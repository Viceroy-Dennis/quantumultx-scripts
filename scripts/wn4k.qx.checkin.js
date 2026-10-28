/*
 * 蜗牛 I 4K（wn4k.com）每日签到 · 多账号 · Quantumult X / Surge 双端通用
 * 作者：Linda for Dennis
 * 版本：2.0.0（多账号改造）
 *
 * 站点是 MacCMS V10 + 盘链模板，接口已实测：
 *   登录  POST https://wn4k.com/user/login.html
 *         表单 user_name / user_pwd（明文，无验证码）
 *         成功 {"code":1,"msg":...}；失败 {"code":1003,"msg":"获取用户信息失败"}；封禁 1004
 *   签到  POST https://wn4k.com/user/checkin.html  （要登录 Cookie + X-Requested-With）
 *         成功 {"code":1,"msg":"签到成功","info":{"points":10}}
 *         今日已签 {"code":1001,...}
 *         未登录 直接 302 跳 /user/login.html
 *
 * ── 多账号怎么用 ────────────────────────────────────────────────
 * 三种方式，可以混着来：
 *   ① 账号密码（推荐，不怕 Cookie 过期）
 *      Surge → 模块参数 account：a@qq.com|p1;b@qq.com|p2;c@qq.com|p3
 *      QX    → 任务行 URL 后面加 #acct=a@qq.com%7Cp1%3Bb@qq.com%7Cp2
 *              （QX 会校验任务行 URL，竖线和分号必须编码：| → %7C，; → %3B）
 *      也可以往持久化存储 WN4K_ACCOUNTS 写 JSON 数组 ["a@qq.com|p1","b@qq.com|p2"]
 *
 *   ② 抓包（零配置，一个账号抓一次）
 *      装上重写规则后，用哪个账号登录 wn4k.com 并打开「会员中心」，
 *      那个账号的 Cookie 就自动存进它自己的桶里。换账号再登录一次即可。
 *      多个账号就依次登录一遍。
 *
 *   ③ 两者混用：同一个账号既填了账密又抓过包 → 优先用 Cookie，
 *      Cookie 失效才拿账密重登，不会重复签到。
 *
 * 每个账号有独立的 Cookie 和独立的「今日已签」标记，互不干扰。
 * 账号身份用 Cookie 里的 user_id 认（抓包和登录拿到的 user_id 一致），
 * 所以同一账号的两种凭据会自动合并成一个。
 *
 * [rewrite_local]
 * ^https?:\/\/(www\.)?wn4k\.com\/user\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/wn4k.qx.checkin.js
 *
 * [task_local]
 * 14 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/wn4k.qx.checkin.js, tag=蜗牛4K签到, img-url=https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/icons/wn4k.png, enabled=true
 *
 * [MITM]
 * hostname = wn4k.com, www.wn4k.com
 */

const VERSION = "2.0.0";
const NAME = "蜗牛4K签到";
const BASE = "https://wn4k.com";

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const CONFIG = {
  // 可选账号密码，格式 "账号,密码"（也可换成 QQ 邮箱）。留空就纯用抓包 Cookie。
  accounts: [],
  retry: 2,          // 单次签到失败重试次数
  jitterMax: 15e3,   // 定时任务启动抖动，避开整点
  gapMin: 1200,      // 账号之间的最小间隔（毫秒）
  gapMax: 2700,      // 账号之间的最大间隔（毫秒）
  notifyMax: 1500,   // 通知正文上限，超了截断
};

// ── 存储键 ──────────────────────────────────────────────
const K_CREDS = "WN4K_CREDS";       // JSON: { "<uid>": {ck, nm, acct, t} } 每账号独立 Cookie
const K_DONE = "WN4K_DONE";         // JSON: { "<uid>": "2026-10-28" } 每账号独立签到日期
const K_ACCT = "WN4K_ACCOUNTS";     // JSON 数组，运行时账号密码
const K_MIG = "WN4K_MIGRATED_V2";   // 老版本单桶数据是否已迁移
const K_OLD_CRED = "WN4K_CRED";     // v1 遗留：单个 Cookie
const K_OLD_DATE = "WN4K_LAST_DATE";// v1 遗留：单个签到日期

const IS_QX = typeof $task !== "undefined";
const isCapture = typeof $request !== "undefined";

