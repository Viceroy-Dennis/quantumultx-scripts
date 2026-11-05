/*
 * RE0 影巢 · Quantumult X 普通签到
 *
 * 导入 gallery/re0.qx.cookie.gallery.json 中的任务与配套重写。
 * 启用 re0.me 的 HTTPS 解密后，登录 https://re0.me，
 * 手动点一次普通签到，收到“普通签到参数已保存”通知即可。
 *
 * 远程任务 URL 可用 #policy=节点名称 指定固定出口。
 * 本地副本也可填写 RE0_CONFIG.policy。
 * 浏览器抓取与定时请求应使用相同出口，以便复用 cf_clearance。
 */

const RE0_CONFIG = {
  base: "https://re0.me",
  storageKey: "re0_qx_session",
  policy: "",
  requestTimeout: 10000,
  runTimeout: 45000,
  maxChunks: 12
};

const RE0_VARIABLES = typeof $environment !== "undefined"
  ? $environment.variables : null;
if (RE0_VARIABLES && typeof RE0_VARIABLES.policy === "string") {
  RE0_CONFIG.policy = RE0_VARIABLES.policy.trim();
}

const RE0_COOKIES = [
  "token", "refresh_token", "csrf_access_token",
  "hdh_uid", "hdh_sa_token", "cf_clearance"
];
const RE0_STARTED = Date.now();

function re0Error(code, phase) {
  const error = new Error(code);
  error.code = code;
  error.phase = phase || "";
  return error;
}

function re0Header(headers, name) {
  const key = Object.keys(headers || {}).find(
    item => item.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : "";
}

function re0CookieMap(value) {
  const result = Object.create(null);
  String(value || "").split(";").forEach(part => {
    const position = part.indexOf("=");
    if (position < 1) return;
    const name = part.slice(0, position).trim();
    if (RE0_COOKIES.indexOf(name) < 0) return;
    const content = part.slice(position + 1).trim();
    if (content) result[name] = content;
  });
  return result;
}

function re0CookieString(jar) {
  return RE0_COOKIES.filter(name => jar[name])
    .map(name => name + "=" + jar[name]).join("; ");
}

function re0MergeCookies(jar, value) {
  const values = Array.isArray(value) ? value : [value];
  values.filter(Boolean).forEach(item => {
    String(item).split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)
      .forEach(cookie => {
        const parts = cookie.trim().split(";");
        const first = parts.shift() || "";
        const position = first.indexOf("=");
        if (position < 1) return;
        const name = first.slice(0, position).trim();
        if (RE0_COOKIES.indexOf(name) < 0) return;
        const content = first.slice(position + 1).trim();
        const attributes = Object.create(null);
        parts.forEach(part => {
          const index = part.indexOf("=");
          const key = (index < 0 ? part : part.slice(0, index))
            .trim().toLowerCase();
          attributes[key] = index < 0 ? "" : part.slice(index + 1).trim();
        });
        if (attributes.domain &&
            attributes.domain.replace(/^\./, "").toLowerCase() !== "re0.me") return;
        if (attributes.path && attributes.path !== "/") return;
        const maxAge = attributes["max-age"];
        const validMaxAge = maxAge !== undefined &&
          /^-?\d+$/.test(maxAge) && Number.isFinite(Number(maxAge));
        const expiry = Date.parse(attributes.expires || "");
        const removed = !content || (validMaxAge
          ? Number(maxAge) <= 0
          : Number.isFinite(expiry) && expiry <= Date.now());
        if (removed) delete jar[name];
        else jar[name] = content;
      });
  });
}

function re0ReadSession() {
  try {
    const value = $prefs.valueForKey(RE0_CONFIG.storageKey);
    const session = value ? JSON.parse(value) : null;
    return session && typeof session === "object" ? session : null;
  } catch (_) {
    return null;
  }
}

function re0SaveSession(session) {
  if (!$prefs.setValueForKey(JSON.stringify(session), RE0_CONFIG.storageKey)) {
    throw re0Error("storage");
  }
}

