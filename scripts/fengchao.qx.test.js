// 蜂巢 (pting.club) 综合测试与诊断脚本 — Quantumult X 版
// 用途: 一键检测 Cookie 有效性、签到端点连通性与今日签到状态

const NAME = "蜂巢测试";
const COOKIE_KEY = "pting_cookie";
const TIME_KEY = "pting_capture_time";
const CHECK_URL = "https://pting.club/api/check-in";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function main() {
  console.log(`[${NAME}] ========== 蜂巢签到环境体检开始 ==========`);
  const cookie = $prefs.valueForKey(COOKIE_KEY) || "";
  const capTime = $prefs.valueForKey(TIME_KEY);
  const rows = [];

  if (!cookie) {
    rows.push("❌ 未检测到登录 Cookie (pting_cookie)");
    rows.push("💡 请在 Quantumult X 开启蜂巢模块，并在浏览器登录访问 pting.club");
    const text = rows.join("\n");
    console.log(text);
    $notify(NAME, "未检测到凭据", text);
    $done();
    return;
  }

  const keys = cookie
    .split(";")
    .map((x) => x.split("=")[0].trim())
    .filter(Boolean);

  rows.push("🔑 Cookie 状态: 已捕获");
  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`🕒 捕获时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }
  rows.push(`📋 包含字段: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ` (共 ${keys.length} 项)` : ""}`);

  console.log(`[${NAME}] 正在测试签到接口连通性...`);
  $task.fetch({
    url: CHECK_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": "https://pting.club",
      "Referer": "https://pting.club/",
      "Cookie": cookie,
      "User-Agent": UA
    },
    body: JSON.stringify({ action: "check-in" })
  }).then((resp) => {
    const status = Number(resp && resp.statusCode) || 0;
    const body = (resp && resp.body) || "";
    const json = parseJSON(body);

    if (status === 401 || (json && json.code === 401)) {
      rows.push(`📡 接口状态: 凭据已失效 (HTTP ${status})`);
      rows.push("💡 请在浏览器重新登录 pting.club 并刷新任意页面");
    } else if (status >= 200 && status < 300) {
      rows.push(`📡 接口连通: 正常 (HTTP ${status})`);
      if (json) {
        const data = json.data || {};
        const msg = json.message || json.msg || "完成";
        const already = (data.alreadyCheckedIn === true || data.checked === true || msg.indexOf("已签") !== -1);
        rows.push(`🎯 签到状态: ${already ? "今日已签过" : "签到成功"}`);
        if (data.reward != null) rows.push(`🎁 获得奖励: +${data.reward}`);
        const streakNum = data.streak != null ? data.streak : data.currentCheckInStreak;
        if (streakNum != null) rows.push(`🔥 连续签到: ${streakNum} 天`);
        const pointNum = data.points != null ? data.points : data.score;
        if (pointNum != null) rows.push(`🪙 当前积分: ${pointNum}`);
      } else {
        rows.push(`📄 原始响应: ${String(body || "").slice(0, 60)}`);
      }
    } else {
      rows.push(`📡 接口异常: HTTP ${status} | ${json ? (json.message || json.code) : String(body).slice(0, 60)}`);
    }

    finish(rows);
  }, (reason) => {
    rows.push(`📡 接口测试: 请求失败 (${String((reason && reason.error) || reason || "未知错误")})`);
    finish(rows);
  });
}

function finish(rows) {
  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  console.log(`[${NAME}] ========== 蜂巢签到环境体检结束 ==========`);
  $notify(NAME, "体检诊断报告", text);
  $done();
}

if (typeof $task === "undefined") {
  $done();
} else {
  try {
    main();
  } catch (e) {
    console.log(`[${NAME}] 异常: ${e}`);
    $notify(NAME, "体检脚本异常", String(e));
    $done();
  }
}
