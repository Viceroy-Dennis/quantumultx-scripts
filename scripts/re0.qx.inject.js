/*
 * 影巢 re0.me 签到 · v4 注入式（Linda for Dennis）
 * ---------------------------------------------------------------
 * 为什么推翻 v3：re0.me 全站（网页 Server Action / /api/customer/*）都挂
 * Cloudflare 交互盾，cf_clearance 绑定 Safari 的 TLS/JA3 指纹。QX 用
 * $task.fetch 重放 = 假指纹，永远 403 撞墙。
 *
 * v4 思路：不在 QX 后台发请求，而是拦截 re0.me 首页【响应体】注入一段 JS，
 * 让【Safari 自己】在页面里发同源 Server Action —— 真 TLS、真 clearance、
 * 真浏览器环境，CF 从原理上无法拦截。打开任意 re0.me 页面即自动签到（当天仅一次）。
 *
 * action id 不写死：注入 JS 动态读取首页引用的 (app)/layout-*.js，
 * 正则挖 checkIn 的 createServerReference id，站点重新部署也能自适应。
 *
 * 另有 OpenAPI 通道（可选）：填 RE0_API_KEY 后定时任务走 /api/open/checkin，
 * 该路径是全站唯一不挂 CF 盾的接口，可纯后台签到。
 *
 * [rewrite_local]
 * ^https?:\/\/re0\.me\/?$ url script-response-body https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.inject.js
 * [mitm]
 * hostname = re0.me
 * ---------------------------------------------------------------
 */

const NAME = "RE0";
const BASE = "https://re0.me";
const DATE_KEY = "RE0_LastCheckinDate";

// ★ 可选项：OpenAPI 应用 Key（re0.me 个人设置/开发者页面申请），填了即可后台定时签到
const RE0_API_KEY = "";
// ★ 赌狗模式：true = 赌狗签到（有风险加倍），false = 普通签到
const RE0_GAMBLER = false;

// ───────────────────────── 通用工具 ─────────────────────────
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function alreadyToday() {
  try {
    return $prefs.valueForKey(DATE_KEY) === todayCN();
  } catch (e) {
    return false;
  }
}
function markDoneToday() {
  try {
    $prefs.setValueForKey(todayCN(), DATE_KEY);
  } catch (e) {
    console.log("[" + NAME + "] save date failed:", e);
  }
}

