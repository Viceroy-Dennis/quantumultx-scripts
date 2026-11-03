/*
 * 影巢 RE0 签到：正常首页加载后，在浏览器内执行一次同源签到。
 * Cloudflare 挑战页不修改；403/429、令牌失效或动作过期后停止并冷却。
 * 页面不会自动刷新，不重放浏览器 Cookie，也不保证站点放行。
 *
 * 后台定时签到使用 OpenAPI：应用 Secret + 用户 Access Token，支持 Refresh Token。
 * 用 re0.qx.setup.js 的本地副本保存授权，勿将凭据提交到仓库或放入任务 URL。
 * 同一份实现也发布在 re0.qx.inject.js，兼容已安装的任务与重写地址。
 *
 * [rewrite_local]
 * ^https:\/\/re0\.me\/?(?:\?[^#]*)?$ url script-response-body https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js
 * ^https:\/\/re0\.me\/re0-checkin-report\.gif\? url script-echo-response https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js
 * ^https:\/\/re0\.me\/api\/open\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js
 * ^https:\/\/re0\.me\/api\/public\/openapi\/oauth\/refresh(?:\?[^#]*)?$ url script-response-body https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js
 * [task_local]
 * 0 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js#force-timeout=60000, tag=RE0签到, enabled=true
 * [mitm]
 * hostname = %APPEND% re0.me
 */

const NAME = "RE0";
const BASE = "https://re0.me";
const DATE_KEY = "RE0_LastCheckinDate";
const VERIFIED_DATE_KEY = "re0_verified_checkin_date";
const API_WAIT_KEY = "re0_api_next_attempt";
const API_KEY_PREF = "re0_api_key";
const AUTH_PREF = "re0_openapi_auth";
const RE0_API_KEY = "";
const RE0_ACCESS_TOKEN = "";
const RE0_REFRESH_TOKEN = "";
const RE0_GAMBLER = false;
let qxFinished = false;
let qxTimer;

function complete(value) {
  if (qxFinished) return;
  qxFinished = true;
  if (qxTimer && typeof clearTimeout === "function") clearTimeout(qxTimer);
  $done(value);
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function readPref(key) {
  try { return $prefs.valueForKey(key) || ""; } catch (e) { return ""; }
}
function writePref(key, value) {
  try { return $prefs.setValueForKey(String(value), key) === true; } catch (e) { return false; }
}
function alreadyToday() {
  // 旧版日期也可能来自失败；只信任经过业务结果核实的日期。
  return readPref(VERIFIED_DATE_KEY) === todayCN();
}
function markDoneToday(date) {
  const day = date || todayCN();
  writePref(DATE_KEY, day);
  writePref(VERIFIED_DATE_KEY, day);
}
function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}
function responseStatus(response) {
  const status = response.statusCode === undefined ? response.status : response.statusCode;
  const match = String(status || "").match(/^(?:HTTP\/[\d.]+\s+)?(\d{3})(?:\s|$)/);
  return match ? Number(match[1]) : 0;
}
function authRevision() {
  try { return String((JSON.parse(readPref(AUTH_PREF)) || {}).revision || ""); } catch (e) { return ""; }
}

