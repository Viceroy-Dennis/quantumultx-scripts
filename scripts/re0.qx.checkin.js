// 2026.10.9 v1.0（参考 NodeSeek 风控优化版思路，为 Dennis 定制）

/*
@Name：影巢 RE0 签到
@Author：Linda for Dennis

🎯 站点背景：
re0.me 是影巢/HDHive 的新家（hdhive.com 已被域名商停放）。
Next.js 架构 + Cloudflare 交互盾（比 NodeSeek 那把更严）。
网页端签到走 Server Action（next-action 头），API 层不挂盾。

✅ 双通道设计：
1. Open API 通道（强烈推荐）：POST https://re0.me/api/open/checkin
   只需一个长期有效的 X-API-Key（网页端 个人设置 → OpenAPI 里生成），
   不依赖 Cookie、不受 Cloudflare 挑战影响，半夜定时也稳。
   ⚠️ 留空 RE0_API_KEY 则自动降级到网页通道。
2. 网页 Server Action 通道（无需 Key）：
   NodeSeek 同款「趁热打铁」——重写规则匹配任意 re0.me 请求，
   打开页面瞬间（CF 刚放行、凭据最鲜）自动补签；
   凌晨凭据易凉，定时任务仅作兜底，403 温和提示。

[rewrite_local]
^https?:\/\/re0\.me\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js

[task_local]
0 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js, tag=RE0🎬签到, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true

[MITM]
hostname = re0.me
*/

// ====================== 配置区 ======================
// 在 re0.me 网页端「个人设置 → OpenAPI / 开发者」里生成 API Key 后填到这里。
// 填了它：定时签到走 API 通道，无视 Cloudflare，最稳。
const RE0_API_KEY = "";
// 赌狗模式：true = 每天翻倍或归零（刺激），false = 普通签到（稳妥）
const RE0_GAMBLER = false;
// ====================================================

const BASE = "https://re0.me";
const API_CHECKIN_URL = `${BASE}/api/open/checkin`;
const COOKIE_KEY = "RE0_SavedHeaders";
const ACTION_KEY = "RE0_ActionId";
const DATE_KEY = "RE0_LastCheckinDate";

// 网页通道 Server Action 兜底 ID（来自 MoviePilot 社区插件 hdhivedian115checkin，
// 若失效脚本会自动从页面 JS 重新发现）
const CHECKIN_ACTION_FALLBACK = "4068b21f57fce3dc23dca0ca104769e9e42c011d22";
const CHECKIN_ROUTER_STATE_TREE =
  "%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D";

const NEED_KEYS = [
  "Cookie",
  "User-Agent",
  "Accept-Language",
  "Accept",
  "Accept-Encoding",
  "Priority",
];

const isGetHeader = typeof $request !== "undefined";

function pickNeedHeaders(src = {}) {
  const dst = {};
  const get = (name) =>
    src[name] ?? src[name.toLowerCase()] ??
    src[name.toUpperCase()] ??
    src[`_${name}`];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined && v !== null && v !== "") dst[k] = String(v);
  }
  return dst;
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function markDoneToday() {
  try {
    $prefs.setValueForKey(todayCN(), DATE_KEY);
  } catch (e) {
    console.log("[RE0] save checkin date failed:", e);
  }
}

function alreadyToday() {
  try {
    return $prefs.valueForKey(DATE_KEY) === todayCN();
  } catch (e) {
    return false;
  }
}

// 无 Cookie 请求提醒（60 秒节流）：最常见根因是 Safari 走了 QUIC(HTTP/3)，QX 的 MitM 拦不到 UDP
const NO_COOKIE_NOTIFY_KEY = "RE0_NoCookieNotifyAt";
function noCookieNotifyOnce() {
  try {
    const last = Number($prefs.valueForKey(NO_COOKIE_NOTIFY_KEY) || 0);
    if (Date.now() - last < 60 * 1000) return;
    $prefs.setValueForKey(String(Date.now()), NO_COOKIE_NOTIFY_KEY);
    $notify(
      "影巢抓包提醒",
      "请求里没有 Cookie",
      "若已登录：大概率 Safari 走了 QUIC（HTTP/3），QX 拦不到 UDP——在配置 [general] 加一行 udp_drop_list = QUIC 后重开页面；若未登录，先登录 re0.me。"
    );
  } catch (e) {
    console.log("[RE0] no-cookie notify failed:", e);
  }
}

function saveHeaders(h) {
  try {
    return $prefs.setValueForKey(JSON.stringify(h), COOKIE_KEY);
  } catch (e) {
    console.log("[RE0] save headers failed:", e);
    return false;
  }
}

