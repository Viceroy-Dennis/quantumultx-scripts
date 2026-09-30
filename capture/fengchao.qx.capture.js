// 蜂巢 (pting.club) 登录 Cookie 抓包脚本 — Quantumult X 版 (script-request-header)
// 捕获请求中的 Cookie 并过滤临时 WAF Cookie (acw_tc, cdn_sec_tc)
// 降噪设计：仅在捕获到全新或有效变更的 Cookie 时保存并发送通知

const NAME = "蜂巢签到";
const COOKIE_KEY = "pting_cookie";
const TIME_KEY = "pting_capture_time";

function lowerHeaders(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => {
    o[String(k).toLowerCase()] = String(h[k]);
  });
  return o;
}

function mergeCookie(oldStr, newStr) {
  const map = {};
  String(oldStr || "")
    .split(";")
    .concat(String(newStr || "").split(";"))
    .forEach((p) => {
      const s = p.trim();
      if (!s) return;
      const i = s.indexOf("=");
      if (i <= 0) return;
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      const lk = k.toLowerCase();
      // 过滤临时阿里云 WAF cookie
      if (lk === "acw_tc" || lk === "cdn_sec_tc") return;
      map[k] = v;
    });

  return Object.keys(map)
    .map((k) => `${k}=${map[k]}`)
    .join("; ");
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const headers = lowerHeaders($request.headers || {});
    const cookie = headers.cookie || "";

    if (!cookie) {
      $done({});
    } else {
      const oldCookie = $prefs.valueForKey(COOKIE_KEY) || "";
      const merged = mergeCookie(oldCookie, cookie);

      // 提取有效的 cookie key 列表（已剔除 waf）
      const keys = merged
        .split(";")
        .map((x) => x.split("=")[0].trim())
        .filter(Boolean);

      // 如果没有有效业务 key 则不写入
      if (!keys.length) {
        $done({});
      } else if (merged !== oldCookie) {
        $prefs.setValueForKey(merged, COOKIE_KEY);
        $prefs.setValueForKey(String(Date.now()), TIME_KEY);
        console.log(`[${NAME}] Cookie 已更新, keys: ${keys.join(", ")}`);
        $notify(NAME, "Cookie 获取成功", `已捕获有效 Cookie 凭据\n包含: ${keys.join(", ")}`);
        $done({});
      } else {
        console.log(`[${NAME}] Cookie 未变化，静默处理`);
        $done({});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
