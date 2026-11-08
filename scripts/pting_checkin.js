/*
 * 蜂巢每日签到 — Quantumult X
 *
 * 将本文件放入 Quantumult X/Scripts，然后合并下列配置。
 * 在 Safari 登录蜂巢后，用同一个浏览器打开 /api/auth/me 获取 Cookie。
 * pting.club 当前会跳转到 fengchao.chat；以实际捕获的域名为准。
 *
 * [rewrite_local]
 * ^https:\/\/(?:www\.)?(?:pting\.club|fengchao\.chat)\/api\/(?:auth\/me|check-in)(?:\?.*)?$ url script-request-header pting_checkin.js
 *
 * [task_local]
 * 14 9 * * * pting_checkin.js, tag=蜂巢签到, enabled=true
 *
 * [mitm]
 * hostname = pting.club, www.pting.club, fengchao.chat, www.fengchao.chat
 *
 * hostname 需合并到现有列表。HTTPS 抓取需要已安装并信任 QX 的 MitM 证书。
 * 凭据保存在本机 $prefs，不打印 Cookie，不向其他域名发送。
 * 定时任务只发送一次签到 POST；用站点的今日状态确认结果。
 */

(function () {
  "use strict";

  var TITLE = "蜂巢签到";
  var STORAGE_KEY = "pting.club.checkin.session";
  var CAPTURE = typeof $request !== "undefined";
  var completed = false;
  var timer;

  function finish() {
    if (completed) return;
    completed = true;
    if (timer) clearTimeout(timer);
    if (CAPTURE) $done({});
    else $done();
  }

  function notify(subtitle, message) {
    if (!completed) $notify(TITLE, subtitle, message);
  }

  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase()) {
        return String(headers[keys[i]] || "");
      }
    }
    return "";
  }

  function originOf(url) {
    var match = /^https:\/\/((?:www\.)?(?:pting\.club|fengchao\.chat))(?=\/|$)/i.exec(url || "");
    return match ? "https://" + match[1].toLowerCase() : "";
  }

  function loadSession() {
    var raw = $prefs.valueForKey(STORAGE_KEY);
    if (!raw) throw new Error("未获取 Cookie。请在 Safari 登录蜂巢，再打开 /api/auth/me。");
    var session;
    try {
      session = JSON.parse(raw);
    } catch (_) {
      throw new Error("本地凭据格式无效，请重新获取 Cookie。");
    }
    if (!session || typeof session.cookie !== "string" || !session.cookie.trim() ||
        typeof session.origin !== "string" || originOf(session.origin) !== session.origin) {
      throw new Error("本地凭据无效，请重新获取 Cookie。");
    }
    return session;
  }

  function capture() {
    var origin = originOf($request.url);
    if (!origin || !/^https:\/\/[^/]+\/api\/(?:auth\/me|check-in)(?:\?.*)?$/i.test($request.url)) return;
    var cookie = header($request.headers, "Cookie").trim();
    if (!cookie) return;

    var previous;
    try { previous = loadSession(); } catch (_) { previous = null; }
    var sameSession = previous && previous.origin === origin && previous.cookie === cookie;
    var session = {
      origin: origin,
      cookie: cookie,
      userAgent: header($request.headers, "User-Agent") || (sameSession && previous.userAgent) || "",
      csrfToken: header($request.headers, "X-CSRF-Token") || (sameSession && previous.csrfToken) || "",
      xsrfToken: header($request.headers, "X-XSRF-Token") || (sameSession && previous.xsrfToken) || ""
    };
    var serialized = JSON.stringify(session);
    if ($prefs.valueForKey(STORAGE_KEY) === serialized) return;
    if (!$prefs.setValueForKey(serialized, STORAGE_KEY)) {
      notify("保存失败", "Quantumult X 无法保存凭据，请检查后重试。");
      return;
    }
    if (!previous || previous.origin !== origin) {
      notify("凭据已保存", "来源：" + origin + "\n请手动运行一次签到任务验证登录状态。");
    }
  }

  function requestJSON(session, method, path, body) {
    if (completed) return Promise.reject(new Error("任务已结束。"));
    var headers = {
      "Cookie": session.cookie,
      "Accept": "application/json",
      "Cache-Control": "no-cache",
      "Referer": session.origin + "/",
      "Origin": session.origin
    };
    if (session.userAgent) headers["User-Agent"] = session.userAgent;
    if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;
    if (session.xsrfToken) headers["X-XSRF-Token"] = session.xsrfToken;
    var request = {
      url: session.origin + path,
      method: method,
      headers: headers,
      opts: { redirection: false, "auto-cookie": false }
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }
    return $task.fetch(request).then(function (response) {
      if (completed) throw new Error("任务已结束。");
      var status = Number(response.statusCode);
      var text = String(response.body || "");
      if (/cf-chl-|challenge-platform|just a moment|turnstile/i.test(text) && /^\s*</.test(text)) {
        throw new Error("遇到网站验证。请用 Safari 完成验证后重新获取 Cookie。");
      }
      if (status === 401 || status === 403) {
        throw new Error("登录失效或访问被拒绝（HTTP " + status + "），请重新登录并获取 Cookie。");
      }
      if (status >= 300 && status < 400) {
        throw new Error("网站返回重定向。请登录当前域名并重新获取 Cookie。");
      }
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        throw new Error("站点请求失败（HTTP " + status + "）。");
      }
      var json;
      try { json = JSON.parse(text); }
      catch (_) { throw new Error("站点返回非 JSON 内容，请在 Safari 检查登录或验证状态。"); }
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new Error("站点返回的数据格式无效。");
      }
      if (json.code !== undefined && json.code !== 0 && json.code !== "0") {
        throw new Error("站点拒绝请求：" + String(json.message || "业务错误").slice(0, 160));
      }
      if (json.success === false) {
        throw new Error("站点拒绝请求：" + String(json.message || "操作失败").slice(0, 160));
      }
      return json;
    }, function () {
      throw new Error("网络请求失败或超时，请检查 Quantumult X 网络连接。");
    });
  }

  function readStatus(session) {
    return requestJSON(session, "GET", "/api/auth/me").then(function (json) {
      var data = json.data;
      if (!data || !data.user || typeof data.user !== "object") {
        throw new Error("未检测到登录账户，请重新登录并获取 Cookie。");
      }
      if (!data.surface || typeof data.surface.checkedInToday !== "boolean") {
        throw new Error("站点未返回今日签到状态，接口可能已变更。");
      }
      return data;
    });
  }

  function details(state, result) {
    var lines = [];
    var name = state && (state.user.username || state.user.name);
    if (name) lines.push("账户：" + name);
    if (result && typeof result.reward === "number" && Number.isFinite(result.reward)) {
      lines.push("本次奖励：" + result.reward + " 蜂蜜");
    }
    var streak = state ? state.surface.currentCheckInStreak : result && result.currentStreak;
    if (typeof streak === "number") lines.push("连续签到：" + streak + " 天");
    var balance = state && state.surface.balance;
    if (balance && typeof balance.amount === "number") lines.push("蜂蜜余额：" + balance.amount);
    return lines.join("\n") || "请在蜂巢签到页面查看详情。";
  }

  async function checkIn() {
    var session = loadSession();
    var before = await readStatus(session);
    if (before.surface.checkedInToday) {
      notify("今天已签到", details(before));
      return;
    }

    var result;
    var submitError;
    try {
      var submitted = await requestJSON(session, "POST", "/api/check-in", { action: "check-in" });
      result = submitted.data;
    } catch (error) { submitError = error; }

    // POST 可能已在服务器完成，而客户端遇到超时；查询确认，不重复提交。
    var after;
    var verifyError;
    try { after = await readStatus(session); }
    catch (error) { verifyError = error; }

    if (after && after.surface.checkedInToday) {
      var already = result && result.alreadyCheckedIn === true;
      notify(already ? "今天已签到" : (submitError ? "今日签到已确认" : "签到成功"), details(after, result));
      return;
    }
    if (verifyError) {
      notify("签到结果待确认", "签到请求已发出，但无法查询今日状态。请在站内查看记录。\n" +
        (submitError ? submitError.message + "\n" : "") + verifyError.message);
      return;
    }
    if (submitError) throw submitError;
    throw new Error("接口已返回，但站点仍显示今日未签到。请在站内检查签到结果。");
  }

  if (CAPTURE) {
    try { capture(); }
    catch (_) { notify("获取凭据失败", "请检查配置并重新打开 /api/auth/me。"); }
    finally { finish(); }
    return;
  }

  timer = setTimeout(function () {
    notify("执行超时", "任务未能完成。若已发送签到请求，请在站内确认结果。");
    finish();
  }, 40000);

  checkIn().catch(function (error) {
    notify("签到未完成", error.message || "执行异常，请查看站点状态。");
  }).then(finish, finish);
})();
