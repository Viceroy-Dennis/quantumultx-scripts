/**
 * 蜗牛4K签到 v2 多账号 mock 测试
 * 跑法：node tests/wn4k.multi.mock.test.js
 */
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const CANDIDATES = [
  path.join(__dirname, "..", "wn4k.qx.checkin.js"),
  path.join(__dirname, "..", "wn4k_task.js"),
];
const SRC = CANDIDATES.find((f) => fs.existsSync(f));
if (!SRC) {
  console.error("找不到脚本文件，试过：\n" + CANDIDATES.join("\n"));
  process.exit(2);
}
let code = fs.readFileSync(SRC, "utf8");

// 把抖动和账号间隔归零，测试不用等
code = code
  .replace(/jitterMax:\s*15e3/, "jitterMax: 0")
  .replace(/gapMin:\s*1200/, "gapMin: 0")
  .replace(/gapMax:\s*2700/, "gapMax: 0");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}

function makeEnv(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const notifies = [];
  const logs = [];
  const calls = [];

  const handler = opts.handler || (() => ({ statusCode: 200, headers: {}, body: '{"code":1}' }));

  const ctx = {
    console: {
      log: (...a) => logs.push(a.map(String).join(" ")),
      error: (...a) => logs.push(a.map(String).join(" ")),
    },
    setTimeout,
    clearTimeout,
    $prefs: {
      valueForKey: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setValueForKey: (v, k) => {
        store[k] = String(v);
        return true;
      },
    },
    $task: {
      fetch: (o) => {
        calls.push(o);
        return Promise.resolve().then(() => handler(o, calls.length));
      },
    },
    $notify: (t, s, b) => notifies.push({ t, s, b }),
  };
  if (opts.argument !== undefined) ctx.$argument = opts.argument;
  if (opts.variables) ctx.$environment = { variables: opts.variables };
  if (opts.request) ctx.$request = opts.request;

  vm.createContext(ctx);
  return { ctx, store, notifies, logs, calls };
}

async function run(env) {
  vm.runInContext(code, env.ctx, { filename: "wn4k.js" });
  // 等异步流程跑完（所有 sleep 已被置 0）
  for (let i = 0; i < 40; i++) {
    await sleep(25);
  }
}

function credsOf(store) {
  try {
    return JSON.parse(store.WN4K_CREDS || "{}");
  } catch (e) {
    return {};
  }
}
function doneOf(store) {
  try {
    return JSON.parse(store.WN4K_DONE || "{}");
  } catch (e) {
    return {};
  }
}

/* ───────────── 公共 mock ───────────── */

function loginOK(uid, name) {
  return {
    statusCode: 200,
    headers: {
      "set-cookie":
        `PHPSESSID=sess${uid}; path=/; HttpOnly, ` +
        `user_id=${uid}; expires=Fri, 27-Nov-2026 01:00:00 GMT; path=/, ` +
        `user_name=${encodeURIComponent(name)}; path=/, ` +
        `group_id=1; path=/, ` +
        `user_check=deadbeef${uid}; path=/`,
    },
    body: '{"code":1,"msg":"登录成功"}',
  };
}

const PWD_OF = {
  "a@qq.com": "pa",
  "b@qq.com": "pb",
  "c@qq.com": "pc",
};
const UID_OF = {
  "a@qq.com": 1001,
  "b@qq.com": 1002,
  "c@qq.com": 1003,
};

/** 通用 handler：登录 + 签到，按 cookie 里的 user_id 区分 */
function stdHandler(opt) {
  opt = opt || {};
  return (o) => {
    if (/\/user\/login\.html/.test(o.url)) {
      const m = String(o.body || "").match(/user_name=([^&]*)&user_pwd=([^&]*)/);
      const user = m ? decodeURIComponent(m[1]) : "";
      const pwd = m ? decodeURIComponent(m[2]) : "";
      if (opt.loginFail && opt.loginFail[user]) return opt.loginFail[user];
      if (!UID_OF[user] || PWD_OF[user] !== pwd) {
        return { statusCode: 200, headers: {}, body: '{"code":1003,"msg":"获取用户信息失败"}' };
      }
      return loginOK(UID_OF[user], user);
    }
    if (/\/user\/checkin\.html/.test(o.url)) {
      const ck = String(o.headers.Cookie || "");
      const uid = (ck.match(/user_id=(\d+)/) || [])[1];
      if (opt.checkin) {
        const r = opt.checkin(uid, ck, o);
        if (r) return r;
      }
      if (!uid) return { statusCode: 302, headers: { Location: "/user/login.html" }, body: "" };
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ code: 1, msg: "签到成功", info: { points: 10 } }),
      };
    }
    return { statusCode: 404, headers: {}, body: "" };
  };
}

