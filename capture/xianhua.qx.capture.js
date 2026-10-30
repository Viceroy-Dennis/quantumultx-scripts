// 三国咸话 —— Quantumult X 登录凭据抓包脚本
// 仅用于 script-request-header，不读取请求体、不嗅探领奖接口。
// wxforum / api-xh 微信凭据隔离；app-system=h5 使用独立键。
// 通知节流 8 秒，全程 $done({}) 放行，不修改请求。

const NAME = "三国咸话QX";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const TOKEN_H5_KEY = "sgxh_token_h5";
const HDR_H5_KEY = "sgxh_headers_h5";
const COOKIE_KEY = "sgxh_cookie";

// 兼容旧键；H5 不写入旧键，避免污染微信凭据。
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
const TIME_KEY = "sgxh_capture_time";
const NOTIFY_KEY = "sgxh_notify_ts";

const HOST_RE = /^(api-xh|wxforum|xh|hi-gateway|api-forum-act|xianhua)\.sanguosha\.cn$/i;
const DROP = { host: 1, connection: 1, "keep-alive": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function read(key) { try { return $prefs.valueForKey(key) || ""; } catch (e) { return ""; } }
function write(value, key) { try { $prefs.setValueForKey(String(value), key); } catch (e) {} }

function notifyThrottled(sub, msg) {
  const last = Number(read(NOTIFY_KEY) || 0);
  if (Date.now() - last < 8000) return;
  write(Date.now(), NOTIFY_KEY);
  $notify(NAME, sub, msg);
}

function cleanValue(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const v = String(value).trim();
  if (!v || /^\[object .*\]$/i.test(v) || /^(undefined|null)$/i.test(v) || /[\r\n]/.test(v)) return "";
  return v;
}

function lowerHeaders(h) {
  const o = Object.create(null);
  Object.keys(h || {}).forEach((key) => {
    const k = String(key).toLowerCase();
    const v = cleanValue(h[key]);
    if (!DROP[k] && v) o[k] = v;
  });
  return o;
}

function cookieMap(cookie) {
  const o = Object.create(null);
  String(cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function mergeCookie(oldValue, newValue) {
  const o = cookieMap(oldValue);
  const n = cookieMap(newValue);
  Object.keys(n).forEach((k) => { if (n[k] !== "") o[k] = n[k]; });
  return Object.keys(o).map((k) => k + "=" + o[k]).join("; ");
}

function pickToken(h) {
  const c = cookieMap(h.cookie);
  const candidates = [h.authorization, h.token, h["x-token"], h["x-auth-token"], h.accesstoken, h["access-token"], c.token];
  for (let i = 0; i < candidates.length; i++) {
    const tok = cleanValue(candidates[i]);
    if (tok.length >= 8) return tok;
  }
  return "";
}

function queryToken(query) {
  let token = "";
  let count = 0;
  String(query || "").split("&").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const key = decodeURIComponent(part.slice(0, i).replace(/\+/g, " "));
    if (key !== "token") return;
    count++;
    const value = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
    const v = cleanValue(value);
    if (v === value && v.length >= 8 && /^[A-Za-z0-9._~+/-]+=*$/.test(v)) token = v;
  });
  return count === 1 ? token : "";
}

function capture() {
  if (typeof $request === "undefined") return;
  // 不接受子域或 userinfo；仅已验证 H5 入口读取 query token。
  const parts = String($request.url || "").match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i);
  if (!parts) return;
  const host = parts[1].toLowerCase();
  if (!HOST_RE.test(host)) return;

  const h = lowerHeaders($request.headers || {});
  if (h.cookie) {
    const merged = mergeCookie(read(COOKIE_KEY), h.cookie);
    if (merged) write(merged, COOKIE_KEY);
  }

  const isH5Entry = host === "xh.sanguosha.cn" && parts[2] === "/h5/energy" &&
    String($request.method || "GET").toUpperCase() === "GET";
  if (isH5Entry) {
    const tok = queryToken(parts[3]);
    if (tok) {
      const oldToken = read(TOKEN_H5_KEY);
      write(tok, TOKEN_H5_KEY);
      write(JSON.stringify(h), HDR_H5_KEY);
      write(Date.now(), TIME_KEY);
      if (tok !== oldToken) notifyThrottled("登录凭据已更新", "通道: H5");
    }
    return;
  }

  const tok = pickToken(h);
  if (!tok) return;

  const isH5 = (h["app-system"] || "").toLowerCase() === "h5";
  const isWx = host === "wxforum.sanguosha.cn";
  const isXh = /^(api-xh|xh|api-forum-act)\.sanguosha\.cn$/.test(host);
  let tokenKey, headerKey, channel;
  if (isH5) {
    tokenKey = TOKEN_H5_KEY;
    headerKey = HDR_H5_KEY;
    channel = "H5";
  } else if (isWx) {
    tokenKey = TOKEN_WX_KEY;
    headerKey = HDR_WX_KEY;
    channel = "wxforum";
  } else if (isXh) {
    tokenKey = TOKEN_XH_KEY;
    headerKey = HDR_XH_KEY;
    channel = "api-xh";
  } else {
    return;
  }

  const oldToken = read(tokenKey);
  const headers = JSON.stringify(h);
  write(tok, tokenKey);
  write(headers, headerKey);
  write(Date.now(), TIME_KEY);
  if (!isH5) {
    write(tok, TOKEN_KEY);
    write(headers, HEADER_KEY);
  }
  if (tok !== oldToken) notifyThrottled("登录凭据已更新", "通道: " + channel);
}

try {
  capture();
} catch (e) {
  // 异常可能包含凭据或 URL，仅输出固定提示。
  console.log("[" + NAME + "] 凭据捕获异常");
} finally {
  $done({});
}