// 无外部依赖：同一个响应判定函数也会随页面脚本序列化到浏览器。
function classifyResponse(status, body, headers, redirected) {
  const text = String(body || "");
  const header = (name) => {
    const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key]) : "";
  };
  const clean = (message) => String(message || "").replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 120);
  const retryAfter = () => {
    const value = header("retry-after").trim();
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    const time = Date.parse(value);
    return Number.isFinite(time) ? Math.max(0, time - Date.now()) : 0;
  };
  const failure = (code, msg, wait) => ({
    done: false, ok: false, status, code, msg,
    retryMs: Math.max(wait || 5 * 60 * 1000, retryAfter()),
  });
  const challenge =
    /challenge/i.test(header("cf-mitigated")) ||
    /_cf_chl_opt|<title[^>]*>\s*(?:Just a moment|Attention Required!)/i.test(text);
  if (challenge) return failure("CF_CHALLENGE", "Cloudflare 要求浏览器验证，请完成验证后再尝试", 15 * 60 * 1000);
  if (status === 429) return failure("RATE_LIMIT", "请求过于频繁，已按服务器要求暂停", 15 * 60 * 1000);
  if (status === 401) return failure("UNAUTHORIZED", "登录状态或 API Key 已失效", 15 * 60 * 1000);
  if (status === 403) return failure("ACCESS_DENIED", "站点拒绝访问，请检查登录状态或访问权限", 15 * 60 * 1000);
  if (redirected || !status) return failure("REDIRECT_OR_NETWORK", "响应发生重定向或网络异常，签到未确认");
  if (status >= 500) return failure("SERVER_ERROR", "站点暂时不可用，请稍后尝试");
  if (status === 404 || header("x-nextjs-action-not-found")) {
    return failure("STALE_ACTION", "签到动作已过期，请稍后手动重新打开首页");
  }
  if (/text\/html/i.test(header("content-type")) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
    return failure("HTML_RESPONSE", "返回了网页或登录页，签到未确认");
  }

  let whole;
  try { whole = JSON.parse(text); } catch (e) {}
  const entries = {};
  // Next.js Flight 条目可在行首，也可在空格后；按字符串转义和平衡括号截取。
  const records = /(?:^|\s)[0-9a-f]{1,8}:(?=[{\[])/g;
  let record;
  while ((record = records.exec(text))) {
    const start = records.lastIndex;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (--depth === 0) {
          try {
            const id = record[0].trim().split(":")[0];
            entries[id] = JSON.parse(text.slice(start, i + 1));
          } catch (e) {}
          records.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  // Flight 页面内可含其他组件的 success/message。只读取动作返回的记录，
  // 优先 Next.js 的 a:"$@<id>" 引用，兼容仓库抓包中的 1:{response/error:...}。
  const reference = entries["0"] && typeof entries["0"].a === "string" &&
    entries["0"].a.match(/^\$@([0-9a-f]+)$/);
  const root = whole || entries[reference ? reference[1] : "1"];
  let result = root;
  if (root && typeof root === "object") {
    if (root.response && typeof root.response === "object") result = root.response;
    else if (root.error && typeof root.error === "object") result = root.error;
  }
  if (result && typeof result.success === "boolean") {
    const data = result.data && typeof result.data === "object" ? result.data : {};
    const msg = clean(data.description || data.message || result.description || result.message);
    const code = clean(result.code || data.code);
    const context = msg + " " + code;
    const negative = /(?:尚未|还未|没有|未能|不能|无法|未完成)签到|未签到|尚未签过|签到(?:失败|未完成|未成功|尚未|还未)|not[ _-]+(?:yet[ _-]+)?(?:checked|signed)[ _-]*in/i.test(context);
    const already = !negative && /已经签到|今天已经签过|今日已签|已签到|already[ _-]*(?:checked|signed)[ _-]*in|already[ _-]*check[ _-]*in/i.test(context);
    const typedAlready = result.success === true && data.checked_in === false &&
      typeof data.points === "number" && data.points === 0 && !negative;
    const confirmed = data.checked_in === true ||
      /签到成功|签到完成|check[ _-]?in[ _-]+(?:success|successful|completed?)|successfully[ _-]+(?:checked|signed)[ _-]*in/i.test(context);
    if (code === "action_token_invalid") {
      return failure("TOKEN_INVALID", "站点安全令牌已更新，请稍后手动重新打开首页");
    }
    const allowedStatus = (status >= 200 && status < 300) || status === 400 || status === 409;
    if ((already || typedAlready) && allowedStatus) {
      return { done: true, ok: true, already: true, status, code: "ALREADY_SIGNED", msg: msg || "今天已经签到" };
    }
    if (status >= 200 && status < 300 && result.success === true &&
        data.checked_in !== false && !negative && confirmed) {
      return { done: true, ok: true, status, code: "CHECKED_IN", msg: msg || "签到成功" };
    }
    if (status === 409 || status === 428) {
      return failure("TOKEN_INVALID", "站点安全令牌已更新，请稍后手动重新打开首页");
    }
    if (result.success === false || negative || data.checked_in === false) {
      return failure("BUSINESS_ERROR", msg || "站点未确认签到完成");
    }
  }
  if (/\$Sreact\./.test(text)) return failure("STALE_ACTION", "返回的是页面渲染流，签到动作未确认");
  if (status === 409 || status === 428) return failure("TOKEN_INVALID", "站点安全令牌已更新，请稍后手动重新打开首页");
  return failure("UNKNOWN_RESPONSE", "未找到明确的签到业务结果，签到未确认");
}

function browserCheckin(config, classify) {
  const LS_DATE = "re0_auto_checkin_date";
  const LS_VERIFIED = "re0_auto_checkin_success_date";
  const LS_LOG = "re0_auto_checkin_log";
  const LS_WAIT = "re0_auto_checkin_next_attempt";
  const LS_LOCK = "re0_auto_checkin_lock";
  const LS_ACTION = "re0_auto_checkin_action";
  const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const log = (code, status) => {
    try { localStorage.setItem(LS_LOG, `[${new Date().toISOString()}] ${code} status=${status || 0}`); } catch (e) {}
  };
  // 存储不可用时不启动，避免每次页面加载都重复签到。
  try {
    if (window.__re0CheckinStarted || localStorage.getItem(LS_VERIFIED) === today()) return;
    if (Number(localStorage.getItem(LS_WAIT) || 0) > Date.now()) return;
    if (Number(localStorage.getItem(LS_LOCK) || 0) > Date.now()) return;
    localStorage.setItem(LS_LOCK, String(Date.now() + 60000));
    localStorage.setItem(LS_WAIT, String(Date.now() + 5 * 60 * 1000));
    window.__re0CheckinStarted = true;
  } catch (e) {
    log("STORAGE_UNAVAILABLE");
    return;
  }
  const startedDay = today();
  let deadline;
  let fingerprint = "";

  function report(result) {
    try {
      const params = new URLSearchParams({
        ok: result.ok ? "1" : "0", already: result.already ? "1" : "0",
        msg: result.msg || "", d: startedDay, g: config.generation || "",
      });
      const image = new Image();
      image.src = "/re0-checkin-report.gif?" + params.toString() + "&_=" + Date.now();
    } catch (e) { log("REPORT_UNAVAILABLE"); }
  }
  function finish(result) {
    try {
      localStorage.setItem(LS_LOCK, "0");
      localStorage.setItem(LS_WAIT, result.ok ? "0" : String(Date.now() + (result.retryMs || 5 * 60 * 1000)));
      if (result.ok && startedDay === today()) {
        localStorage.setItem(LS_DATE, startedDay);
        localStorage.setItem(LS_VERIFIED, startedDay);
      }
      if (result.code === "STALE_ACTION") localStorage.setItem(LS_ACTION, "");
    } catch (e) {}
    log(result.code, result.status);
    window.__re0Checkin = result;
    document.title = (result.ok ? "✅ " : "⚠️ ") + (document.title || "RE0");
    report(result);
  }
  function request(url, options) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject({ code: "TIMEOUT" });
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const opts = Object.assign({ credentials: "same-origin", redirect: "error" }, options);
    if (controller) opts.signal = controller.signal;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (controller) controller.abort();
        reject({ code: "TIMEOUT" });
      }, Math.min(10000, remaining));
      Promise.resolve().then(() => fetch(url, opts)).then((res) => {
        return res.text().then((text) => {
          const headers = {};
          for (const name of ["cf-mitigated", "retry-after", "content-type", "x-nextjs-action-not-found"]) {
            const value = res.headers && res.headers.get(name);
            if (value) headers[name] = value;
          }
          return { status: res.status, text, headers, redirected: res.redirected };
        });
      }).then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  function scanText(text) {
    const match = text.match(/createServerReference\s*\)?\s*\(\s*["']([0-9a-f]{40,64})["'](?:(?!createServerReference)[\s\S]){0,600}?["']checkIn["']/);
    return match ? match[1] : "";
  }
  function findActionId() {
    const sources = [];
    const base = config.base + "/";
    Array.prototype.slice.call(document.scripts).forEach((script) => {
      if (!script.src) return;
      try {
        const url = new URL(script.src, base);
        if (url.origin !== config.base || url.username || url.password) return;
        if (!/^\/_next\/static\/chunks\/.+\.js$/.test(url.pathname)) return;
        if (!sources.includes(url.href)) sources.push(url.href);
      } catch (e) {}
    });
    sources.sort((a, b) => Number(/\/layout-/.test(b)) - Number(/\/layout-/.test(a)));
    fingerprint = sources.join("\n");
    try {
      const cached = JSON.parse(localStorage.getItem(LS_ACTION) || "null");
      if (cached && cached.fingerprint === fingerprint && /^[0-9a-f]{40,64}$/.test(cached.id)) {
        return Promise.resolve(cached.id);
      }
    } catch (e) {}
    const targets = sources.slice(0, config.maxChunks);
    function scan(index) {
      if (index >= targets.length) return Promise.resolve("");
      return request(targets[index], { cache: "force-cache" }).then((res) => {
        const result = classify(res.status, res.text, res.headers, res.redirected);
        if (["CF_CHALLENGE", "RATE_LIMIT", "UNAUTHORIZED", "ACCESS_DENIED", "SERVER_ERROR", "REDIRECT_OR_NETWORK", "HTML_RESPONSE"].includes(result.code)) {
          throw result;
        }
        const id = res.status >= 200 && res.status < 300 ? scanText(res.text) : "";
        if (!id) return scan(index + 1);
        try { localStorage.setItem(LS_ACTION, JSON.stringify({ fingerprint, id })); } catch (e) {}
        return id;
      });
    }
    return scan(0);
  }
  function run() {
    deadline = Date.now() + 30000;
    findActionId().then((id) => {
      if (!id) throw { code: "NO_ACTION_ID", msg: "未找到当前签到动作，请稍后手动重新打开首页" };
      return request("/", {
        method: "POST",
        headers: {
          Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8",
          "Next-Action": id, "Next-Router-State-Tree": config.routerTree,
        },
        body: JSON.stringify([config.gambler]),
      });
    }).then((res) => {
      finish(classify(res.status, res.text, res.headers, res.redirected));
    }).catch((error) => {
      finish(error && error.ok === false ? error : {
        ok: false, done: false, code: error && error.code || "NETWORK_ERROR",
        msg: error && error.code === "NO_ACTION_ID" ? error.msg : "请求未完成，已暂停，请稍后尝试",
        retryMs: 5 * 60 * 1000,
      });
    });
  }
  const start = () => setTimeout(run, 1200);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

function injectedSource() {
  const config = {
    base: BASE, gambler: !!RE0_GAMBLER, maxChunks: 6, generation: authRevision(),
    routerTree: "%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
  };
  return "(" + browserCheckin.toString() + ")(" + JSON.stringify(config) + "," + classifyResponse.toString() + ");";
}

// ─────────────────── 分支 A：仅对正常首页 HTML 注入 ───────────────────
function injectIntoPage() {
  const html = String($response.body || "");
  const status = responseStatus($response);
  const type = getHeader($response.headers, "content-type");
  if (status !== 200 || (type && !/text\/html/i.test(type)) || !/^\s*(?:<!doctype\s+html|<html\b)/i.test(html)) {
    $done({});
    return;
  }
  if (/id\s*=\s*["']re0-auto-checkin["']/i.test(html) || alreadyToday()) {
    $done({});
    return;
  }
  if (classifyResponse(status, html, $response.headers).code === "CF_CHALLENGE" ||
      !/\/_next\/static\/chunks\//.test(html)) {
    console.log("[RE0] INJECT skipped reason=NOT_APP_PAGE");
    $done({});
    return;
  }
  // 复用页面已有的 CSP nonce；不删除或放宽 CSP。
  const nonce = html.match(/<script\b[^>]*\bnonce\s*=\s*["']([A-Za-z0-9+/_=-]+)["']/i);
  const attr = nonce ? ' nonce="' + nonce[1] + '"' : "";
  const tag = '<script id="re0-auto-checkin"' + attr + ">" + injectedSource() + "</script>";
  const out = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => tag + "</body>") :
    /<\/html>/i.test(html) ? html.replace(/<\/html>/i, () => tag + "</html>") : html + tag;
  console.log("[RE0] INJECT normal_html");
  $done({ body: out });
}

function credential(value, bearer) {
  let text = String(value || "").trim();
  if (bearer) text = text.replace(/^Bearer\s+/i, "");
  return text.length <= 8192 && !/[\x00-\x20\x7f]/.test(text) ? text : "";
}
function readAuth() {
  let stored = {};
  try { stored = JSON.parse(readPref(AUTH_PREF)) || {}; } catch (e) {}
  const legacyKey = credential(readPref(API_KEY_PREF));
  const apiKey = credential(RE0_API_KEY || stored.apiKey || legacyKey);
  // 完整授权记录优先，空字段也有意义：换用户后不得回填旧用户 Token。
  if (apiKey && stored.apiKey === apiKey) {
    return {
      apiKey,
      accessToken: credential(stored.accessToken, true),
      refreshToken: credential(stored.refreshToken),
      expiresAt: Number(stored.expiresAt) || 0,
    };
  }
  return {
    apiKey,
    accessToken: credential(RE0_ACCESS_TOKEN ||
      (legacyKey === apiKey ? readPref("re0_access_token") : ""), true),
    refreshToken: credential(RE0_REFRESH_TOKEN ||
      (legacyKey === apiKey ? readPref("re0_refresh_token") : "")),
    expiresAt: 0,
  };
}
function saveAuth(auth, reset) {
  const record = Object.assign({}, auth, {
    revision: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
  });
  if (!writePref(AUTH_PREF, JSON.stringify(record))) return false;
  if (!reset) return true;
  const results = [
    writePref(VERIFIED_DATE_KEY, ""),
    writePref(DATE_KEY, ""),
    writePref(API_WAIT_KEY, "0"),
  ];
  return results.every(Boolean);
}
function tokenAuth(apiKey, data, previous) {
  const accessToken = credential(data && data.access_token, true);
  if (!apiKey || !accessToken) return null;
  const seconds = Number(data.expires_in);
  return {
    apiKey, accessToken,
    refreshToken: credential(data.refresh_token) || (previous && previous.refreshToken) || "",
    expiresAt: Number.isFinite(seconds) && seconds > 0 && seconds < 365 * 86400 ?
      Date.now() + seconds * 1000 : 0,
  };
}
function captureOpenApi(request) {
  const apiKey = credential(getHeader(request.headers, "x-api-key"));
  const header = getHeader(request.headers, "authorization");
  const accessToken = /^Bearer\s+/i.test(header) ? credential(header, true) : "";
  if (!apiKey || !accessToken) { complete({}); return; }
  const previous = readAuth();
  if (previous.apiKey === apiKey && previous.accessToken === accessToken) {
    complete({});
    return;
  }
  // 不把另一个用户的 Refresh Token 拼到新捕获的 Access Token 上。
  const saved = saveAuth({ apiKey, accessToken, refreshToken: "", expiresAt: 0 }, true);
  console.log("[RE0] CAPTURE result=" + (saved ? "SAVED" : "STORAGE_ERROR"));
  $notify("影巢授权", saved ? "已保存 OpenAPI 授权" : "本地保存失败",
    saved ? "凭据只保存在 QX 本地。本次仅采集，定时任务将在运行时签到。" : "请检查 QX 本地存储后重新采集。");
  complete({});
}
function captureRefresh(request) {
  const apiKey = credential(getHeader(request.headers, "x-api-key"));
  const status = responseStatus($response);
  const body = String($response.body || "");
  const result = classifyResponse(status, body, $response.headers);
  let envelope;
  try { envelope = JSON.parse(body); } catch (e) {}
  if (status < 200 || status >= 300 || !envelope || envelope.success !== true ||
      ["CF_CHALLENGE", "HTML_RESPONSE", "REDIRECT_OR_NETWORK"].includes(result.code)) {
    complete({});
    return;
  }
  // QX 响应重写不保证提供请求体。缺少完整 Token 对时保持原记录，
  // 不能推断这是哪个用户的刷新，也不能借用已有用户的 Refresh Token。
  if (!envelope.data || !credential(envelope.data.refresh_token)) {
    console.log("[RE0] CAPTURE_REFRESH result=INCOMPLETE_PAIR");
    complete({});
    return;
  }
  const previous = readAuth();
  const auth = tokenAuth(apiKey, envelope.data, null);
  if (auth) {
    const changed = previous.apiKey !== auth.apiKey || previous.accessToken !== auth.accessToken ||
      previous.refreshToken !== auth.refreshToken;
    const saved = saveAuth(auth, changed);
    console.log("[RE0] CAPTURE_REFRESH result=" + (saved ? "SAVED" : "STORAGE_ERROR"));
    if (!saved) $notify("影巢授权", "本地保存失败", "刷新授权未保存，请检查 QX 存储。");
    else if (changed) $notify("影巢授权", "已保存刷新授权", "定时签到将使用本地授权；本次仅采集，原请求正常放行。");
  }
  complete({});
}
function diagnose() {
  const auth = readAuth();
  const wait = Number(readPref(API_WAIT_KEY)) || 0;
  const lines = [
    "应用 Secret：" + (auth.apiKey ? "已保存" : "未保存"),
    "用户 Access Token：" + (auth.accessToken ? "已保存" : "未保存"),
    "Refresh Token：" + (auth.refreshToken ? "已保存" : "未保存"),
    "今日签到：" + (alreadyToday() ? "已确认" : "未确认"),
    "请求冷却：" + (wait > Date.now() ? Math.ceil((wait - Date.now()) / 60000) + " 分钟" : "无"),
  ];
  console.log("[RE0] DIAGNOSE " + lines.join("；"));
  $notify("影巢签到", "本地状态检查", lines.join("\n"));
  complete();
}
function taskMode() {
  try {
    const raw = typeof $environment !== "undefined" && $environment.variables;
    const vars = typeof raw === "string" ? JSON.parse(raw) : raw;
    return vars && vars.mode || "";
  } catch (e) { return ""; }
}
function apiRequest(path, auth, body, withBearer, isCurrent) {
  const headers = { "Content-Type": "application/json", "X-API-Key": auth.apiKey, Accept: "application/json" };
  if (withBearer) headers.Authorization = "Bearer " + auth.accessToken;
  return Promise.resolve().then(() => {
    if (qxFinished) throw { code: "TIMEOUT" };
    if (isCurrent && !isCurrent()) throw { code: "AUTH_CHANGED" };
    return $task.fetch({
      url: BASE + path, method: "POST", headers,
      body: JSON.stringify(body),
      opts: { "auto-cookie": false, redirection: false },
    });
  });
}
function refreshAuth(auth, isCurrent) {
  return apiRequest("/api/public/openapi/oauth/refresh", auth, { refresh_token: auth.refreshToken }, false, isCurrent)
    .then((response) => {
      if (qxFinished) throw { code: "TIMEOUT" };
      if (isCurrent && !isCurrent()) throw { code: "AUTH_CHANGED" };
      const status = responseStatus(response);
      const result = classifyResponse(status, response.body, response.headers);
      let envelope;
      try { envelope = JSON.parse(String(response.body || "")); } catch (e) {}
      const next = status >= 200 && status < 300 && envelope && envelope.success === true &&
        !["CF_CHALLENGE", "HTML_RESPONSE"].includes(result.code) ?
        tokenAuth(auth.apiKey, envelope.data, auth) : null;
      if (!next) {
        console.log(`[RE0] OAUTH_REFRESH status=${status} result=${result.code}`);
        if (status >= 200 && status < 300 && result.code === "UNKNOWN_RESPONSE") {
          result.code = "AUTH_RESPONSE_INVALID";
          result.msg = "刷新响应没有有效的用户授权，请重新授权后配置本地凭据";
        }
        throw result;
      }
      if (!saveAuth(next, false)) {
        throw { ok: false, status, code: "STORAGE_ERROR", msg: "刷新授权未保存，本次停止签到，请检查 QX 本地存储", retryMs: 5 * 60 * 1000 };
      }
      console.log(`[RE0] OAUTH_REFRESH status=${status} result=REFRESHED`);
      return next;
    });
}
function openApiCheckin() {
  if (taskMode() === "diagnose") { diagnose(); return; }
  if (alreadyToday()) { complete(); return; }
  let expectedRecord = readPref(AUTH_PREF);
  let auth = readAuth();
  function isCurrent() {
    return expectedRecord === readPref(AUTH_PREF) && JSON.stringify(auth) === JSON.stringify(readAuth());
  }
  if (!auth.apiKey || (!auth.accessToken && !auth.refreshToken)) {
    $notify("影巢签到", "请配置 OpenAPI 用户授权，或打开首页",
      "后台签到需要应用 Secret 和用户 Token（write 权限）。在 QX 本地运行 re0.qx.setup.js 配置；已登录的浏览器打开 re0.me 首页也可尝试页面签到。");
    complete();
    return;
  }
  if (Number(readPref(API_WAIT_KEY)) > Date.now()) {
    console.log("[RE0] API skipped reason=COOLDOWN");
    complete();
    return;
  }
  if (!writePref(API_WAIT_KEY, Date.now() + 5 * 60 * 1000)) {
    $notify("影巢签到（API）", "本地存储不可用", "本次未执行签到，请检查 QX 本地存储。");
    complete();
    return;
  }
  const requestDay = todayCN();
  function finish(result) {
    if (qxFinished) return;
    if (!isCurrent()) {
      console.log("[RE0] API stopped result=AUTH_CHANGED");
      complete();
      return;
    }
    writePref(API_WAIT_KEY, result.ok ? 0 : Date.now() + (result.retryMs || 5 * 60 * 1000));
    if (result.ok) markDoneToday(requestDay);
    console.log(`[RE0] API status=${result.status || 0} result=${result.code}`);
    let message = result.msg || "请求未完成，请稍后再运行";
    for (const secret of [auth.apiKey, auth.accessToken, auth.refreshToken]) {
      if (secret) message = message.split(secret).join("[已隐藏]");
    }
    $notify("影巢签到（API）",
      result.ok ? result.already ? "✅ 今天已经签过啦" : "✅ 签到完成" : "⚠️ 签到未完成",
      message);
    complete();
  }
  // 看门狗只结束脚本，不能撤销已发送的 HTTP 请求；迟到响应不再触发后续操作。
  if (typeof setTimeout === "function") {
    qxTimer = setTimeout(() => finish({ code: "TIMEOUT", msg: "请求结果未确认，已暂停，请稍后再运行" }), 35000);
  }
  let refreshed = false;
  function refreshOnce() {
    refreshed = true;
    return refreshAuth(auth, isCurrent).then((next) => {
      auth = next;
      expectedRecord = readPref(AUTH_PREF);
    });
  }
  function checkin() {
    return apiRequest("/api/open/checkin", auth, { is_gambler: !!RE0_GAMBLER }, true, isCurrent).then((response) => {
      if (qxFinished) return;
      const result = classifyResponse(responseStatus(response), response.body, response.headers);
      // 只在明确的 401 用户授权失效后刷新一次；挑战、限流与超时不重试签到。
      const invalidApp = /INVALID_API_KEY|MISSING_API_KEY|invalid (?:app|api)[ _-]*(?:key|secret)/i.test(String(response.body || ""));
      if (result.code === "UNAUTHORIZED" && !invalidApp && auth.refreshToken && !refreshed) {
        return refreshOnce().then(checkin);
      }
      finish(result);
    });
  }
  const expired = auth.expiresAt && auth.expiresAt <= Date.now() + 60000;
  const prepare = (!auth.accessToken || expired) && auth.refreshToken ? refreshOnce() : Promise.resolve();
  prepare.then(checkin).catch((error) => {
    if (qxFinished) return;
    finish(error && error.ok === false ? error : {
      ok: false, code: error && error.code === "TIMEOUT" ? "TIMEOUT" : "NETWORK_ERROR",
      msg: "网络请求未完成，已暂停，请稍后再运行", retryMs: 5 * 60 * 1000,
    });
  });
}

function tinyGif() {
  return "GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04" +
    "\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";
}
function handleReport() {
  const query = {};
  try {
    const raw = String($request.url || "").split("?")[1] || "";
    raw.split("&").forEach((pair) => {
      const index = pair.indexOf("=");
      if (index < 0) return;
      const key = pair.slice(0, index);
      if (!["ok", "already", "msg", "d", "g"].includes(key)) return;
      query[key] = decodeURIComponent(pair.slice(index + 1).replace(/\+/g, " "));
    });
  } catch (e) {}
  const valid = query.d === todayCN() && (query.ok === "0" || query.ok === "1") &&
    String(query.g || "") === authRevision();
  if (valid) {
    const ok = query.ok === "1";
    const alreadyNotified = alreadyToday();
    if (ok) markDoneToday();
    if (!ok || !alreadyNotified) {
      $notify("影巢签到（实时·网页）",
        ok ? query.already === "1" ? "✅ 今天已经签过啦" : "✅ 签到完成" : "⚠️ 签到未完成",
        String(query.msg || "页面签到结果").replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 120));
    }
    console.log("[RE0] REPORT result=" + (ok ? "CONFIRMED" : "FAILED"));
  }
  complete({
    status: "HTTP/1.1 200 OK",
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
    body: tinyGif(),
  });
}

(function main() {
  const request = typeof $request !== "undefined" && $request;
  const url = request ? String(request.url || "") : "";
  if (/^https:\/\/re0\.me\/re0-checkin-report\.gif\?/.test(url)) {
    handleReport();
  } else if (/^https:\/\/re0\.me\/api\/public\/openapi\/oauth\/refresh(?:\?[^#]*)?$/.test(url) &&
      String(request.method || "").toUpperCase() === "POST" &&
      typeof $response !== "undefined" && $response && typeof $response.body === "string") {
    captureRefresh(request);
  } else if (/^https:\/\/re0\.me\/api\/open\//.test(url)) {
    captureOpenApi(request);
  } else if (typeof $response !== "undefined" && $response && typeof $response.body === "string") {
    if (!request || /^https:\/\/re0\.me\/?(?:\?[^#]*)?$/.test(url)) injectIntoPage();
    else complete({});
  } else if (request) {
    // 旧版全站请求头重写只放行；不保存 Cookie，也不启动后台网页重放。
    complete({});
  } else {
    openApiCheckin();
  }
})();
