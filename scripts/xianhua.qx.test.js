// 三国咸话 —— 综合体检与状态诊断脚本 (Quantumult X 专用)
// 用途: 一键诊断 wxforum (签到通道) 与 api-xh (任务/浏览通道) 的独立凭据健康状态及任务列表进度

const NAME = "三国咸话QX测试";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const TIME_KEY = "sgxh_capture_time";

const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function savedHeaders(isXh) {
  let hdrRaw = "";
  let tokRaw = "";

  if (isXh) {
    hdrRaw = $prefs.valueForKey("sgxh_headers_xh") || $prefs.valueForKey("sgxh_xh_headers") || $prefs.valueForKey(HEADER_KEY) || "{}";
    tokRaw = $prefs.valueForKey("sgxh_token_xh") || $prefs.valueForKey("sgxh_xh_token") || $prefs.valueForKey(TOKEN_KEY) || "";
  } else {
    hdrRaw = $prefs.valueForKey("sgxh_headers_wx") || $prefs.valueForKey("sgxh_wx_headers") || $prefs.valueForKey(HEADER_KEY) || "{}";
    tokRaw = $prefs.valueForKey("sgxh_token_wx") || $prefs.valueForKey("sgxh_wx_token") || $prefs.valueForKey(TOKEN_KEY) || "";
  }

  let saved = {};
  try { saved = JSON.parse(hdrRaw); } catch (e) {}

  const h = {};
  for (const key in saved) {
    const k = String(key).toLowerCase();
    if (DROP[k]) continue;
    if (saved[key] === undefined || saved[key] === null || saved[key] === "") continue;
    h[k] = String(saved[key]);
  }
  if (tokRaw && !h.authorization && !h.token && !h["x-token"]) {
    h.authorization = tokRaw;
  }
  return h;
}

function getJson(url, isXh, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ url, status: 0, error: `网络请求超时(${timeoutMs}ms)`, body: "" });
      }
    }, timeoutMs);

    $task.fetch({
      url: url,
      headers: savedHeaders(isXh)
    }).then((response) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({
          url,
          status: Number(response && response.statusCode) || 0,
          error: "",
          body: String((response && response.body) || "")
        });
      }
    }, (reason) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ url, status: 0, error: String((reason && reason.error) || reason || "请求失败"), body: "" });
      }
    });
  });
}

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

async function main() {
  console.log(`[${NAME}] ========== 开始诊断 ==========`);
  const rows = [];

  const genTok = $prefs.valueForKey(TOKEN_KEY) || "";
  const wxTok = $prefs.valueForKey("sgxh_token_wx") || $prefs.valueForKey("sgxh_wx_token") || genTok;
  const xhTok = $prefs.valueForKey("sgxh_token_xh") || $prefs.valueForKey("sgxh_xh_token") || "";
  const capTime = $prefs.valueForKey(TIME_KEY);
  const rewardUrl = $prefs.valueForKey("sgxh_confirmed_reward_url") || "";

  rows.push("🔑 双通道凭据捕获状态:");
  rows.push(`  • 签到通道 (wxforum): ${wxTok ? `✅ 已具备 (长 ${wxTok.length} 位)` : "❌ 缺失"}`);
  rows.push(`  • 社区/任务通道 (api-xh): ${xhTok ? `✅ 已具备 (长 ${xhTok.length} 位)` : "⚠️ 尚未捕获"}`);
  if (rewardUrl) {
    rows.push(`  • 🎯 领奖端点: 已锁定 ${rewardUrl.replace(/^https?:\/\/[^/]+/i, "")}`);
  }

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`🕒 最近捕获时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  // 测试任务列表
  console.log(`[${NAME}] 正在测试 api-xh 任务列表...`);
  const res = await getJson(LIST_URL, true, 4000);

  rows.push("\n📡 api-xh 任务网关实测:");
  if (res.status === 200) {
    rows.push(`  • 接口状态: 🟢 连通正常 (HTTP 200)`);
    const j = parseJSON(res.body);
    const tasks = (j && j.data) || [];
    rows.push(`  • 识别任务数: ${tasks.length} 项`);

    // 格式化输出目标核心任务
    const targets = tasks.filter(t => /浏览|点赞|分享|签到/i.test(String(t.taskName || t.taskDesc || "")));
    if (targets.length) {
      rows.push("📋 今日核心任务状态:");
      targets.forEach(t => {
        const name = t.taskName || t.taskDesc || t.taskId;
        const cur = t.progress !== undefined ? t.progress : (t.current !== undefined ? t.current : "-");
        const total = t.total !== undefined ? t.total : (t.target !== undefined ? t.target : "-");
        const isRec = t.isReceive === 1 || t.isReceived === 1 || t.receiveStatus === 2 || t.status === 2;
        const statusTxt = isRec ? "✅ 已领取" : "⏳ 待领取/进行中";
        rows.push(`  • ${name}: 进度 ${cur}/${total} [${statusTxt}]`);
      });
    }
  } else if (res.status === 401 || (res.body && res.body.includes("token已经过期"))) {
    rows.push(`  • 接口状态: 🔴 401 凭据缺失或已过期`);
    rows.push(`  • 💡 解决办法: 请在小程序里随便点进一个【帖子】或点击【社区】页面，即可自动抓取 api-xh 凭据！`);
  } else {
    rows.push(`  • 接口状态: 🟡 HTTP ${res.status} ${String(res.body).slice(0, 60)}`);
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  $notify(NAME, xhTok ? "咸话体检正常 🟢" : "咸话凭据体检", text);
  $done();
}

if (typeof $task === "undefined") {
  $done();
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notify(NAME, "测试异常", String(e));
    $done();
  });
}
