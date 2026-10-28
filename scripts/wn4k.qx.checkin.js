/*
 * 蜗牛 I 4K（wn4k.com）每日签到 · Quantumult X
 * 作者：Linda for Dennis
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
 * 两种用法，二选一即可：
 *   A. 抓包（推荐，零配置）：导入下面的重写规则 → 浏览器登录 wn4k.com 后打开「会员中心」
 *      任意页面，Cookie 自动存进 QX。之后定时任务直接拿它签到。
 *   B. 账号密码：把账号密码填进下面 CONFIG.accounts（本地改脚本，远程订阅会覆盖）
 *      或往持久化存储写 WN4K_ACCOUNTS = ["账号,密码"]。Cookie 失效时会自动重新登录。
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

const VERSION = "1.0.0";
const NAME = "蜗牛4K签到";
const BASE = "https://wn4k.com";

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const CONFIG = {
  // 可选账号密码，格式 "账号,密码"（也可换成 QQ 邮箱）。留空就纯用抓包 Cookie。
  accounts: [],
  retry: 2,          // 单次签到失败重试次数
  jitterMax: 15e3,   // 定时任务启动抖动，避开整点
};

const K_CRED = "WN4K_CRED";       // 抓包 / 登录拿到的 Cookie
const K_ACCT = "WN4K_ACCOUNTS";   // 运行时账号密码（JSON 数组）
const K_DATE = "WN4K_LAST_DATE";  // 最后签到成功日期
const K_TRIED = "WN4K_TRIED";     // 当天已尝试标记，避免抓包时反复请求

const IS_QX = typeof $task !== "undefined";
const isCapture = typeof $request !== "undefined";
// Surge 模块参数（argument=账号,密码）。QX 没有这个变量，保持空串。
const ARG = (() => {
  try {
    return typeof $argument !== "undefined" ? String($argument || "").trim() : "";
  } catch (e) {
    return "";
  }
})();

/* ------------------------------ 基础工具 ------------------------------ */

const log = (...a) => console.log("[WN4K]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notify(title, sub, body) {
  try {
    if (IS_QX) $notify(title, sub, body);
    else $notification.post(title, sub, body);
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
  // MacCMS 的登录态是 user_id + user_token 这对持久 Cookie；
  // PHPSESSID 未登录访客也会发，单独存在不算登录。
  return /(?:^|;\s*)user_(token|id)=/i.test(cookie);
}

function cookieBrief(cookie) {
  return String(cookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("=")[0])
    .join(",");
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

function parseAccountLine(line) {
  const s = String(line || "").trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*[,|，:：]\s*(.+)$/);
  if (!m) return null;
  return { user: m[1].trim(), pwd: m[2].trim() };
}

function argToAccounts(raw) {
  const s = String(raw || "").trim();
  if (!s || /^(none|null|undefined|空)$/i.test(s)) return [];
  // Surge 模块参数可能传成 account=xxx，也可能就是裸值
  let val = s;
  if (/^account=/i.test(s)) {
    val = s.slice(s.indexOf("=") + 1);
  } else {
    const m = s.match(/(?:^|&)account=([\s\S]*)$/i);
    if (m) val = m[1];
  }
  try {
    val = decodeURIComponent(val);
  } catch (e) {}
  return val.split(/&&|\n/).map(parseAccountLine).filter(Boolean);
}

function readAccounts() {
  // 0) Surge 模块参数：argument=账号,密码（多个用 && 分隔）
  const fromArg = argToAccounts(ARG);
  if (fromArg.length) return fromArg;
  // 1) 运行时写入的（JSON 数组 或 换行分隔）
  const raw = store.read(K_ACCT);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const out = arr.map((it) => (typeof it === "string" ? parseAccountLine(it) : it)).filter(Boolean);
        if (out.length) return out;
      }
    } catch (e) {
      const out = raw.split(/\n|&&/).map(parseAccountLine).filter(Boolean);
      if (out.length) return out;
    }
  }
  // 2) 脚本内常量
  return (CONFIG.accounts || []).map((s) => (typeof s === "string" ? parseAccountLine(s) : s)).filter(Boolean);
}

/* ------------------------------ 单个账号签到 ------------------------------ */

