// 三国咸话每日全套任务 v3.4 QX 版 (2026-10-10 领奖二轮延迟重取：覆盖 st1→st2 服务端转换延迟)
// Quantumult X [task_local] 专用：$task.fetch / $prefs / $notify
// 包含全套社区与福利任务：
// 1. 打开小程序 (openMiniApp)
// 2. 每日签到 (signIn)
// 3. 今日点赞 10 次 (全并发极速完成)
// 4. 今日浏览帖子 3 次 (真实阅读 + 微服务 3 次上报双重保障)
// 5. 今日分享帖子 1 次 (自动触发)
// 6. 任务列表查询与智能多端点自动领奖 (taskReward / getTaskBonus)
// 2. 每日签到 (signIn)
// 3. 今日点赞 10 次 (全并发极速完成)
// 4. 今日浏览帖子 3 次 (真实阅读 + 微服务 3 次上报双重保障)
// 5. 今日分享帖子 1 次 (自动触发)
// 6. 任务列表查询与智能多端点自动领奖 (taskReward / getTaskBonus)

const NAME = "三国咸话QXv3.4";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const TOPICS_URL = "https://wxforum.sanguosha.cn/api/topics?page=1&category_id=1";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const CANDIDATE_REWARD_URLS = [
  "https://api-xh.sanguosha.cn/task/sgxh-task/taskReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receiveReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/getReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receive",
  "https://api-xh.sanguosha.cn/task/sgxh-task/drawReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/claimReward"
];

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function savedHeaders(url) {
  const isXh = url.includes("api-xh") || url.includes("xh.sanguosha.cn") || url.includes("api-forum-act");
  const isWx = url.includes("wxforum");

  let hdrRaw = "";
  let tokRaw = "";

  if (isXh) {
    hdrRaw = $prefs.valueForKey(HDR_XH_KEY) || "";
    tokRaw = $prefs.valueForKey(TOKEN_XH_KEY) || "";

    if (!tokRaw) {
      tokRaw = $prefs.valueForKey(TOKEN_KEY) || "";
      hdrRaw = $prefs.valueForKey(HEADER_KEY) || "{}";
    }
  } else if (isWx) {
    hdrRaw = $prefs.valueForKey(HDR_WX_KEY) || $prefs.valueForKey(HEADER_KEY) || "{}";
    tokRaw = $prefs.valueForKey(TOKEN_WX_KEY) || $prefs.valueForKey(TOKEN_KEY) || "";
  } else {
    hdrRaw = $prefs.valueForKey(HEADER_KEY) || "{}";
    tokRaw = $prefs.valueForKey(TOKEN_KEY) || "";
  }

  let saved = {};
  try { saved = JSON.parse(hdrRaw || "{}"); } catch (e) {}

  const h = {};
  for (const key in saved) {
    const k = String(key).toLowerCase();
    if (DROP[k]) continue;
    if (saved[key] === undefined || saved[key] === null || saved[key] === "") continue;
    const v = String(saved[key]).trim();
    // 丢弃小程序 JS 序列化 bug 产物，如 "[object Null]"（已实测：传给 api-xh 直接 401）
    if (/^\[object .*\]$/i.test(v) || v === "undefined" || v === "null") continue;
    h[k] = v;
  }

  if (tokRaw && !h.authorization && !h.token && !h["x-token"]) {
    h.authorization = tokRaw;
  }

  const cookie = $prefs.valueForKey(COOKIE_KEY);
  if (cookie && !h.cookie) {
    h.cookie = cookie;
  }

  return { headers: h, token: tokRaw };
}

function headersFor(url) {
  const { headers } = savedHeaders(url);
  const route = String(url).replace(/^https?:\/\/[^/]+/i, "") || "/";
  headers["current-uri"] = route;
  headers["content-type"] = "application/json";
  headers.accept = headers.accept || "application/json, text/plain, */*";
  headers.origin = headers.origin || "https://xianhua.sanguosha.cn";
  headers.referer = headers.referer || "https://xianhua.sanguosha.cn/";
  if (/api-xh|xh\.sanguosha\.cn/i.test(url)) {
    // 小程序专属头（2026-10-09 记录器实抓配方，缺失时补齐）
    headers["app-code"] = headers["app-code"] || "2";
    headers["platform"] = headers["platform"] || "weixin";
    headers["app-system"] = headers["app-system"] || "weixin";
    headers["app-version"] = headers["app-version"] || "8.0.0";
    headers["appversion-code"] = headers["appversion-code"] || "800";
    headers["client-id"] = headers["client-id"] || "ae1ef5b7-6fa2-48d4-891e-e513fad01308";
    headers["current-uri"] = headers["current-uri"] || "subPackages/index/welfare/welfare";
  }
  return headers;
}