function loadHeaders() {
  try {
    const raw = $prefs.valueForKey(COOKIE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.Cookie ? obj : null;
  } catch (e) {
    return null;
  }
}

function loadActionId() {
  try {
    const v = $prefs.valueForKey(ACTION_KEY);
    return v && /^[0-9a-f]{40,64}$/.test(v) ? v : "";
  } catch (e) {
    return "";
  }
}

function saveActionId(id) {
  try {
    if (id) $prefs.setValueForKey(id, ACTION_KEY);
  } catch (e) {
    console.log("[RE0] save action id failed:", e);
  }
}

// 从响应文本里挖业务提示：优先 JSON，再逐行 Flight 流（0-9a-f:json）
function extractMessage(body) {
  const text = String(body || "");
  const tryObj = (s) => {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  };
  const collect = (val, out) => {
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach((x) => collect(x, out));
      return;
    }
    if (typeof val === "object") {
      if (val.message) out.push(String(val.message));
      if (val.description) out.push(String(val.description));
      if (val.data && typeof val.data === "object" && val.data.message) {
        out.push(String(val.data.message));
      }
      Object.values(val).forEach((x) => collect(x, out));
    }
  };
  const msgs = [];
  let obj = tryObj(text.trim());
  if (obj) collect(obj, msgs);
  if (!msgs.length) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^[0-9a-f]+:(\{.*\})$/i);
      if (!m) continue;
      const o = tryObj(m[1]);
      if (o) collect(o, msgs);
      if (msgs.length) break;
    }
  }
  if (!msgs.length) {
    const m = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m) {
      try {
        msgs.push(JSON.parse(`"${m[1]}"`));
      } catch (e) {
        msgs.push(m[1]);
      }
    }
  }
  return msgs[0] || "";
}

function looksSuccess(body) {
  const text = String(body || "");
  if (/"success"\s*:\s*true/.test(text)) return true;
  return false;
}

function looksAlreadySigned(body) {
  const text = String(body || "");
  return /已经签到|已签到|今日已签|重复签到/.test(text);
}

// v8 实战机制:纯页面 flight 壳(渲染流而非动作结果)且无业务提示 = action id 未生效
function looksPageFlight(body, msg) {
  if (msg) return false; // 有业务提示就不是纯壳
  const t = String(body || "");
  return /\$Sreact\./.test(t) || /^\s*\d+:"\$/m.test(t);
}

// 从响应 Set-Cookie 提取 hdh_sa_token(v6 令牌接力)
function setCookieToken(headers) {
  let v = headers?.["Set-Cookie"] ?? headers?.["set-cookie"] ?? "";
  if (Array.isArray(v)) v = v.join(",");
  const m = String(v).match(/(?:^|[,\s])hdh_sa_token=([^;,\s]+)/i);
  return m ? m[1] : "";
}

function putCookie(cookie, key, value) {
  const map = {};
  String(cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) map[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  map[key] = value;
  return Object.keys(map)
    .map((k) => `${k}=${map[k]}`)
    .join("; ");
}

function headerHas(headers, wanted) {
  const w = String(wanted).toLowerCase();
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === w) return true;
  }
  return false;
}

// 通知结果统一出口
function notifyResult(tag, status, body, isApi, preMsg) {
  const msg = preMsg !== undefined ? preMsg : extractMessage(body);
  const via = isApi ? "API" : "网页";
  console.log(`[RE0签到${tag}] ${via} status=${status} msg=${msg || "(empty)"}`);

  const pageFlight = !isApi && looksPageFlight(body, msg);
  if (
    status >= 200 &&
    status < 300 &&
    !pageFlight &&
    (looksSuccess(body) || looksAlreadySigned(body) || msg)
  ) {
    markDoneToday();
    const already = looksAlreadySigned(body);
    $notify(
      `影巢签到（${tag}·${via}）`,
      already ? "✅ 今天已经签过啦" : "✅ 签到完成",
      msg || "签到成功"
    );
  } else if (status >= 200 && status < 300 && pageFlight) {
    // v8 假成功防线:纯页面渲染壳 ≠ 签到成功,绝不记日期
    $notify(
      `影巢签到（${tag}·${via}）`,
      "签到动作未生效",
      "返回的是页面渲染（action id 已过期）。下次打开 re0.me 页面会自动刷新并补签。"
    );
  } else if (status === 401) {
    if (isApi) {
      $notify(
        `影巢签到（${tag}·API）`,
        "API Key 无效或已失效",
        "去 re0.me 个人设置重新生成 Key，填到脚本配置区 RE0_API_KEY。"
      );
    } else {
      $notify(
        `影巢签到（${tag}·网页）`,
        "登录态已失效",
        "在浏览器重新登录 re0.me 后自动保鲜。"
      );
    }
  } else if (status === 403) {
    $notify(
      `影巢签到（${tag}·${via}）`,
      "403 被 Cloudflare 拦截",
      "别慌：下次打开 re0.me 任意页面，会趁凭据新鲜自动补签。"
    );
  } else if (status === 404) {
    $notify(
      `影巢签到（${tag}·${via}）`,
      "404 签到接口未命中",
      "站点可能改版，抓包重开一次页面刷新凭据试试。"
    );
  } else {
    $notify(
      `影巢签到（${tag}·${via}）`,
      `请求异常 ${status}`,
      msg || String(body || "").slice(0, 80) || "无返回内容"
    );
  }
  $done();
}

