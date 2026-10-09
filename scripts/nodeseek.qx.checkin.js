// 2026.10.9 风控优化版（原作：怎么肥事 ZenmoFeiShi 2026.4.8）

/*
@Name：NodeSeek 签到·风控优化版
@Author：原作 怎么肥事 | 优化 Linda for Dennis

❓ 403「Just a moment...」风控原理：
NodeSeek 挂着 Cloudflare 盾。抓包存的 Cookie 里 cf_clearance 短命（几小时级）且绑定 IP+指纹；
QX 的 $task.fetch 用自家 TLS 栈，JA3 指纹与 Safari 不同；
深夜定时任务拿「凉凭据 + 异指纹」硬闯 → CF 直接甩 403 挑战页。

✅ 优化思路（趁热打铁）：
1. 重写规则放宽到任意 /api/ 请求：打开 NS 任意页面即自动保鲜凭据
2. 抓到新凭据的瞬间（CF 刚放行、cf_clearance 最新鲜）立刻补签
3. 当日已签自动跳过，不重复打扰
4. 定时任务降级为兜底；403 温和提示而非报错吓人

[rewrite_local]
^https?:\/\/www\.nodeseek\.com\/api\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/nodeseek.qx.checkin.js

[task_local]
0 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/nodeseek.qx.checkin.js, tag=NS🍗签到, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true

[MITM]
hostname = www.nodeseek.com
*/

const NS_HEADER_KEY = "NS_NodeseekHeaders";
const NS_DATE_KEY = "NS_LastCheckinDate";
const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Connection",
  "Accept-Encoding",
  "Priority",
  "Content-Type",
  "Origin",
  "refract-sign",
  "User-Agent",
  "refract-key",
  "Sec-Fetch-Mode",
  "Cookie",
  "Host",
  "Referer",
  "Accept-Language",
  "Accept",
];

function pickNeedHeaders(src = {}) {
  const dst = {};
  const get = (name) =>
    src[name] ??
    src[name.toLowerCase()] ??
    src[name.toUpperCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function buildHeaders(saved = {}) {
  return {
    Connection: saved["Connection"] || "keep-alive",
    "Accept-Encoding": saved["Accept-Encoding"] || "gzip, deflate, br",
    Priority: saved["Priority"] || "u=3, i",
    "Content-Type": saved["Content-Type"] || "text/plain;charset=UTF-8",
    Origin: saved["Origin"] || "https://www.nodeseek.com",
    "refract-sign": saved["refract-sign"] || "",
    "User-Agent":
      saved["User-Agent"] ||
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "refract-key": saved["refract-key"] || "",
    "Sec-Fetch-Mode": saved["Sec-Fetch-Mode"] || "cors",
    Cookie: saved["Cookie"] || "",
    Host: saved["Host"] || "www.nodeseek.com",
    Referer: saved["Referer"] || "https://www.nodeseek.com/sw.js?v=0.3.33",
    "Accept-Language": saved["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    Accept: saved["Accept"] || "*/*",
  };
}

function markDoneToday() {
  try {
    $prefs.setValueForKey(todayCN(), NS_DATE_KEY);
  } catch (e) {
    console.log("[NS] save checkin date failed:", e);
  }
}

function doCheckin(headers, tag) {
  const myRequest = {
    url: "https://www.nodeseek.com/api/attendance?random=true",
    method: "POST",
    headers: headers,
    body: "",
  };

  $task.fetch(myRequest).then(
    (resp) => {
      const status = resp.statusCode;
      const body = resp.body || "";

      let msg = "";
      try {
        const obj = JSON.parse(body);
        msg = obj?.message ? String(obj.message) : "";
        console.log(`[NS签到${tag}] status=${status} message=${msg || "(empty)"}`);
      } catch (e) {
        console.log(`[NS签到${tag}] status=${status} JSON parse failed`);
      }

      if (status >= 200 && status < 300) {
        markDoneToday();
        $notify(`NodeSeek 签到（${tag}）`, "✅ 签到完成", msg || "签到成功");
      } else if (status === 403) {
        $notify(
          `NodeSeek 签到（${tag}）`,
          "403 凭据被 Cloudflare 拦截",
          "别慌：下次打开 NodeSeek 任意页面，会趁凭据新鲜自动补签。"
        );
      } else if (status === 500) {
        $notify(`NodeSeek 签到（${tag}）`, "500 服务器错误", msg || body || "无返回内容");
      } else {
        $notify(`NodeSeek 签到（${tag}）`, `请求异常 ${status}`, msg || body || "");
      }
      $done();
    },
    (reason) => {
      const err = reason?.error ? String(reason.error) : String(reason || "");
      console.log(`[NS签到${tag}] request error: ${err}`);
      $notify(`NodeSeek 签到（${tag}）`, "请求错误", err);
      $done();
    }
  );
}

if (isGetHeader) {
  // 🔹 抓包分支：保鲜凭据 + 趁热补签
  const picked = pickNeedHeaders($request.headers || {});

  if (!picked || Object.keys(picked).length === 0) {
    console.log("[NS] picked headers empty:", JSON.stringify($request.headers || {}));
    $notify("NodeSeek 凭据获取失败", "", "未获取到指定请求头，请重试。");
    $done({});
  } else {
    const ok = $prefs.setValueForKey(JSON.stringify(picked), NS_HEADER_KEY);
    if (!ok) {
      $notify("NodeSeek 凭据保存失败", "", "写入持久化存储失败，请检查配置。");
      $done({});
    } else if ($prefs.valueForKey(NS_DATE_KEY) === todayCN()) {
      // 今天已签：凭据静默保鲜，不打扰
      console.log("[NS] credentials refreshed silently (already checked in today)");
      $done({});
    } else {
      console.log("[NS] fresh credentials, hot check-in now");
      doCheckin(buildHeaders(picked), "实时补签");
    }
  }
} else {
  // 🔹 定时兜底分支：凭据可能已凉，尽力一试
  const raw = $prefs.valueForKey(NS_HEADER_KEY);

  if (!raw) {
    $notify("NodeSeek 签到（定时兜底）", "无法签到", "本地没有凭据，打开一次 NodeSeek 页面即可自动完成。");
    $done();
  } else {
    let savedHeaders = {};
    let parseOk = true;
    try {
      savedHeaders = JSON.parse(raw) || {};
    } catch (e) {
      parseOk = false;
      console.log("[NS] parse saved headers failed:", e);
    }

    if (!parseOk) {
      $notify("NodeSeek 签到（定时兜底）", "凭据损坏", "请重新打开 NodeSeek 页面刷新凭据。");
      $done();
    } else if ($prefs.valueForKey(NS_DATE_KEY) === todayCN()) {
      // 今天已签：静默退出
      console.log("[NS] already checked in today, skip");
      $done();
    } else {
      doCheckin(buildHeaders(savedHeaders), "定时兜底");
    }
  }
}
