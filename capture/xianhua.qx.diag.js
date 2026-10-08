// 三国咸话抓包诊断脚本（临时用）：每次命中都写 QX 日志，每个域名每分钟弹一次通知
// 用途：验证 重写规则 + MitM 解密 + 脚本下载 三关是否全通
try {
  var url = String($request.url || "");
  var host = (url.match(/^https?:\/\/([^\/]+)/) || ["", ""])[1];
  console.log("[咸话诊断] 命中: " + url);
  var key = "sgxh_diag_" + host;
  var last = Number($prefs.valueForKey(key) || 0);
  if (Date.now() - last > 60000) {
    $prefs.setValueForKey(String(Date.now()), key);
    $notify("咸话抓包诊断 🎯", "重写与 MitM 正常，命中域名:", host);
  }
} catch (e) {
  console.log("[咸话诊断] 异常: " + e);
}
$done({});