function fetchFail(tag, reason, isApi) {
  const err = reason?.error ? String(reason.error) : String(reason || "");
  console.log(`[RE0签到${tag}] request error:`, err);
  $notify(`影巢签到（${tag}·${isApi ? "API" : "网页"}）`, "请求错误", err);
  $done();
}

// ============ 通道一：Open API（有 Key 走这，无视 CF） ============
function apiCheckin(tag) {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": RE0_API_KEY,
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    Origin: BASE,
    Referer: `${BASE}/`,
  };
  $task
    .fetch({
      url: API_CHECKIN_URL,
      method: "POST",
      headers,
      body: JSON.stringify({ is_gambler: RE0_GAMBLER }),
    })
    .then(
      (resp) => {
        // 已签时后端可能回 400/409 + 文案，也当作完成处理
        const status = resp.statusCode;
        const body = resp.body || "";
        if (status >= 200 && status < 300) {
          notifyResult(tag, status, body, true);
        } else if (looksAlreadySigned(body)) {
          markDoneToday();
          $notify(`影巢签到（${tag}·API）`, "✅ 今天已经签过啦", extractMessage(body));
          $done();
        } else if (status === 401 && /INVALID_API_KEY|MISSING_API_KEY/i.test(body)) {
          // Key 无效 → 尝试降级网页通道（若有 Cookie）
          const saved = loadHeaders();
          if (saved) {
            console.log("[RE0] API Key invalid, fallback to web channel");
            webCheckin(tag, saved);
          } else {
            notifyResult(tag, status, body, true);
          }
        } else {
          notifyResult(tag, status, body, true);
        }
      },
      (reason) => fetchFail(tag, reason, true)
    );
}

