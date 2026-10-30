// 三国咸话 QX 每日与每周任务 v4.0
// 打开小程序、签到、点赞10次、浏览3次、分享1次、查看热力竹与周报、领取热力竹档位和任务奖励。
// #mode=list 仅查询服务器任务列表，不执行任务、不领取奖励。
// progressStatus: -1/0=未完成，1=完成待领取，2=已领取。

const NAME = "三国咸话QXv4.1";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const TOPICS_URL = "https://wxforum.sanguosha.cn/api/topics?page=1&category_id=1";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

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
  if (/^https:\/\/api-xh\.sanguosha\.cn\//i.test(url)) {
    // 小程序通道按已验证配方重建；H5 另用 energyHeaders，互不覆盖。
    const tokRaw = $prefs.valueForKey(TOKEN_XH_KEY) || $prefs.valueForKey(TOKEN_WX_KEY) || $prefs.valueForKey(TOKEN_KEY) || "";
    const clientId = headers["client-id"];
    Object.keys(headers).forEach((k) => delete headers[k]);
    headers["app-code"] = "2";
    headers["platform"] = "weixin";
    headers["app-system"] = "weixin";
    headers["app-version"] = "8.0.0";
    headers["appversion-code"] = "800";
    if (clientId) headers["client-id"] = clientId;
    headers["current-uri"] = "subPackages/index/welfare/welfare";
    headers["content-type"] = "application/json";
    headers["accept"] = "application/json, text/plain, */*";
    if (tokRaw) headers["authorization"] = tokRaw;
    return headers;
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
  if (!j) return safeText(body) || "空响应";
  return safeText(j.message || j.msg || (j.data && (j.data.message || j.data.msg))) || (j.success === true ? "成功" : "请求完成");
}

function isAuthError(r) {
  if (r.status === 401 || r.status === 403) return true;
  const str = String(r.body || "");
  if (str.indexOf("未登录") !== -1 || str.indexOf("token已经过期") !== -1 || str.indexOf("token过期") !== -1 || str.indexOf("token失效") !== -1) {
    return true;
  }
  return false;
}

function responseOk(r) {
  if (!r || r.error || r.status < 200 || r.status >= 300 || isAuthError(r)) return false;
  const j = parseJSON(r.body);
  if (!j || j.success === false || j.failed === true) return false;
  if (j.code !== undefined) return ["0", "200", "1000"].includes(String(j.code));
  return j.success === true;
}

let runFailures = 0;
function result(label, r) {
  if (!responseOk(r)) runFailures++;
  if (!r) return `${label}: 无响应`;
  if (r.error) return `${label}: 异常 (${safeText(r.error)})`;
  if (isAuthError(r)) return `${label}: 凭据失效`;
  return `${label}: ${responseOk(r) ? "请求成功" : "请求失败"} (HTTP ${r.status}，${messageOf(r.body)})`;
}

// 给最后的任务列表复查预留时间，避免120秒客户端超时前仍在批量领奖。
const REQUEST_DEADLINE = Date.now() + 106000;
function fetchQX(opts, timeoutMs = 2500) {
  const remaining = REQUEST_DEADLINE - Date.now();
  if (remaining <= 0) return Promise.resolve({status:0, error:"达到本轮时间上限，请稍后重试", body:""});
  timeoutMs = Math.min(timeoutMs, remaining);
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
        resolve({ url: opts.url, status: 0, error: safeText((reason && reason.error) || reason || "请求失败"), body: "" });
      }
    });
  });
}

