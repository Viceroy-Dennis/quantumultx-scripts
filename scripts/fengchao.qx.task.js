// 蜂巢 (pting.club) 每日自动签到 — Quantumult X 定时任务脚本
// 由 Surge 版移植：$httpClient → $task.fetch，$persistentStore → $prefs，$notification.post → $notify
// 凭据来源: $prefs 键 pting_cookie（与 Surge 版同键名，可共存）
// 签到端点: POST https://pting.club/api/check-in  {"action":"check-in"}

const NAME = "蜂巢签到";
const COOKIE_KEY = "pting_cookie";
const CHECK_URL = "https://pting.club/api/check-in";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function handleResponse(body, status) {
  const json = parseJSON(body);
  if (!json) {
    const raw = String(body || "").slice(0, 120);
    console.log(`[${NAME}] 响应非 JSON: ${raw}`);
    $notify(NAME, "签到结果异常", `HTTP ${status}\n${raw}`);
    return;
  }

  console.log(`[${NAME}] 签到响应: ${JSON.stringify(json)}`);
  const code = json.code;
  const msg = json.message || json.msg || "";
  const data = json.data || {};

  const already = (data.alreadyCheckedIn === true || data.checked === true || msg.indexOf("已签") !== -1);
  const reward = data.reward != null ? ` 奖励: +${data.reward}` : "";
  const streakNum = data.streak != null ? data.streak : data.currentCheckInStreak;
  const streak = streakNum != null ? ` | 连续: ${streakNum} 天` : "";
  const pointNum = data.points != null ? data.points : data.score;
  const point = pointNum != null ? ` | 积分: ${pointNum}` : "";

  let detail = `${reward}${streak}${point}`.trim();
  if (detail.startsWith("|")) detail = detail.slice(1).trim();

  if (status === 401 || code === 401) {
    console.log(`[${NAME}] 登录凭据失效`);
    $notify(NAME, "未登录 (Cookie 已失效)", "请在浏览器重新登录 pting.club 并刷新页面更新凭据");
    return;
  }

  if (status >= 200 && status < 300) {
    const title = already ? "今天已签过" : "签到成功";
    $notify(NAME, title, detail || (msg || "操作已完成"));
    return;
  }

  $notify(NAME, "签到失败", `HTTP ${status} | ${msg || ("code=" + code)}`);
}

function checkin() {
  const cookie = $prefs.valueForKey(COOKIE_KEY) || "";
  if (!cookie) {
    const hint = "未检测到 Cookie，请先在浏览器登录 pting.club 并访问任意页面";
    console.log(`[${NAME}] ${hint}`);
    $notify(NAME, "没有 Cookie", hint);
    $done();
    return;
  }

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
    handleResponse((resp && resp.body) || "", status);
    $done();
  }, (reason) => {
    const err = String((reason && reason.error) || reason || "请求失败");
    console.log(`[${NAME}] 请求出错: ${err}`);
    $notify(NAME, "请求失败", err);
    $done();
  });
}

if (typeof $task === "undefined") {
  $done();
} else {
  try {
    checkin();
  } catch (e) {
    console.log(`[${NAME}] 运行异常: ${e}`);
    $notify(NAME, "脚本运行异常", String(e));
    $done();
  }
}
