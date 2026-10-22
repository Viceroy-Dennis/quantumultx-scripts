// 2026.10.22 签名版 v3（原作：怎么肥事 ZenmoFeiShi 2026.4.8）

/*
@Name：NodeSeek 签到 · 运行时签名版 v3
@Author：原作 怎么肥事 | 重构 Linda for Dennis

❓ 上一版还是会被 403，根因找到了：
NodeSeek 的 Service Worker（sw.js，当前 self.version=0.3.34）给每个请求加
  refract-key / refract-version / refract-sign
签名算法是：
  sign = SHA1( method \n\n url \n\n UA \n\n body \n\n key )
签名**绑定 URL**。抓包时抓到的是 getInfo/xxxx?readme=1 的签名，
拿去请求 /api/attendance?random=true → 服务器验签必然失败 → 403 Forbidden。
也就是说：以前成功率取决于「服务器那天有没有放过验签」，所以时好时坏。

✅ 本版做法：不再重放签名，而是运行时自己算
1. 抓包只存 Cookie / UA / Referer（脏头 [object Null] 过滤），绝不复用 refract-sign
2. 每次签到前先打一次 /edge-cgi/ping：key 有效回 "pong"；
   失效则响应头 refract-key-update 下发新 key（格式 <hex>-<毫秒时间戳>），自动换 key 重打
3. 用新 key 现算签名 → 请求 /api/attendance
4. 签名被拒自动降级为无签名请求（实测该接口也接受无签名，双保险）
5. 403/500 退避重试，USER NOT FOUND 直接判定 Cookie 失效，不瞎重试
6. 启动抖动 + 当天已签零请求跳过；抓到新鲜凭据时趁热补签（单次，不拖住页面）

[rewrite_local]
^https?:\/\/www\.nodeseek\.com\/api\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/nodeseek.qx.checkin.js

[task_local]
23 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/nodeseek.qx.checkin.js, tag=NS🍗签到, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true
（分钟数随便换成你自己的随机值，别整点扎堆）

[MITM]
hostname = www.nodeseek.com
*/

const CFG = {
  random: "true",     // true=随机鸡腿 / false=固定 5 个
  useRefract: "auto", // auto=能签就签、签不了退化 | on=必须签名 | off=不签名
  keyTTL: 15 * 60e3,  // 缓存的 refract-key 多久可复用
  maxRetry: 3,        // 定时任务重试上限
  backoff: 3500,      // 重试退避基数(ms)
  jitterMax: 20e3,    // 定时任务启动抖动上限(ms)
  hotCooldown: 60e3,  // 实时补签冷却，避免刷页面时反复请求
};

const INITIAL_KEY = "CHICZkKViFoZmVbIH1Y6"; // sw.js 内置初始 key，只用于换新 key
const REFRACT_VER = "0.3.34";               // 与 sw.js 的 self.version 对齐

const K_HDR = "NS_NodeseekHeaders";
const K_DATE = "NS_LastCheckinDate";
const K_KEY = "NS_RefractKey";
const K_KEYTS = "NS_RefractKeyTs";
const K_TRY = "NS_LastTryTs";

const BASE = "https://www.nodeseek.com";
const PING_URL = `${BASE}/edge-cgi/ping`;
const ATT_URL = `${BASE}/api/attendance?random=${CFG.random}`;

const isCapture = typeof $request !== "undefined";
const IS_QX = typeof $task !== "undefined";

/* ---------------- 基础工具 ---------------- */

const log = (...a) => console.log("[NS]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notify(title, sub, body) {
  try {
    if (IS_QX) $notify(title, sub, body);
    else $notification.post(title, sub, body);
  } catch (e) { log("notify failed:", e); }
}

const $store = {
  read(k) {
    try {
      const v = IS_QX ? $prefs.valueForKey(k) : $persistentStore.read(k);
      return v === undefined ? null : v;
    } catch (e) { return null; }
  },
  write(k, v) {
    try { return IS_QX ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k); }
    catch (e) { return false; }
  },
};

function todayCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function http(opts) {
  return new Promise((resolve, reject) => {
    if (IS_QX) {
      $task.fetch(opts).then(
        (r) => resolve({ status: r.statusCode, headers: r.headers || {}, body: r.body || "" }),
        (e) => reject(e)
      );
      return;
    }
    const cb = (err, resp, data) => {
      if (err) return reject(err);
      resolve({
        status: (resp && (resp.status || resp.statusCode)) || 0,
        headers: (resp && resp.headers) || {},
        body: data || "",
      });
    };
    const m = (opts.method || "GET").toUpperCase();
    if (m === "GET") $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

function headerOf(headers, name) {
  if (!headers) return null;
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) return headers[k];
  }
  return null;
}

/* ---------------- SHA-1（QX 沙箱没有 crypto.subtle，纯 JS 实现） ---------------- */

function sha1(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const b = [];
  for (let i = 0; i < utf8.length; i++) b.push(utf8.charCodeAt(i) & 0xff);

  const bits = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(bits / 4294967296);
  const lo = bits >>> 0;
  b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  b.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array(80);

  for (let i = 0; i < b.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = (b[i + j * 4] << 24) | (b[i + j * 4 + 1] << 16) | (b[i + j * 4 + 2] << 8) | b[i + j * 4 + 3];
    }
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (x << 1) | (x >>> 31);
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4];
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (j < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = bb ^ c ^ d; k = 0xca62c1d6; }
      const t = ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + w[j]) | 0;
      e = d; d = c; c = ((bb << 30) | (bb >>> 2)) >>> 0; bb = a; a = t;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }
  return h.map((v) => ("00000000" + ((v >>> 0).toString(16))).slice(-8)).join("");
}

function signOf(method, url, body, key, ua) {
  return sha1([method.toUpperCase(), url.split("#")[0], ua, body || "", key].join("\n\n"));
}

function refractHeaders(method, url, body, key, ua) {
  return {
    "refract-sign": signOf(method, url, body, key, ua),
    "refract-version": REFRACT_VER,
    "refract-key": key,
  };
}

/* ---------------- 凭据：抓包存入 / 读取（兼容旧版格式） ---------------- */

const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function cleanCookie(raw) {
  return String(raw || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/\[object .*\]/i.test(s))
    .join("; ");
}

function pickCredentials(headers, url) {
  const get = (n) => headers[n] ?? headers[n.toLowerCase()] ?? headers[n.toUpperCase()];
  const cookie = cleanCookie(get("Cookie"));
  if (!cookie) return null;
  const ua = String(get("User-Agent") || "").trim() || DEFAULT_UA;
  const m = String(url || "").match(/getInfo\/(\d+)/);
  return {
    cookie,
    ua,
    lang: String(get("Accept-Language") || "").trim() || "zh-CN,zh;q=0.9",
    referer: String(get("Referer") || "").trim() || `${BASE}/board`,
    memberId: m ? m[1] : "",
    ts: Date.now(),
  };
}

// 兼容 v2（拍平成 header 的旧格式）与 v3（结构化）
function readCredentials() {
  const raw = $store.read(K_HDR);
  if (!raw) return null;
  let o;
  try { o = JSON.parse(raw); } catch (e) { return "broken"; }
  if (!o) return "broken";
  if (o.cookie) return o;
  // 旧格式迁移
  const cookie = cleanCookie(o["Cookie"] || o["cookie"]);
  if (!cookie) return "broken";
  return {
    cookie,
    ua: String(o["User-Agent"] || DEFAULT_UA),
    lang: String(o["Accept-Language"] || "zh-CN,zh;q=0.9"),
    referer: String(o["Referer"] || `${BASE}/board`),
    memberId: "",
    ts: 0,
  };
}

