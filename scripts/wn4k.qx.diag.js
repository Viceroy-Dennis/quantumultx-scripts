/*
 * 蜗牛 I 4K（wn4k.com）签到体检 · 多账号 · Quantumult X / Surge 通用
 * 作者：Linda for Dennis
 *
 * 作用：一次跑完，告诉你卡在哪一环。
 *   1. 存储里有哪些账号的 Cookie、各自哪些字段、上次签到日期
 *   2. 每个 Cookie 还能不能用（GET 会员中心看是否被 302 踢回登录页）
 *   3. 签到接口现在怎么回（真打一次，已签会返回 1001，不会重复扣）
 *   4. 给了账号密码就直接走登录链路验证（跟抓包彻底无关）
 *
 * 用法一：任务行 URL 后面加 #acct=账号|密码;账号2|密码2
 *   14 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/wn4k.qx.diag.js#acct=账号,密码, tag=蜗牛4K体检, enabled=true
 * 用法二：什么都不加，只查已经抓到的 Cookie（多账号会逐个过一遍）。
 */

const NAME = "蜗牛4K体检";
const BASE = "https://wn4k.com";
const K_CREDS = "WN4K_CREDS";
const K_DONE = "WN4K_DONE";
const K_OLD_CRED = "WN4K_CRED";
const K_MIG = "WN4K_MIGRATED_V2";

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
  write(k, v) {
    try {
      return IS_QX ? $prefs.setValueForKey(String(v), k) : $persistentStore.write(String(v), k);
    } catch (e) {
      return false;
    }
  },
};

function readJSON(k, def) {
  const raw = store.read(k);
  if (!raw) return def;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : def;
  } catch (e) {
    return def;
  }
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function safeDecode(s) {
  const v = String(s == null ? "" : s).trim();
  if (!v || !/%[0-9a-f]{2}/i.test(v)) return v;
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return v;
  }
}

function maskName(name) {
  const s = String(name || "").trim();
  if (!s) return "账号";
  if (s.includes("@")) return s.replace(/^(.{1,3}).*(@.*)$/, "$1***$2");
  if (s.length <= 2) return s.slice(0, 1) + "**";
  return s.slice(0, 2) + "***";
}

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
      resolve({
        status: (resp && (resp.status || resp.statusCode)) || 0,
        headers: (resp && resp.headers) || {},
        body: data || "",
      });
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
      if (!m[2].trim() || /\[object .*\]/i.test(m[2])) continue;
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

