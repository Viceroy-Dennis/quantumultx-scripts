/*
 * 蜗牛 I 4K（wn4k.com）签到体检 · Quantumult X
 * 作者：Linda for Dennis
 *
 * 作用：一次跑完，告诉你卡在哪一环。
 *   1. 存储里有没有 Cookie、Cookie 里都有哪些字段
 *   2. Cookie 到底还能不能用（GET 会员中心看是否被 302 踢回登录页）
 *   3. 签到接口现在怎么回（真打一次，已签到会返回 1001，不会重复扣）
 *   4. 给了账号密码就直接走登录链路验证（跟抓包彻底无关）
 *
 * 用法一（推荐先跑这个验证接口）：任务行 URL 后面加 #u=账号&p=密码
 *   14 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/wn4k.qx.diag.js#u=账号&p=密码, tag=蜗牛4K体检, enabled=true
 * 用法二：什么都不加，只查抓到的 Cookie。
 */

const NAME = "蜗牛4K体检";
const BASE = "https://wn4k.com";
const K_CRED = "WN4K_CRED";
const K_ACCT = "WN4K_ACCOUNTS";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const IS_QX = typeof $task !== "undefined";
const out = [];
const p = (s) => {
  out.push(s);
  console.log("[体检]", s);
};

function notify(title, sub, body) {
  try {
    if (IS_QX) $notify(title, sub, body);
    else $notification.post(title, sub, body);
  } catch (e) {}
}

const store = {
  read(k) {
    try {
      const v = IS_QX ? $prefs.valueForKey(k) : $persistentStore.read(k);
      return v === undefined || v === null ? "" : String(v);
    } catch (e) {
      return "";
    }
  },
};

function headerOf(headers, name) {
  if (!headers) return "";
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) return headers[k];
  }
  return "";
}