/* ───────────── 用例 ───────────── */

async function T1_twoAccountsByPassword() {
  console.log("\n[T1] 两个账号密码并行签到");
  const env = makeEnv({
    variables: { acct: "a@qq.com,pa&&b@qq.com,pb" },
    handler: stdHandler(),
  });
  await run(env);

  const logins = env.calls.filter((c) => /login\.html/.test(c.url));
  const checks = env.calls.filter((c) => /checkin\.html/.test(c.url));
  const creds = credsOf(env.store);
  const done = doneOf(env.store);

  ok(logins.length === 2, `登录 2 次（实际 ${logins.length}）`);
  ok(checks.length === 2, `签到 2 次（实际 ${checks.length}）`);
  ok(!!creds.u1001 && !!creds.u1002, `两个账号各一个桶（${Object.keys(creds).join(",")}）`);
  ok(creds.u1001 && creds.u1001.acct === "a@qq.com", "u1001 记住归属 a@qq.com");
  ok(creds.u1002 && creds.u1002.acct === "b@qq.com", "u1002 记住归属 b@qq.com");
  ok(done.u1001 === todayCN() && done.u1002 === todayCN(), "两个账号都记了今天日期");
  const n = env.notifies[env.notifies.length - 1] || {};
  ok(/2 签到/.test(String(n.s || "")), `通知摘要含「2 签到」（实际「${n.s}」）`);
  ok(/a\*\*\*@qq\.com/.test(String(n.b || "")) && /b\*\*\*@qq\.com/.test(String(n.b || "")), "通知里两个账号都列出了");

  return env.store;
}

async function T2_skipWhenAllDone(store) {
  console.log("\n[T2] 二次运行：全部已签 → 不发请求");
  const env = makeEnv({ store, variables: { acct: "a@qq.com,pa&&b@qq.com,pb" }, handler: stdHandler() });
  await run(env);
  ok(env.calls.length === 0, `没有网络请求（实际 ${env.calls.length}）`);
  const n = env.notifies[env.notifies.length - 1] || {};
  ok(/今日已签 2 个/.test(String(n.s || "")), `通知「今日已签 2 个」（实际「${n.s}」）`);
}

async function T3_captureTwoAccounts() {
  console.log("\n[T3] 抓包分账号：先后抓两个账号，各存各的");
  const store = {};

  const capA = `PHPSESSID=x; user_id=1001; user_name=${encodeURIComponent("a@qq.com")}; user_check=aaa`;
  const env1 = makeEnv({
    store,
    request: { headers: { Cookie: capA } },
    handler: stdHandler(),
  });
  await run(env1);
  let creds = credsOf(store);
  ok(!!creds.u1001, `抓到 A 存进 u1001（${Object.keys(creds).join(",")}）`);

  const capB = `PHPSESSID=y; user_id=1002; user_name=${encodeURIComponent("b@qq.com")}; user_check=bbb`;
  const env2 = makeEnv({
    store,
    request: { headers: { Cookie: capB } },
    handler: stdHandler(),
  });
  await run(env2);
  creds = credsOf(store);
  ok(!!creds.u1001 && !!creds.u1002, `再抓 B，两个桶都在（${Object.keys(creds).join(",")}）`);
  ok(creds.u1002 && creds.u1002.ck.includes("user_id=1002"), "B 的桶里是 B 自己的 Cookie");
}