function requestQX(url, method, payload, timeoutMs) {
  const opts = { url: url, method: method, headers: headersFor(url), opts: {"auto-cookie": false, redirection: false} };
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
    const key = (node.progressStatus !== undefined ? "xh:" : "shop:") + String(id.value);
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
  return String((n && n.value) || taskIdOf(t) || "未知任务").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function taskStatus(t) {
  if (t.progressStatus !== undefined) {
    const state = Number(t.progressStatus);
    if (state === 2) return "已领取";
    if (state === 1) return "待领取";
    if (state === -1 || state === 0) return "未完成";
    return "状态未知(" + String(t.progressStatus) + ")";
  }
  const received = pick(t, RECEIVED_FIELDS);
  if (received && truthy(received.value)) return "已领取";
  if (t.is_finish !== undefined) return truthy(t.is_finish) ? "待领取" : "未完成";
  return "状态未知";
}

function printTaskList(tasks, phase) {
  console.log(`[${NAME}] ===== 任务列表 · ${phase}（${tasks.length}项） =====`);
  tasks.forEach((t, index) => {
    const current = t.currentProgressValue !== undefined ? t.currentProgressValue : t.user_finish_num;
    const target = t.targetProgressValue !== undefined ? t.targetProgressValue : t.value;
    const progress = current !== undefined && target !== undefined ? ` | 进度 ${current}/${target}` : "";
    const source = t._source === "xh" || t.progressStatus !== undefined ? "社区福利" : "商城";
    const cycle = Number(t.taskType) === 1 ? "每日" : Number(t.taskType) === 2 ? "每周" : Number(t.taskType) === 3 ? "一次性/累计" : t.cycle || "等级/累计";
    console.log(`[${NAME}] ${index + 1}. ${taskLabel(t)} | ${taskStatus(t)}${progress} | ${source} | ${cycle}`);
  });
}

function alreadyClaimed(t) {
  const r = pick(t, RECEIVED_FIELDS);
  if (r && truthy(r.value)) return true;
  return false;
}

function claimable(t) {
  return t.progressStatus === undefined && !alreadyClaimed(t) && t.is_finish !== undefined && truthy(t.is_finish);
}

async function claimReward(t) {
  const tid = taskIdOf(t);
  if (!/^\d+$/.test(String(tid))) return {status: 0, error: "无有效商城任务ID", body: ""};
  return postJson(`https://wxforum.sanguosha.cn/api/shop/getTaskBonus/${tid}`, {}, 3000);
}

async function claimXhTask(t) {
  if (!t.taskProgressId) return `领取[${taskLabel(t)}]: 缺少进度记录，跳过`;
  const response = await postJson("https://api-xh.sanguosha.cn/task/sgxh-task/getReward", {taskProgressId:t.taskProgressId}, 3000);
  return result(`领取[${taskLabel(t)}]`, response);
}

// 浏览一个帖子：完整复刻 App 看帖链路（api-xh postings 系列 + 任务上报），2026-10-09 记录器实抓配方
async function browsePost(postId) {
  await getJson(`https://api-xh.sanguosha.cn/postings/collect/postCollectInfo?postId=${postId}&gameId=2`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/sgxh/community/cert-status?gameId=2`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/postings/topic/getPostOfficialActTopicInfo?gameId=2&postId=${postId}`, 2000);
  await getJson(`https://api-xh.sanguosha.cn/postings/sgxh/post/getPostLikeEasterEgg?gameId=2&postId=${postId}`, 2000);
  await postJson(`https://api-xh.sanguosha.cn/postings/hotpush/order/stat/incr`, { extKey: "view", gameId: 2, extraInfo: "dssm-u2i-L2|que:0|sc:3.3|st:4.35" }, 2000);
  const r = await postJson(PROGRESS_URL, { operateType: 1 }, 2500);
  console.log(`[${NAME}] 浏览上报: HTTP ${r.status} | 业务${responseOk(r) ? "成功" : "失败"}`);
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

// 2026-10-30 QX 记录：H5 /h5/energy 服务端返回进度；客户端刷新 /task/heatValue/progress。
// 热力竹 rewardReceive 使用档位 id；社区 getReward 使用 taskProgressId，两者分别处理。
let runtimeH5Token = "";
function h5Token() {
  return String(runtimeH5Token || $prefs.valueForKey("sgxh_token_h5") || "").replace(/^Bearer\s+/i, "");
}

function prepareH5Token(snapshot) {
  const task = snapshot.tasks.find(t => t._source === "xh" && Number(taskIdOf(t)) === 1006);
  let jump = String(task && task.jumpPageUrl || "");
  try { if (!jump.includes("https://xh.sanguosha.cn/h5/energy")) jump = decodeURIComponent(jump); } catch (e) {}
  if (!/(?:^|[?&]src=)https:\/\/xh\.sanguosha\.cn\/h5\/energy(?:[?&]|$)/.test(jump)) return;
  const match = jump.match(/[?&]token=([^&#\s]+)/);
  if (match) {
    try { const token = decodeURIComponent(match[1]).replace(/^Bearer\s+/i, ""); if (/^[A-Za-z0-9._~+/-]+=*$/.test(token) && token.length >= 8) runtimeH5Token = token; } catch (e) {}
  }
}

function energyHeaders() {
  const token = h5Token();
  return {
    "app-code": "2", "app-system": "h5", "app-version": "5.2.1", "appversion-code": "",
    "content-type": "application/json;charset=UTF-8", "accept": "application/json, text/plain, */*",
    "origin": "https://xh.sanguosha.cn", "referer": "https://xh.sanguosha.cn/",
    ...(token ? {authorization: "Bearer " + token} : {})
  };
}

function energyRequest(path, method, payload) {
  const opts = {url: "https://api-xh.sanguosha.cn" + path, method, headers: energyHeaders(), opts:{"auto-cookie":false, redirection:false}};
  if (payload !== undefined) opts.body = JSON.stringify(payload);
  return fetchQX(opts, 5000);
}

async function bambooProgress() {
  const response = await energyRequest("/task/heatValue/progress", "GET");
  const json = parseJSON(response.body);
  const data = json && json.data;
  return {response, data: responseOk(response) && data && Array.isArray(data.rewards) ? data : null};
}

function finiteValue(value) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "" && /^\d+(?:\.\d+)?$/.test(value.trim())) && Number.isFinite(Number(value)) && Number(value) >= 0;
}

let bambooNotice = "热力竹档位：未检查";

function notificationSummary(snapshot, rows, signResponse, claims) {
  const lines = [responseOk(signResponse) ? "签到：成功" : "签到：失败，详情见下方提示"];
  const daily = snapshot.tasks.filter(t => t._source === "xh" && /今日|每日/.test(taskLabel(t)));
  if (daily.length) daily.forEach(t => lines.push(`${taskLabel(t)}：${taskStatus(t)}`));
  else lines.push("每日任务：列表未返回，请查看日志");
  lines.push("");
  for (const def of WEEKLY_TASKS) {
    const task = weeklyTask(snapshot, def);
    const label = def.key === "bambooView" ? "本周查看热力竹" : def.key === "weeklyReport" ? "本周查看每周战报" : "首次领取热力竹奖励";
    lines.push(`${label}：${task ? taskStatus(task) : "未查到任务"}`);
  }
  lines.push(bambooNotice);
  if (claims) lines.push(`任务奖励：本次尝试领取 ${claims} 项，结果见任务状态`);
  const warnings = rows.filter(row => /失败|异常|缺少明确|无效|未确认|尚未确认|时间不足|达到保护上限/.test(row) &&
    !row.startsWith("热力竹奖励") && !row.startsWith("热力竹进度查询"));
  const extra = [...new Set(warnings)].slice(0,4).map(row => safeText(row));
  if (extra.length) lines.push("", "需检查：", ...extra);
  return lines.join("\n");
}

async function receiveBambooRewards(rows) {
  let progress = await bambooProgress();
  if (!progress.data) { runFailures++; bambooNotice = "热力竹档位：查询失败，请检查授权或网络"; rows.push(result("热力竹进度查询", progress.response)); return; }
  const attempted = {}, maxClaims = 20;
  let received = 0;
  bambooNotice = "热力竹档位：检查中";
  while (received < maxClaims) {
    if (Date.now() > REQUEST_DEADLINE - 15000) { runFailures++; bambooNotice = `热力竹档位：已领取 ${received} 档，剩余下次继续`; rows.push("热力竹奖励: 本轮时间不足，余下档位下次继续"); return; }
    const data = progress.data;
    if (!finiteValue(data.heatValue)) {
      runFailures++; bambooNotice = "热力竹档位：热力值无效，未领取"; rows.push("热力竹奖励: 热力值缺失或无效，跳过领取"); return;
    }
    if (data.rewards.some(r => r && /^\d+$/.test(String(r.id)) && r.received === false && !finiteValue(r.heatThreshold))) { runFailures++; bambooNotice = "热力竹档位：奖励阈值异常，未领取"; rows.push("热力竹奖励: 档位阈值无效，跳过领取"); return; }
    const eligible = data.rewards.filter(r => r && /^\d+$/.test(String(r.id)) && r.received === false &&
      finiteValue(r.heatThreshold) && Number(r.heatThreshold) <= Number(data.heatValue));
    // 服务端给出下个可领档位时优先采用；不硬编码抓包中的37～40号。
    const next = eligible.find(r => String(r.id) === String(data.currentRewardId)) || eligible.sort((a,b) => Number(a.heatThreshold)-Number(b.heatThreshold))[0];
    if (!next) { bambooNotice = received ? `热力竹档位：已领取 ${received} 档，热力值 ${data.heatValue}` : `热力竹档位：暂无可领奖励，热力值 ${data.heatValue}`; rows.push(`热力竹奖励: 本次已确认领取 ${received} 档，当前无可领取档位（热力值 ${data.heatValue}）`); return; }
    if (attempted[next.id]) { runFailures++; bambooNotice = "热力竹档位：进度未更新，已停止重复领取"; rows.push("热力竹奖励: 进度尚未更新，停止重复领取，请稍后重试"); return; }
    attempted[next.id] = true;
    const response = await energyRequest("/task/heatValue/rewardReceive", "POST", {id:next.id});
    if (!responseOk(response)) { bambooNotice = "热力竹档位：领取失败，请查看日志"; rows.push(result(`热力竹奖励[${next.id}]`, response)); return; }
    const check = await bambooProgress();
    if (!check.data) { runFailures++; bambooNotice = "热力竹档位：领取后复查失败，结果待确认"; rows.push(`热力竹奖励[${next.id}]: 接口受理，进度复查失败`); return; }
    const record = check.data.rewards.find(r => String(r.id) === String(next.id));
    if (!record || record.received !== true) { runFailures++; bambooNotice = "热力竹档位：领取结果未确认，已停止重复提交"; rows.push(`热力竹奖励[${next.id}]: 接口受理，但尚未确认已领取，停止重复提交`); return; }
    received++;
    rows.push(`热力竹奖励[${next.id}]: 已复查领取 ${safeText(next.rewardTitle || "奖励")}`);
    progress = check;
  }
  bambooNotice = `热力竹档位：已领取 ${received} 档，余下下次继续`;
  rows.push(`热力竹奖励: 已领取 ${received} 档，本轮达到保护上限，余下档位下次继续`);
}

async function runWeeklyTasks(snapshot, rows) {
  prepareH5Token(snapshot);
  if (!h5Token()) { runFailures++; bambooNotice = "热力竹档位：未检查，请更新重写后在小程序打开一次热力竹页面"; rows.push(bambooNotice); }
  if (!snapshot.xhOk) { runFailures++; rows.push("周任务: 初始社区任务列表查询失败，跳过查看动作"); }
  const view = snapshot.tasks.find(t => t._source === "xh" && Number(taskIdOf(t)) === 1006);
  if (snapshot.xhOk && view && taskStatus(view) === "未完成") {
    const token = h5Token();
    if (!token) rows.push("本周查看热力竹: 缺少 H5 凭据，请打开一次热力竹页面");
    else {
      // 只请求已验证的固定官方入口；token 仅随本地构造的请求发往此地址，不输出到日志。
      const page = await fetchQX({url:"https://xh.sanguosha.cn/h5/energy?token=" + encodeURIComponent(token) + "&c=2", method:"GET", headers:{accept:"text/html"}, opts:{"auto-cookie":false, redirection:false}}, 6000);
      if (!(page.status === 200 && /heatThreshold|currentRewardId/.test(page.body))) runFailures++;
      rows.push(`本周查看热力竹: ${page.status === 200 && /heatThreshold|currentRewardId/.test(page.body) ? "页面已加载，任务状态以复查为准" : "页面未确认加载，请检查 H5 凭据"}`);
    }
  } else if (view && ["已领取","待领取"].includes(taskStatus(view))) rows.push(`本周查看热力竹: ${taskStatus(view)}，跳过重复查看`);
  else { runFailures++; rows.push("本周查看热力竹: 缺少明确未完成状态，暂未执行"); }
  // 档位奖励持续随热力值解锁；一次性任务3014已领取也继续领取已解锁的热力竹档位。
  if (h5Token()) await receiveBambooRewards(rows);
  const report = snapshot.tasks.find(t => t._source === "xh" && Number(taskIdOf(t)) === 3028);
  if (snapshot.xhOk && report && taskStatus(report) === "未完成") {
    const url = "https://api-xh.sanguosha.cn/user/weekReport/sgs?date=undefined&gameId=2";
    const headers = headersFor(url);
    headers["current-uri"] = "subPackages/record/weekPaper/weekPaper";
    const response = await fetchQX({url, method:"GET", headers, opts:{"auto-cookie":false, redirection:false}}, 5000);
    const json = parseJSON(response.body);
    rows.push(result("本周查看每周战报", response));
    if (responseOk(response) && json && json.data && json.data.noData === true) rows.push("每周战报: 暂无战绩数据，任务状态以复查为准");
  } else if (report && ["已领取","待领取"].includes(taskStatus(report))) rows.push(`本周查看每周战报: ${taskStatus(report)}，跳过重复查看`);
  else { runFailures++; rows.push("本周查看每周战报: 缺少明确未完成状态，暂未执行"); }
}

function safeText(value) {
  return String(value || "").replace(/Bearer\s+[\w.-]+/gi,"<REDACTED>").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,"<REDACTED>").replace(/(?:https?:\/\/[^\s]+)[?][^\s]+/g,"<URL>").slice(0,160);
}

const WEEKLY_TASKS = [
  { key: "bambooView", label: "本周查看一次热力竹", match: /(?:查看|浏览).*热力竹|热力竹.*(?:查看|浏览)/ },
  { key: "bambooReward", label: "领取一次热力竹奖励（一次性）", match: /(?:领取|获得).*热力竹|热力竹.*(?:领取|奖励)/ },
  { key: "weeklyReport", label: "本周查看一次每周战报", match: /(?:每周|本周|周).*战报|战报/ }
];

function dailyRemaining(snapshot, id, fallback) {
  const task = snapshot.tasks.find(t => t._source === "xh" && Number(taskIdOf(t)) === id);
  if (!task) return fallback;
  if (Number(task.progressStatus) === 1 || Number(task.progressStatus) === 2) return 0;
  const current = Number(task.currentProgressValue), target = Number(task.targetProgressValue);
  return Number.isFinite(current) && Number.isFinite(target) ? Math.max(0, Math.min(fallback, target-current)) : fallback;
}

function runMode() {
  const vars = typeof $environment !== "undefined" && $environment.variables;
  if (vars && typeof vars === "object") return String(vars.mode || "run");
  const match = String(vars || "").match(/(?:^|[&#])mode=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : "run";
}

async function loadTaskSnapshot(phase) {
  const sources = [
    ["shop", "商城任务", "https://wxforum.sanguosha.cn/api/shop/taskList"],
    ["shop", "商城等级", "https://wxforum.sanguosha.cn/api/shop/taskForever"],
    ["xh", "社区福利", LIST_URL]
  ];
  const results = await Promise.all(sources.map(async ([source, label, url]) => {
    const response = await getJson(url, 3000);
    const json = parseJSON(response.body);
    const tasks = [];
    if (responseOk(response) && json && json.data && typeof json.data === "object") {
      collectTasks(json.data, tasks);
    }
    tasks.forEach(t => { t._source = source; });
    console.log(`[${NAME}] ${label}: ${responseOk(response) ? "查询成功" : "查询失败"} | HTTP ${response.status} | ${tasks.length}项`);
    return { source, label, response, tasks, ok: responseOk(response) && json && json.data && typeof json.data === "object" };
  }));
  const tasks = [], seen = {};
  results.forEach(r => r.tasks.forEach(t => {
    const key = t._source + ":" + String(taskIdOf(t));
    if (!seen[key]) { seen[key] = true; tasks.push(t); }
  }));
  printTaskList(tasks, phase);
  return { tasks, results, xhOk: Boolean(results[2].ok) };
}

function weeklyTask(snapshot, definition) {
  return snapshot.tasks.find(t => t._source === "xh" && definition.match.test(taskLabel(t))) ||
    snapshot.tasks.find(t => definition.match.test(taskLabel(t)));
}

function weeklyRows(snapshot) {
  return WEEKLY_TASKS.map(def => {
    const task = weeklyTask(snapshot, def);
    if (!task) return `${def.label}: ${snapshot.xhOk ? "接口未返回此任务" : "任务列表查询失败"}`;
    const current = task.currentProgressValue !== undefined ? task.currentProgressValue : task.user_finish_num;
    const target = task.targetProgressValue !== undefined ? task.targetProgressValue : task.value;
    return `${def.label}: ${taskStatus(task)}${current !== undefined && target !== undefined ? ` (${current}/${target})` : ""}`;
  });
}

async function claimSnapshot(snapshot, attempted, rows) {
  const candidates = snapshot.tasks.filter(t => taskStatus(t) === "待领取");
  const jobs = [];
  for (const t of candidates) {
    const isXh = t._source === "xh";
    if (isXh && (Number(t.progressStatus) !== 1 || !t.taskProgressId)) continue;
    if (!isXh && !claimable(t)) continue;
    const key = isXh ? `xh:${t.taskProgressId}` : `shop:${taskIdOf(t)}`;
    if (attempted[key]) continue;
    attempted[key] = true;
    jobs.push(isXh ? claimXhTask(t) : claimReward(t).then(r => result(`领取[${taskLabel(t)}]`, r)));
  }
  const output = await Promise.all(jobs);
  rows.push(...output);
  return jobs.length;
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
  console.log(`[${NAME}] ${credReport()}`);
  const before = await loadTaskSnapshot("执行前");
  if (runMode() === "list") {
    const lines = before.tasks.map(t => `${taskLabel(t)}: ${taskStatus(t)}`);
    const text = [...lines, "", ...weeklyRows(before)].join("\n");
    $notify(NAME, "任务列表（只查询）", text || "接口未返回任务");
    $done();
    return;
  }

  const [openRes, signRes] = await Promise.all([
    postJson(OPEN_URL, { flag: 1 }, 2000), postJson(SIGN_URL, {}, 2000)
  ]);
  rows.push(result("打开小程序", openRes), result("每日签到", signRes));

  const topicsRes = await getJson(TOPICS_URL, 3000);
  const topicsJson = parseJSON(topicsRes.body);
  const topicsList = responseOk(topicsRes) && topicsJson && Array.isArray(topicsJson.data) ? topicsJson.data.filter(t => /^\d+$/.test(String(t.id))) : [];
  if (topicsList.length) {
    const likeNeed = dailyRemaining(before, 1001, 10);
    const likeTopics = topicsList.filter(t => !truthy(t.is_like)).slice(0, likeNeed);
    const likeResults = await Promise.all(likeTopics.map(t =>
      postJson(`https://wxforum.sanguosha.cn/api/topics/${t.id}/likes`, {}, 2000)));
    rows.push(likeNeed ? `今日点赞: 请求成功 ${likeResults.filter(responseOk).length}/${likeResults.length}，任务进度以复查为准` : "今日点赞: 已达目标，跳过重复操作");
    const browseNeed = dailyRemaining(before, 1003, 3);
    let browseOk = 0;
    for (let i = 0; i < Math.min(browseNeed, topicsList.length); i++) {
      const id = topicsList[i].id;
      await getJson(`https://wxforum.sanguosha.cn/api/topics/${id}`, 2000);
      if (responseOk(await browsePost(id))) browseOk++;
      if (i < 2) await sleep(300);
    }
    rows.push(browseNeed ? `今日浏览: 上报成功 ${browseOk}/${browseNeed}，任务进度以复查为准` : "今日浏览: 已达目标，跳过重复操作");
    if (dailyRemaining(before, 1004, 1)) {
      const shareId = topicsList[0].id;
      rows.push(result("今日分享", await postJson(`https://wxforum.sanguosha.cn/api/topics/${shareId}/share`, {}, 2000)));
      await sharePost(shareId);
    } else rows.push("今日分享: 已达目标，跳过重复操作");
  } else {
    if (before.tasks.some(t => t._source === "xh" && [1001,1003,1004].includes(Number(taskIdOf(t))) && taskStatus(t) === "未完成")) runFailures++;
    rows.push("帖子列表查询失败或为空：点赞、浏览、分享暂未执行");
  }

  await runWeeklyTasks(before, rows);
  await sleep(1500);
  const after = await loadTaskSnapshot("动作后 / 领取前");
  const attempted = {};
  let claims = await claimSnapshot(after, attempted, rows);
  await sleep(1500);
  const retry = await loadTaskSnapshot("进度复查");
  const extraClaims = await claimSnapshot(retry, attempted, rows);
  claims += extraClaims;
  let final = retry;
  if (extraClaims) {
    await sleep(1000);
    final = await loadTaskSnapshot("领取后");
  }
  if (!claims) rows.push("奖励领取: 本次没有可领取项，具体状态见任务列表");

  const finalWeekly = weeklyRows(final);
  const daily = final.tasks.filter(t => /今日|每日/.test(taskLabel(t)));
  rows.push("", "📋 每日任务状态", ...daily.map(t => `${taskLabel(t)}: ${taskStatus(t)}`), "", "📋 周任务与热力竹奖励", ...finalWeekly);
  const unfinished = final.tasks.filter(t => /今日|每日|本周|每周|热力竹|战报/.test(taskLabel(t)) && taskStatus(t) !== "已领取");
  const missingWeekly = WEEKLY_TASKS.some(d => !weeklyTask(final, d));
  const queryFailure = final.results.some(r => !r.ok);
  const title = unfinished.length || missingWeekly || queryFailure || runFailures ? "任务执行结果 · 有待完成或需检查项" : "任务执行结果 · 已复查";
  const text = rows.join("\n");
  console.log(`[${NAME}] ===== 执行结束 =====\n${text}`);
  $notify(NAME, title, notificationSummary(final, rows, signRes, claims));
  $done();
}

if (typeof $task === "undefined") {
  $done();
} else {
  main().catch(e => {
    console.log(`[${NAME}] 运行异常（详情已隐去，避免包含凭据）`);
    $notify(NAME, "脚本运行异常", "执行中断，请检查 QX 日志中的接口状态");
    $done();
  });
}
