/*
 * 淘金币请求诊断 / 标准 H5 MTOP 执行器（Quantumult X）
 * 尚未适配真实淘金币签到 API；默认只做本机诊断，不会主动发请求。
 * 配套安装说明见 README.md。不要公开本脚本的 $prefs 数据或完整请求。
 * 无远程依赖；凭据只保存于本机，仅向捕获的白名单淘宝域名发送。
 */

var CONFIG = {
  mode: "inspect",                 // inspect：查看诊断；run：执行；clear：清理本脚本数据
  api: "",                         // 从真机确认的签到 API，必须完整匹配
  version: "",                     // 对应路径中的版本号
  dataMatch: [],                    // 请求筛选，如 [{path:"action", equals:"实际动作值"}]
  successAll: [],                   // 业务成功条件，路径从响应 JSON 根开始，全部满足
  alreadyAll: [],                   // 已签到的业务条件，可留空；同样要求 MTOP SUCCESS
  reusablePayloadConfirmed: false,  // 只有确认 data 可跨日复用后才能启用
  maxCaptureHours: 48               // 超过此时间必须重新采集；这不代表 token 可用这么久
};

var NS = "local.taobao.coin.";
var KEYS = { record: NS + "record", diagnostics: NS + "diagnostics", attempts: NS + "attempts" };
var ALLOWED_HOSTS = ["h5api.m.taobao.com", "h5api.m.tmall.com", "acs.m.taobao.com"];
var ended = false;
var deadline;
var rewriting = typeof $request !== "undefined";
var KNOWN_ERRORS = [];