// 参数来源：
//   Surge → 模块参数 $argument
//   QX    → 任务行 URL 的 #hash，从 $environment.variables 读（QX 1.5.6 build 918+）
//   例：.../wn4k.qx.checkin.js#acct=账号%7C密码%3B账号2%7C密码2, tag=蜗牛4K签到
//   注意 QX 的 URL 校验：竖线必须写成 %7C，分号写成 %3B，否则任务存不进去
const ARG = (() => {
  try {
    if (typeof $argument !== "undefined" && $argument) return String($argument).trim();
    if (typeof $environment !== "undefined" && $environment && $environment.variables) {
      const v = $environment.variables;
      return Object.keys(v)
        .map((k) => `${k}=${v[k]}`)
        .join("&");
    }
  } catch (e) {}
  return "";
})();

/* ------------------------------ 基础工具 ------------------------------ */

const log = (...a) => console.log("[WN4K]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notify(title, sub, body) {
  try {
    let text = String(body || "");
    if (CONFIG.notifyMax > 0 && text.length > CONFIG.notifyMax) {
      text = text.slice(0, CONFIG.notifyMax) + "\n…（内容过长已截断）";
    }
    if (IS_QX) $notify(title, sub, text);
    else $notification.post(title, sub, text);
  } catch (e) {
    log("通知失败", String(e));
  }
}

const store = {
  read(k) {
    try {
      const v = IS_QX ? $prefs.valueForKey(k) : $persistentStore.read(k);
      return v === undefined || v === null ? "" : String(v);
    } catch (e) {
      return "";
    }
  },
  write(k, v) {
    try {
      return IS_QX ? $prefs.setValueForKey(String(v), k) : $persistentStore.write(String(v), k);
    } catch (e) {
      return false;
    }
  },
};

function readJSON(k, def) {
  const raw = store.read(k);
  if (!raw) return def;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : def;
  } catch (e) {
    return def;
  }
}

function writeJSON(k, v) {
  return store.write(k, JSON.stringify(v));
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function headerOf(headers, name) {
  if (!headers) return "";
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) return headers[k];
  }
  return "";
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
    const method = String(opts.method || "GET").toUpperCase();
    if (method === "GET") $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

/** 稳定短哈希，用来给「只有用户名没有 user_id」的账号造一个桶名 */
function hashKey(s) {
  let h = 5381;
  const t = String(s || "").toLowerCase();
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36);
}

function safeDecode(s) {
  const v = String(s == null ? "" : s).trim();
  if (!v) return "";
  if (!/%[0-9a-f]{2}/i.test(v)) return v;
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return v;
  }
}

/** 通知里显示的脱敏名字：ab***@qq.com / 王** */
function maskName(name) {
  const s = String(name || "").trim();
  if (!s) return "账号";
  if (s.includes("@")) return s.replace(/^(.{1,3}).*(@.*)$/, "$1***$2");
  if (s.length <= 2) return s.slice(0, 1) + "**";
  return s.slice(0, 2) + "***";
}

/* ------------------------------ Cookie 处理 ------------------------------ */

/**
 * 解析 Set-Cookie。QX/Surge 给的是字符串（多条可能用逗号拼在一起），
 * 也可能直接给数组。Expires 里自带逗号，所以要按「后面紧跟 name=」才切。
 */
function parseSetCookie(raw) {
  if (!raw) return "";
  const lines = Array.isArray(raw) ? raw : [String(raw)];
  const jar = {};
  const SKIP = /^(expires|path|domain|max-age|samesite|secure|httponly|priority|partitioned)$/i;

  for (const line of lines) {
    const chunks = String(line).split(/,\s*(?=[A-Za-z0-9_\-\.]+=)/);
    for (const chunk of chunks) {
      const m = chunk.match(/^\s*([A-Za-z0-9_\-\.]+)=([^;]*)/);
      if (!m) continue;
      if (SKIP.test(m[1])) continue;
      const val = m[2].trim();
      if (!val || /\[object .*\]/i.test(val)) continue;
      jar[m[1]] = val;
    }
  }
  return Object.keys(jar)
    .map((k) => `${k}=${jar[k]}`)
    .join("; ");
}