function cookieField(cookie, name) {
  const m = String(cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)", "i"));
  return m ? m[1].trim() : "";
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

/** 多账号：acct=a,p&&b,p；也认 u=账号&p=密码（单账号） */
function parseAccts(raw) {
  const s = String(raw || "").trim();
  if (!s || /^(none|null|undefined|空)$/i.test(s)) return [];
  const dec = (x) => {
    try {
      return decodeURIComponent(x);
    } catch (e) {
      return x;
    }
  };
  const norm = s.replace(/%26%26/gi, "&&");

  const mu = norm.match(/(?:^|[&#])u=([^&#]*)/i);
  const mp = norm.match(/(?:^|[&#])p=([^&#]*)/i);
  if (mu && mp) return [{ user: dec(mu[1]).trim(), pwd: dec(mp[1]).trim() }];

  let val = norm;
  const m2 = norm.match(/(?:^|[&#])(?:acct|account)=([\s\S]*)$/i);
  if (m2) val = m2[1];
  val = dec(val);
  // 账号之间：&& / 分号（半角或全角）/ 换行；账密之间：| 优先（Surge 下不能用英文逗号）
  return val
    .split(/&&|[;；]|\n/)
    .map((x) => {
      const hit = String(x)
        .trim()
        .match(/^([^|,，:：\s][^|,，:：]*?)\s*[|,，:：]\s*(.+)$/);
      return hit ? { user: hit[1].trim(), pwd: hit[2].trim() } : null;
    })
    .filter(Boolean);
}

async function tryLogin(acct) {
  const r = await http({
    url: `${BASE}/user/login.html`,
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE}/user/login.html`,
    }),
    body: `user_name=${encodeURIComponent(acct.user)}&user_pwd=${encodeURIComponent(acct.pwd)}`,
  });
  let j = null;
  try {
    j = JSON.parse(r.body || "{}");
  } catch (e) {}
  const cookie = parseSetCookie(headerOf(r.headers, "set-cookie"));

  p(`  登录：HTTP ${r.status} code=${j && j.code} msg=${(j && j.msg) || ""}`);
  p(`        Set-Cookie ${cookie ? `${cookie.split(";").length} 个字段（${cookieNames(cookie)}）` : "0 个"}`);

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
  p(`  签到：HTTP ${r.status}${broke ? "（被踢回登录页 = Cookie 无效）" : ` code=${j && j.code} msg=${(j && j.msg) || ""}`}`);

  let verdict = "";
  if (j && Number(j.code) === 1) verdict = `签到成功，积分 +${(j.info && (j.info.points ?? j.info.reward)) ?? "?"}`;
  else if (j && Number(j.code) === 1001) verdict = "今天已经签过了";
  else if (broke) verdict = "Cookie 被判无效";
  else verdict = `签到返回异常：${String(r.body || "").slice(0, 100)}`;
  return { verdict, cookieOK: !broke };
}

(async () => {
  p(`运行环境：${IS_QX ? "Quantumult X" : typeof $httpClient !== "undefined" ? "Surge" : "未知"}`);
  const arg = qxArg();
  p(`参数：${arg ? arg.replace(/p=[^&#]*/gi, "p=***") : "(无)"}`);

  const creds = readJSON(K_CREDS, {});
  const done = readJSON(K_DONE, {});
  const uids = Object.keys(creds);
  const today = todayCN();

  p(`—— 存储 ——`);
  p(`WN4K_CREDS：${uids.length} 个账号桶`);
  for (const uid of uids) {
    const it = creds[uid] || {};
    const nm = maskName(it.nm || it.acct);
    p(`  ${uid} ${nm} · 字段 [${cookieNames(it.ck)}] · 今天${done[uid] === today ? "已签" : "未签"}`);
  }
  if (store.read(K_OLD_CRED)) p(`⚠️ 还留着 v1 的老 Cookie（WN4K_CRED），迁移标记=${store.read(K_MIG) || "无"}`);
  if (!uids.length) p("  （空）");

  // 参数里的账号
  const accts = parseAccts(arg);
  const results = [];

  if (accts.length) {
    p(`—— 逐账号验证（账密 ${accts.length} 个）——`);
    for (let i = 0; i < accts.length; i++) {
      const a = accts[i];
      p(`[${i + 1}/${accts.length}] ${maskName(a.user)}`);
      const lg = await tryLogin(a);
      if (!lg.ok) {
        results.push(`${maskName(a.user)} ❌ ${lg.msg}`);
        continue;
      }
      if (!lg.cookie) {
        results.push(`${maskName(a.user)} ⚠️ code=1 但无 Set-Cookie，只能抓包`);
        continue;
      }
      const uid = (cookieField(lg.cookie, "user_id") ? "u" + cookieField(lg.cookie, "user_id") : "?");
      p(`        账号桶：${uid}`);
      const ck = await tryCheckin(lg.cookie);
      results.push(`${maskName(a.user)} ${ck.cookieOK ? "✅" : "🔑"} ${ck.verdict}`);
    }
  } else {
    if (!uids.length) {
      p("—— 结论 ——");
      p("没有 Cookie，也没有账号密码 → 抓包链路没生效：检查 MITM 是否装好、是否用该账号打开过会员中心");
      notify(`${NAME}`, "没有任何账号", "先登录 wn4k.com 打开一次会员中心，或在参数里填 acct=账号,密码");
      return;
    }
    p(`—— 逐账号验证（已抓包 ${uids.length} 个）——`);
    for (let i = 0; i < uids.length; i++) {
      const uid = uids[i];
      const it = creds[uid] || {};
      const nm = maskName(it.nm || it.acct);
      p(`[${i + 1}/${uids.length}] ${nm} (${uid})`);

      const idx = await http({
        url: `${BASE}/user/index.html`,
        method: "GET",
        headers: baseHeaders({ "Cookie": it.ck, "Referer": `${BASE}/user/checkin.html` }),
      });
      const kicked = idx.status === 302 || idx.status === 301 || /<title>[^<]*用户登录/.test(idx.body || "");
      p(`  会员中心：HTTP ${idx.status} ${kicked ? "→ 未登录" : "→ 已登录 ✅"}`);

      if (kicked) {
        results.push(`${nm} 🔑 会员中心被踢回登录页，Cookie 已失效`);
        continue;
      }
      const ck = await tryCheckin(it.ck);
      results.push(`${nm} ${ck.cookieOK ? "✅" : "🔑"} ${ck.verdict}`);
      if (ck.cookieOK && /签到成功|已经签/.test(ck.verdict)) {
        done[uid] = today;
        store.write(K_DONE, JSON.stringify(done));
      }
    }
  }

  p("—— 结论 ——");
  for (const r of results) p(r);

  notify(`${NAME}`, `${results.length} 个账号体检完成`, results.join("\n").slice(0, 1200));
})().catch((e) => {
  notify(`${NAME}`, "体检脚本异常", String((e && e.message) || e).slice(0, 160));
});
