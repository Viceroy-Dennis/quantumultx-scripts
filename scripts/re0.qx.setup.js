/*
 * RE0 OpenAPI 本地授权配置。只保存 QX 本地状态，不发送网络请求。
 *
 * 将此文件复制到 QX 的本地 Scripts 目录，再填写下方配置并手动运行一次。
 * API_KEY 是应用 Secret；用户 Token 应由站点正常授权获得，具备 write 权限。
 * ACCESS_TOKEN 和 REFRESH_TOKEN 至少填写一个。Refresh Token 用于自动续期。
 * 勿在 GitHub、远程脚本 URL、任务 hash 参数或公开配置中填写真实凭据。
 */
const API_KEY = "";
const ACCESS_TOKEN = "";
const REFRESH_TOKEN = "";
const AUTH_PREF = "re0_openapi_auth";

function credential(value, bearer) {
  let text = String(value || "").trim();
  if (bearer) text = text.replace(/^Bearer\s+/i, "");
  return text.length <= 8192 && !/[\x00-\x20\x7f]/.test(text) ? text : "";
}

(function setup() {
  if (typeof $request !== "undefined" && $request) { $done({}); return; }
  const auth = {
    apiKey: credential(API_KEY),
    accessToken: credential(ACCESS_TOKEN, true),
    refreshToken: credential(REFRESH_TOKEN),
    expiresAt: 0,
    revision: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
  };
  if (!auth.apiKey || (!auth.accessToken && !auth.refreshToken)) {
    $notify("影巢授权配置", "请先编辑本地副本",
      "填写应用 Secret，以及用户 Access Token 或 Refresh Token，再手动运行。此脚本不会签到或发送网络请求。");
    $done();
    return;
  }
  try {
    const stored = $prefs.setValueForKey(JSON.stringify(auth), AUTH_PREF) === true;
    const cleared = stored && [
      $prefs.setValueForKey("", "re0_verified_checkin_date"),
      $prefs.setValueForKey("", "RE0_LastCheckinDate"),
      $prefs.setValueForKey("0", "re0_api_next_attempt"),
    ].every((result) => result === true);
    $notify("影巢授权配置", cleared ? "授权已保存到 QX 本地" : "本地保存未完成",
      cleared ? "现在可运行 RE0 签到任务；支持每日定时签到。凭据未发送到任何服务器。"
        : "请检查 QX 本地存储，再运行本地配置脚本。");
  } catch (e) {
    $notify("影巢授权配置", "本地保存失败", "请检查 QX 本地存储，再运行本地配置脚本。");
  }
  $done();
})();