// ============ 通道二：网页 Server Action（NodeSeek 式趁热补签） ============
function buildWebHeaders(saved, actionId) {
  return {
    Accept: "text/x-component",
    "Content-Type": "text/plain;charset=UTF-8",
    "Next-Action": actionId,
    "Next-Router-State-Tree": CHECKIN_ROUTER_STATE_TREE,
    Origin: BASE,
    Referer: `${BASE}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent":
      saved["User-Agent"] ||
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "Accept-Language": saved["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    Cookie: saved["Cookie"] || "",
  };
}

function webCheckin(tag, saved, retryAction) {
  const actionId = (retryAction ? "" : loadActionId()) || CHECKIN_ACTION_FALLBACK;
  postCheckinAction(tag, saved, actionId, retryAction);
}

function postCheckinAction(tag, saved, actionId, retryAction, retryToken) {
  $task
    .fetch({
      url: BASE + "/",
      method: "POST",
      headers: buildWebHeaders(saved, actionId),
      body: JSON.stringify([RE0_GAMBLER]),
    })
    .then(
      (resp) => {
        const status = resp.statusCode;
        const body = resp.body || "";
        const headers = resp.headers || {};
        const msg = extractMessage(body);

        // ① 428/409 → hdh_sa_token 令牌接力(v6 实战机制),只接力一轮
        if ((status === 428 || status === 409) && !retryToken) {
          const token = setCookieToken(headers);
          if (token) {
            const fresh = putCookie(saved["Cookie"] || "", "hdh_sa_token", token);
            const saved2 = Object.assign({}, saved, { Cookie: fresh });
            console.log("[RE0] hdh_sa_token refreshed, retry once");
            postCheckinAction(tag, saved2, actionId, retryAction, true);
            return;
          }
        }

        // ② id 过期三特征:404 / x-nextjs-action-not-found 头 / 纯 flight 壳
        const idExpired =
          status === 404 ||
          headerHas(headers, "x-nextjs-action-not-found") ||
          looksPageFlight(body, msg);
        if (idExpired && !retryAction) {
          console.log("[RE0] action id stale, rediscovering");
          discoverAndCheckin(tag, saved);
          return;
        }

        notifyResult(tag, status, body, false, msg);
      },
      (reason) => fetchFail(tag, reason, false)
    );
}

// GET 首页 → 挖 layout chunk → 挖 checkIn action id → 签到
function discoverAndCheckin(tag, saved) {
  const baseHeaders = {
    "User-Agent":
      saved["User-Agent"] ||
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "Accept-Language": saved["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Cookie: saved["Cookie"] || "",
    Referer: `${BASE}/`,
  };
  $task
    .fetch({ url: BASE + "/", method: "GET", headers: baseHeaders })
    .then(
      (resp) => {
        if (resp.statusCode === 403 || resp.statusCode >= 500) {
          notifyResult(tag, resp.statusCode, resp.body, false);
          return;
        }
        const html = resp.body || "";
        const chunks = [
          ...html.matchAll(
            /src="(\/_next\/static\/chunks\/app\/\(app\)\/layout-[^"]+\.js[^"]*)"/g
          ),
          ...html.matchAll(
            /src="(\/_next\/static\/chunks\/[^"]*layout[^"]*\.js[^"]*)"/g
          ),
        ].map((m) => m[1]);
        const targets = [...new Set(chunks)];
        if (!targets.length) {
          console.log("[RE0] no layout chunk found, use fallback action id");
          postCheckinAction(tag, saved, CHECKIN_ACTION_FALLBACK, true);
          return;
        }
        const tryNext = (i) => {
          if (i >= targets.length) {
            postCheckinAction(tag, saved, loadActionId() || CHECKIN_ACTION_FALLBACK, true);
            return;
          }
          $task
            .fetch({
              url: BASE + targets[i],
              method: "GET",
              headers: { ...baseHeaders, Accept: "*/*", Referer: `${BASE}/` },
            })
            .then(
              (r2) => {
                const js = r2.body || "";
                const m = js.match(
                  /createServerReference\)\("([0-9a-f]{40,64})"[\s\S]{0,300}?"checkIn"/
                );
                if (m) {
                  saveActionId(m[1]);
                  console.log("[RE0] discovered action id:", m[1]);
                  postCheckinAction(tag, saved, m[1], true);
                } else {
                  tryNext(i + 1);
                }
              },
              () => tryNext(i + 1)
            );
        };
        tryNext(0);
      },
      (reason) => fetchFail(tag, reason, false)
    );
}

// ============ 主入口 ============
function doCheckin(tag) {
  if (RE0_API_KEY) {
    apiCheckin(tag);
  } else {
    const saved = loadHeaders();
    if (!saved) {
      $notify(
        "影巢签到",
        "暂无可用凭据",
        "两种方式任选：① 脚本里填 RE0_API_KEY（个人设置生成）；② 打开一次 re0.me 网页自动抓 Cookie 补签。"
      );
      $done();
    } else {
      webCheckin(tag, saved);
    }
  }
}

if (isGetHeader) {
  // 🔹 抓包分支：保鲜凭据 + 趁热补签
  const picked = pickNeedHeaders($request.headers || {});
  let finish = $done.bind({});

  if (!picked.Cookie) {
    console.log("[RE0] no cookie in request, skip refresh");
    noCookieNotifyOnce();
    $done({});
  } else {
    const ok = saveHeaders(picked);
    if (!ok) {
      $notify("影巢凭据保存失败", "", "写入持久化存储失败，请检查配置。");
      $done({});
    } else if (alreadyToday()) {
      console.log("[RE0] credentials refreshed silently (already checked in today)");
      $done({});
    } else {
      // 抓到就是签到 action 本体？顺手存 action id（body 为单布尔数组）
      const m = String($request.body || "").match(/^\s*\[(true|false)\]\s*$/);
      const actionHeader =
        $request.headers?.["next-action"] ||
        $request.headers?.["Next-Action"] ||
        $request.headers?.["NEXT-ACTION"];
      if (m && actionHeader && /^[0-9a-f]{40,64}$/.test(actionHeader)) {
        saveActionId(actionHeader);
        console.log("[RE0] captured live checkin action:", actionHeader);
      }
      if (RE0_API_KEY) {
        console.log("[RE0] fresh visit, hot check-in via API");
        apiCheckin("实时补签");
      } else {
        console.log("[RE0] fresh credentials, hot check-in now");
        webCheckin("实时补签", picked);
      }
    }
  }
} else {
  // 🔹 定时兜底分支
  if (alreadyToday()) {
    console.log("[RE0] already checked in today, skip");
    $done();
  } else {
    doCheckin("定时兜底");
  }
}