function hasCredential() {
  const raw = $prefs.valueForKey(TOKEN_WX_KEY) || $prefs.valueForKey(TOKEN_KEY) || $prefs.valueForKey(TOKEN_XH_KEY);
  return Boolean(raw);
}

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function messageOf(body) {
  const j = parseJSON(body);
  if (!j) return String(body || "").slice(0, 100) || "空响应";
  return j.message || j.msg || (j.data && (j.data.message || j.data.msg)) || (j.success === true ? "成功" : "请求完成");
}

function isAuthError(r) {
  if (r.status === 401 || r.status === 403) return true;
  const str = String(r.body || "");
  if (str.indexOf("未登录") !== -1 || str.indexOf("token已经过期") !== -1 || str.indexOf("token过期") !== -1 || str.indexOf("token失效") !== -1) {
    return true;
  }
  return false;
}

function result(label, r) {
  if (r.error) return `${label}: 异常 (${r.error})`;
  if (isAuthError(r)) return `${label}: 凭据失效 (${messageOf(r.body)})`;
  if (r.status >= 200 && r.status < 300) return `${label}: ${messageOf(r.body)}`;
  return `${label}: HTTP ${r.status} ${messageOf(r.body)}`;
}

// （Surge 版 httpWithTimeout 已移除，QX 版见下方 fetchQX）

// ---- QX HTTP 层：$task.fetch 封装，单请求超时熔断，错误路径必定 resolve ----
function fetchQX(opts, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ url: opts.url, status: 0, error: `网络超时(${timeoutMs}ms)`, body: "" });
      }
    }, timeoutMs);

    $task.fetch(opts).then((resp) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({
          url: opts.url,
          status: Number(resp && resp.statusCode) || 0,
          error: "",
          body: String((resp && resp.body) || "")
        });
      }
    }, (reason) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ url: opts.url, status: 0, error: String((reason && reason.error) || reason || "请求失败"), body: "" });
      }
    });
  });
}

function requestQX(url, method, payload, timeoutMs) {
  const opts = { url: url, method: method, headers: headersFor(url) };
  if (payload !== undefined) opts.body = JSON.stringify(payload || {});
  return fetchQX(opts, timeoutMs);
}

function postJson(url, payload, timeoutMs = 2500) {
  return requestQX(url, "POST", payload, timeoutMs);
}

function putJson(url, payload, timeoutMs = 2500) {
  return requestQX(url, "PUT", payload, timeoutMs);
}

function getJson(url, timeoutMs = 2500) {
  return requestQX(url, "GET", undefined, timeoutMs);
}

const ID_FIELDS = ["taskId", "taskID", "task_id", "id", "userTaskId", "userTaskID", "taskCode"];
const RECEIVED_FIELDS = ["isReceive", "isReceived", "received", "hasReceive", "hasReceived", "isGetReward", "isGet", "receiveFlag", "rewardFlag", "claimed", "is_bonus"]; // is_bonus: 商城任务专用，1=奖励已领
const NAME_FIELDS = ["taskName", "name", "title", "taskTitle", "taskDesc", "task_name", "description", "content"]; // content: 商城任务名

function pick(obj, fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (obj[f] !== undefined && obj[f] !== null) return { field: f, value: obj[f] };
  }
  return null;
}

function truthy(v) { return v === true || v === 1 || v === "1" || v === "true"; }


function collectTasks(node, out, seen = {}) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTasks(item, out, seen));
    return;
  }
  const id = pick(node, ID_FIELDS);
  const name = pick(node, NAME_FIELDS);
  if (id && (name || pick(node, ["status", "progressStatus", "taskStatus"]) || pick(node, RECEIVED_FIELDS))) {
    const key = String(id.value);
    if (!seen[key]) {
      seen[key] = 1;
      out.push(node);
    }
  }
  Object.keys(node).forEach((k) => collectTasks(node[k], out, seen));
}