function http(opts) {
  return new Promise((resolve, reject) => {
    if (IS_QX) {
      $task.fetch(opts).then(
        (r) => resolve({ status: r.statusCode, headers: r.headers || {}, body: r.body || "" }),
        (e) => reject(e)
      );
      return;
    }
    const cb = (err, resp, data) => {
      if (err) return reject(err);
      resolve({ status: (resp && (resp.status || resp.statusCode)) || 0, headers: (resp && resp.headers) || {}, body: data || "" });
    };
    const m = String(opts.method || "GET").toUpperCase();
    if (m === "GET") $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

function parseSetCookie(raw) {
  if (!raw) return "";
  const lines = Array.isArray(raw) ? raw : [String(raw)];
  const jar = {};
  const SKIP = /^(expires|path|domain|max-age|samesite|secure|httponly|priority|partitioned)$/i;
  for (const line of lines) {
    for (const chunk of String(line).split(/,\s*(?=[A-Za-z0-9_\-\.]+=)/)) {
      const m = chunk.match(/^\s*([A-Za-z0-9_\-\.]+)=([^;]*)/);
      if (!m || SKIP.test(m[1])) continue;
      if (!m[2].trim()) continue;
      jar[m[1]] = m[2].trim();
    }
  }
  return Object.keys(jar)
    .map((k) => `${k}=${jar[k]}`)
    .join("; ");
}

function cookieNames(cookie) {
  return String(cookie || "")
    .split(";")
    .map((s) => s.trim().split("=")[0])
    .filter(Boolean)
    .join(", ");
}

function baseHeaders(extra) {
  return Object.assign(
    {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": UA,
      "Origin": BASE,
    },
    extra || {}
  );
}

function qxArg() {
  try {
    if (typeof $argument !== "undefined" && $argument) return String($argument);
    if (typeof $environment !== "undefined" && $environment && $environment.variables) {
      return Object.keys($environment.variables)
        .map((k) => `${k}=${$environment.variables[k]}`)
        .join("&");
    }
  } catch (e) {}
  return "";
}

function parseAcct(s) {
  const mu = s.match(/(?:^|[&#])u=([^&#]*)/i);
  const mp = s.match(/(?:^|[&#])p=([^&#]*)/i);
  const dec = (x) => {
    try {
      return decodeURIComponent(x);
    } catch (e) {
      return x;
    }
  };
  if (mu && mp) return { user: dec(mu[1]), pwd: dec(mp[1]) };
  const m = s.match(/(?:^|[&#])(?:acct|account)=([\s\S]*)$/i);
  const val = dec(m ? m[1] : s);
  const hit = val.match(/^(.+?)\s*[,|，:：]\s*(.+)$/);
  return hit ? { user: hit[1].trim(), pwd: hit[2].trim() } : null;
}

async function tryLogin(acct) {
  const r = await http({
    url: `${BASE}/user/login.html`,
    method: "POST",
    headers: baseHeaders({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": `${BASE}/user/login.html` }),
    body: `user_name=${encodeURIComponent(acct.user)}&user_pwd=${encodeURIComponent(acct.pwd)}`,
  });
  let j = null;
  try {
    j = JSON.parse(r.body || "{}");
  } catch (e) {}
  const cookie = parseSetCookie(headerOf(r.headers, "set-cookie"));

  p(`登录：HTTP ${r.status} code=${j && j.code} msg=${(j && j.msg) || ""}`);
  p(`      Set-Cookie 拿到 ${cookie ? cookie.split(";").length + " 个字段（" + cookieNames(cookie) + "）" : "0 个"}`);
  p(`      原始 set-cookie 头：${String(headerOf(r.headers, "set-cookie")).slice(0, 180) || "(空)"}`);

  if (j && Number(j.code) === 1) return { ok: true, cookie };
  return { ok: false, msg: (j && j.msg) || `HTTP ${r.status}` };
}

async function tryCheckin(cookie) {
  const r = await http({
    url: `${BASE}/user/checkin.html`,
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE}/user/checkin.html`,
      "Cookie": cookie,
    }),
    body: "",
  });
  let j = null;
  try {
    j = JSON.parse(r.body || "{}");
  } catch (e) {}
  const broke = r.status === 302 || r.status === 301 || /<title>[^<]*用户登录|请先登录/.test(r.body || "");
  p(`签到：HTTP ${r.status}${broke ? "（被踢回登录页 = Cookie 无效）" : ` code=${j && j.code} msg=${(j && j.msg) || ""}`}`);
  return { status: r.status, json: j, broke, raw: String(r.body || "").slice(0, 140) };
}

(async () => {
  p(`运行环境：${IS_QX ? "Quantumult X" : typeof $httpClient !== "undefined" ? "Surge" : "未知"}`);
  p(`参数：${qxArg() ? qxArg().replace(/p=[^&]*/, "p=***") : "(无)"}`);

  const cookie = store.read(K_CRED);
  p(`存储 WN4K_CRED：${cookie ? `${cookie.length} 字符 · 字段 [${cookieNames(cookie)}]` : "空"}`);

  const acctRaw = qxArg() || store.read(K_ACCT) || "";
  const acct = acctRaw ? parseAcct(acctRaw) : null;

  let useCookie = cookie;
  let verdict = "";

  // 有账号密码：直接验证登录链路，与抓包无关
  if (acct) {
    p("—— 走账号密码链路 ——");
    const lg = await tryLogin(acct);
    if (!lg.ok) {
      verdict = `账号密码登录失败：${lg.msg}`;
    } else if (!lg.cookie) {
      verdict = "登录返回 code=1 但没拿到 Set-Cookie —— 只能改用抓包模式";
    } else {
      useCookie = lg.cookie;
    }
  } else if (!cookie) {
    verdict = "没有 Cookie，也没有账号密码 → 抓包链路没生效（见下方清单）";
  }

  if (useCookie) {
    p("—— 验证 Cookie 会员中心 ——");
    const idx = await http({
      url: `${BASE}/user/index.html`,
      method: "GET",
      headers: baseHeaders({ "Cookie": useCookie, "Referer": `${BASE}/user/checkin.html` }),
    });
    const kicked = idx.status === 302 || idx.status === 301 || /<title>[^<]*用户登录/.test(idx.body || "");
    p(`会员中心：HTTP ${idx.status} ${kicked ? "→ 未登录" : "→ 已登录 ✅"}`);
    if (!kicked) {
      const ck = await tryCheckin(useCookie);
      if (ck.json && Number(ck.json.code) === 1) verdict = `签到成功，积分 +${(ck.json.info && ck.json.info.points) || "?"}`;
      else if (ck.json && Number(ck.json.code) === 1001) verdict = "今天已经签过了";
      else if (ck.broke) verdict = "Cookie 被判无效";
      else verdict = `签到返回异常：${ck.raw}`;
    } else {
      verdict = "Cookie 无效（会员中心被 302 踢回登录页）";
    }
  }

  p("—— 结论 ——");
  p(verdict);

  const body = out.slice(-8).join("\n");
  notify(`${NAME}`, verdict.slice(0, 40), body);
})().catch((e) => {
  notify(`${NAME}`, "体检脚本异常", String((e && e.message) || e).slice(0, 160));
});