function re0Notify(title, message) {
  console.log("[RE0] " + title);
  $notify("RE0 普通签到", title, message, {
    "open-url": RE0_CONFIG.base
  });
}

function re0Capture() {
  if (!/^https:\/\/re0\.me\/(?:\?.*)?$/i.test($request.url || "")) return;
  if (String($request.method || "").toUpperCase() !== "POST") return;
  let body;
  try {
    body = JSON.parse($request.body || "");
  } catch (_) {
    return;
  }
  if (!Array.isArray(body) || body.length !== 1 || body[0] !== false) return;

  const headers = $request.headers || {};
  const action = String(re0Header(headers, "next-action") || "").trim();
  const ua = String(re0Header(headers, "user-agent") || "").trim();
  const jar = re0CookieMap(re0Header(headers, "cookie"));
  if (!/^[0-9a-f]{20,128}$/i.test(action) || !ua || !jar.token) {
    re0Notify("签到参数未完整", "请确认已经登录，再手动点一次普通签到。");
    return;
  }
  const previous = re0ReadSession();
  const session = {
    action: action,
    ua: ua,
    cookie: re0CookieString(jar),
    capturedAt: Date.now()
  };
  re0SaveSession(session);
  if (!previous || previous.action !== action ||
      previous.cookie !== session.cookie || previous.ua !== ua) {
    re0Notify("普通签到参数已保存", "可以手动运行定时任务检查配置。");
  }
}

function re0Challenge(response) {
  const body = String(response.body || "");
  const mitigated = String(re0Header(response.headers, "cf-mitigated") || "");
  return /challenge/i.test(mitigated) ||
    /cf-chl-|id=["']challenge-form|Just a moment|Checking your browser/i.test(body) ||
    (Number(response.statusCode) === 403 &&
      /cloudflare/i.test(body) &&
      /you have been blocked|Attention Required|Access denied/i.test(body));
}

async function re0Fetch(session, jar, method, path, action, staticAsset) {
  const remaining = RE0_CONFIG.runTimeout - (Date.now() - RE0_STARTED);
  if (remaining <= 0) throw re0Error("timeout", method);
  if (path.indexOf("/") !== 0 || path.indexOf("//") === 0) {
    throw re0Error("path", method);
  }
  const headers = {
    "User-Agent": session.ua,
    "Cookie": re0CookieString(jar),
    "Accept": method === "POST" ? "text/x-component"
      : staticAsset ? "application/javascript,*/*;q=0.8"
      : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9"
  };
  const opts = { redirection: false, "auto-cookie": false };
  if (RE0_CONFIG.policy.trim()) opts.policy = RE0_CONFIG.policy.trim();
  const request = {
    url: RE0_CONFIG.base + path,
    method: method,
    headers: headers,
    opts: opts
  };
  if (method === "POST") {
    headers["Content-Type"] = "text/plain;charset=UTF-8";
    headers["Origin"] = RE0_CONFIG.base;
    headers["Referer"] = RE0_CONFIG.base + "/";
    headers["Next-Action"] = action;
    request.body = "[false]";
  }

  const response = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(re0Error("timeout", method));
    }, Math.min(RE0_CONFIG.requestTimeout, remaining));
    Promise.resolve().then(() => $task.fetch(request)).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(re0Error("network", method));
    });
  });
  if (!staticAsset) {
    re0MergeCookies(jar, re0Header(response.headers, "set-cookie"));
    const cookie = re0CookieString(jar);
    if (session.cookie !== cookie) {
      session.cookie = cookie;
      try {
        re0SaveSession(session);
      } catch (error) {
        error.phase = method;
        throw error;
      }
    }
  }
  if (re0Challenge(response)) throw re0Error("cloudflare", method);
  return response;
}

