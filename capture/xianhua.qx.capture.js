// 三国咸话 —— Quantumult X 登录凭据抓包脚本
// 一个脚本同时用于 script-request-header 与 script-request-body 两种重写类型：
//   • script-request-header：所有 GET/POST 都能拿到请求头 → 保存双通道凭据（wxforum HS256 / api-xh RS256）
//   • script-request-body  ：只有带 body 的 POST/PUT 会触发 → 嗅探用户在小程序内点【领取】时的真实领奖接口
// 特性：
//   1. 双通道隔离存储，绝不互相覆盖（sgxh_token_wx / sgxh_token_xh）
//   2. 智能领奖嗅探：锁定真实 URL、Method、Body 并持久化
//   3. 通知节流 8 秒，避免刷屏
//   4. 全程 passthrough，不改动任何请求内容

const NAME = "三国咸话QX";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";
const REWARD_METHOD_KEY = "sgxh_confirmed_reward_method";
const REWARD_BODY_KEY = "sgxh_confirmed_reward_body";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
const TIME_KEY = "sgxh_capture_time";
const NOTIFY_KEY = "sgxh_notify_ts";

const HOST_RE = /(^|\.)(api-xh|wxforum|xh|hi-gateway|api-forum-act|xianhua)\.sanguosha\.cn$/i;
const DROP = { host: 1, connection: 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function read(key) { try { return $prefs.valueForKey(key) || ""; } catch (e) { return ""; } }
function write(value, key) { try { $prefs.setValueForKey(String(value), key); } catch (e) {} }

function notifyThrottled(sub, msg) {
  const last = Number(read(NOTIFY_KEY) || 0);
  if (Date.now() - last < 8000) return;
  write(Date.now(), NOTIFY_KEY);
  $notify(NAME, sub, msg);
}

function lowerHeaders(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = String(h[k]); });
  return o;
}

function cookieMap(cookie) {
  const o = {};
  String(cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function mergeCookie(oldValue, newValue) {
  const o = cookieMap(oldValue);
  const n = cookieMap(newValue);
  Object.keys(n).forEach((k) => { if (n[k] !== "") o[k] = n[k]; });
  return Object.keys(o).map((k) => k + "=" + o[k]).join("; ");
}

function pickToken(h) {
  const c = cookieMap(h.cookie);
  const tok = h.authorization || h.token || h["x-token"] || h["x-auth-token"] ||
    h.accesstoken || h["access-token"] || c.token || "";
  return String(tok || "").trim();
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const url = String($request.url || "");
    const host = (url.match(/^https?:\/\/([^/]+)/i) || ["", ""])[1].toLowerCase();

    if (!HOST_RE.test(host)) {
      $done({});
    } else {
      const method = String($request.method || "GET").toUpperCase();
      const h = lowerHeaders($request.headers || {});
      // script-request-header 不提供 body；script-request-body 才有 $request.body
      const hasBody = typeof $request.body !== "undefined" && $request.body !== null;
      const bodyStr = hasBody ? String($request.body || "") : "";

      // ---- 1. 领奖接口嗅探（仅 request-body 分支可用 body）----
      const isAction = method === "POST" || method === "PUT";
      const isKnownAction = /updateTaskProgress|signIn|openMiniApp|likes|share|topics\/\d+\/replies/i.test(url);

      if (isAction && !isKnownAction) {
        console.log(`[${NAME}] 捕获动作请求: ${method} ${url} body=${bodyStr.slice(0, 100)}`);
        const isRewardLike = /task|reward|receive|claim|award|bonus|draw|get|finish|exchange|shop/i.test(url) ||
          /taskId|task_id|bonus|award|id|type/i.test(bodyStr);
        if (isRewardLike) {
          write(url, REWARD_URL_KEY);
          write(method, REWARD_METHOD_KEY);
          write(bodyStr, REWARD_BODY_KEY);
          console.log(`[${NAME}] 🎯 成功锁定真实领奖接口: ${method} ${url}`);
          // 领奖锁定必弹通知，不走节流（这是关键事件）
          $notify(NAME, "🎯 真实领奖接口已锁定！",
            `接口: ${method} ${url.replace(/^https?:\/\/[^/]+/i, "")}\n参数: ${bodyStr.slice(0, 80) || "(空)"}`);
        }
      }

      // ---- 2. 凭据捕获（header 分支与 body 分支都能拿到 headers）----
      const tok = pickToken(h);

      if (h.cookie) {
        const oldCookie = read(COOKIE_KEY);
        const merged = mergeCookie(oldCookie, h.cookie);
        if (merged) write(merged, COOKIE_KEY);
      }

      if (!tok || tok.length < 8) {
        $done(hasBody ? $request.body : {});
      } else {
        const saved = {};
        Object.keys(h).forEach((k) => {
          if (!DROP[k] && h[k] !== "") saved[k] = h[k];
        });

        const isXh = /api-xh|xh\.sanguosha|api-forum-act/i.test(host);
        const isWx = /wxforum/i.test(host);

        if (isXh) {
          const oldXh = read(TOKEN_XH_KEY);
          write(tok, TOKEN_XH_KEY);
          write(JSON.stringify(saved), HDR_XH_KEY);
          write(Date.now(), TIME_KEY);
          console.log(`[${NAME}] 捕获【社区/任务 api-xh】凭据: ${tok.slice(0, 10)}...`);
          if (tok !== oldXh) {
            notifyThrottled("社区任务凭据已锁定 🎯", `通道: api-xh (浏览/任务)\nToken 长度: ${tok.length} 位`);
          }
        } else if (isWx) {
          const oldWx = read(TOKEN_WX_KEY);
          write(tok, TOKEN_WX_KEY);
          write(JSON.stringify(saved), HDR_WX_KEY);
          write(Date.now(), TIME_KEY);
          console.log(`[${NAME}] 捕获【签到 wxforum】凭据: ${tok.slice(0, 10)}...`);
          if (tok !== oldWx) {
            notifyThrottled("签到凭据已更新 ✅", `通道: wxforum (签到)\nToken 长度: ${tok.length} 位`);
          }
        }

        // 兼容旧键
        write(tok, TOKEN_KEY);
        write(JSON.stringify(saved), HEADER_KEY);

        // request-body 类型必须回传 body 保持原样通过
        $done(hasBody ? $request.body : {});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