function cookieLooksAlive(cookie) {
  if (!cookie) return false;
  // MacCMS V10 登录时写的是 user_id / user_name / group_id / group_name / user_check / user_portrait，
  // 其中 user_check = md5(服务器随机数-用户名-user_id-)，只能靠登录或抓包拿，没法本地算。
  // PHPSESSID 未登录访客也会发，单独存在不算登录。
  return /(?:^|;\s*)(user_check|user_id)=/i.test(cookie);
}

function cookieBrief(cookie) {
  return String(cookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("=")[0])
    .join(",");
}

function cookieField(cookie, name) {
  const m = String(cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)", "i"));
  return m ? m[1].trim() : "";
}

/** 从 Cookie 里认人：优先 user_id（登录和抓包都一致），退而用 user_name 的哈希 */
function uidFromCookie(cookie) {
  const id = cookieField(cookie, "user_id");
  if (/^\d+$/.test(id) && id !== "0") return "u" + id;
  const nm = safeDecode(cookieField(cookie, "user_name"));
  if (nm) return "n" + hashKey(nm);
  return "";
}

function cookieName(cookie) {
  return safeDecode(cookieField(cookie, "user_name"));
}

/* ------------------------------ 接口调用 ------------------------------ */

function baseHeaders(extra) {
  return Object.assign(
    {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": DEFAULT_UA,
      "Origin": BASE,
    },
    extra || {}
  );
}

async function doLogin(user, pwd) {
  const r = await http({
    url: `${BASE}/user/login.html`,
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE}/user/login.html`,
    }),
    body: `user_name=${encodeURIComponent(user)}&user_pwd=${encodeURIComponent(pwd)}`,
  });

  let j = null;
  try {
    j = JSON.parse(r.body || "{}");
  } catch (e) {
    j = null;
  }

  if (!j && r.status === 403 && /just a moment|cf-chl|cf-mitigated/i.test(String(r.body || ""))) {
    return { ok: false, kind: "cf", msg: "登录接口被 Cloudflare 挑战页拦住" };
  }

  const cookie = parseSetCookie(headerOf(r.headers, "set-cookie"));
  log(`登录 ${user} → HTTP ${r.status} code=${j && j.code} cookie=[${cookieBrief(cookie)}]`);

  if (j && Number(j.code) === 1) {
    if (!cookie) return { ok: false, kind: "nocookie", msg: "登录成功但没拿到 Set-Cookie" };
    return { ok: true, cookie };
  }
  if (j && Number(j.code) === 1004) {
    return { ok: false, kind: "banned", msg: j.msg || "账号被封禁" };
  }
  if (j && Number(j.code) === 1003) {
    return { ok: false, kind: "auth", msg: j.msg || "账号或密码错误" };
  }
  return { ok: false, kind: "error", msg: (j && j.msg) || `HTTP ${r.status} ${String(r.body || "").slice(0, 80)}` };
}

async function doCheckin(cookie) {
  const r = await http({
    url: `${BASE}/user/checkin.html`,
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE}/user/checkin.html`,
      "Cookie": cookie,
    }),
    body: "",
  });

  const bodyText = String(r.body || "");
  const looksLoginPage = /<title>[^<]*用户登录|请先登录后再签到/i.test(bodyText);

  if (r.status === 403 && /just a moment|cf-mitigated|attention required|cf-chl/i.test(bodyText)) {
    return { kind: "cf", msg: "被 Cloudflare 挑战页拦住（403）", status: r.status };
  }

  if (r.status === 302 || r.status === 301 || looksLoginPage) {
    return { kind: "need-login", msg: "Cookie 失效，被踢回登录页", status: r.status };
  }

  let j = null;
  try {
    j = JSON.parse(bodyText || "{}");
  } catch (e) {
    j = null;
  }

  if (!j) {
    return { kind: "error", msg: `响应非 JSON（HTTP ${r.status}）: ${bodyText.slice(0, 100)}`, status: r.status };
  }

  const code = Number(j.code);
  const msg = j.msg || j.message || "";
  const points = (j.info && (j.info.points ?? j.info.reward)) ?? null;

  log(`签到 → HTTP ${r.status} code=${code} msg=${msg} points=${points}`);

  if (code === 1) {
    return { kind: "ok", msg: msg || "签到成功", points, status: r.status };
  }
  if (code === 1001 || /已签到|已经签到|请勿重复/.test(msg)) {
    return { kind: "already", msg: msg || "今日已签到", status: r.status };
  }
  if (code === 1003 || code === 1004) {
    return { kind: "need-login", msg: msg || "登录态无效", status: r.status };
  }
  return { kind: "error", msg: msg || `code=${code}`, status: r.status };
}