function re0CheckPage(response, jar) {
  const status = Number(response.statusCode);
  const location = String(re0Header(response.headers, "location") || "");
  if (!jar.token || status === 401 ||
      (status >= 300 && status < 400 && /(?:^|\/)login(?:[/?#]|$)/i.test(location)) ||
      /<title>[^<]*(?:登录|sign in|log in)[^<]*<\/title>/i.test(response.body || "")) {
    throw re0Error("auth", "GET");
  }
  if (status === 403) throw re0Error("blocked", "GET");
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw re0Error("page", "GET");
  }
}

function re0SafeMessage(value) {
  return String(value || "").replace(/\s+/g, " ")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\b/g, "[凭据]")
    .slice(0, 180).trim();
}

function re0Records(body) {
  const records = [];
  function add(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    ["response", "error"].forEach(key => {
      const item = value[key];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        records.push({ kind: key, data: item });
      }
    });
  }
  try { add(JSON.parse(body)); } catch (_) {}
  String(body || "").split(/\r?\n/).forEach(line => {
    const match = line.match(/^[0-9a-f]+:(\{.*\})$/i);
    if (!match) return;
    try { add(JSON.parse(match[1])); } catch (_) {}
  });
  return records;
}

function re0Result(response) {
  const status = Number(response.statusCode);
  const body = String(response.body || "");
  const location = String(re0Header(response.headers, "location") || "");
  const records = re0Records(body);
  const record = records.length === 1 ? records[0] : null;
  const data = record ? record.data : {};
  const message = [data.message, data.description]
    .filter(value => typeof value === "string").join(" ").trim();
  const code = String(data.code || "");
  const httpOK = status >= 200 && status < 300;
  const errorText = records.length > 1 || (record && data.success === true) ? ""
    : !httpOK ? body : record && data.success === false ? code + " " + message : "";

  if (/action_token_required|安全验证已更新/i.test(errorText)) {
    return { kind: "stale-token", message: "签到安全参数已失效。" };
  }
  if (/Server action not found|Failed to find Server Action|Server Action does not exist/i.test(errorText)) {
    return { kind: "stale-action", message: "签到接口编号已变更。" };
  }
  if (status === 401 || code === "401" ||
      (status >= 300 && status < 400 && /(?:^|\/)login(?:[/?#]|$)/i.test(location)) ||
      /<title>[^<]*(?:登录|sign in|log in)[^<]*<\/title>/i.test(body) ||
      /未登录|请先登录|登录已?失效|token expired|unauthorized/i.test(message)) {
    return { kind: "auth", message: "请重新登录并手动点一次普通签到。" };
  }
  if (httpOK && record && record.kind === "response" && data.success === true) {
    return { kind: "success", message: re0SafeMessage(message) || "普通签到成功。" };
  }
  if (httpOK && record && data.success === false &&
      /已(?:经)?签到(?:过)?|already\s+(?:checked|signed)\s*in/i.test(message)) {
    return { kind: "already", message: re0SafeMessage(message) || "今天已经签到。" };
  }
  if (record && data.success === false) {
    return { kind: "failed", message: re0SafeMessage(message) || "签到失败（HTTP " + status + "）。" };
  }
  return {
    kind: "unknown",
    message: "返回结果未能确认（HTTP " + status + "），请在网站查看签到状态。"
  };
}

function re0ChunkPaths(html) {
  const source = String(html || "").replace(/\\\//g, "/");
  const pattern = /((?:https?:\/\/[^/"'\s\\<>]+)?\/?(?:_next\/)?static\/chunks\/[^"'\s\\<>]+?\.js(?:\?[^"'\s\\<>]*)?)/g;
  const result = [];
  const seen = Object.create(null);
  let match;
  while ((match = pattern.exec(source))) {
    let path = match[1].replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(path)) {
      if (path.indexOf(RE0_CONFIG.base + "/") !== 0) continue;
      path = path.slice(RE0_CONFIG.base.length);
    } else {
      path = "/" + path.replace(/^\/+/, "");
    }
    if (path.indexOf("/static/") === 0) path = "/_next" + path;
    if (path.indexOf("/_next/static/chunks/") !== 0 ||
        /(?:^|\/)\.\.(?:\/|$)/.test(path) || seen[path]) continue;
    seen[path] = true;
    result.push(path);
  }
  const priority = path => /layout/i.test(path) ? 0 : /page/i.test(path) ? 1 : 2;
  return result.sort((left, right) => priority(left) - priority(right))
    .slice(0, RE0_CONFIG.maxChunks);
}

function re0ActionIds(source) {
  const result = [];
  const pattern = /createServerReference\s*\)?\s*\(\s*(["'])([0-9a-f]{20,128})\1([^)]{0,700})\)/g;
  let match;
  while ((match = pattern.exec(String(source || "")))) {
    if (/,\s*["']checkIn["']\s*$/.test(match[3]) &&
        result.indexOf(match[2]) < 0) result.push(match[2]);
  }
  return result;
}

async function re0Discover(session, jar, html) {
  const paths = re0ChunkPaths(html);
  for (let index = 0; index < paths.length; index += 3) {
    const batch = await Promise.all(paths.slice(index, index + 3).map(path =>
      re0Fetch(session, jar, "GET", path, "", true)
        .then(response => ({ response: response }), error => ({ error: error }))
    ));
    let ids = [];
    for (const item of batch) {
      if (item.error && item.error.code === "cloudflare") throw item.error;
      if (!item.response || item.response.statusCode !== 200) continue;
      ids = ids.concat(re0ActionIds(item.response.body));
    }
    ids = ids.filter((id, position) => ids.indexOf(id) === position);
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return "";
  }
  return "";
}

async function re0Run() {
  if (typeof $request !== "undefined" && $request) {
    re0Capture();
    return;
  }
  const session = re0ReadSession();
  const jar = re0CookieMap(session && session.cookie);
  if (!session || !jar.token || !session.ua ||
      !/^[0-9a-f]{20,128}$/i.test(session.action || "")) {
    re0Notify("请先抓取签到", "启用配套重写，登录 re0.me 后手动点一次普通签到。");
    return;
  }
  let page = await re0Fetch(session, jar, "GET", "/");
  re0CheckPage(page, jar);
  let result = re0Result(await re0Fetch(session, jar, "POST", "/", session.action));

  if (result.kind === "stale-action" || result.kind === "stale-token") {
    page = await re0Fetch(session, jar, "GET", "/");
    re0CheckPage(page, jar);
    if (result.kind === "stale-action") {
      const action = await re0Discover(session, jar, page.body);
      if (!action || action === session.action) {
        re0Notify("签到接口需要更新", "请在网站手动点一次普通签到，重新保存当前参数。");
        return;
      }
      session.action = action;
      re0SaveSession(session);
    }
    result = re0Result(await re0Fetch(session, jar, "POST", "/", session.action));
  }
  const titles = {
    success: "签到成功",
    already: "今天已签到",
    auth: "登录信息已失效",
    failed: "签到失败",
    unknown: "签到结果未确认",
    "stale-action": "签到接口需要更新",
    "stale-token": "签到安全参数需要更新"
  };
  re0Notify(titles[result.kind] || "签到结果未确认", result.message);
}

re0Run().catch(error => {
  if (error.code === "cloudflare") {
    re0Notify("需要更新网站通行状态",
      "请用相同出口节点在浏览器通过网站验证，再手动普通签到保存参数。");
  } else if (error.code === "auth") {
    re0Notify("登录信息已失效", "请重新登录并手动点一次普通签到。");
  } else if (error.code === "storage" && error.phase === "POST") {
    re0Notify("签到结果未确认", "请求后的登录信息保存失败，请在网站查看签到状态。");
  } else if (error.code === "storage") {
    re0Notify("保存失败", "请检查 Quantumult X 的脚本存储状态。");
  } else if (error.phase === "POST") {
    re0Notify("签到结果未确认", "请求未能完成确认，请在网站查看签到状态。");
  } else {
    re0Notify("请求失败", "请检查网络、所用策略和登录状态，再运行任务。");
  }
}).finally(() => $done({}));