function requestHeaders(cred, key, method, url) {
  const h = {
    "Accept": "*/*",
    "Accept-Language": cred.lang || "zh-CN,zh;q=0.9",
    "User-Agent": cred.ua,
    "Cookie": cred.cookie,
    "Origin": BASE,
    "Referer": cred.referer || `${BASE}/board`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (key && method && url) Object.assign(h, refractHeaders(method, url, "", key, cred.ua));
  return h;
}

/* ---------------- refract key：ping 换新 ---------------- */

function saveKey(k) {
  if (!k) return;
  $store.write(K_KEY, k);
  $store.write(K_KEYTS, String(Date.now()));
}

async function pingKey(key, cred) {
  const headers = requestHeaders(cred, key, "GET", PING_URL);
  const r = await http({ url: PING_URL, method: "GET", headers });
  return { status: r.status, body: String(r.body || "").slice(0, 60), next: headerOf(r.headers, "refract-key-update") };
}

async function ensureKey(cred) {
  const cached = $store.read(K_KEY) || "";
  const ts = parseInt($store.read(K_KEYTS) || "0", 10) || 0;
  if (cached && Date.now() - ts < CFG.keyTTL) return cached;

  let key = cached || INITIAL_KEY;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await pingKey(key, cred);
      if (r.status >= 200 && r.status < 300) { saveKey(key); return key; }
      if (!r.next) break;
      log("key 失效，换服务器下发的新 key");
      key = r.next;
    } catch (e) {
      log("ping 异常:", String(e && e.message ? e.message : e));
      break;
    }
  }
  return null;
}

/* ---------------- 签到一次 ---------------- */

async function checkinOnce(cred, key) {
  const headers = requestHeaders(cred, key, "POST", ATT_URL);
  headers["Content-Type"] = "text/plain;charset=UTF-8";
  const r = await http({ url: ATT_URL, method: "POST", headers, body: "" });
  return { status: r.status, body: String(r.body || ""), next: headerOf(r.headers, "refract-key-update") };
}

function msgOf(body) {
  try { const o = JSON.parse(body); return (o && (o.message || o.msg)) || ""; }
  catch (e) { return ""; }
}

async function profileOf(cred, key) {
  if (!cred.memberId) return null;
  try {
    const url = `${BASE}/api/account/getInfo/${cred.memberId}?readme=1`;
    const r = await http({ url, method: "GET", headers: requestHeaders(cred, key, "GET", url) });
    const o = JSON.parse(r.body || "{}");
    return (o && o.detail) || null;
  } catch (e) { return null; }
}

/* ---------------- 结果分类 ---------------- */

function classify(r) {
  const msg = msgOf(r.body);
  if (r.status >= 200 && r.status < 300) {
    if (/已完成签到|已经签到|请勿重复/.test(msg)) return { kind: "already", msg };
    if (!msg && r.body.indexOf("success") === -1) return { kind: "odd", msg: r.body.slice(0, 120) };
    return { kind: "ok", msg: msg || "签到成功" };
  }
  if (/USER NOT FOUND/i.test(r.body)) return { kind: "auth", msg: "USER NOT FOUND" };
  if (r.status === 403) return { kind: "blocked", msg: msg || (r.body.indexOf("Just a moment") >= 0 ? "Cloudflare 挑战页" : "403 Forbidden") };
  if (r.status === 500) return { kind: "server", msg: msg || "服务器 500" };
  return { kind: "error", msg: msg || r.body.slice(0, 120) || `status=${r.status}` };
}

/* ---------------- 主签到流程 ---------------- */

async function runCheckin(cred, { retries, hot }) {
  let key = CFG.useRefract === "off" ? null : await ensureKey(cred);
  if (CFG.useRefract === "on" && !key) return { kind: "nokey", msg: "拿不到 refract-key" };

  let last = { status: 0, body: "", next: null };
  for (let i = 1; i <= retries; i++) {
    try {
      last = await checkinOnce(cred, key);
    } catch (e) {
      last = { status: 0, body: String(e && e.message ? e.message : e), next: null };
    }
    const res = classify(last);
    log(`第 ${i} 次 → ${last.status} ${res.kind} ${res.msg}`);

    if (res.kind === "ok" || res.kind === "already" || res.kind === "auth" || res.kind === "odd") {
      return { kind: res.kind, msg: res.msg, status: last.status, key };
    }
    // 服务端给了新 key：换 key 重签，不消耗重试次数
    if (last.next && i < retries) {
      log("换 key 重签");
      key = last.next;
      saveKey(key);
      continue;
    }
    // 签名被拒且换不到 key：降级无签名再来一次
    if ((last.status === 401 || last.status === 403) && key) {
      log("签名被拒，降级无签名请求");
      key = null;
      $store.write(K_KEY, "");
      continue;
    }
    if (i < retries && !hot) await sleep(CFG.backoff * i);
  }
  const res = classify(last);
  return { kind: res.kind, msg: res.msg, status: last.status, key };
}