async function runOne(acct, idx, total) {
  const label = total > 1 ? `#${idx + 1}` : "";
  const tag = acct && acct.user ? acct.user.replace(/^(.{2}).*@/, "$1***@") : "抓包账号";

  let cookie = store.read(K_CRED);

  // 有账号密码但没 Cookie → 先登录
  if (!cookieLooksAlive(cookie) && acct) {
    log("没有可用 Cookie，走账号密码登录");
    const g = await doLogin(acct.user, acct.pwd);
    if (!g.ok) return { tag, kind: g.kind, msg: g.msg };
    cookie = g.cookie;
    store.write(K_CRED, cookie);
  }

  if (!cookieLooksAlive(cookie)) {
    return {
      tag,
      kind: "nocred",
      msg: "没有登录凭据。浏览器登录 wn4k.com 后打开一次「会员中心」，或在脚本里填账号密码。",
    };
  }

  let last = null;
  for (let i = 1; i <= Math.max(1, CONFIG.retry); i++) {
    try {
      last = await doCheckin(cookie);
    } catch (e) {
      last = { kind: "error", msg: `请求异常: ${(e && e.message) || e}` };
    }

    // 只要不是「登录态失效」，就不用再试了
    if (last.kind !== "need-login") break;

    // Cookie 挂了：能登录就换个新的再来一次
    if (acct && i === 1) {
      log("Cookie 失效，用账号密码重新登录");
      const g = await doLogin(acct.user, acct.pwd);
      if (!g.ok) return { tag, kind: g.kind, msg: g.msg };
      cookie = g.cookie;
      store.write(K_CRED, cookie);
      continue;
    }
    break;
  }

  if (last.kind === "ok") {
    const extra = last.points != null ? ` 积分 +${last.points}` : "";
    return { tag, kind: "ok", msg: (last.msg || "签到成功") + extra };
  }
  if (last.kind === "already") {
    return { tag, kind: "already", msg: last.msg || "今日已签到" };
  }
  if (last.kind === "need-login") {
    return { tag, kind: "need-login", msg: "Cookie 失效且没有可用账号密码，请重新抓包或在脚本里填账号" };
  }
  return { tag, kind: last.kind || "error", msg: last.msg || "未知错误" };
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const accounts = readAccounts();
  const cookie = store.read(K_CRED);

  if (!accounts.length && !cookieLooksAlive(cookie)) {
    notify(`${NAME} v${VERSION}`, "还没配置", "两种方式任选：\n① 浏览器登录 wn4k.com，打开「会员中心」任意页（QX 会自动存 Cookie）\n② 脚本 CONFIG.accounts 里填「账号,密码」");
    return;
  }

  // 同一天已经签到成功过就别再打接口了
  if (store.read(K_DATE) === todayCN()) {
    log("今天已签到过，跳过");
    notify(`${NAME}`, "今日已签", "之前已经签到成功，不再重复请求。");
    return;
  }

  // 定时任务加一点抖动
  if (!isCapture && CONFIG.jitterMax > 0) {
    await sleep(Math.floor(Math.random() * CONFIG.jitterMax));
  }

  const list = accounts.length ? accounts : [null];
  const results = [];

  for (let i = 0; i < list.length; i++) {
    const r = await runOne(list[i], i, list.length);
    results.push(r);
    log(`结果 ${r.tag}: ${r.kind} ${r.msg}`);
    if (i < list.length - 1) await sleep(1200 + Math.floor(Math.random() * 1500));
  }

  const okCount = results.filter((r) => r.kind === "ok").length;
  const already = results.filter((r) => r.kind === "already").length;
  const bad = results.filter((r) => r.kind !== "ok" && r.kind !== "already");

  if (bad.length === 0) store.write(K_DATE, todayCN());
  else if (okCount + already > 0 && bad.length === 0) store.write(K_DATE, todayCN());

  const body = results
    .map((r) => `${r.tag ? r.tag + " " : ""}${icon(r.kind)} ${r.msg}`)
    .join("\n");

  if (bad.length === 0) {
    notify(`${NAME}`, okCount ? `签到成功 ${okCount} 个` : "今日已签", body);
  } else {
    notify(`${NAME}`, `异常 ${bad.length} 个`, body);
  }
}

function icon(kind) {
  if (kind === "ok") return "✅";
  if (kind === "already") return "🟡";
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

    const prev = store.read(K_CRED);
    store.write(K_CRED, cookie);
    log("凭据已保存:", cookieBrief(cookie));

    // 只有真换了凭据才提示，避免每次刷页面都弹
    const changed = prev !== cookie;
    if (!changed) return;

    // 趁凭据新鲜，如果今天还没签就顺手补一刀
    if (store.read(K_DATE) !== todayCN()) {
      doCheckin(cookie)
        .then((r) => {
          if (r.kind === "ok") {
            store.write(K_DATE, todayCN());
            notify(`${NAME}`, "凭据已保存 · 顺手签到成功", r.msg + (r.points != null ? ` 积分 +${r.points}` : ""));
          } else if (r.kind === "already") {
            store.write(K_DATE, todayCN());
            notify(`${NAME}`, "凭据已保存 · 今日已签", r.msg);
          } else {
            notify(`${NAME}`, "凭据已保存", `签到未完成：${r.msg}`);
          }
        })
        .catch((e) => log("补签异常:", String(e)));
    } else {
      notify(`${NAME}`, "凭据已更新", "今日已签到，仅更新 Cookie。");
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
