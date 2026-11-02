/*
 * 影巢 RE0 签到：正常首页加载后，在浏览器内执行一次同源签到。
 * Cloudflare 挑战页不修改；403/429、令牌失效或动作过期后停止并冷却。
 * 页面不会自动刷新，不重放浏览器 Cookie，也不保证站点放行。
 *
 * 后台定时签到仅使用站点 OpenAPI，需要用户自己的有效 API Key。
 * 推荐将 Key 保存在 QX 本地 $prefs 的 re0_api_key 中，勿提交到公开仓库。
 *
 * [rewrite_local]
 * ^https:\/\/re0\.me\/?(?:\?[^#]*)?$ url script-response-body https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.inject.js
 * ^https:\/\/re0\.me\/re0-checkin-report\.gif\? url script-echo-response https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.inject.js
 * [mitm]
 * hostname = %APPEND% re0.me
 */

const NAME = "RE0";
const BASE = "https://re0.me";
const DATE_KEY = "RE0_LastCheckinDate";
const VERIFIED_DATE_KEY = "re0_verified_checkin_date";
const API_WAIT_KEY = "re0_api_next_attempt";
const API_KEY_PREF = "re0_api_key";
const RE0_API_KEY = "";
const RE0_GAMBLER = false;

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function readPref(key) {
  try { return $prefs.valueForKey(key) || ""; } catch (e) { return ""; }
}
function writePref(key, value) {
  try { return $prefs.setValueForKey(String(value), key) !== false; } catch (e) { return false; }
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

  const roots = [];
  try { roots.push(JSON.parse(text)); } catch (e) {}
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
          try { roots.push(JSON.parse(text.slice(start, i + 1))); } catch (e) {}
          records.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  const candidates = [];
  const stack = roots.slice();
  while (stack.length) {
    const obj = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") stack.push(value);
    }
    if (typeof obj.success !== "boolean") continue;
    const data = obj.data && typeof obj.data === "object" ? obj.data : {};
    const msg = clean(obj.description || obj.message || data.message);
    const code = clean(obj.code);
    if (!msg && data.checked_in !== true) continue;
    const relevant = /签到|签过|积分|check[ _-]?in|checked[ _-]?in|points?/i.test(msg + " " + code);
    if (relevant || data.checked_in === true || code === "action_token_invalid") {
      candidates.push({ success: obj.success, msg, code, checked: data.checked_in });
    }
  }
  const checkinCandidates = candidates.filter((c) =>
    /签到|签过|check[ _-]?in|checked[ _-]?in/i.test(c.msg + " " + c.code) ||
    c.checked === true || c.code === "action_token_invalid");
  const result = checkinCandidates.find((c) => c.code === "action_token_invalid") ||
    checkinCandidates.find((c) => c.success === false) || checkinCandidates[0] ||
    candidates.find((c) => c.success === false);
  if (result) {
    const already = /已经签到(?:过|了)|今天已经签到|你已经签到|已签到|今日已签|重复签到|明天再来|already[ _-]*(?:checked[ _-]*in|signed[ _-]*in)/i.test(result.msg + " " + result.code);
    const allowedStatus = (status >= 200 && status < 300) || status === 400 || status === 409;
    if (already && allowedStatus && result.code !== "action_token_invalid") {
      return { done: true, ok: true, already: true, status, code: "ALREADY_SIGNED", msg: result.msg || "今天已经签到" };
    }
    if (status >= 200 && status < 300 && result.success === true && result.checked !== false) {
      return { done: true, ok: true, status, code: "CHECKED_IN", msg: result.msg || "签到成功" };
    }
    if (result.code === "action_token_invalid" || status === 409 || status === 428) {
      return failure("TOKEN_INVALID", "站点安全令牌已更新，请稍后手动重新打开首页");
    }
    return failure("BUSINESS_ERROR", result.msg || "站点未确认签到完成");
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
        msg: result.msg || "", d: startedDay,
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
    base: BASE, gambler: !!RE0_GAMBLER, maxChunks: 6,
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

function openApiCheckin() {
  if (alreadyToday()) { $done(); return; }
  const key = String(RE0_API_KEY || readPref(API_KEY_PREF)).trim();
  if (!key) {
    $notify("影巢签到", "请在浏览器打开 re0.me 首页", "完成站点验证和登录后，页面会尝试签到。后台定时签到需要你自己的 OpenAPI Key，可保存在 QX 本地 re0_api_key。");
    $done();
    return;
  }
  if (Number(readPref(API_WAIT_KEY)) > Date.now()) {
    console.log("[RE0] API skipped reason=COOLDOWN");
    $done();
    return;
  }
  if (!writePref(API_WAIT_KEY, Date.now() + 60000)) {
    $notify("影巢签到（API）", "本地存储不可用", "为避免重复请求，本次未执行签到。");
    $done();
    return;
  }
  const requestDay = todayCN();
  $task.fetch({
    url: BASE + "/api/open/checkin", method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key, Accept: "application/json" },
    body: JSON.stringify({ is_gambler: !!RE0_GAMBLER }),
    opts: { "auto-cookie": false, redirection: false },
  }).then((response) => {
    const result = classifyResponse(responseStatus(response), response.body, response.headers);
    writePref(API_WAIT_KEY, result.ok ? 0 : Date.now() + result.retryMs);
    if (result.ok) markDoneToday(requestDay);
    console.log(`[RE0] API status=${result.status} result=${result.code}`);
    $notify("影巢签到（API）",
      result.ok ? result.already ? "✅ 今天已经签过啦" : "✅ 签到完成" : "⚠️ 签到未完成",
      result.msg);
    $done();
  }, () => {
    writePref(API_WAIT_KEY, Date.now() + 5 * 60 * 1000);
    console.log("[RE0] API result=NETWORK_ERROR");
    $notify("影巢签到（API）", "网络请求未完成", "已暂停请求，请稍后尝试。");
    $done();
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
      if (!["ok", "already", "msg", "d"].includes(key)) return;
      query[key] = decodeURIComponent(pair.slice(index + 1).replace(/\+/g, " "));
    });
  } catch (e) {}
  const valid = query.d === todayCN() && (query.ok === "0" || query.ok === "1");
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
  $done({
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
  } else if (typeof $response !== "undefined" && $response && typeof $response.body === "string") {
    injectIntoPage();
  } else if (request) {
    // 被误装为请求头重写时也只放行，不启动额外后台请求。
    $done({});
  } else {
    openApiCheckin();
  }
})();