async function T4_capturePlusPasswordMerge() {
  console.log("\n[T4] 同账号：抓包 + 账密 → 合并，只签一次");
  const store = {};
  const capA = `PHPSESSID=x; user_id=1001; user_name=${encodeURIComponent("a@qq.com")}; user_check=aaa`;
  await run(makeEnv({ store, request: { headers: { Cookie: capA } }, handler: stdHandler() }));

  // 清掉今天日期，让它真去签
  store.WN4K_DONE = "{}";
  const callsBefore = 0;
  const env = makeEnv({
    store,
    variables: { acct: "a@qq.com,pa&&b@qq.com,pb" },
    handler: stdHandler(),
  });
  await run(env);

  const logins = env.calls.filter((c) => /login\.html/.test(c.url));
  const checks = env.calls.filter((c) => /checkin\.html/.test(c.url));
  ok(logins.length === 1, `只给 B 登录 1 次，A 用抓包 Cookie（实际 ${logins.length}）`);
  ok(checks.length === 2, `签到 2 次不重复（实际 ${checks.length}）`);
  const done = doneOf(store);
  ok(done.u1001 === todayCN() && done.u1002 === todayCN(), "两个账号都记了今天日期");
}

async function T5_cookieExpiredRelogin() {
  console.log("\n[T5] Cookie 失效 → 自动用账密重登再签");
  const store = {
    WN4K_CREDS: JSON.stringify({
      u1001: { ck: "PHPSESSID=old; user_id=1001; user_name=a%40qq.com; user_check=old", nm: "a@qq.com", acct: "a@qq.com", t: 1 },
    }),
  };
  const env = makeEnv({
    store,
    variables: { acct: "a@qq.com,pa" },
    handler: stdHandler({ checkin: (uid, ck) => (ck.includes("user_check=old") ? { statusCode: 302, headers: {}, body: "" } : null) }),
  });
  await run(env);

  const logins = env.calls.filter((c) => /login\.html/.test(c.url));
  const creds = credsOf(store);
  ok(logins.length === 1, `重登 1 次（实际 ${logins.length}）`);
  ok(creds.u1001 && creds.u1001.ck.includes("user_check=deadbeef1001"), "桶里换成了新 Cookie");
  ok(doneOf(store).u1001 === todayCN(), "签到成功并记账");
}

async function T6_legacyMigration() {
  console.log("\n[T6] v1 单桶迁移到 v2");
  // 老日期用「今天」：迁移成功的话，这个账号今天就不该再打接口
  const store = {
    WN4K_CRED: "PHPSESSID=z; user_id=1001; user_name=a%40qq.com; user_check=legacy",
    WN4K_LAST_DATE: todayCN(),
  };
  const env = makeEnv({ store, handler: stdHandler() });
  await run(env);

  const creds = credsOf(store);
  ok(!!creds.u1001, `老 Cookie 迁进 u1001（${Object.keys(creds).join(",")}）`);
  ok(store.WN4K_CRED === "", "老 Cookie 键已清空");
  ok(store.WN4K_MIGRATED_V2 === "1", "迁移标记已写");
  ok(doneOf(store).u1001 === todayCN(), "老日期迁到该账号");
  const checks = env.calls.filter((c) => /checkin\.html/.test(c.url));
  ok(checks.length === 0, `日期迁移生效，不再重复签到（实际 ${checks.length} 次）`);

  // 迁移是一次性的：再跑一遍不应把数据搞乱
  const env2 = makeEnv({ store, handler: stdHandler() });
  await run(env2);
  ok(credsOf(store).u1001 && credsOf(store).u1001.ck.length > 0, "二次运行桶还在，没被迁移逻辑洗掉");
}

async function T7_dedupeSameAccount() {
  console.log("\n[T7] 重复填同一账号 → 只签一次");
  const env = makeEnv({
    variables: { acct: "a@qq.com,pa&&a@qq.com,pa" },
    handler: stdHandler(),
  });
  await run(env);
  const logins = env.calls.filter((c) => /login\.html/.test(c.url));
  ok(logins.length === 1, `只登录一次（实际 ${logins.length}）`);
}

async function T8_partialFailure() {
  console.log("\n[T8] 一个成功一个密码错 → 异常汇总");
  const env = makeEnv({
    variables: { acct: "a@qq.com,pa&&b@qq.com,WRONG" },
    handler: stdHandler(),
  });
  await run(env);
  const n = env.notifies[env.notifies.length - 1] || {};
  ok(/1 个异常/.test(String(n.s || "")), `标题报异常（实际「${n.s}」）`);
  ok(/🚫/.test(String(n.b || "")), "正文里带 🚫 标记");
  ok(doneOf(env.store).u1001 === todayCN(), "成功的那个记账了");
  ok(!doneOf(env.store).u1002, "失败的那个没记账");
}

