/*
 * WN4K multi-account check-in for Quantumult X build 934 or newer.
 * Rewrite: script-request-body. Task: the same file without $request.
 * Learn the real request from a manual check-in; never guess an endpoint.
 * Credentials stay in $prefs. Do not export the account store to GitHub.
 */

(function () {
  "use strict";

  const STORE = "wn4k.checkin.accounts.v1";
  const LOCK = "wn4k.checkin.lock.v1";
  const MAX_ATTEMPTS = 3;
  const RUN_BUDGET_MS = 100000;
  const MIN_REQUEST_BUDGET_MS = 12000;
  const MAX_BODY_LENGTH = 16384;
  // Optional: the exact HTTPS check-in URL, if its action name is unrecognized.
  const CHECKIN_URL = "";
  const LOG_VERSION = "2026-10-29-log1";
  const TEXT = {
    title: "WN4K \u7b7e\u5230",
    account: "\u8d26\u6237",
    captured: "\u5df2\u4fdd\u5b58\u7b7e\u5230\u8bf7\u6c42",
    updated: "\u5df2\u66f4\u65b0\u767b\u5f55\u51ed\u636e",
    captureTip: "\u5207\u6362\u5176\u4ed6\u8d26\u6237\u540e\u518d\u624b\u52a8\u7b7e\u5230\uff0c\u5373\u53ef\u6dfb\u52a0\u591a\u8d26\u6237\u3002",
    noIdentity: "\u672a\u627e\u5230 user_id/user_name Cookie\uff0c\u672a\u4fdd\u5b58\u3002\u8bf7\u5148\u767b\u5f55\u3002",
    unsupportedBody: "\u8bf7\u6c42\u4f53\u4e0d\u652f\u6301\u5b89\u5168\u91cd\u653e\uff0c\u672a\u4fdd\u5b58\u3002",
    corrupt: "\u672c\u5730\u8d26\u6237\u6570\u636e\u635f\u574f\uff0c\u5df2\u505c\u6b62\uff0c\u4e0d\u4f1a\u8986\u76d6\u3002",
    storage: "\u672c\u5730\u4fdd\u5b58\u5931\u8d25",
    empty: "\u8bf7\u5148\u542f\u7528\u91cd\u5199\uff0c\u9010\u4e2a\u767b\u5f55\u8d26\u6237\u5e76\u624b\u52a8\u7b7e\u5230\u4e00\u6b21\u3002",
    ok: "\u7b7e\u5230\u6210\u529f",
    already: "\u4eca\u65e5\u5df2\u7b7e\u5230",
    expired: "\u767b\u5f55\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u624b\u52a8\u7b7e\u5230",
    challenge: "\u9700\u8981\u9a8c\u8bc1\u6216\u6743\u9650\u53d7\u9650\uff0c\u8bf7\u5728\u7f51\u9875\u5904\u7406",
    network: "\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25",
    unknown: "\u7b7e\u5230\u672a\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u7f51\u9875\u7b7e\u5230\u7ed3\u679c",
    redirect: "\u63a5\u53e3\u91cd\u5b9a\u5411\uff0c\u8bf7\u91cd\u65b0\u624b\u52a8\u7b7e\u5230\u83b7\u53d6\u8bf7\u6c42",
    unsafe: "\u5df2\u8df3\u8fc7\u4e0d\u53d7\u652f\u6301\u7684\u8bf7\u6c42",
    busy: "\u4e0a\u4e00\u6b21\u4efb\u52a1\u4ecd\u5728\u6267\u884c",
    deferred: "\u65f6\u95f4\u9884\u7b97\u4e0d\u8db3\uff0c\u4fdd\u7559\u81f3\u4e0b\u6b21\u4efb\u52a1",
    stopped: "\u4efb\u52a1\u5df2\u505c\u6b62\uff0c\u672a\u786e\u8ba4\u7684\u8d26\u6237\u4e0d\u4f1a\u6807\u8bb0\u6210\u529f"
  };

  let finished = false;
  let lockToken = "";
  let watchdog;
  const mode = typeof $request !== "undefined" ? "capture" : (diagnosticRequested() ? "diagnose" : "task");
  log("START version=" + LOG_VERSION + " mode=" + mode);

  function log(message) {
    // Only controlled status fields: never log URLs, headers, names or response bodies.
    console.log("[WN4K] " + message);
  }

  function diagnosticRequested() {
    if (typeof $environment === "undefined" || !$environment) return false;
    if ($environment.variables && $environment.variables.mode === "diagnose") return true;
    const hash = String($environment.sourcePath || "").split("#").slice(1).join("#");
    return /(?:^|&)mode=diagnose(?:&|$)/.test(hash);
  }

  function diagnose() {
    const accounts = readAccounts();
    log("STATE accounts=" + accounts.length);
    const legacy = !!($prefs.valueForKey("WN4K_CREDS") || $prefs.valueForKey("WN4K_CRED"));
    log("STATE legacy-store=" + (legacy ? "present" : "absent"));
    const lines = ["\u5df2\u8fdb\u5165\u811a\u672c\uff0c\u8bca\u65ad\u6a21\u5f0f\u4e0d\u53d1\u9001\u7b7e\u5230\u8bf7\u6c42\u3002", "\u5df2\u5f55\u5165\u8d26\u6237\uff1a" + accounts.length];
    accounts.forEach((account, index) => {
      const number = index + 1;
      const cookie = !!header(account.headers, "cookie");
      const matched = identity(account.headers) === account.id;
      const endpoint = isSiteUrl(account.url) && isCheckin(account) && !isSensitive(account);
      log("STATE account=" + number + " cookie=" + (cookie ? "present" : "absent") +
        " identity=" + (matched ? "match" : "mismatch") + " endpoint=" + (endpoint ? "valid" : "invalid") +
        " today=" + (account.lastDay === today() ? "done" : "pending"));
      lines.push(TEXT.account + number + ": Cookie " + (cookie ? "OK" : "\u7f3a\u5931") +
        " / \u8d26\u6237\u5339\u914d " + (matched ? "OK" : "\u5931\u8d25") +
        " / \u7b7e\u5230\u8bf7\u6c42 " + (endpoint ? "OK" : "\u65e0\u6548"));
    });
    if (!accounts.length) {
      log("SKIP reason=NO_ACCOUNTS");
      if (legacy) lines.push("\u68c0\u6d4b\u5230\u65e7\u7248\u5b58\u50a8\uff0c\u65b0\u7248\u9700\u91cd\u65b0\u91c7\u96c6\u3002");
      lines.push(TEXT.empty);
    }
    notify("\u672c\u5730\u8bca\u65ad", lines.join("\n"));
  }

  function notify(subtitle, message) {
    $notify(TEXT.title, subtitle, message || "");
  }

  function readAccounts() {
    const raw = $prefs.valueForKey(STORE);
    if (!raw) return [];
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error(TEXT.corrupt); }
    if (!Array.isArray(value) || value.some(a => !a || typeof a.id !== "string")) {
      throw new Error(TEXT.corrupt);
    }
    return value;
  }

  function writeAccounts(accounts) {
    if (!$prefs.setValueForKey(JSON.stringify(accounts), STORE)) {
      throw new Error(TEXT.storage);
    }
  }

  function header(headers, key) {
    const name = Object.keys(headers || {}).find(k => k.toLowerCase() === key);
    return name ? String(headers[name]) : "";
  }

  function cookies(value) {
    const result = Object.create(null);
    String(value || "").split(";").forEach(part => {
      const position = part.indexOf("=");
      if (position < 1) return;
      const key = part.slice(0, position).trim();
      const raw = part.slice(position + 1).trim();
      try { result[key] = decodeURIComponent(raw); } catch (_) { result[key] = raw; }
    });
    return result;
  }

  function identity(headers) {
    const values = cookies(header(headers, "cookie"));
    if (/^[1-9]\d*$/.test(values.user_id || "")) return "uid:" + values.user_id;
    if (values.user_name) return "name:" + values.user_name;
    return "";
  }

  function safeHeaders(headers) {
    const result = {};
    const allowed = /^(cookie|authorization|user-agent|accept|accept-language|content-type|origin|referer|x-requested-with|x-csrf-token|x-xsrf-token|csrf-token)$/i;
    Object.keys(headers || {}).forEach(key => {
      if (allowed.test(key)) result[key.toLowerCase()] = String(headers[key]);
    });
    return result;
  }

  function isSiteUrl(url) {
    return /^https:\/\/(?:www\.)?wn4k\.com(?::443)?\//i.test(url || "") && !/[\r\n]/.test(url);
  }

  function route(url) {
    const path = String(url).replace(/^https:\/\/[^/]+/i, "").split("?")[0];
    const query = String(url).split("?").slice(1).join("?");
    const routed = query.match(/(?:^|&)s=([^&]*)/i);
    if (routed) {
      try { return decodeURIComponent(routed[1]); } catch (_) { return ""; }
    }
    return path;
  }

  function isSensitive(request) {
    const path = route(request.url);
    if (/(?:^|\/)(?:ajax_)?(?:login|logout|reg|register|signin|signout|reset|change_pwd)(?:[/.]|$)/i.test(path)) return true;
    const content = String(request.body || "");
    if (content.length > MAX_BODY_LENGTH) return true;
    const sensitiveKey = /(?:^|[.\[])(?:user_)?(?:password|passwd|pwd|captcha|verify|otp)(?:\]|$)/i;
    function formHasSecret(value) {
      return value.split("&").some(part => {
        try { return sensitiveKey.test(decodeURIComponent(part.split("=")[0].replace(/\+/g, " "))); }
        catch (_) { return true; }
      });
    }
    function objectHasSecret(value) {
      return value && typeof value === "object" && Object.keys(value).some(key =>
        sensitiveKey.test(key) || objectHasSecret(value[key]));
    }
    const query = String(request.url).split("?").slice(1).join("?");
    if (formHasSecret(query)) return true;
    if (/^\s*[\[{]/.test(content)) {
      try { return !!objectHasSecret(JSON.parse(content)); } catch (_) { return true; }
    }
    return formHasSecret(content);
  }

  function isCheckin(request) {
    if (CHECKIN_URL && request.url === CHECKIN_URL) return true;
    if (/\/(?:ajax_)?(?:check_?in|qiandao|sign|daily_sign)(?:\.html)?\/?$/i.test(route(request.url))) return true;
    let params = {};
    try {
      if (/^\s*\{/.test(request.body || "")) params = JSON.parse(request.body);
      else {
        String(request.body || "").split("&").forEach(part => {
          const pair = part.split("=");
          params[decodeURIComponent(pair[0])] = decodeURIComponent(pair.slice(1).join("="));
        });
      }
    } catch (_) { return false; }
    return [params.action, params.act, params.ac].some(value => /^(check_?in|qiandao|daily_sign)$/.test(value || ""));
  }

  function capture(request) {
    if (!isSiteUrl(request.url) || isSensitive(request)) return;
    const method = String(request.method || "GET").toUpperCase();
    const checkin = isCheckin(request);
    const memberPage = method === "GET" && /\/user\/(?:index|info)(?:\.html)?\/?$/i.test(route(request.url));
    if (!checkin && !memberPage) return;
    const id = identity(request.headers);
    if (!id) {
      log("CAPTURE skipped=NO_IDENTITY");
      if (checkin) notify(TEXT.noIdentity);
      return;
    }
    const accounts = readAccounts();
    const index = accounts.findIndex(a => a.id === id);
    if (!checkin && index < 0) {
      log("CAPTURE skipped=MANUAL_CHECKIN_REQUIRED");
      return;
    }
    const headers = safeHeaders(request.headers);
    if (!checkin) {
      // Member-page requests refresh cookies, not endpoint-specific CSRF headers.
      const account = accounts[index];
      ["cookie", "authorization", "user-agent"].forEach(key => {
        if (headers[key]) account.headers[key] = headers[key];
      });
      account.updatedAt = Date.now();
      writeAccounts(accounts);
      log("CAPTURE updated=COOKIE account=" + (index + 1));
      return;
    }
    if (!/^(GET|POST)$/.test(method) ||
        (request.body !== undefined && request.body !== null && typeof request.body !== "string") ||
        (!request.body && request.bodyBytes && request.bodyBytes.byteLength > 0) ||
        String(request.body || "").length > MAX_BODY_LENGTH) {
      notify(TEXT.unsupportedBody);
      log("CAPTURE skipped=UNSUPPORTED_BODY");
      return;
    }
    const old = index < 0 ? {} : accounts[index];
    const account = Object.assign({}, old, {
      id,
      label: old.label || TEXT.account + (index < 0 ? accounts.length + 1 : index + 1),
      url: request.url,
      method,
      headers,
      body: method === "POST" ? String(request.body || "") : "",
      updatedAt: Date.now()
    });
    const changed = index < 0 || JSON.stringify(old.headers) !== JSON.stringify(headers) ||
      old.url !== account.url || old.body !== account.body || old.method !== method;
    if (index < 0) accounts.push(account);
    else accounts[index] = account;
    writeAccounts(accounts);
    log("CAPTURE saved account=" + (index < 0 ? accounts.length : index + 1) + " accounts=" + accounts.length);
    if (changed) notify(account.label + " - " + (index < 0 ? TEXT.captured : TEXT.updated), TEXT.captureTip);
  }

  function today() {
    // Deliberately use a UTC+8 calendar, independent of the device timezone.
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function messageOf(body) {
    return String(body.msg || body.message || "");
  }

  function classify(response) {
    const status = Number(response.statusCode);
    if (!Number.isInteger(status) || status < 100 || status > 599) return { kind: "failed", message: TEXT.unknown };
    if (status === 401) return { kind: "failed", message: TEXT.expired };
    if (status === 403) return { kind: "failed", message: TEXT.challenge };
    if (status >= 300 && status < 400) return { kind: "failed", message: TEXT.redirect };
    if ([408, 425, 429].includes(status) || status >= 500) {
      return { kind: "retry", message: "HTTP " + status, retryAfter: header(response.headers, "retry-after") };
    }
    if (status < 200 || status >= 300) return { kind: "failed", message: "HTTP " + status };
    let body;
    try { body = JSON.parse(response.body); } catch (_) {
      const html = String(response.body || "");
      return { kind: "failed", message: /user_pwd|\/user\/login/i.test(html) ? TEXT.expired : TEXT.unknown };
    }
    if (!body || typeof body !== "object") return { kind: "failed", message: TEXT.unknown };
    const message = messageOf(body);
    if (/(?:\u672a\u767b\u5f55|\u8bf7.*\u767b\u5f55|\u767b\u5f55.*(?:\u5931\u6548|\u8fc7\u671f)|not logged|unauthorized)/i.test(message)) {
      return { kind: "failed", message: TEXT.expired };
    }
    if (/(?:\u9a8c\u8bc1\u7801|\u9a57\u8b49\u78bc|captcha|csrf|token.*(?:expired|invalid)|\u5c01\u7981|\u53d7\u9650)/i.test(message) || Number(body.code) === 1004) {
      return { kind: "failed", message: TEXT.challenge };
    }
    if (/(?:\u7a0d\u540e\u91cd\u8bd5|\u7cfb\u7edf\u7e41\u5fd9|too many requests|temporarily unavailable)/i.test(message)) {
      return { kind: "retry", message: TEXT.unknown };
    }
    if (/(?:\u5931\u8d25|\u672a\u6210\u529f|\u672a\u7b7e\u5230|failed|failure)/i.test(message)) {
      return { kind: "failed", message: TEXT.unknown };
    }
    if (/(?:\u4eca\u65e5|\u4eca\u5929|\u5df2\u7ecf|\u5df2).{0,12}(?:\u7b7e\u5230|\u7b7e\u8fc7|\u7c3d\u5230)|already.{0,20}(?:check.?in|signed)/i.test(message)) {
      return { kind: "ok", message: TEXT.already };
    }
    // MacCMS's public login JS uses code === 1. Do not treat HTTP 200 as success.
    if (body.code === 1 || body.code === "1") return { kind: "ok", message: TEXT.ok };
    return { kind: "failed", message: TEXT.unknown };
  }

  function markSuccess(id, day) {
    const accounts = readAccounts();
    const account = accounts.find(a => a.id === id);
    if (account) {
      account.lastDay = day;
      writeAccounts(accounts);
    }
  }

  function markAttempt(id) {
    const accounts = readAccounts();
    const account = accounts.find(a => a.id === id);
    if (account) {
      account.lastAttemptAt = Date.now();
      writeAccounts(accounts);
    }
  }

  function retryDelay(result, attempt) {
    if (result.retryAfter) {
      const seconds = Number(result.retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(result.retryAfter) - Date.now();
      if (Number.isFinite(delay) && delay > 0) return Math.max(delay, 1000);
    }
    return 1500 * Math.pow(2, attempt - 1);
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function finish() {
    if (finished) return;
    finished = true;
    if (watchdog) clearTimeout(watchdog);
    if (lockToken && $prefs.valueForKey(LOCK) === lockToken) $prefs.removeValueForKey(LOCK);
    log("END mode=" + mode);
    $done({});
  }

  async function run() {
    const accounts = readAccounts();
    log("STATE accounts=" + accounts.length);
    if (!accounts.length) { log("SKIP reason=NO_ACCOUNTS"); notify(TEXT.empty); return; }
    const now = Date.now();
    const existing = Number($prefs.valueForKey(LOCK));
    if (existing > now) { log("SKIP reason=BUSY"); notify(TEXT.busy); return; }
    lockToken = String(now + RUN_BUDGET_MS + 30000);
    if (!$prefs.setValueForKey(lockToken, LOCK)) throw new Error(TEXT.storage);
    const deadline = now + RUN_BUDGET_MS;
    const lines = [];
    watchdog = setTimeout(() => {
      log("STOP reason=RUN_BUDGET");
      notify(TEXT.stopped, lines.join("\n"));
      finish();
    }, RUN_BUDGET_MS);

    // Finish pending accounts first, even if earlier accounts were captured first.
    accounts.sort((a, b) => Number(a.lastDay === today()) - Number(b.lastDay === today()) ||
      (Number(a.lastAttemptAt) || 0) - (Number(b.lastAttemptAt) || 0));
    for (const snapshot of accounts) {
      if (finished) return;
      const account = readAccounts().find(a => a.id === snapshot.id);
      if (!account) continue;
      const label = account.label || TEXT.account;
      const number = accounts.indexOf(snapshot) + 1;
      if (account.lastDay === today()) {
        log("SKIP account=" + number + " reason=TODAY_DONE");
        lines.push(label + ": " + TEXT.already); continue;
      }
      if (!isSiteUrl(account.url) || !/^(GET|POST)$/.test(account.method) ||
          identity(account.headers) !== account.id || typeof account.body !== "string" ||
          account.body.length > MAX_BODY_LENGTH || isSensitive(account) || !isCheckin(account)) {
        lines.push(label + ": " + TEXT.unsafe);
        log("SKIP account=" + number + " reason=INVALID_REQUEST");
        continue;
      }
      let result = { kind: "failed", message: TEXT.deferred };
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (finished) return;
        if (deadline - Date.now() < MIN_REQUEST_BUDGET_MS) {
          result = { kind: "failed", message: TEXT.deferred };
          log("SKIP account=" + number + " reason=RUN_BUDGET");
          break;
        }
        const requestDay = today();
        const request = {
          url: account.url,
          method: account.method,
          headers: safeHeaders(account.headers),
          // Disabling the cookie jar is essential for isolated multi-account replay.
          opts: { redirection: false, "auto-cookie": false, "skip-cert-verify": false }
        };
        if (account.method === "POST") request.body = account.body;
        markAttempt(account.id);
        log("REQUEST account=" + number + " attempt=" + attempt);
        try {
          const response = await $task.fetch(request);
          result = classify(response);
          const status = Number(response.statusCode);
          let code = "none";
          try {
            const value = JSON.parse(response.body).code;
            if (/^-?\d{1,9}$/.test(String(value))) code = String(value);
          } catch (_) {}
          log("RESULT account=" + number + " HTTP=" + (Number.isInteger(status) ? status : "invalid") +
            " code=" + code + " kind=" + result.kind);
        } catch (_) {
          result = { kind: "retry", message: TEXT.network };
          log("RESULT account=" + number + " kind=retry reason=NETWORK_ERROR");
        }
        if (finished) return;
        if (result.kind === "ok") {
          // A request crossing midnight is not credited to the following day.
          if (requestDay === today()) markSuccess(account.id, requestDay);
          break;
        }
        if (result.kind !== "retry" || attempt === MAX_ATTEMPTS) break;
        const delay = retryDelay(result, attempt);
        if (deadline - Date.now() < delay + MIN_REQUEST_BUDGET_MS) {
          result.message = TEXT.deferred;
          break;
        }
        log("RETRY account=" + number + " next=" + (attempt + 1));
        await sleep(delay);
      }
      lines.push(label + ": " + result.message);
      if (deadline - Date.now() > MIN_REQUEST_BUDGET_MS) await sleep(1000);
    }
    if (!finished) notify(TEXT.title, lines.join("\n"));
  }

  if (typeof $request !== "undefined") {
    try { capture($request); } catch (error) {
      log("ERROR mode=capture reason=" + (error.message === TEXT.corrupt ? "CORRUPT_STORE" : "CAPTURE_FAILED"));
      notify(error.message === TEXT.corrupt ? TEXT.corrupt : TEXT.storage);
    }
    finish();
  } else {
    const execution = mode === "diagnose" ? Promise.resolve().then(diagnose) : run();
    execution.catch(error => {
      log("ERROR mode=" + mode + " reason=" + (error.message === TEXT.corrupt ? "CORRUPT_STORE" : "RUN_FAILED"));
      if (!finished) notify(error.message === TEXT.corrupt ? TEXT.corrupt : TEXT.stopped);
    }).finally(finish);
  }
})();