/* ------------------------------ 账号来源 ------------------------------ */

/**
 * 一行一个账号，账号和密码之间用 | 分隔。
 * 注意不要用英文逗号——Surge 的 [Script] 行是按逗号切参数的，
 * argument 的值里一带逗号，整行就会解析错，UI 直接报「参数无效」。
 * 老写法（逗号/中文逗号/冒号）仍然兼容，只是 Surge 端别用。
 */
function parseAccountLine(line) {
  const s = String(line || "")
    .trim()
    .replace(/^["'\u201c\u201d]|["'\u201c\u201d]$/g, "");
  if (!s) return null;
  const m = s.match(/^([^|,，:：\s][^|,，:：]*?)\s*[|,，:：]\s*(.+)$/);
  if (!m) return null;
  return { user: m[1].trim(), pwd: m[2].trim() };
}

/**
 * 解析模块参数 / 任务行 hash。
 * 支持「#acct=账号|密码;账号2|密码2」（QX 里要写成 %7C / %3B）以及「#u=账号&p=密码」。
 * 值里如果出现被 URL 编码的 &（%26），先还原成 && 再切，避免被切碎。
 */
function argToAccounts(raw) {
  const s = String(raw || "").trim();
  if (!s || /^(none|null|undefined|空)$/i.test(s)) return [];

  const dec = (x) => {
    try {
      return decodeURIComponent(x);
    } catch (e) {
      return x;
    }
  };

  const norm = s.replace(/%26%26/gi, "&&");

  // 形式一：#u=账号&p=密码（单账号）
  const mu = norm.match(/(?:^|[&#])u=([^&#]*)/i);
  const mp = norm.match(/(?:^|[&#])p=([^&#]*)/i);
  if (mu && mp) return [{ user: dec(mu[1]).trim(), pwd: dec(mp[1]).trim() }];

  // 形式二：#acct=账号|密码;账号2|密码2
  let val = norm;
  const m2 = norm.match(/(?:^|[&#])(?:acct|account)=([\s\S]*)$/i);
  if (m2) val = m2[1];
  val = dec(val);
  // 账号之间：&& / 分号（半角或全角）/ 换行 都认
  return val
    .split(/&&|[;；]|\n/)
    .map(parseAccountLine)
    .filter(Boolean);
}

function readAccounts() {
  const seen = {};
  const push = (arr, out) => {
    for (const a of arr) {
      if (!a || !a.user) continue;
      const k = a.user.toLowerCase();
      if (seen[k]) continue; // 同一账号只留第一个
      seen[k] = 1;
      out.push(a);
    }
  };
  const out = [];

  // 0) 模块参数 / 任务行 hash
  push(argToAccounts(ARG), out);
  if (out.length) {
    log(`账号来源：参数，共 ${out.length} 个`);
    return out;
  }

  // 1) 运行时写入的（JSON 数组 或 换行分隔）
  const raw = store.read(K_ACCT);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        push(arr.map((it) => (typeof it === "string" ? parseAccountLine(it) : it)).filter(Boolean), out);
        if (out.length) {
          log(`账号来源：WN4K_ACCOUNTS(JSON)，共 ${out.length} 个`);
          return out;
        }
      }
    } catch (e) {
      push(raw.split(/\n|&&|[;；]/).map(parseAccountLine).filter(Boolean), out);
      if (out.length) {
        log(`账号来源：WN4K_ACCOUNTS(文本)，共 ${out.length} 个`);
        return out;
      }
    }
  }

  // 2) 脚本内常量
  push((CONFIG.accounts || []).map((s) => (typeof s === "string" ? parseAccountLine(s) : s)).filter(Boolean), out);
  return out;
}

/* ------------------------------ 账号桶（凭据 / 日期） ------------------------------ */

function readCreds() {
  const v = readJSON(K_CREDS, {});
  const out = {};
  for (const k of Object.keys(v)) {
    const it = v[k];
    if (it && typeof it === "object" && typeof it.ck === "string" && it.ck) out[k] = it;
  }
  return out;
}

function writeCreds(creds) {
  return writeJSON(K_CREDS, creds);
}

function readDone() {
  return readJSON(K_DONE, {});
}

function writeDone(done) {
  return writeJSON(K_DONE, done);
}

function putCred(creds, uid, cookie, acctUser) {
  const old = creds[uid] || {};
  creds[uid] = {
    ck: cookie,
    nm: cookieName(cookie) || old.nm || "",
    acct: acctUser || old.acct || "",
    t: Date.now(),
  };
  return creds[uid];
}

/**
 * v1 → v2 迁移：老脚本把 Cookie 和日期都塞在单个 key 里，
 * 这里拆成按账号的桶，迁完就把老键清掉（留个标记位，不会重复迁）。
 */
function migrateLegacy(creds, done) {
  if (store.read(K_MIG) === "1") return { creds, done, changed: false };
  let changed = false;

  const oldCk = store.read(K_OLD_CRED);
  if (oldCk && cookieLooksAlive(oldCk)) {
    const uid = uidFromCookie(oldCk) || "n" + hashKey(cookieName(oldCk) || "legacy");
    if (!creds[uid] || !cookieLooksAlive(creds[uid].ck)) {
      putCred(creds, uid, oldCk, "");
      changed = true;
      log(`迁移 v1 Cookie → 桶 ${uid}`);
    }
  }

  const oldDate = store.read(K_OLD_DATE);
  if (oldDate && /^\d{4}-\d{2}-\d{2}$/.test(oldDate)) {
    // 老日期没法对应到具体账号，只给「刚迁移进来的那个桶」用，避免误伤别的账号
    const uids = Object.keys(creds).filter((k) => !done[k]);
    if (uids.length === 1) {
      done[uids[0]] = oldDate;
      changed = true;
    }
  }

  store.write(K_MIG, "1");
  store.write(K_OLD_CRED, "");
  store.write(K_OLD_DATE, "");
  return { creds, done, changed };
}

/** 给一个账密账号找它已有的桶：先按记录过的账号名，再按 cookie 里的 user_name */
function findBucket(creds, user) {
  const want = String(user || "").trim().toLowerCase();
  if (!want) return "";
  for (const uid of Object.keys(creds)) {
    const it = creds[uid];
    if (it.acct && String(it.acct).trim().toLowerCase() === want) return uid;
    if (it.nm && String(it.nm).trim().toLowerCase() === want) return uid;
  }
  return "";
}

/* ------------------------------ 单个账号签到 ------------------------------ */

async function runJob(job, creds, done) {
  const acct = job.acct;
  let uid = job.uid || "";
  let entry = uid ? creds[uid] : null;
  let cookie = entry && entry.ck ? entry.ck : "";

  let tag = maskName((acct && acct.user) || (entry && entry.nm) || "账号");

  // 1) 没有可用 Cookie → 用账号密码登录（有账密才行）
  if (!cookieLooksAlive(cookie)) {
    if (!acct) {
      return { uid, tag, kind: "nocred", msg: "Cookie 已失效，请重新抓包" };
    }
    log(`${tag} 没有可用 Cookie，走账号密码登录`);
    const g = await doLogin(acct.user, acct.pwd);
    if (!g.ok) return { uid, tag, kind: g.kind, msg: g.msg };

    cookie = g.cookie;
    const newUid = uidFromCookie(cookie) || uid || "n" + hashKey(acct.user);
    if (uid && uid !== newUid) delete creds[uid]; // 同一账号换了桶名，旧的并过去
    uid = newUid;
    putCred(creds, uid, cookie, acct.user);
    writeCreds(creds);
    tag = maskName(acct.user);
  }

  if (!cookieLooksAlive(cookie)) {
    return {
      uid,
      tag,
      kind: "nocred",
      msg: "没有登录凭据。浏览器登录 wn4k.com 后打开一次「会员中心」，或填账号密码。",
    };
  }

  // 2) 签到（Cookie 失效时用账密换新 Cookie 再来一次）
  let last = null;
  for (let i = 1; i <= Math.max(1, CONFIG.retry); i++) {
    try {
      last = await doCheckin(cookie);
    } catch (e) {
      last = { kind: "error", msg: `请求异常: ${(e && e.message) || e}` };
    }

    if (last.kind !== "need-login") break;

    if (acct && i === 1) {
      log(`${tag} Cookie 失效，用账号密码重新登录`);
      const g = await doLogin(acct.user, acct.pwd);
      if (!g.ok) return { uid, tag, kind: g.kind, msg: g.msg };
      cookie = g.cookie;
      const newUid = uidFromCookie(cookie) || uid;
      if (uid && uid !== newUid) delete creds[uid];
      uid = newUid;
      putCred(creds, uid, cookie, acct.user);
      writeCreds(creds);
      continue;
    }
    break;
  }

  if (last.kind === "ok") {
    const extra = last.points != null ? ` 积分 +${last.points}` : "";
    return { uid, tag, kind: "ok", msg: (last.msg || "签到成功") + extra };
  }
  if (last.kind === "already") {
    return { uid, tag, kind: "already", msg: last.msg || "今日已签到" };
  }
  if (last.kind === "need-login") {
    return { uid, tag, kind: "need-login", msg: "Cookie 失效且没有可用账号密码，请重新抓包或填账号" };
  }
  return { uid, tag, kind: last.kind || "error", msg: last.msg || "未知错误" };
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const today = todayCN();

  let creds = readCreds();
  let done = readDone();
  const mig = migrateLegacy(creds, done);
  if (mig.changed) {
    writeCreds(mig.creds);
    writeDone(mig.done);
  }
  creds = mig.creds;
  done = mig.done;

  const accounts = readAccounts();

  // ── 编排任务：账密账号先认领自己的桶，剩下的桶各自成任务 ──
  const jobs = [];
  const claimed = {};
  for (const a of accounts) {
    const uid = findBucket(creds, a.user);
    if (uid) claimed[uid] = 1;
    jobs.push({ acct: a, uid });
  }
  for (const uid of Object.keys(creds)) {
    if (claimed[uid]) continue;
    jobs.push({ acct: null, uid });
  }

  if (!jobs.length) {
    notify(
      `${NAME} v${VERSION}`,
      "还没有账号",
      "三选一：\n① 登录 wn4k.com 后打开一次「会员中心」，自动存这个账号的 Cookie（多账号就依次登录一遍）\n② 模块参数填账号密码，多个用 && 分隔\n③ 跑一遍「蜗牛4K体检」看卡在哪"
    );
    return;
  }

  // ── 今天已经签过的账号先摘掉 ──
  const todo = [];
  const results = [];
  for (const job of jobs) {
    const u = job.uid;
    const nm = maskName((job.acct && job.acct.user) || (u && creds[u] && creds[u].nm) || "账号");
    if (u && done[u] === today) {
      results.push({ uid: u, tag: nm, kind: "skipped", msg: "今日已签（跳过）" });
      continue;
    }
    todo.push(job);
  }

  log(`共 ${jobs.length} 个账号，今天待签 ${todo.length} 个`);

  if (!todo.length) {
    notify(`${NAME}`, `今日已签 ${results.length} 个`, results.map((r) => `${r.tag} ⏭️ 已签`).join("\n"));
    return;
  }

  // 定时任务加一点抖动
  if (!isCapture && CONFIG.jitterMax > 0) {
    await sleep(Math.floor(Math.random() * CONFIG.jitterMax));
  }

  const gapMin = Math.max(0, CONFIG.gapMin || 0);
  const gapMax = Math.max(gapMin, CONFIG.gapMax || gapMin);

  for (let i = 0; i < todo.length; i++) {
    const r = await runJob(todo[i], creds, done);
    results.push(r);
    log(`结果 ${r.tag}(${r.uid || "-"}): ${r.kind} ${r.msg}`);

    // 签成功就立刻落盘，中途被打断也不会重复签
    if (r.uid && (r.kind === "ok" || r.kind === "already")) {
      done[r.uid] = today;
      writeDone(done);
    }

    if (i < todo.length - 1) await sleep(gapMin + Math.floor(Math.random() * (gapMax - gapMin + 1)));
  }

  // ── 汇总 ──
  const okCount = results.filter((r) => r.kind === "ok").length;
  const alreadyCount = results.filter((r) => r.kind === "already").length;
  const skipCount = results.filter((r) => r.kind === "skipped").length;
  const bad = results.filter((r) => r.kind !== "ok" && r.kind !== "already" && r.kind !== "skipped");

  // 显示顺序跟账号列表一致
  results.sort((a, b) => {
    const ia = jobs.findIndex((j) => (j.uid || "") === (a.uid || "") && !!j.acct === !!a.tag);
    const ib = jobs.findIndex((j) => (j.uid || "") === (b.uid || "") && !!j.acct === !!b.tag);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  const body = results.map((r) => `${r.tag} ${icon(r.kind)} ${r.msg}`).join("\n");
  const head = [
    okCount ? `${okCount} 签到` : "",
    alreadyCount ? `${alreadyCount} 已签` : "",
    skipCount ? `${skipCount} 跳过` : "",
    bad.length ? `${bad.length} 异常` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (bad.length === 0) {
    notify(`${NAME}`, head || "全部完成", body);
  } else {
    notify(`${NAME}`, `${bad.length} 个异常`, body);
  }
}

function icon(kind) {
  if (kind === "ok") return "✅";
  if (kind === "already") return "🟡";
  if (kind === "skipped") return "⏭️";
  if (kind === "nocred" || kind === "need-login") return "🔑";
  if (kind === "auth" || kind === "banned") return "🚫";
  return "❌";
}

/* ------------------------------ 抓包分支 ------------------------------ */

function onCapture() {
  try {
    const headers = $request.headers || {};
    const raw = headerOf(headers, "cookie");
    const cookie = String(raw || "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && !/\[object .*\]/i.test(s))
      .join("; ");

    if (!cookieLooksAlive(cookie)) {
      log("抓到的 Cookie 里没有登录态（可能是未登录访问）:", cookieBrief(cookie));
      return;
    }

    const creds = readCreds();
    const done = readDone();
    const name = cookieName(cookie);
    let uid = uidFromCookie(cookie);
    if (!uid) uid = "n" + hashKey(name || "unknown");

    // 同一账号如果之前用过别的桶名（比如先账密后抓包），并过来
    const byName = name ? findBucket(creds, name) : "";
    if (byName && byName !== uid) {
      delete creds[byName];
      if (done[byName]) {
        done[uid] = done[byName];
        delete done[byName];
      }
    }

    const prev = creds[uid] && creds[uid].ck;
    putCred(creds, uid, cookie, (creds[uid] && creds[uid].acct) || "");
    writeCreds(creds);
    log(`凭据已保存 ${uid}（${maskName(name)}）:`, cookieBrief(cookie));

    if (prev === cookie) return; // 没变化就闭嘴，别每次刷页面都弹

    // 趁凭据新鲜，如果这个账号今天还没签就顺手补一刀
    if (done[uid] !== todayCN()) {
      doCheckin(cookie)
        .then((r) => {
          if (r.kind === "ok") {
            const d = readDone();
            d[uid] = todayCN();
            writeDone(d);
            notify(
              `${NAME}`,
              `${maskName(name)} 凭据已存 · 顺手签到成功`,
              r.msg + (r.points != null ? ` 积分 +${r.points}` : "")
            );
          } else if (r.kind === "already") {
            const d = readDone();
            d[uid] = todayCN();
            writeDone(d);
            notify(`${NAME}`, `${maskName(name)} 凭据已存 · 今日已签`, r.msg);
          } else {
            notify(`${NAME}`, `${maskName(name)} 凭据已存`, `签到未完成：${r.msg}`);
          }
        })
        .catch((e) => log("补签异常:", String(e)));
    } else {
      notify(`${NAME}`, `${maskName(name)} 凭据已更新`, "今日已签到，仅更新 Cookie。");
    }
  } catch (e) {
    log("抓包异常:", String(e));
  }
  done();
}

/* ------------------------------ 入口 ------------------------------ */

if (isCapture) {
  onCapture();
} else {
  main()
    .then(() => done())
    .catch((e) => {
      log("未捕获异常:", String(e));
      notify(`${NAME}`, "脚本异常", String((e && e.message) || e).slice(0, 160));
      done();
    });
}

function done() {
  // Surge 的 http-request / cron 脚本都要收尾，QX 里没有 $done 也无所谓
  try {
    if (typeof $done === "function") $done({});
  } catch (e) {}
}