async function T9_captureSameCookieQuiet() {
  console.log("\n[T9] 同一 Cookie 重复抓包 → 不重复提示");
  const store = {};
  const cap = `PHPSESSID=x; user_id=1001; user_name=${encodeURIComponent("a@qq.com")}; user_check=aaa`;
  const e1 = makeEnv({ store, request: { headers: { Cookie: cap } }, handler: stdHandler() });
  await run(e1);
  const n1 = e1.notifies.length;
  // 第二次同一 Cookie，且今天已签
  const e2 = makeEnv({ store, request: { headers: { Cookie: cap } }, handler: stdHandler() });
  await run(e2);
  ok(e2.notifies.length === n1 - n1, `第二次抓包无新通知（首次 ${n1} 条，第二次 ${e2.notifies.length} 条）`);
  const checks2 = e2.calls.filter((c) => /checkin\.html/.test(c.url));
  ok(checks2.length === 0, "已签的账号不再打签到接口");
}

async function T10_multiAccountDoneIndependent() {
  console.log("\n[T10] 只有 A 已签：A 跳过、B 照签");
  const store = {
    WN4K_CREDS: JSON.stringify({
      u1001: { ck: "PHPSESSID=x; user_id=1001; user_name=a%40qq.com; user_check=aaa", nm: "a@qq.com", acct: "a@qq.com", t: 1 },
      u1002: { ck: "PHPSESSID=y; user_id=1002; user_name=b%40qq.com; user_check=bbb", nm: "b@qq.com", acct: "b@qq.com", t: 1 },
    }),
    WN4K_DONE: JSON.stringify({ u1001: todayCN() }),
  };
  const env = makeEnv({ store, handler: stdHandler() });
  await run(env);
  const checks = env.calls.filter((c) => /checkin\.html/.test(c.url));
  ok(checks.length === 1, `只给 B 签到（实际 ${checks.length}）`);
  ok(String(checks[0].headers.Cookie).includes("user_id=1002"), "打的是 B 的 Cookie");
  const n = env.notifies[env.notifies.length - 1] || {};
  ok(/1 跳过/.test(String(n.s || "")) && /1 签到/.test(String(n.s || "")), `摘要含 1 跳过 / 1 签到（实际「${n.s}」）`);
}


async function T11_pipeSemicolonFormat() {
  console.log("\n[T11] Surge 安全格式：竖线 + 分号（不含逗号）");
  const env = makeEnv({
    variables: { account: "a@qq.com|pa;b@qq.com|pb" },
    handler: stdHandler(),
  });
  await run(env);
  const logins = env.calls.filter((c) => /login\.html/.test(c.url));
  const checks = env.calls.filter((c) => /checkin\.html/.test(c.url));
  ok(logins.length === 2, `竖线分隔解析出 2 个账号登录（实际 ${logins.length}）`);
  ok(checks.length === 2, `签到 2 次（实际 ${checks.length}）`);
  const creds = credsOf(env.store);
  ok(!!creds.u1001 && !!creds.u1002, "两个账号桶都在");

  // 全角分号也要认
  const env2 = makeEnv({
    variables: { account: "a@qq.com|pa；b@qq.com|pb" },
    handler: stdHandler(),
  });
  await run(env2);
  ok(env2.calls.filter((c) => /login\.html/.test(c.url)).length === 2, "全角分号也能解析");

  // 老格式（逗号）不能坏，QX 侧还在用
  const env3 = makeEnv({
    variables: { acct: "a@qq.com,pa&&b@qq.com,pb" },
    handler: stdHandler(),
  });
  await run(env3);
  ok(env3.calls.filter((c) => /login\.html/.test(c.url)).length === 2, "老逗号+&&格式仍然兼容");
}

async function main() {
  console.log("=== 蜗牛4K签到 v2 多账号测试 ===");
  const store = await T1_twoAccountsByPassword();
  await T2_skipWhenAllDone(store);
  await T3_captureTwoAccounts();
  await T4_capturePlusPasswordMerge();
  await T5_cookieExpiredRelogin();
  await T6_legacyMigration();
  await T7_dedupeSameAccount();
  await T8_partialFailure();
  await T9_captureSameCookieQuiet();
  await T10_multiAccountDoneIndependent();
  await T11_pipeSemicolonFormat();

  console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试崩了:", e);
  process.exit(2);
});
