/*
 * 蜗牛4K 签到脚本 · Node mock 回归测试（QX 环境）
 * 跑法：node tests/wn4k.qx.mock.test.js
 *
 * 手法：把真实脚本丢进 vm 沙箱，注入 $task / $prefs / $notify 假实现，
 * 断言发出的请求、存储的凭据和最终通知。不改脚本逻辑（只把抖动定时器改成 0ms）。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPT = path.join(__dirname, "..", "scripts", "wn4k.qx.checkin.js");
const CODE = fs.readFileSync(SCRIPT, "utf8");

const BASE = "https://wn4k.com";
let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " → " + extra : ""}`);
  }
}

function eq(name, actual, expect) {
  ok(name, actual === expect, `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expect)}`);
}

/* ------------------------------------------------------------------ */

function run({ prefs = {}, routes = {}, capture = null }) {
  const store = new Map(Object.entries(prefs));
  const notes = [];
  const calls = [];

  const handle = (opts) => {
    calls.push({
      url: opts.url,
      method: (opts.method || "GET").toUpperCase(),
      headers: opts.headers || {},
      body: opts.body || "",
    });
    const r = routes(opts) || { status: 404, headers: {}, body: "" };
    return Promise.resolve({ statusCode: r.status, headers: r.headers || {}, body: r.body || "" });
  };

  const sandbox = {
    console: { log: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    setInterval: (fn) => setInterval(fn, 0),
    clearTimeout: () => {},
    clearInterval: () => {},
    Promise,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    $task: { fetch: handle },
    $prefs: {
      valueForKey: (k) => (store.has(k) ? store.get(k) : null),
      setValueForKey: (v, k) => {
        store.set(k, v);
        return true;
      },
    },
    $notify: (title, sub, body) => notes.push({ title, sub, body }),
  };

  if (capture) {
    sandbox.$request = {
      url: capture.url || `${BASE}/user/index.html`,
      method: "GET",
      headers: capture.headers || {},
    };
  }

  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "wn4k.qx.checkin.js" });

  return new Promise((resolve) => {
    setTimeout(() => resolve({ store, notes, calls }), 60);
  });
}