function taskIdOf(t) {
  const id = pick(t, ID_FIELDS);
  return id ? id.value : undefined;
}

function taskLabel(t) {
  const n = pick(t, NAME_FIELDS);
  return String((n && n.value) || taskIdOf(t) || "未知任务");
}

function alreadyClaimed(t) {
  const r = pick(t, RECEIVED_FIELDS);
  if (r && truthy(r.value)) return true;
  return false;
}

function isDailyTargetTask(t) {
  const label = taskLabel(t);
  if (/累计/i.test(label) || /100次|500次|600次|1000次/i.test(label)) return false;
  return /点赞|浏览|分享|热力竹|战报|签到|打开/i.test(label);
}

function claimable(t) {
  if (alreadyClaimed(t)) return false; // is_bonus:1 → 已领
  if (t.is_finish !== undefined) return truthy(t.is_finish); // 商城任务：完成且未领 → 可领
  return isDailyTargetTask(t);
}

async function claimReward(t) {
  const confirmedUrl = $prefs.valueForKey(REWARD_URL_KEY) || "";
  const confirmedMethod = $prefs.valueForKey("sgxh_confirmed_reward_method") || "POST";
  const confirmedBody = $prefs.valueForKey("sgxh_confirmed_reward_body") || "";

  const tid = typeof t === "object" ? taskIdOf(t) : t;
  const uid = typeof t === "object" ? (t.userTaskId || t.userTaskID || t.id || tid) : tid;

  if (confirmedUrl && /\/api\/shop\//.test(confirmedUrl)) {
    let targetUrl = confirmedUrl.replace(/\/\d+(\/?(\?|$))/, `/${tid}$1`);
    let payload = {};
    try {
      const bodyObj = JSON.parse(confirmedBody);
      if (typeof bodyObj === "object") {
        payload = bodyObj;
        ["taskId", "task_id", "id", "taskCode"].forEach((k) => {
          if (payload[k] !== undefined) payload[k] = tid;
        });
        ["userTaskId", "userTaskID"].forEach((k) => {
          if (payload[k] !== undefined) payload[k] = uid;
        });
      }
    } catch (e) {
      payload = { taskId: tid };
    }

    if (confirmedMethod === "PUT") {
      return await putJson(targetUrl, payload, 2000);
    }
    return await postJson(targetUrl, payload, 2000);
  }

  // 依次尝试候选端点与参数组合
  const attemptPayloads = [
    { taskId: tid },
    { taskId: Number(tid) },
    { userTaskId: uid },
    { id: tid }
  ];

  const claimOk = (r) => {
    const j = parseJSON(r.body);
    const code = j ? (j.code !== undefined ? String(j.code) : "") : "";
    return r.status >= 200 && r.status < 300 && (
      (j && (j.success === true || code === "0" || code === "200" || code === "1000")) ||
      /成功|已领取|获得/.test(r.body)
    );
  };

  // 1. wxforum 商城任务系统（2026-10 小程序实际在用的通道，wx 凭据有效）
  const wxUrls = [
    `https://wxforum.sanguosha.cn/api/shop/getTaskBonus/${tid}`
  ];
  let wxFirstRes = null;
  for (const curUrl of wxUrls) {
    const payloads = /receiveTaskBonus$/.test(curUrl) ? attemptPayloads : [{}];
    for (const payload of payloads) {
      const r = await postJson(curUrl, payload, 2000);
      console.log(`[${NAME}] 领奖试探(wx通道) ${curUrl.replace(/^https?:\/\/[^/]+/i, "")} ${JSON.stringify(payload)} -> HTTP ${r.status} ${String(r.body || "").slice(0, 200)}`);
      if (claimOk(r)) {
        $prefs.setValueForKey(curUrl, REWARD_URL_KEY);
        console.log(`[${NAME}] 🎯 成功锁定领奖接口(wx通道): ${curUrl}`);
        return r;
      }
      if (!wxFirstRes) wxFirstRes = r;
      if (isAuthError(r)) break;
    }
    if (wxFirstRes && isAuthError(wxFirstRes)) break;
  }

  // 2. api-xh 旧微服务候选端点（备胎，多数账号已失效）
  let firstRes = null;
  for (let i = 0; i < CANDIDATE_REWARD_URLS.length; i++) {
    const curUrl = CANDIDATE_REWARD_URLS[i];
    for (const payload of attemptPayloads) {
      const r = await postJson(curUrl, payload, 2000);
      console.log(`[${NAME}] 领奖试探 ${curUrl.replace(/^https?:\/\/[^/]+/i, "")} ${JSON.stringify(payload)} -> HTTP ${r.status} ${messageOf(r.body)}`);
      if (claimOk(r)) {
        $prefs.setValueForKey(curUrl, REWARD_URL_KEY);
        console.log(`[${NAME}] 🎯 成功锁定领奖接口: ${curUrl}`);
        return r;
      }
      if (!firstRes) firstRes = r;
      if (isAuthError(r)) break;
    }
  }

  return firstRes || wxFirstRes;
}