async function report(res, label, cred) {
  const title = `NodeSeek 签到（${label}）`;
  const withExtra = async (msg) => {
    if (!cred) return msg;
    const p = await profileOf(cred, res.key);
    return p ? `${msg}\nLV${p.rank || "-"} · 鸡腿 ${p.coin ?? "-"}` : msg;
  };

  if (res.kind === "ok") {
    $store.write(K_DATE, todayCN());
    notify(title, "签到完成", await withExtra(res.msg));
    return;
  }
  if (res.kind === "already") {
    $store.write(K_DATE, todayCN());
    notify(title, "今天已签到", await withExtra(res.msg));
    return;
  }
  if (res.kind === "odd") {
    $store.write(K_DATE, todayCN());
    notify(title, "签到完成", res.msg || "接口返回异常内容，但状态码正常");
    return;
  }
  if (res.kind === "auth") {
    notify(title, "登录态失效", "服务器返回 USER NOT FOUND，请打开一次 NodeSeek 页面重新抓包。");
    return;
  }
  if (res.kind === "nokey") {
    notify(title, "签名失败", "拿不到 refract-key，已按配置不降级。");
    return;
  }
  if (res.kind === "blocked") {
    notify(title, "403 被拦截", `${res.msg}\n打开一次 NodeSeek 页面会用新鲜凭据自动补签。`);
    return;
  }
  if (res.kind === "server") {
    notify(title, "500 服务器错误", `${res.msg}\n稍后重试或等下次定时任务。`);
    return;
  }
  notify(title, `请求异常 ${res.status}`, res.msg);
}

/* ---------------- 抓包分支：存凭据 + 趁热补签 ---------------- */

async function onCapture() {
  try {
    const cred = pickCredentials($request.headers || {}, $request.url);
    if (!cred) {
      notify("NodeSeek 凭据获取失败", "", "没抓到 Cookie，请在登录状态下打开自己的个人主页。");
      return;
    }
    $store.write(K_HDR, JSON.stringify(cred));
    log("凭据已保存", cred.memberId || "(无 ID)");

    if ($store.read(K_DATE) === todayCN()) {
      log("今天已签，静默保鲜");
      return;
    }
    const lastTry = parseInt($store.read(K_TRY) || "0", 10) || 0;
    if (Date.now() - lastTry < CFG.hotCooldown) {
      log("补签冷却中，跳过");
      return;
    }
    $store.write(K_TRY, String(Date.now()));
    // 趁热补签：单次、不抖动，尽量不拖住页面这个请求
    const res = await runCheckin(cred, { retries: 1, hot: true });
    if (res.kind === "ok" || res.kind === "already" || res.kind === "odd") {
      await report(res, "实时补签", cred);
    } else {
      log("实时补签未成功，等定时任务兜底:", res.kind, res.msg);
    }
  } catch (e) {
    log("capture 分支异常:", e);
  } finally {
    $done({}); // 无论成败都要放行被拦截的请求
  }
}

/* ---------------- 定时分支 ---------------- */

async function onSchedule() {
  try {
    const cred = readCredentials();
    if (cred === "broken") {
      notify("NodeSeek 签到（定时）", "凭据损坏", "请打开一次 NodeSeek 页面重新抓包。");
      return;
    }
    if (!cred) {
      notify("NodeSeek 签到（定时）", "无法签到", "本地没有凭据，打开一次 NodeSeek 页面即可自动完成。");
      return;
    }
    if ($store.read(K_DATE) === todayCN()) {
      log("今天已签，跳过");
      return;
    }
    if (CFG.jitterMax > 0) await sleep(Math.floor(Math.random() * CFG.jitterMax));

    const res = await runCheckin(cred, { retries: CFG.maxRetry, hot: false });
    await report(res, "定时", cred);
  } catch (e) {
    log("schedule 分支异常:", e);
    notify("NodeSeek 签到（定时）", "脚本异常", String((e && e.message) || e));
  } finally {
    $done();
  }
}

if (isCapture) onCapture();
else onSchedule();
