// NodeSeek 体检脚本 · 一次跑完把「卡在哪一层」问出来
// 用法：导入后长按「NS诊断」→ 手动运行；结果看通知和 QX 日志。
// 只读诊断，会顺手打一次签到接口（等于正常签到，没有副作用）。

const BASE = "https://www.nodeseek.com";
const K_HDR = "NS_NodeseekHeaders";
const K_KEY = "NS_RefractKey";
const K_KEYTS = "NS_RefractKeyTs";
const INITIAL_KEY = "CHICZkKViFoZmVbIH1Y6";
const VER = "0.3.34";
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const IS_QX = typeof $task !== "undefined";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notify(t, s, b) {
  try { IS_QX ? $notify(t, s, b) : $notification.post(t, s, b); } catch (e) {}
}
function read(k) {
  try { return IS_QX ? $prefs.valueForKey(k) : $persistentStore.read(k); } catch (e) { return null; }
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
      resolve({ status: (resp && (resp.status || resp.statusCode)) || 0, headers: (resp && resp.headers) || {}, body: data || "" });
    };
    ((opts.method || "GET").toUpperCase() === "GET") ? $httpClient.get(opts, cb) : $httpClient.post(opts, cb);
  });
}
function hdr(h, name) {
  if (!h) return null;
  const w = String(name).toLowerCase();
  for (const k of Object.keys(h)) if (String(k).toLowerCase() === w) return h[k];
  return null;
}
function sha1(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const b = [];
  for (let i = 0; i < utf8.length; i++) b.push(utf8.charCodeAt(i) & 0xff);
  const bits = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
  b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  b.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0], w = new Array(80);
  for (let i = 0; i < b.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = (b[i + j * 4] << 24) | (b[i + j * 4 + 1] << 16) | (b[i + j * 4 + 2] << 8) | b[i + j * 4 + 3];
    for (let j = 16; j < 80; j++) { const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]; w[j] = (x << 1) | (x >>> 31); }
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
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }
  return h.map((v) => ("00000000" + ((v >>> 0).toString(16))).slice(-8)).join("");
}
const sign = (m, u, b, k, ua) => sha1([m.toUpperCase(), u.split("#")[0], ua, b || "", k].join("\n\n"));

function isCF(r) {
  return r.status === 403 && /just a moment|attention required|cf-chl|cf-mitigated|<title>|cloudflare/i.test(String(r.body || ""));
}
function brief(r) {
  const b = String(r.body || "").replace(/\s+/g, " ").slice(0, 70);
  return `${r.status} ${b}`;
}