// api-xh 任务系统领奖（2026-10-09 记录器实抓锁定：POST getReward {taskProgressId}）
async function claimXhTask(t) {
  const label = taskLabel(t);
  if (!t.taskProgressId) return `${label}: 无进度记录，跳过`;
  const r = await postJson("https://api-xh.sanguosha.cn/task/sgxh-task/getReward", { taskProgressId: t.taskProgressId }, 3000);
  const j = parseJSON(r.body);
  const ok = r.status >= 200 && r.status < 300 && (
    (j && (String(j.code) === "1000" || String(j.code) === "0" || j.success === true)) ||
    /成功|已领取|获得/.test(r.body)
  );
  console.log(`[${NAME}] getReward(taskProgressId=${t.taskProgressId}) -> HTTP ${r.status} ${String(r.body || "").slice(0, 120)}`);
  if (ok) return `领取[${label}]: ${messageOf(r.body)}`;
  if (isAuthError(r)) return `领取[${label}]: 凭据失效 (${messageOf(r.body)})`;
  return `领取[${label}]: ${result("", r).replace(": ", " ")} (HTTP ${r.status})`;
}

// 浏览一个帖子：完整复刻 App 看帖链路（api-xh postings 系列 + 任务上报），2026-10-09 记录器实抓配方
async function browsePost(postId) {
  await getJson(`https://api-xh.sanguosha.cn/postings/collect/postCollectInfo?postId=${postId}&gameId=2`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/sgxh/community/cert-status?gameId=2`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/postings/topic/getPostOfficialActTopicInfo?gameId=2&postId=${postId}`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/postings/sgxh/post/getPostLikeEasterEgg?gameId=2&postId=${postId}`, 2000);
  await postJson(`https://api-xh.sanguosha.cn/postings/hotpush/order/stat/incr`, { extKey: "view", gameId: 2, extraInfo: "dssm-u2i-L2|que:0|sc:3.3|st:4.35" }, 2000);
  const r = await postJson(PROGRESS_URL, { operateType: 1 }, 2500);
  console.log(`[${NAME}] 浏览上报 postId=${postId} -> HTTP ${r.status} ${String(r.body || "").slice(0, 80)}`);
  return r;
}

// 分享一个帖子：完整复刻 App 分享链路（sgxh ×2 + act-user-task ×2），2026-10-09 记录器实抓配方
async function sharePost(postId) {
  await postJson(PROGRESS_URL, { operateType: 2, gameId: 2 }, 2000);
  await postJson(PROGRESS_URL, { operateType: 2 }, 2000);
  await postJson(`https://api-xh.sanguosha.cn/user/act-user-task/updateTaskProgress`, { channelId: 2, postId: postId, operationType: 1, gameId: 2 }, 2000);
  await postJson(`https://api-xh.sanguosha.cn/user/act-user-task/updateTaskProgress`, { channelId: 2, postId: String(postId), operationType: 1, gameId: 2 }, 2000);
  console.log(`[${NAME}] 分享上报 postId=${postId} 完成`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


function credReport() {
  const xhTok = $prefs.valueForKey(TOKEN_XH_KEY) || "";
  const wxTok = $prefs.valueForKey(TOKEN_WX_KEY) || $prefs.valueForKey(TOKEN_KEY) || "";
  let xhKeys = [];
  try { xhKeys = Object.keys(JSON.parse($prefs.valueForKey(HDR_XH_KEY) || "{}")); } catch (e) {}
  return `凭据自检: api-xh=${xhTok ? xhTok.length + "位" : "缺失!"} | wx=${wxTok ? wxTok.length + "位" : "缺失!"}` +
    (xhKeys.length ? ` | xh头字段: ${xhKeys.slice(0, 10).join(",")}` : "");
}

async function main() {
  if (!hasCredential()) {
    const msg = "未检测到凭据，请在微信中打开一次「三国咸话」小程序自动保存";
    console.log(`[${NAME}] ${msg}`);
    $notify(NAME, "未检测到凭据", msg);
    $done();
    return;
  }

  const rows = [];
  const credLine = credReport();
  rows.push(credLine);
  console.log(`[${NAME}] ${credLine}`);
  if (!($prefs.valueForKey(TOKEN_XH_KEY) || "")) {
    rows.push("⚠️ api-xh 凭据缺失：打开咸话小程序福利页逛一圈即可自动捕获（抓包引用需在重写列表里）");
  }
  console.log(`[${NAME}] ========== 启动全套任务 (极速并发版) ==========`);

  // 1. 并发执行：打开小程序任务 + 每日签到
  const [openRes, signRes] = await Promise.all([
    postJson(OPEN_URL, { flag: 1 }, 2000),
    postJson(SIGN_URL, {}, 2000)
  ]);
  rows.push(result("打开任务", openRes));
  rows.push(result("每日签到", signRes));
  console.log(`[${NAME}] 打开: HTTP ${openRes.status} | 签到: HTTP ${signRes.status}`);

  // 2. 获取推荐帖子列表
  const topicsRes = await getJson(TOPICS_URL, 2000);
  const topicsJson = parseJSON(topicsRes.body);
  let topicsList = (topicsJson && topicsJson.data) || [];

  if (!Array.isArray(topicsList) || !topicsList.length) {
    topicsList = [
      { id: "12906766" }, { id: "12905506" }, { id: "12905512" }, { id: "12904365" }, { id: "12905737" },
      { id: "12906764" }, { id: "12906763" }, { id: "12905500" }, { id: "12905501" }, { id: "12905502" }
    ];
  }

  // 3. 【今日点赞 10 次】全并发打出 (0.2秒完成)
  console.log(`[${NAME}] 并发执行【今日点赞10次】...`);
  const likeLimit = Math.min(10, topicsList.length);
  const likePromises = [];
  for (let i = 0; i < likeLimit; i++) {
    likePromises.push(postJson(`https://wxforum.sanguosha.cn/api/topics/${topicsList[i].id}/likes`, {}, 2000));
  }
  const likeResults = await Promise.all(likePromises);
  const likeSuccess = likeResults.filter(r => r.status === 200 || (parseJSON(r.body) && parseJSON(r.body).code === 0)).length;
  rows.push(`今日点赞: 完成 ${likeSuccess}/10 次`);

  // 4. 【今日浏览 3 次】wxforum 真阅读 + api-xh 完整看帖链路（实抓复刻）
  console.log(`[${NAME}] 执行【今日浏览3次】：真阅读 + api-xh 看帖链路...`);
  let xhBrowseOk = 0;
  for (let i = 0; i < 3; i++) {
    const tid = topicsList[i] ? topicsList[i].id : "12906766";
    await getJson(`https://wxforum.sanguosha.cn/api/topics/${tid}`, 2000);
    const br = await browsePost(tid);
    if (br.status >= 200 && br.status < 300) xhBrowseOk++;
    if (i < 2) await sleep(300);
  }
  rows.push(`今日浏览: 完成 3/3 次 (真链路 ${xhBrowseOk}/3)`);

  // 5. 【今日分享 1 次】wxforum 分享 + api-xh 完整分享链路（实抓复刻）
  const shareTid = topicsList[0] ? topicsList[0].id : "12906766";
  const shRes = await postJson(`https://wxforum.sanguosha.cn/api/topics/${shareTid}/share`, {}, 2000);
  rows.push(result("今日分享", shRes));
  await sharePost(shareTid);

  // 服务端落库等待（st-1→st1 转换）
  await sleep(1500);

  // 7. 查询任务列表并执行自动领奖（wxforum 商城通道为主，api-xh 为备）
  console.log(`[${NAME}] 正在拉取任务列表...`);
  const tasks = [];
  const seenIds = {};

  const shopListRes = await getJson("https://wxforum.sanguosha.cn/api/shop/taskList", 2000);
  console.log(`[${NAME}] shop/taskList 原始响应 (HTTP ${shopListRes.status}): ${String(shopListRes.body || "").slice(0, 600)}`);
  if (parseJSON(shopListRes.body)) collectTasks(parseJSON(shopListRes.body), tasks, seenIds);
  console.log(`[${NAME}] wxforum shop/taskList: HTTP ${shopListRes.status}, 识别 ${tasks.length} 项`);

  const foreverRes = await getJson("https://wxforum.sanguosha.cn/api/shop/taskForever", 2000);
  const foreverJson = parseJSON(foreverRes.body);
  if (foreverJson) collectTasks(foreverJson, tasks, seenIds);
  console.log(`[${NAME}] shop/taskForever: HTTP ${foreverRes.status}, 累计 ${tasks.length} 项`);

  const listRes = await getJson(LIST_URL, 2000);
  const data = parseJSON(listRes.body);
  const beforeCount = tasks.length;
  if (data) collectTasks(data, tasks, seenIds);
  console.log(`[${NAME}] api-xh taskList: HTTP ${listRes.status}, 追加 ${tasks.length - beforeCount} 项`);

  if (tasks.length) {
    console.log(`[${NAME}] 共识别 ${tasks.length} 项任务`);
    const claimPromises = [];
    let xhPass1 = 0;
    for (const t of tasks) {
      const label = taskLabel(t);
      // 通道一：api-xh 任务系统（progressStatus 2 = 已完成待领取，用 taskProgressId 领取）
      if (t.progressStatus === 2 && t.taskProgressId) {
        xhPass1++;
        claimPromises.push((async () => {
          const line = await claimXhTask(t);
          rows.push(line);
          return line;
        })());
        continue;
      }
      // 通道二：wxforum 商城任务（is_finish 且未领）
      if (claimable(t)) {
        claimPromises.push((async () => {
          const claimRes = await claimReward(t);
          return result(`领取[${label}]`, claimRes);
        })());
      }
    }

    // 二轮领奖：st1（已完成待结算）→ st2（可领取）有 1~2 秒服务端延迟，等 3 秒重取再领一轮
    if (xhPass1 === 0) {
      await sleep(3000);
      const reRes = await getJson(LIST_URL, 3000);
      const reJson = parseJSON(reRes.body);
      const reTasks = (reJson && Array.isArray(reJson.data)) ? reJson.data : [];
      for (const t of reTasks) {
        if (t.progressStatus === 2 && t.taskProgressId) {
          console.log(`[${NAME}] 二轮捕捉到可领取: ${t.taskDesc} (pid=${t.taskProgressId})`);
          claimPromises.push((async () => {
            const line = await claimXhTask(t);
            rows.push(line);
            return line;
          })());
        }
      }
    }
    if (claimPromises.length) {
      const claimOutputs = await Promise.all(claimPromises);
      claimOutputs.forEach(o => rows.push(o));
    } else {
      rows.push("奖励领取: 目标任务奖励已处于已领状态");
    }
  } else {
    // 容灾保底：直接尝试领奖核心任务
    const coreTasks = [
      { id: "1001", taskId: "1001", name: "今日点赞10次" },
      { id: "1003", taskId: "1003", name: "今日浏览帖子3次" },
      { id: "1004", taskId: "1004", name: "今日分享帖子1次" }
    ];
    const corePromises = coreTasks.map(async t => {
      const claimRes = await claimReward(t);
      return result(`领取[${t.name}]`, claimRes);
    });
    const coreOutputs = await Promise.all(corePromises);
    coreOutputs.forEach(o => rows.push(o));
  }

  const text = rows.join("\n");
  console.log(`[${NAME}] ========== 执行完成 ==========\n${text}`);

  const hasSuccess = rows.some((x) => x.includes("成功") || x.includes("已领") || x.includes("完成"));
  const title = hasSuccess ? "每日全套任务完成 🎉" : "任务执行结果";

  $notify(NAME, title, text);
  $done();
}

if (typeof $task === "undefined") {
  $done();
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notify(NAME, "脚本运行异常", String(e));
    $done();
  });
}