// ───────────── 注入到 Safari 页面里执行的 JS（字符串） ─────────────
// 这段在浏览器上下文跑，用不到任何 QX API。签到状态写 localStorage，
// 并通过 document.title 角标呈现（页面内无法直接调 QX 通知）。
function injectedSource() {
  return `(function () {
    try {
      var LS_DATE = "re0_auto_checkin_date";
      var LS_LOG = "re0_auto_checkin_log";
      var today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      if (localStorage.getItem(LS_DATE) === today) return; // 当天已处理

      var GAMBLER = ${JSON.stringify(!!RE0_GAMBLER)};
      var ROUTER_TREE =
        "%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A" +
        "%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2C" +
        "null%2Cnull%2Ctrue%5D";

      function setLog(s) {
        try { localStorage.setItem(LS_LOG, "[" + new Date().toISOString() + "] " + s); } catch (e) {}
      }

      // 从首页 <script src> 找 (app)/layout chunk，挖 checkIn action id
      function scanText(text) {
        var re = /createServerReference\\)\\("([0-9a-f]{40,64})"[\\s\\S]{0,300}?"checkIn"/g;
        var m = re.exec(text);
        return m ? m[1] : "";
      }

      function findActionId() {
        var scripts = Array.prototype.slice.call(document.scripts);
        var srcs = scripts.map(function (s) { return s.src || ""; }).filter(Boolean);
        var layoutSrc = srcs.filter(function (u) {
          return /\\/chunks\\/app\\/\\(app\\)\\/layout-[A-Za-z0-9]+\\.js/.test(u);
        })[0];

        function fetchText(u) {
          return fetch(u, { credentials: "same-origin" }).then(function (r) { return r.text(); });
        }

        // 优先 layout，再兜底所有 chunk
        if (layoutSrc) {
          return fetchText(layoutSrc).then(scanText).then(function (id) {
            if (id) return id;
            return scanAll(srcs, 0);
          });
        }
        return scanAll(srcs, 0);

        function scanAll(list, i) {
          if (i >= list.length) return Promise.resolve("");
          var u = list[i];
          return fetchText(u)
            .then(function (t) {
              var id = scanText(t);
              return id || scanAll(list, i + 1);
            })
            .catch(function () { return scanAll(list, i + 1); });
        }
      }

      function doCheckin(actionId) {
        return fetch("/", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "text/x-component",
            "Content-Type": "text/plain;charset=UTF-8",
            "Next-Action": actionId,
            "Next-Router-State-Tree": ROUTER_TREE
          },
          body: JSON.stringify([GAMBLER])
        }).then(function (res) {
          return res.text().then(function (text) {
            return { status: res.status, text: text };
          });
        });
      }

      function parseResult(r) {
        var t = r.text || "";
        // 成功：{"response":{"success":true,"message":"签到成功，获得 10 积分","code":"200"}}
        var ok = t.match(/"response":\\{[\\s\\S]{0,80}"success":true[\\s\\S]{0,200}?"message":"([^"]+)"/);
        if (ok) return { done: true, ok: true, msg: ok[1] };
        // 已签（error 包装，文案在 description）
        var already = t.match(/"description":"([^"]*(?:已经签到|明天再来|重复签到)[^"]*)"/);
        if (already) return { done: true, ok: true, already: true, msg: already[1] };
        var msg2 = t.match(/"message":"([^"]+)"/);
        if (r.status === 409) return { done: false, msg: (msg2 && msg2[1]) || "安全验证刷新中，请重开页面" };
        if (r.status === 404) return { done: false, stale: true, msg: "action id 失效" };
        if (r.status === 403) return { done: false, msg: "被 Cloudflare 拦截" };
        if (msg2 && /签到成功|获得|积分/.test(msg2[1])) return { done: true, ok: true, msg: msg2[1] };
        if (msg2) return { done: false, msg: msg2[1] };
        return { done: false, msg: "未知响应 status=" + r.status };
      }

      // 把结果用图片信标递回给 QX（同源 GET，自动带 cookie/clearance）
      function report(result) {
        try {
          var p = new URLSearchParams({
            ok: result.ok ? "1" : "0",
            already: result.already ? "1" : "0",
            msg: (result.msg || "").slice(0, 120),
            d: today
          });
          var img = new Image();
          img.src = "/re0-checkin-report.gif?" + p.toString() + "&_=" + Date.now();
        } catch (e) { setLog("beacon fail " + e.message); }
      }

      function finish(result) {
        localStorage.setItem(LS_DATE, today);
        setLog((result.already ? "已签 " : result.ok ? "成功 " : "失败 ") + result.msg);
        var badge = result.ok ? "✅" : "⚠️";
        document.title = badge + " " + (document.title || "re0");
        window.__re0Checkin = result;
        report(result);
      }

      function run(reloaded) {
        findActionId()
          .then(function (id) {
            if (!id) throw new Error("NO_ACTION_ID");
            return doCheckin(id);
          })
          .then(function (r) {
            var result = parseResult(r);
            if (result.stale && !reloaded) {
              setLog("action stale, reload once");
              setTimeout(function () { location.reload(); }, 800);
              return;
            }
            finish(result);
          })
          .catch(function (e) {
            setLog("error " + (e && e.message));
            localStorage.setItem(LS_DATE, today); // 找不到 id 也别死循环
          });
      }

      function start() { setTimeout(function () { run(false); }, 1200); }
      if (document.readyState === "complete") start();
      else window.addEventListener("load", start);
    } catch (e) {
      try { localStorage.setItem("re0_auto_checkin_log", "inject fatal " + e.message); } catch (x) {}
    }
  })();`;
}