(async () => {
  const lines = [];
  let verdict = "";

  // 0. 凭据状态
  let cred = null;
  const raw = read(K_HDR);
  if (raw) {
    try { cred = JSON.parse(raw); } catch (e) { cred = null; }
    if (cred && !cred.cookie && cred["Cookie"]) cred = { cookie: cred["Cookie"], ua: cred["User-Agent"] || DEFAULT_UA, lang: "zh-CN,zh;q=0.9", referer: `${BASE}/board`, memberId: "", ts: 0 };
  }
  const hasSession = cred && /(?:^|;\s*)session=/.test(cred.cookie);
  const hasCF = cred && /cf_clearance=/.test(cred.cookie);
  const age = cred && cred.ts ? Math.round((Date.now() - cred.ts) / 60000) + " 分钟前" : "未知";
  lines.push(`凭据：${raw ? (hasSession ? "有 session" : "无 session") + ` / ${hasCF ? "有" : "无"} cf_clearance / 更新于 ${age}` : "❌ 没抓到（重写规则没生效）"}`);

  const ua = (cred && cred.ua) || DEFAULT_UA;
  const cookie = (cred && cred.cookie) || "";
  const H = () => ({
    "Accept": "*/*", "Accept-Language": "zh-CN,zh;q=0.9", "User-Agent": ua,
    ...(cookie ? { Cookie: cookie } : {}),
    "Origin": BASE, "Referer": `${BASE}/board`,
  });

  // 1. 首页（判断是不是 CF 盾）
  try {
    const r = await http({ url: BASE + "/", method: "GET", headers: H() });
    lines.push(`首页：${r.status}${isCF(r) ? " ⛔ CF 挑战页" : ""} / server=${hdr(r.headers, "server") || "-"}`);
  } catch (e) { lines.push(`首页：请求失败 ${e}`); }

  // 2. ping 未签名 / 签名
  let key = read(K_KEY) || INITIAL_KEY;
  try {
    const r = await http({ url: BASE + "/edge-cgi/ping", method: "GET", headers: H() });
    lines.push(`ping 未签名：${brief(r)}`);
  } catch (e) { lines.push(`ping 未签名：失败 ${e}`); }
  try {
    let r = await http({ url: BASE + "/edge-cgi/ping", method: "GET", headers: { ...H(), "refract-sign": sign("GET", BASE + "/edge-cgi/ping", "", key, ua), "refract-version": VER, "refract-key": key } });
    let nk = hdr(r.headers, "refract-key-update");
    lines.push(`ping 签名：${brief(r)}${nk ? " · 下发新key" : ""}`);
    if (nk) {
      key = nk;
      r = await http({ url: BASE + "/edge-cgi/ping", method: "GET", headers: { ...H(), "refract-sign": sign("GET", BASE + "/edge-cgi/ping", "", key, ua), "refract-version": VER, "refract-key": key } });
      lines.push(`ping 换key后：${brief(r)}`);
    }
  } catch (e) { lines.push(`ping 签名：失败 ${e}`); }

  // 3. 签到（签名）
  try {
    const url = `${BASE}/api/attendance?random=true`;
    const r = await http({
      url, method: "POST",
      headers: { ...H(), "Content-Type": "text/plain;charset=UTF-8", "refract-sign": sign("POST", url, "", key, ua), "refract-version": VER, "refract-key": key },
      body: "",
    });
    lines.push(`签到(签名)：${brief(r)}`);
    if (isCF(r)) verdict = "CF";
    else if (r.status >= 200 && r.status < 300) verdict = "OK";
    else if (/USER NOT FOUND/i.test(r.body)) verdict = "AUTH";
    else verdict = "OTHER";
  } catch (e) { lines.push(`签到(签名)：失败 ${e}`); }

  // 4. CF 盾的话，去掉 cf_clearance 再试一次
  if (verdict === "CF") {
    const bare = cookie.split(";").map((s) => s.trim()).filter((s) => s && !/^cf_clearance=/.test(s) && !/^__cf_bm=/.test(s)).join("; ");
    try {
      const r = await http({ url: `${BASE}/api/attendance?random=true`, method: "POST", headers: { ...H(), Cookie: bare, "Content-Type": "text/plain;charset=UTF-8" }, body: "" });
      lines.push(`签到(去cf_clearance)：${brief(r)}`);
      if (!isCF(r)) verdict = "CF-NOCF";
    } catch (e) { lines.push(`签到(去cf_clearance)：失败 ${e}`); }
  }

  const map = {
    OK: ["签到接口通了", "这条链路正常，问题只在凭据过期或定时时机。"],
    AUTH: ["Cookie 已失效", "抓包存的是旧 session，需要用新规则重新抓一次。"],
    CF: ["卡在 Cloudflare 盾", "QX 的 TLS 指纹被 CF 认出来，签名救不了。把 www.nodeseek.com 走直连，或改用浏览器补签。"],
    "CF-NOCF": ["CF 只认带 cf_clearance 的请求", "去掉它反而通了——脚本会自动这么降级。"],
    OTHER: ["接口报错", "看下面的原始返回。"],
    "": ["没跑完", "网络层直接失败，检查 QX 隧道/策略。"],
  };
  const [title, tip] = map[verdict] || map.OTHER;
  notify(`NS 诊断：${title}`, tip, lines.join("\n"));

  console.log("[NS诊断]\n" + lines.join("\n"));
  $done();
})();