function fail(message) { KNOWN_ERRORS.push(message); throw new Error(message); }
function safeError(error) {
  return error && KNOWN_ERRORS.indexOf(error.message) >= 0 ? error.message : "脚本处理异常，请检查配置或清理本机记录后重新采集。";
}
function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function header(headers, name) {
  var keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]]);
  }
  return "";
}
function read(key, fallback) {
  var raw = $prefs.valueForKey(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { fail("本机记录损坏，请用 clear 模式清理后重新采集。"); }
}
function write(key, value) {
  if (!$prefs.setValueForKey(JSON.stringify(value), key)) fail("本机记录保存失败，未继续执行。");
}
function finish(subtitle, message) {
  if (ended) return;
  ended = true;
  if (deadline) clearTimeout(deadline);
  if (subtitle) {
    try { $notify("淘宝淘金币", subtitle, message || ""); } catch (_) {}
  }
  if (rewriting) $done({}); else $done();
}

function endpoint(url) {
  var m = /^https:\/\/([a-z0-9.-]+)\/(h5|gw)\/([a-z0-9_.]+)\/([0-9.]+)\/?(?:\?([^#]*))?$/i.exec(String(url || ""));
  if (!m || ALLOWED_HOSTS.indexOf(m[1].toLowerCase()) < 0) return null;
  return {host: m[1].toLowerCase(), kind: m[2].toLowerCase(), api: m[3].toLowerCase(), version: m[4], query: m[5] || ""};
}
function candidate(ep) {
  return ep && (/^mtop\.(?:coingame(?:\.|$)|taobao\.(?:taocoin|coin|bgc)(?:\.|$))/.test(ep.api) ||
    (CONFIG.api && ep.api === CONFIG.api.toLowerCase()));
}
function selected(ep) {
  return ep && CONFIG.api && ep.api === CONFIG.api.toLowerCase() && ep.version === CONFIG.version;
}
function pairs(text) {
  if (typeof text !== "string" || text.length > 65536) fail("请求参数不是支持的文本格式，或长度超过采集限制。");
  if (!text) return [];
  return text.split("&").filter(function (x) { return x !== ""; }).map(function (x) {
    var i = x.indexOf("=");
    try {
      return [decodeURIComponent((i < 0 ? x : x.slice(0, i)).replace(/\+/g, " ")),
        decodeURIComponent((i < 0 ? "" : x.slice(i + 1)).replace(/\+/g, " "))];
    } catch (_) { fail("请求参数编码无法解析。"); }
  });
}
function combined(query, form) {
  var out = Object.create(null);
  query.concat(form).forEach(function (pair) {
    if (own(out, pair[0])) fail("请求含重复参数，不能可靠地重建签名。");
    out[pair[0]] = pair[1];
  });
  return out;
}
function cookies(raw) {
  var out = Object.create(null);
  String(raw || "").split(";").forEach(function (part) {
    var i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}
function atPath(value, path) {
  var parts = path.split(".");
  for (var i = 0; i < parts.length; i++) {
    if (!value || typeof value !== "object" || !own(value, parts[i])) return undefined;
    value = value[parts[i]];
  }
  return value;
}
function validRules(rules, required) {
  return Array.isArray(rules) && (!required || rules.length > 0) && rules.length <= 12 && rules.every(function (rule) {
    return object(rule) && typeof rule.path === "string" &&
      /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(rule.path) &&
      !/(?:^|\.)(?:__proto__|constructor|prototype)(?:\.|$)/.test(rule.path) &&
      own(rule, "equals") && (rule.equals === null || ["string", "boolean", "number"].indexOf(typeof rule.equals) >= 0);
  });
}
function allMatch(value, rules) {
  return validRules(rules, true) && rules.every(function (rule) { return atPath(value, rule.path) === rule.equals; });
}
function businessRules(rules, required) {
  return validRules(rules, required) && rules.every(function (rule) { return /^data\./.test(rule.path); });
}
function configHash() {
  return md5(JSON.stringify([CONFIG.api.toLowerCase(), CONFIG.version, CONFIG.dataMatch, CONFIG.successAll, CONFIG.alreadyAll]));
}
function nativeFields(value, depth) {
  if (!value || typeof value !== "object" || depth > 8) return false;
  return Object.keys(value).some(function (key) {
    return /^(?:wua|mini[-_]?wua|x[-_](?:sign|mini[-_]?wua|sgext|umt))$/i.test(key) || nativeFields(value[key], depth + 1);
  });
}

function parseRequest(request) {
  var ep = endpoint(request.url);
  if (!candidate(ep)) fail("请求不是允许采集的淘宝接口。");
  if (ep.kind !== "h5") fail("原生 /gw/ 请求；当前执行器不支持原生签名。");
  var method = String(request.method || "").toUpperCase();
  if (method !== "GET" && method !== "POST") fail("仅支持 GET 或表单 POST。");
  var sourceHeaders = request.headers || {};
  if (Object.keys(sourceHeaders).some(function (key) { return /^x[-_](?:sign|mini[-_]?wua|sgext|umt)$/i.test(key); })) {
    fail("请求含原生安全签名；当前执行器无法生成此类签名。");
  }
  var type = header(sourceHeaders, "Content-Type");
  if (method === "POST" && !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type)) fail("POST 不是标准 H5 表单，需专用适配。");
  var query = pairs(ep.query);
  var form = method === "POST" ? pairs(request.body) : [];
  var params = combined(query, form);
  if (nativeFields(params, 0)) fail("请求参数含原生安全签名；需专用适配。");
  if (!params.api || params.api.toLowerCase() !== ep.api || params.v !== ep.version) fail("路径与 api/v 参数不一致或缺失。");
  if (!/^\d{5,20}$/.test(params.appKey || "") || !/^\d{10,16}$/.test(params.t || "") || !/^[a-f0-9]{32}$/i.test(params.sign || "")) {
    fail("缺少标准 H5 的 appKey、t 或 32 位 sign。");
  }
  var data;
  try { data = JSON.parse(params.data); } catch (_) { fail("缺少 JSON data，或 data 无法解析。"); }
  if (!object(data)) fail("data 必须是 JSON 对象，需专用适配其他格式。");
  if (nativeFields(data, 0)) fail("data 含原生安全签名；需专用适配。");
  var cookie = header(sourceHeaders, "Cookie");
  if (!cookie || /[\r\n]/.test(cookie)) fail("未捕获到有效 Cookie。");
  var jar = cookies(cookie);
  var tk = /^([^_]+)_(\d+)$/.exec(jar["_m_h5_tk"] || "");
  if (!tk || !jar["_m_h5_tk_enc"]) fail("缺少 H5 token Cookie，请在已登录的 H5 页面重新采集。");
  if (!jar.unb) fail("Cookie 缺少 unb，无法可靠区分账号，需专用适配。");
  if (md5(tk[1] + "&" + params.t + "&" + params.appKey + "&" + params.data) !== params.sign.toLowerCase()) {
    fail("原请求签名与标准 H5 算法不匹配，或 Cookie/token 不对应；需重新采集或专用适配。");
  }
  var headers = {Cookie: cookie};
  ["User-Agent", "Referer", "Origin"].forEach(function (name) {
    var value = header(sourceHeaders, name);
    if (value && !/[\r\n]/.test(value)) headers[name] = value;
  });
  if (method === "POST") headers["Content-Type"] = type;
  return {
    ep: ep, method: method, query: query, form: form, params: params, data: data,
    token: tk[1], tokenExpiry: Number(tk[2]), account: md5(jar.unb),
    request: {url: String(request.url), method: method, headers: headers, body: method === "POST" ? request.body : ""}
  };
}

// 分享用诊断：字段名经过限制，字符串/数字值不输出；不输出 Cookie、URL 查询或正文。
function shape(value, depth, budget) {
  if (budget.left-- <= 0 || depth > 5) return "<省略>";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1, budget)] : [];
  if (typeof value !== "object") return typeof value;
  var out = Object.create(null);
  Object.keys(value).slice(0, 24).forEach(function (key) {
    var safe = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) && !/^[a-f0-9]{16,}$/i.test(key) && !/\d{6}/.test(key) &&
      !/(cookie|token|secret|password|session|phone|mobile|address|nickname|userId|orderId)/i.test(key);
    var label = safe ? key : "<隐藏字段>";
    out[label] = safe ? shape(value[key], depth + 1, budget) : "<隐藏>";
  });
  return out;
}
function retCodes(json) {
  if (!json || !Array.isArray(json.ret)) return [];
  return json.ret.slice(0, 8).map(function (item) {
    var code = typeof item === "string" ? item.split("::")[0] : "";
    return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "UNRECOGNIZED";
  });
}
function gatewaySuccess(json) {
  return json && Array.isArray(json.ret) && json.ret.length > 0 && json.ret.every(function (item) {
    return typeof item === "string" && /^SUCCESS(?:::|$)/.test(item);
  });
}
function businessResult(json) {
  if (!gatewaySuccess(json)) return "unconfirmed";
  if (businessRules(CONFIG.alreadyAll, true) && allMatch(json, CONFIG.alreadyAll)) return "already";
  if (businessRules(CONFIG.successAll, true) && allMatch(json, CONFIG.successAll)) return "success";
  return "unconfirmed";
}
function parseJSONBody(text) {
  if (typeof text !== "string" || text.length > 1048576) fail("响应不是支持的文本，或超过诊断大小限制。");
  var trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  // 支持常见 JSONP 外壳，但不执行返回的 JavaScript。
  var match = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed);
  if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
  fail("响应不是 JSON/JSONP，可能需要重新登录或人工验证。");
}
function sessionId(value) {
  var id = value === undefined || value === null ? "" : String(value);
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : "";
}
function diagnostics() {
  var rows = read(KEYS.diagnostics, []);
  if (!Array.isArray(rows)) fail("诊断记录格式错误，请清理后重试。");
  return rows.filter(function (row) { return object(row) && Date.now() - row.time < 86400000; }).slice(-15);
}
function publicRow(row) {
  return {
    api: row.api, version: row.version, transport: row.kind, method: row.method,
    requestFields: row.requestFields, compatibility: row.compatibility,
    httpStatus: row.httpStatus, retCodes: row.retCodes, responseFields: row.responseFields,
    result: row.result
  };
}

function captureRequest() {
  var ep = endpoint($request.url);
  if (!candidate(ep)) return;
  var id = sessionId($request.sessionIndex);
  var row = {id: id, requestHash: md5(String($request.url)), time: Date.now(), api: ep.api, version: ep.version, kind: ep.kind,
    method: String($request.method || "").toUpperCase()};
  var parsed;
  try {
    // 即使凭据不足，仍尝试记录不含值的 data 字段结构。
    var q = pairs(ep.query);
    var b = row.method === "POST" && typeof $request.body === "string" &&
      /^application\/x-www-form-urlencoded/i.test(header($request.headers, "Content-Type")) ? pairs($request.body) : [];
    var parameters = combined(q, b);
    if (parameters.data) row.requestFields = shape(JSON.parse(parameters.data), 0, {left: 100});
  } catch (_) {}
  try {
    parsed = parseRequest($request);
    row.compatibility = "标准 H5 格式；仍需确认它是签到请求，以及 data 能否跨日复用";
  } catch (error) { row.compatibility = safeError(error); }
  if (!id) row.compatibility += "；无 sessionIndex，无法关联响应";
  var rows = diagnostics();
  rows.push(row);
  write(KEYS.diagnostics, rows.slice(-15));
  if (parsed && selected(ep) && id) {
    if (!validRules(CONFIG.dataMatch, false)) fail("dataMatch 配置格式错误。");
    if (CONFIG.dataMatch.length === 0 || allMatch(parsed.data, CONFIG.dataMatch)) {
      // Cookie 与原始请求成套保存，绝不拼接其他请求/账号的 Cookie。
      write(KEYS.record, {id: id, capturedAt: row.time, account: parsed.account,
        request: parsed.request, verifiedConfig: ""});
    }
  }
}
function captureResponse() {
  var ep = endpoint($request.url);
  if (!candidate(ep)) return;
  var requestId = sessionId($request.sessionIndex);
  var responseId = sessionId($response.sessionIndex);
  if (requestId && responseId && requestId !== responseId) return;
  var id = responseId || requestId;
  if (!id) return;
  var rows = diagnostics();
  var row;
  for (var i = rows.length - 1; i >= 0; i--) {
    var item = rows[i];
    if (item.id === id && item.requestHash === md5(String($request.url)) && item.api === ep.api && item.version === ep.version && item.kind === ep.kind &&
        item.method === String($request.method || "").toUpperCase() && Date.now() - item.time < 60000) {
      row = item; break;
    }
  }
  if (!row) return;
  row.httpStatus = Number($response.statusCode);
  var json;
  try {
    json = parseJSONBody($response.body);
    row.retCodes = retCodes(json);
    row.responseFields = shape(json, 0, {left: 160});
    row.result = businessResult(json);
  } catch (_) { row.result = "非 JSON 响应或超出诊断限制"; }
  var record = read(KEYS.record, null);
  if (record && record.id === id && record.capturedAt === row.time && selected(ep) &&
      row.httpStatus >= 200 && row.httpStatus < 300 && row.result !== "unconfirmed" &&
      (row.result === "success" || row.result === "already")) {
    record.verifiedConfig = configHash();
    write(KEYS.record, record);
  }
  row.id = ""; // 已关联，后续不再把此条当作待处理请求。
  write(KEYS.diagnostics, rows);
  console.log("[淘金币诊断] " + JSON.stringify(publicRow(row)));
}

function encodePairs(list, timestamp, signature) {
  return list.map(function (pair) {
    var value = pair[0] === "t" ? timestamp : pair[0] === "sign" ? signature : pair[1];
    return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(value);
  }).join("&");
}
function buildRequest(parsed, now) {
  var t = String(now);
  var sign = md5(parsed.token + "&" + t + "&" + parsed.params.appKey + "&" + parsed.params.data);
  var base = parsed.request.url.split("?")[0];
  var query = encodePairs(parsed.query, t, sign);
  var req = {url: base + (query ? "?" + query : ""), method: parsed.method, headers: parsed.request.headers,
    opts: {redirection: false, "auto-cookie": false, "skip-cert-verify": false}};
  if (parsed.method === "POST") req.body = encodePairs(parsed.form, t, sign);
  return req;
}
function chinaDay(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
function failureHint(codes) {
  var text = codes.join(" ");
  if (/TOKEN|SESSION|LOGIN|SID|AUTH/.test(text)) return "登录态或 token 不可用，请重新登录并采集。";
  if (/RGV|VALIDATE|CAPTCHA|RISK|ILLEGAL_ACCESS|TRAFFIC_LIMIT/.test(text)) return "服务端要求验证或限制访问，请到淘宝手动处理。";
  if (/SIGN|APPKEY/.test(text)) return "签名或 appKey 不被接受，需要检查接口适配。";
  if (/API_NOT|API_UNDEFINED/.test(text)) return "此调用方式下接口不可用，需要重新核实实际请求。";
  return "请在淘宝确认实际结果，并检查脱敏诊断。";
}
function inspect() {
  var rows = diagnostics();
  console.log("[淘金币诊断报告] " + JSON.stringify(rows.map(publicRow), null, 2));
  var record = read(KEYS.record, null);
  var verified = record && record.verifiedConfig === configHash();
  finish("诊断模式：未发送签到请求", rows.length ?
    "已保留 " + rows.length + " 条脱敏记录，请查看任务日志。当前适配" + (verified ? "已观察到匹配的业务响应。" : "尚未验证。") :
    "请启用采集重写，在淘宝淘金币页面手动签到一次，再运行本任务。若仍无记录，查看安装说明。");
}
function clearData() {
  Object.keys(KEYS).forEach(function (key) {
    if ($prefs.valueForKey(KEYS[key]) && !$prefs.removeValueForKey(KEYS[key])) fail("本脚本数据清理失败，请检查存储权限。");
  });
  finish("本脚本数据已清理", "请把 mode 改回 inspect；需要停止采集时，同时停用配套重写规则。");
}
async function run() {
  if (!/^[a-z0-9_.]+$/i.test(CONFIG.api) || !/^[0-9.]+$/.test(CONFIG.version)) fail("尚未配置真实签到 API/版本。请先使用 inspect 模式。");
  if (!businessRules(CONFIG.successAll, true) || !businessRules(CONFIG.alreadyAll, false) || !validRules(CONFIG.dataMatch, false)) {
    fail("必须配置明确的业务成功条件；不能仅凭 HTTP 200 或 MTOP SUCCESS 判定签到。");
  }
  if (CONFIG.reusablePayloadConfirmed !== true) fail("尚未确认 data 可跨日复用；动态任务参数需要专用适配。");
  if (!(typeof CONFIG.maxCaptureHours === "number" && CONFIG.maxCaptureHours > 0 && CONFIG.maxCaptureHours <= 168)) fail("maxCaptureHours 必须大于 0 且不超过 168。");
  var record = read(KEYS.record, null);
  if (!record || !object(record.request) || typeof record.capturedAt !== "number") fail("没有可执行的本机请求，请配置接口后重新采集。");
  var parsed = parseRequest(record.request);
  if (!selected(parsed.ep) || record.account !== parsed.account || record.verifiedConfig !== configHash()) fail("尚未观察到符合当前配置的业务成功响应，请重新采集验证。");
  if (CONFIG.dataMatch.length && !allMatch(parsed.data, CONFIG.dataMatch)) fail("保存的请求不符合 dataMatch。");
  var now = Date.now();
  if (record.capturedAt > now || now - record.capturedAt > CONFIG.maxCaptureHours * 3600000) fail("保存的请求过旧，请重新采集并确认业务参数。");
  if (!isFinite(parsed.tokenExpiry) || parsed.tokenExpiry <= now) fail("H5 token 已到期，请在淘宝重新采集；脚本不会自动刷新登录态。");
  var day = chinaDay(now);
  var attempts = read(KEYS.attempts, {});
  if (!object(attempts)) fail("执行记录格式错误，请清理后重试。");
  var key = md5(parsed.account + "|" + parsed.ep.api);
  if (own(attempts, key) && attempts[key].day === day) {
    finish("今日已尝试，跳过重复请求", "状态：" + attempts[key].state + "。超时或结果不明时也不会自动重发，请在淘宝确认。");
    return;
  }
  var request = buildRequest(parsed, now);
  var current = {};
  Object.keys(attempts).forEach(function (k) {
    if (/^[a-f0-9]{32}$/.test(k) && attempts[k].day === day) current[k] = attempts[k];
  });
  current[key] = {day: day, state: "已尝试，结果未确认"};
  write(KEYS.attempts, current); // 必须在请求前成功落盘；超时不重试。
  var response;
  try { response = await $task.fetch(request); } catch (_) {
    if (!ended) finish("网络请求未完成", "今日已记录尝试；请在淘宝确认是否签到，脚本不会自动重试。");
    return;
  }
  if (ended) return;
  if (!(Number(response.statusCode) >= 200 && Number(response.statusCode) < 300)) {
    finish("HTTP 请求未成功", "状态码 " + Number(response.statusCode) + "；已禁用自动跳转。请到淘宝确认登录和签到状态。");
    return;
  }
  var json = parseJSONBody(response.body);
  var codes = retCodes(json);
  var result = businessResult(json);
  console.log("[淘金币执行结果] " + JSON.stringify({retCodes: codes, result: result, responseFields: shape(json, 0, {left: 160})}));
  if (result === "success" || result === "already") {
    current[key].state = result === "success" ? "业务字段确认成功" : "业务字段确认已签到";
    write(KEYS.attempts, current);
    finish(result === "success" ? "签到业务结果匹配成功" : "业务结果显示已签到", "匹配了你配置的业务条件；金币数量以淘宝页面为准。");
  } else {
    finish("签到结果未确认", (codes.length ? "返回码：" + codes.join(", ") + "。" : "") + failureHint(codes));
  }
}

// UTF-8 MD5，用于标准 H5 MTOP；不依赖 Node.js、CryptoJS 或远程脚本。
function md5(text) {
  var binary = unescape(encodeURIComponent(text));
  var len = binary.length;
  var words = new Array((((len + 8) >>> 6) + 1) * 16).fill(0);
  for (var i = 0; i < len; i++) words[i >>> 2] |= binary.charCodeAt(i) << ((i % 4) * 8);
  words[len >>> 2] |= 0x80 << ((len % 4) * 8);
  words[words.length - 2] = (len * 8) | 0;
  words[words.length - 1] = Math.floor(len / 0x20000000);
  var shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (var offset = 0; offset < words.length; offset += 16) {
    var a = a0, b = b0, c = c0, d = d0;
    for (var round = 0; round < 64; round++) {
      var f, g;
      if (round < 16) { f = (b & c) | (~b & d); g = round; }
      else if (round < 32) { f = (d & b) | (~d & c); g = (5 * round + 1) % 16; }
      else if (round < 48) { f = b ^ c ^ d; g = (3 * round + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * round) % 16; }
      var shift = shifts[(round >>> 4) * 4 + round % 4];
      var sum = (a + f + (Math.floor(Math.abs(Math.sin(round + 1)) * 4294967296) | 0) + words[offset + g]) | 0;
      var previousD = d;
      d = c; c = b; b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0; a = previousD;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map(function (word) {
    var hex = "";
    for (var n = 0; n < 4; n++) hex += ("0" + ((word >>> (8 * n)) & 255).toString(16)).slice(-2);
    return hex;
  }).join("");
}

function start() {
  deadline = setTimeout(function () {
    finish("执行超时，结果未确认", "如已发送请求，今日不会自动重试；请在淘宝确认实际结果。");
  }, 12000);
  Promise.resolve().then(async function () {
    if (typeof $response !== "undefined") { captureResponse(); finish(); }
    else if (rewriting) { captureRequest(); finish(); }
    else if (CONFIG.mode === "clear") clearData();
    else if (CONFIG.mode === "inspect") inspect();
    else if (CONFIG.mode === "run") { await run(); finish(); }
    else fail("mode 仅支持 inspect、run、clear。");
  }).catch(function (error) {
    // 只输出本脚本产生的已知错误；平台异常可能带完整 URL/凭据，故不直接打印。
    finish("未完成执行", safeError(error));
  });
}

start();