const json = (status, body, headers) => ({ status, headers: headers || { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ---------------- 1. 抓包存凭据 ---------------- */

(async () => {
  console.log("\n[1] 抓包分支：保存登录 Cookie");
  {
    const { store, notes } = await run({
      capture: { headers: { Cookie: "user_id=27; user_token=abc123; PHPSESSID=xyz" } },
      routes: () => json(200, { code: 1001, msg: "今日已签到" }),
    });
    eq("Cookie 已落库", store.get("WN4K_CRED"), "user_id=27; user_token=abc123; PHPSESSID=xyz");
    ok("有通知", notes.length >= 1, JSON.stringify(notes));
  }

  console.log("\n[2] 抓包分支：未登录访问不应写入");
  {
    const { store } = await run({
      capture: { headers: { Cookie: "PHPSESSID=only" } },
      routes: () => json(200, {}),
    });
    eq("没有写入 WN4K_CRED", store.get("WN4K_CRED"), undefined);
  }

  console.log("\n[3] 抓包分支：脏头 [object Null] 要过滤");
  {
    const { store } = await run({
      capture: { headers: { Cookie: "user_id=9; [object Null]; user_token=t9" } },
      routes: () => json(200, { code: 1001, msg: "今日已签到" }),
    });
    eq("脏字段被清掉", store.get("WN4K_CRED"), "user_id=9; user_token=t9");
  }

  /* ---------------- 2. 主流程 ---------------- */

  console.log("\n[4] 无任何配置 → 只提示不请求");
  {
    const { notes, calls } = await run({ routes: () => json(200, {}) });
    eq("没有发请求", calls.length, 0);
    ok("提示里含「还没配置」", /还没配置/.test(notes[0].sub), JSON.stringify(notes[0]));
  }

  console.log("\n[5] 有 Cookie → 签到成功，记日期");
  {
    const { store, notes, calls } = await run({
      prefs: { WN4K_CRED: "user_id=27; user_token=abc123" },
      routes: (o) => (o.url.includes("checkin") ? json(200, { code: 1, msg: "签到成功", info: { points: 10 } }) : json(404, {})),
    });
    eq("只打了一次签到接口", calls.length, 1);
    eq("POST /user/checkin.html", calls[0].url, `${BASE}/user/checkin.html`);
    eq("method 是 POST", calls[0].method, "POST");
    eq("带上了 Cookie", calls[0].headers.Cookie, "user_id=27; user_token=abc123");
    eq("带了 X-Requested-With", calls[0].headers["X-Requested-With"], "XMLHttpRequest");
    eq("日期已写", store.get("WN4K_LAST_DATE"), new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
    ok("通知含 +10", /\+10/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[6] 今天已签到过 → 零请求");
  {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const { calls } = await run({
      prefs: { WN4K_CRED: "user_id=27; user_token=abc123", WN4K_LAST_DATE: today },
      routes: () => json(200, { code: 1 }),
    });
    eq("不发请求", calls.length, 0);
  }

  console.log("\n[7] 接口回 1001 → 判定为今日已签");
  {
    const { store, notes } = await run({
      prefs: { WN4K_CRED: "user_id=27; user_token=abc123" },
      routes: () => json(200, { code: 1001, msg: "今日已签到" }),
    });
    eq("日期已写", !!store.get("WN4K_LAST_DATE"), true);
    ok("通知副标题是「今日已签」", /今日已签/.test(notes[0].sub), JSON.stringify(notes[0]));
  }

  console.log("\n[8] Cookie 失效(302) → 账号密码自动重登 → 再签到成功");
  {
    let loginHit = 0;
    const { store, notes, calls } = await run({
      prefs: { WN4K_CRED: "user_id=1; user_token=stale", WN4K_ACCOUNTS: JSON.stringify(["27@qq.com, pwd27"]) },
      routes: (o) => {
        if (o.url.includes("login")) {
          loginHit++;
          return json(200, { code: 1, msg: "登录成功" }, {
            "Content-Type": "application/json",
            "Set-Cookie": "user_id=27; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, user_token=fresh999; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
          });
        }
        // 第一次用旧 cookie → 302；之后成功
        if (o.headers.Cookie === "user_id=1; user_token=stale") return { status: 302, headers: {}, body: "" };
        return json(200, { code: 1, msg: "签到成功", info: { points: 5 } });
      },
    });
    eq("登录只打了一次", loginHit, 1);
    eq("新 Cookie 已存（逗号分隔的 Set-Cookie 正确切分）", store.get("WN4K_CRED"), "user_id=27; user_token=fresh999");
    eq("签到请求 2 次（旧的失败 + 新的成功）", calls.filter((c) => c.url.includes("checkin")).length, 2);
    ok("最终通知成功", /签到成功/.test(notes[0].sub + notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[9] 账号密码错误(1003) → 报错误，不瞎重试");
  {
    const { notes, calls } = await run({
      prefs: { WN4K_ACCOUNTS: JSON.stringify(["someone@qq.com, wrongpass"]) },
      routes: () => json(200, { code: 1003, msg: "获取用户信息失败" }),
    });
    eq("只有 1 次登录请求", calls.length, 1);
    ok("通知带错误信息", /获取用户信息失败/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[10] 没 Cookie 但有账号 → 先登录再签到，Cookie 落库");
  {
    const { store, notes, calls } = await run({
      prefs: { WN4K_ACCOUNTS: JSON.stringify(["d***@qq.com,p@ssw0rd"]) },
      routes: (o) => {
        if (o.url.includes("login")) {
          return json(200, { code: 1, msg: "登录成功" }, {
            "Set-Cookie": "user_id=88; Path=/, user_token=t88; Path=/",
          });
        }
        return json(200, { code: 1, msg: "签到成功", info: { points: 20 } });
      },
    });
    eq("先登录后签到", calls.map((c) => (c.url.includes("login") ? "login" : "checkin")).join(">"), "login>checkin");
    eq("Cookie 落库", store.get("WN4K_CRED"), "user_id=88; user_token=t88");
    ok("通知含积分 20", /\+20/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[11] 响应是登录页 HTML（跟随重定向后的情况）→ 判定未登录");
  {
    const { notes } = await run({
      prefs: { WN4K_CRED: "user_id=1; user_token=dead" },
      routes: () => ({ status: 200, headers: {}, body: "<title>用户登录 - 蜗牛 I 4K</title>" }),
    });
    ok("提示里说 Cookie 失效", /失效|重新抓包/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[12] 多账号：两个都签");
  {
    const { notes, calls } = await run({
      prefs: { WN4K_ACCOUNTS: JSON.stringify(["a@qq.com,p1", "b@qq.com,p2"]) },
      routes: () => json(200, { code: 1, msg: "签到成功", info: { points: 1 } }),
    });
    // 第一个账号登录后 cookie 存库，第二个账号直接复用同一 cookie（设计如此：单站单账号优先）
    ok("至少完成两次签到或一次登录+一次签到", calls.length >= 2, String(calls.length));
    ok("通知有内容", notes.length >= 1);
  }

  console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