// ─────────────────── 分支 A：拦截首页响应，注入 JS ───────────────────
function injectIntoPage() {
  const html = $response.body || "";
  if (!html || html.indexOf("<") !== 0) {
    $done({});
    return;
  }
  const tag = '<script id="re0-auto-checkin">' + injectedSource() + "</script>";
  let out;
  if (/<\/body>/i.test(html)) {
    out = html.replace(/<\/body>/i, tag + "</body>");
  } else if (/<\/html>/i.test(html)) {
    out = html.replace(/<\/html>/i, tag + "</html>");
  } else {
    out = html + tag;
  }
  console.log("[" + NAME + "] inject embedded, bytes=" + out.length);
  $done({ body: out });
}

// ─────────────────── 分支 B：定时任务 → OpenAPI ───────────────────
function openApiCheckin() {
  if (!RE0_API_KEY) {
    $notify(
      "影巢签到",
      "请打开一次 re0.me",
      "注入式签到会在你打开网页时自动完成（Safari 内执行，绕开 Cloudflare）。若想纯后台定时签到，需在脚本顶部填 RE0_API_KEY。"
    );
    $done();
    return;
  }
  if (alreadyToday()) {
    console.log("[" + NAME + "] already checked in today, skip");
    $done();
    return;
  }
  $task
    .fetch({
      url: BASE + "/api/open/checkin",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": RE0_API_KEY,
        Accept: "application/json",
      },
      body: JSON.stringify({ is_gambler: !!RE0_GAMBLER }),
    })
    .then(
      (resp) => {
        const status = resp.statusCode;
        const body = resp.body || "";
        console.log("[" + NAME + "] openapi status=" + status + " body=" + body.slice(0, 200));
        let msg = "";
        let success = false;
        try {
          const j = JSON.parse(body);
          const d = j.data || {};
          msg = d.message || j.message || "";
          success = !!(j.success && (d.checked_in !== undefined ? true : msg));
        } catch (e) {}
        if ((status === 200 || status === 201) && (success || /签到|积分/.test(msg))) {
          markDoneToday();
          $notify("影巢签到（API）", "✅ 签到完成", msg || "签到成功");
        } else if (/已经签到|已签到|明天再来/.test(body)) {
          markDoneToday();
          $notify("影巢签到（API）", "✅ 今天已经签过啦", msg || "");
        } else {
          $notify("影巢签到（API）", "签到异常 " + status, msg || body.slice(0, 100));
        }
        $done();
      },
      (reason) => {
        $notify("影巢签到（API）", "网络请求失败", String(reason && reason.error ? reason.error : reason));
        $done();
      }
    );
}

// ─────────────── 分支 C：接收注入 JS 的图片信标 ───────────────
function tinyGif() {
  // 1x1 透明 GIF
  return (
    "GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04" +
    "\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
  );
}

function handleReport() {
  let q = {};
  try {
    const u = ($request.url || "").split("?")[1] || "";
    u.split("&").forEach((pair) => {
      const i = pair.indexOf("=");
      if (i > 0) q[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
  } catch (e) {}
  const ok = q.ok === "1";
  const already = q.already === "1";
  const msg = q.msg || "";
  console.log("[" + NAME + "] page report: ok=" + ok + " already=" + already + " msg=" + msg);
  if (ok) {
    if (q.d) {
      try {
        $prefs.setValueForKey(q.d, DATE_KEY);
      } catch (e) {}
    } else {
      markDoneToday();
    }
    $notify(
      "影巢签到（实时·网页）",
      already ? "✅ 今天已经签过啦" : "✅ 签到完成",
      msg || "Safari 页面内签到成功"
    );
  } else {
    $notify(
      "影巢签到（实时·网页）",
      "⚠️ 签到未完成",
      msg || "页面内签到失败，可在 re0.me 控制台查看 re0_auto_checkin_log"
    );
  }
  // script-echo-response：直接回一张透明 GIF，不发真实请求
  $done({
    status: "HTTP/1.1 200 OK",
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
    body: tinyGif(),
  });
}

// ───────────────────────── 入口分流 ─────────────────────────
(function main() {
  const url = ($request && $request.url) || "";
  if (/\/re0-checkin-report\.gif/.test(url)) {
    handleReport();
  } else if (
    typeof $response !== "undefined" &&
    $response &&
    typeof $response.body === "string"
  ) {
    injectIntoPage();
  } else {
    openApiCheckin();
  }
})();
