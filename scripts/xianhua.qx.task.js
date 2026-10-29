// 三国咸话每日全套任务 v3.6 正式版（2026-10-11）：打开/签到/点赞10/浏览3/分享/商城领奖；api-xh taskList+getReward{taskProgressId} 主，wxforum 商城备用；st1=待领(st2=已领)
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

const NAME = "三国咸话";
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
    // 小程序专属头：白名单重建（2026-10-09 记录器实抓配方），杜绝任何历史脏值混入
    const tokRaw = $prefs.valueForKey(TOKEN_XH_KEY) || $prefs.valueForKey(TOKEN_KEY) || "";
    Object.keys(headers).forEach((k) => delete headers[k]);
    headers["app-code"] = "2";
    headers["platform"] = "weixin";
    headers["app-system"] = "weixin";
    headers["app-version"] = "8.0.0";
    headers["appversion-code"] = "800";
    headers["client-id"] = "ae1ef5b7-6fa2-48d4-891e-e513fad01308";
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
  if (!j) return String(body || "").slice(0, 100) || "空响应";
  return j.message || j.msg || (j.data && (j.data.message || j.data.msg)) || (j.success === true ? "成功" : "请求完成");
}

function isAuthError(r) {
  if (r.status === 401 || r.status === 403) return true;
  const j = parseJSON(r.body);
  if (j && (String(j.code) === "401" || String(j.code) === "403")) return true;
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

function responseState(r) {
  if (!r) return { ok: false, kind: "unknown", message: "响应未确认" };
  if (isAuthError(r)) return { ok: false, kind: "auth", message: "凭据失效" };
  if (r.error) return { ok: false, kind: "network", message: /超时|timeout/i.test(r.error) ? "网络超时" : "网络异常" };
  if (!(r.status >= 200 && r.status < 300)) return { ok: false, kind: "http", message: `HTTP ${r.status}` };
  const j = parseJSON(r.body);
  if (!j || typeof j !== "object") return { ok: false, kind: "unknown", message: "响应未确认" };
  const message = String(j.message || j.msg || (j.data && (j.data.message || j.data.msg)) || "");
  const negative = /失败|错误|异常|未完成|未达|未领取|未签到|尚未|无法|不能|不可|无权限/.test(message);
  if (!negative && /已签到|已签过|已领取|已领过|已完成/.test(message)) {
    return { ok: true, already: true, kind: "success", message };
  }
  const code = j.code === undefined || j.code === null ? "" : String(j.code);
  const acceptedCode = code === "0" || code === "200" || code === "1000";
  if (negative || j.success === false || (code && !acceptedCode)) {
    return { ok: false, kind: "business", message: message || "业务失败" };
  }
  if (acceptedCode || j.success === true || /成功|获得/.test(message)) {
    return { ok: true, already: false, kind: "success", message };
  }
  return { ok: false, kind: "unknown", message: "响应未确认" };
}

function createReport() {
  return {
    open: null,
    sign: null,
    authExpired: false,
    missingXh: !($prefs.valueForKey(TOKEN_XH_KEY) || ""),
    progress: [
      { label: "点赞", current: 0, target: 10, confirmed: false, complete: false, source: 0 },
      { label: "浏览", current: 0, target: 3, confirmed: false, complete: false, source: 0 },
      { label: "分享", current: 0, target: 1, confirmed: false, complete: false, source: 0 }
    ],
    rewards: {}
  };
}

function inspectResponse(report, r) {
  const state = responseState(r);
  if (state.kind === "auth") report.authExpired = true;
  return state;
}

function progressFor(report, t) {
  if (!isDailyTargetTask(t)) return null;
  const label = taskLabel(t);
  return report.progress.find((p) => label.includes(p.label)) || null;
}

function rewardKey(t) {
  return `${t.progressStatus !== undefined ? "xh" : "wx"}:${taskIdOf(t)}`;
}

function snapshotRewardState(t) {
  if (t.progressStatus !== undefined) {
    const status = Number(t.progressStatus);
    if (status === 2) return "already";
    if (status === 1) return t.taskProgressId ? "pending" : "unknown";
    if (status === -1 || status === 0) return "unfinished";
    return "unknown";
  }
  if (alreadyClaimed(t)) return "already";
  if (t.is_finish !== undefined) return truthy(t.is_finish) ? "pending" : "unfinished";
  return "unknown";
}

function rememberTasks(report, tasks) {
  tasks.forEach((t) => {
    if (isDailyTargetTask(t)) report.rewards[rewardKey(t)] = snapshotRewardState(t);
    const p = progressFor(report, t);
    if (!p) return;
    const source = t.progressStatus !== undefined ? 2 : 1;
    if (p.source > source) return;
    const status = Number(t.progressStatus);
    const done = source === 2 ? status === 1 || status === 2 : truthy(t.is_finish) || alreadyClaimed(t);
    const target = Number(t.targetProgressValue);
    if (Number.isFinite(target) && target > 0) p.target = target;
    const current = t.currentProgressValue === undefined || t.currentProgressValue === null ? NaN : Number(t.currentProgressValue);
    p.current = done ? p.target : Number.isFinite(current) ? Math.max(0, Math.min(current, p.target)) : null;
    p.confirmed = source === 2 ? [1, 2, 0, -1].includes(status) : t.is_finish !== undefined || alreadyClaimed(t);
    p.complete = done;
    p.source = source;
  });
}

function recordClaim(report, t, r) {
  const state = inspectResponse(report, r);
  report.rewards[rewardKey(t)] = state.ok ? state.already ? "already" : "claimed" : state.kind === "unknown" ? "unknown" : "failed";
  const p = progressFor(report, t);
  const source = t.progressStatus !== undefined ? 2 : 1;
  // A secondary-channel receipt must not override authoritative api-xh task progress.
  if (state.ok && p && p.source <= source) {
    p.current = p.target;
    p.confirmed = true;
    p.complete = true;
    p.source = source;
  }
  return result(`领取[${taskLabel(t)}]`, r);
}

function completionNotification(report) {
  const rewardStates = Object.values(report.rewards);
  const count = (state) => rewardStates.filter((s) => s === state).length;
  const claimed = count("claimed");
  const already = count("already");
  const failed = count("failed");
  const pending = count("pending");
  const unknown = count("unknown");
  const rewardParts = [];
  if (claimed) rewardParts.push(`新领取 ${claimed} 项`);
  if (already) rewardParts.push(`${claimed ? "已领取" : "今日已领取"} ${already} 项`);
  if (failed) rewardParts.push(`失败 ${failed} 项`);
  if (pending) rewardParts.push(`待领取 ${pending} 项`);
  if (unknown) rewardParts.push(`未确认 ${unknown} 项`);
  const rewards = rewardParts.length ? rewardParts.join("，") :
    count("unfinished") ? "暂无可领取（任务未完成）" : "状态未确认";
  const shortMessage = (value) => String(value || "").replace(/\s+/g, " ").slice(0, 32);
  const sign = report.sign.ok ? report.sign.already ? "已签到" : "成功" :
    report.sign.kind === "unknown" ? "待确认" : `失败（${shortMessage(report.sign.message)}）`;
  const progress = report.progress.map((p) => {
    if (p.current === null) return `${p.label} ${p.confirmed ? "待完成" : "待确认"}`;
    const unconfirmed = !p.confirmed || (!p.complete && p.current >= p.target);
    return `${p.label} ${p.current}/${p.target}${unconfirmed ? "（待确认）" : ""}`;
  }).join(" · ");
  const lines = [`签到：${sign}`, progress, `奖励：${rewards}`];
  if (report.authExpired) lines.push("提示：登录凭据失效，请重新打开小程序更新");
  else if (report.missingXh) lines.push("提示：福利页凭据缺失，请打开小程序福利页更新");
  else if (!report.open.ok) lines.push(`提示：打开任务${shortMessage(report.open.message)}`);

  let subtitle = "每日任务完成";
  if (report.authExpired) subtitle = "登录凭据失效";
  else if (report.missingXh) subtitle = "凭据需更新";
  else if (failed) subtitle = "奖励领取异常";
  else if ((!report.open.ok && report.open.kind !== "unknown") ||
    (!report.sign.ok && report.sign.kind !== "unknown") ||
    report.progress.some((p) => p.confirmed && !p.complete)) subtitle = "部分任务未完成";
  else if (!report.open.ok || !report.sign.ok || report.progress.some((p) => !p.confirmed) ||
    pending || unknown || !rewardStates.length) subtitle = "执行结果待确认";
  else if (report.sign.already && !claimed && already) subtitle = "今日任务已完成";
  return { subtitle, message: lines.join("\n"), rewards };
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
  if (t.progressStatus !== undefined) return false; // api-xh 体系任务由通道一(getReward)负责，商城通道不碰
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

  const claimOk = (r) => responseState(r).ok;

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
  if (!t.taskProgressId) return { status: 0, error: "无进度记录", body: "" };
  const r = await postJson("https://api-xh.sanguosha.cn/task/sgxh-task/getReward", { taskProgressId: t.taskProgressId }, 3000);
  console.log(`[${NAME}] getReward(taskProgressId=${t.taskProgressId}) -> HTTP ${r.status} ${String(r.body || "").slice(0, 120)}`);
  return r;
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
  const first = await postJson(PROGRESS_URL, { operateType: 2, gameId: 2 }, 2000);
  const second = await postJson(PROGRESS_URL, { operateType: 2 }, 2000);
  await postJson(`https://api-xh.sanguosha.cn/user/act-user-task/updateTaskProgress`, { channelId: 2, postId: postId, operationType: 1, gameId: 2 }, 2000);
  await postJson(`https://api-xh.sanguosha.cn/user/act-user-task/updateTaskProgress`, { channelId: 2, postId: String(postId), operationType: 1, gameId: 2 }, 2000);
  console.log(`[${NAME}] 分享上报 postId=${postId} 完成`);
  return [first, second];
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

  const logRows = [];
  const report = createReport();
  const credLine = credReport();
  logRows.push(credLine);
  console.log(`[${NAME}] ${credLine}`);
  if (!($prefs.valueForKey(TOKEN_XH_KEY) || "")) {
    logRows.push("⚠️ api-xh 凭据缺失：打开咸话小程序福利页逛一圈即可自动捕获（抓包引用需在重写列表里）");
  }
  console.log(`[${NAME}] ========== 启动全套任务 (极速并发版) ==========`);

  // 1. 并发执行：打开小程序任务 + 每日签到
  const [openRes, signRes] = await Promise.all([
    postJson(OPEN_URL, { flag: 1 }, 2000),
    postJson(SIGN_URL, {}, 2000)
  ]);
  logRows.push(result("打开任务", openRes));
  logRows.push(result("每日签到", signRes));
  report.open = inspectResponse(report, openRes);
  report.sign = inspectResponse(report, signRes);
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
  const likeSuccess = likeResults.filter((r) => inspectResponse(report, r).ok).length;
  report.progress[0].current = likeSuccess;
  logRows.push(`今日点赞: 完成 ${likeSuccess}/10 次`);

  // 4. 【今日浏览 3 次】wxforum 真阅读 + api-xh 完整看帖链路（实抓复刻）
  console.log(`[${NAME}] 执行【今日浏览3次】：真阅读 + api-xh 看帖链路...`);
  let xhBrowseOk = 0;
  let browseSuccess = 0;
  for (let i = 0; i < 3; i++) {
    const tid = topicsList[i] ? topicsList[i].id : "12906766";
    const readRes = await getJson(`https://wxforum.sanguosha.cn/api/topics/${tid}`, 2000);
    const readState = inspectResponse(report, readRes);
    const br = await browsePost(tid);
    const browseState = inspectResponse(report, br);
    if (browseState.ok) xhBrowseOk++;
    if (readState.ok && browseState.ok) browseSuccess++;
    if (i < 2) await sleep(300);
  }
  report.progress[1].current = browseSuccess;
  logRows.push(`今日浏览: 完成 ${browseSuccess}/3 次 (真链路 ${xhBrowseOk}/3)`);

  // 5. 【今日分享 1 次】wxforum 分享 + api-xh 完整分享链路（实抓复刻）
  const shareTid = topicsList[0] ? topicsList[0].id : "12906766";
  const shRes = await postJson(`https://wxforum.sanguosha.cn/api/topics/${shareTid}/share`, {}, 2000);
  logRows.push(result("今日分享", shRes));
  const shareState = inspectResponse(report, shRes);
  const shareReports = (await sharePost(shareTid)).map((r) => inspectResponse(report, r));
  report.progress[2].current = shareState.ok && shareReports.some((s) => s.ok) ? 1 : 0;

  // 服务端落库等待（st-1→st1 转换）
  await sleep(1500);

  // 7. 查询任务列表并执行自动领奖（wxforum 商城通道为主，api-xh 为备）
  console.log(`[${NAME}] 正在拉取任务列表...`);
  const tasks = [];
  const seenIds = {};

  const shopListRes = await getJson("https://wxforum.sanguosha.cn/api/shop/taskList", 2000);
  console.log(`[${NAME}] shop/taskList 原始响应 (HTTP ${shopListRes.status}): ${String(shopListRes.body || "").slice(0, 600)}`);
  if (inspectResponse(report, shopListRes).ok && parseJSON(shopListRes.body)) collectTasks(parseJSON(shopListRes.body), tasks, seenIds);
  console.log(`[${NAME}] wxforum shop/taskList: HTTP ${shopListRes.status}, 识别 ${tasks.length} 项`);

  const foreverRes = await getJson("https://wxforum.sanguosha.cn/api/shop/taskForever", 2000);
  const foreverJson = parseJSON(foreverRes.body);
  if (inspectResponse(report, foreverRes).ok && foreverJson) collectTasks(foreverJson, tasks, seenIds);
  console.log(`[${NAME}] shop/taskForever: HTTP ${foreverRes.status}, 累计 ${tasks.length} 项`);

  const listRes = await getJson(LIST_URL, 2000);
  const data = parseJSON(listRes.body);
  const beforeCount = tasks.length;
  if (inspectResponse(report, listRes).ok && data) collectTasks(data, tasks, seenIds);
  rememberTasks(report, tasks);
  console.log(`[${NAME}] api-xh taskList: HTTP ${listRes.status}, 追加 ${tasks.length - beforeCount} 项`);

  if (tasks.length) {
    console.log(`[${NAME}] 共识别 ${tasks.length} 项任务`);
    const claimPromises = [];
    let xhPass1 = 0;
    for (const t of tasks) {
      // 通道一：api-xh 任务系统（progressStatus 1 = 完成待领取，领取成功后服务端转 2；实测确认）
      if (Number(t.progressStatus) === 1 && t.taskProgressId) {
        xhPass1++;
        claimPromises.push((async () => {
          return recordClaim(report, t, await claimXhTask(t));
        })());
        continue;
      }
      // 通道二：wxforum 商城任务（is_finish 且未领）
      if (claimable(t)) {
        claimPromises.push((async () => {
          const claimRes = await claimReward(t);
          return recordClaim(report, t, claimRes);
        })());
      }
    }

    // 二轮领奖：任务完成状态回写可能有几秒延迟，若首轮一无所获，等 3 秒重取再领一轮
    if (xhPass1 === 0) {
      await sleep(3000);
      const reRes = await getJson(LIST_URL, 3000);
      const reJson = parseJSON(reRes.body);
      const reTasks = [];
      if (inspectResponse(report, reRes).ok && reJson) collectTasks(reJson, reTasks);
      rememberTasks(report, reTasks);
      for (const t of reTasks) {
        if (Number(t.progressStatus) === 1 && t.taskProgressId) {
          console.log(`[${NAME}] 二轮捕捉到待领取: ${t.taskDesc} (pid=${t.taskProgressId})`);
          claimPromises.push((async () => {
            return recordClaim(report, t, await claimXhTask(t));
          })());
        }
      }
    }
    if (claimPromises.length) {
      const claimOutputs = await Promise.all(claimPromises);
      claimOutputs.forEach(o => logRows.push(o));
    } else {
      logRows.push(`奖励领取: ${completionNotification(report).rewards}`);
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
      return recordClaim(report, t, claimRes);
    });
    const coreOutputs = await Promise.all(corePromises);
    coreOutputs.forEach(o => logRows.push(o));
  }

  const text = logRows.join("\n");
  console.log(`[${NAME}] ========== 执行完成 ==========\n${text}`);

  const notification = completionNotification(report);
  $notify(NAME, notification.subtitle, notification.message);
  $done();
}

if (typeof $task === "undefined") {
  $done();
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notify(NAME, "脚本运行异常", "任务未能完成，请查看 QX 任务日志");
    $done();
  });
}
