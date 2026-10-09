// 咸话抓包诊断脚本 v2（临时）：覆盖所有 sanguosha 域名，全请求记日志，POST/PUT 弹通知
// body 类型下原样回传请求体，绝不改内容
try {
  var url = String($request.url || "");
  var host = (url.match(/^https?:\/\/([^\/]+)/) || ["", ""])[1];
  var method = String($request.method || "GET").toUpperCase();
  var hasBody = typeof $request.body !== "undefined" && $request.body !== null;
  console.log("[咸话诊断] " + method + " " + url + (hasBody ? " body=" + String($request.body).slice(0, 120) : ""));
  if (method === "POST" || method === "PUT") {
    var key = "sgxh_diag_" + host;
    var last = Number($prefs.valueForKey(key) || 0);
    if (Date.now() - last > 20000) {
      $prefs.setValueForKey(String(Date.now()), key);
      $notify("咸话抓包诊断 🎯", method + " 命中 " + host, url.replace(/^https?:\/\/[^\/]+/i, "").slice(0, 100));
    }
  }
} catch (e) {
  console.log("[咸话诊断] 异常: " + e);
}
$done(typeof $request.body !== "undefined" && $request.body !== null ? $request.body : {});
