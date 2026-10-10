// 影巢 re0.me 签到 — QX mock 测试
// 用法: node tests/re0.qx.mock.test.js

const fs = require("fs");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "scripts", "re0.qx.checkin.js");
const rawCode = fs.readFileSync(SCRIPT, "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

const SAMPLE_HEADERS = {
  Cookie: "cf_clearance=abc; hdhive_session=sxyz123",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)",
  "Accept-Language": "zh-CN,zh-Hans;q=0.9",
  Accept: "text/html",
};

const FAKE_ACTION_ID = "4068b21f57fce3dc23dca0ca104769e9e42c011d22";
const NEW_ACTION_ID = "aaa1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3";

const LANDING_HTML =
  '<!DOCTYPE html><html><head>' +
  '<script src="/_next/static/chunks/app/(app)/layout-9f2c1a.js" async=""></script>' +
  '<script src="/_next/static/chunks/webpack-777.js" async=""></script>' +
  "</head><body>home</body></html>";

const LAYOUT_JS =
  `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[123],{` +
  `"5678":function(){(0,e.createServerReference)("${NEW_ACTION_ID}",` +
  `"checkIn",{temporaryReferences:e.temporaryReferences})}}]);`;

const API_SUCCESS_BODY =
  '{"success":true,"data":{"message":"签到成功，获得 10 积分","checked_in":true,"points":521}}';

const WEB_SUCCESS_FLIGHT =
  `f:{"state":{"toast":{"message":"签到成功，积分 +10"}}}\n` +
  `0:["$","div",null,{"children":[["$","$L8",null,{"response":{"success":true,` +
  `"data":{"message":"签到成功，积分 +10","checked_in":true}}}]]}]\n`;

const WEB_ALREADY_FLIGHT =
  `0:["$","div",null,{"children":[["$","$L8",null,{"response":{"success":false,` +
  `"message":"今天已经签到过了"}}]}]\n`;

// resp: 单个响应对象、或按调用顺序的数组
function runCase({ request, prefs, resp, apiKey }) {
  const store = Object.assign({}, prefs || {});
  const notifications = [];
  const fetches = [];
  const state = { doneCount: 0 };
  let resolve;
  const finished = new Promise((r) => (resolve = r));
  let idleTimer = null;

  const queue = Array.isArray(resp) ? resp.slice() : [resp];
  const nextResp = () => {
    const item = queue.length ? queue.shift() : null;
    if (item === null || item === undefined) return { statusCode: 200, body: "{}" };
    return item;
  };

  const env = {
    $request: request === null ? undefined : request,
    $prefs: {
      setValueForKey: (v, k) => {
        store[k] = v;
        return true;
      },
      valueForKey: (k) => (k in store ? store[k] : null),
    },
    $notify: (t, s, b) => notifications.push({ title: t, subtitle: s, body: b }),
    $done: () => {
      state.doneCount++;
      resolve();
    },
    $task: {
      fetch: (req) => {
        fetches.push(req);
        const r = nextResp();
        return {
          then: (onOk, onErr) => {
            setImmediate(() => {
              if (r && r.error) onErr(r);
              else onOk(r);
            });
          },
        };
      },
    },
    console: { log: () => {} },
  };

  let code = rawCode;
  if (apiKey !== undefined) {
    code = code.replace('const RE0_API_KEY = "";', `const RE0_API_KEY = ${JSON.stringify(apiKey)};`);
  }

  const fn = new Function(...Object.keys(env), `${code}\n;return 0;`);
  fn(...Object.values(env));

  return { store, notifications, fetches, state, finished };
}

async function main() {
  // ── 场景 1：API 通道·定时分支·成功
  {
    console.log("场景1: API Key 定时签到成功");
    const r = runCase({
      request: null,
      prefs: {},
      resp: { statusCode: 200, body: API_SUCCESS_BODY },
      apiKey: "mykey123",
    });
    await r.finished;
    check("走 API 端点", r.fetches.length === 1 && r.fetches[0].url.endsWith("/api/open/checkin"));
    check("带 X-API-Key", r.fetches[0].headers["X-API-Key"] === "mykey123");
    check("body 是 is_gambler:false", r.fetches[0].body === '{"is_gambler":false}');
    check("记录签到日期", r.store["RE0_LastCheckinDate"] === todayCN());
    check("通知签到完成", r.notifications.some((n) => n.subtitle.includes("签到完成")));
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  // ── 场景 2：API 通道·Key 无效·有 Cookie 存底 → 降级网页通道（旧 id 失效则重挖）
  {
    console.log("场景2: API Key 无效 → 降级网页通道 → 404 重挖成功");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: [
        { statusCode: 401, body: '{"code":"INVALID_API_KEY","message":"Invalid API Key","success":false}' },
        { statusCode: 404, body: '{"message":"Server action not found"}' },
        { statusCode: 200, body: LANDING_HTML },
        { statusCode: 200, body: LAYOUT_JS },
        { statusCode: 200, body: WEB_SUCCESS_FLIGHT },
      ],
      apiKey: "badkey",
    });
    await r.finished;
    check("先试 API", r.fetches[0].url.endsWith("/api/open/checkin"));
    check("降级网页先用旧 id POST", r.fetches[1].method === "POST" && r.fetches[1].headers["Next-Action"] === FAKE_ACTION_ID);
    check("404 后 GET 首页", r.fetches[2].method === "GET" && r.fetches[2].url.endsWith("re0.me/"));
    check("挖 chunk js", r.fetches[3].url.includes("layout-9f2c1a.js"));
    check("用新 action id POST", r.fetches[4].method === "POST" && r.fetches[4].headers["Next-Action"] === NEW_ACTION_ID);
    check("action id 已缓存", r.store["RE0_ActionId"] === NEW_ACTION_ID);
    check("记录签到日期", r.store["RE0_LastCheckinDate"] === todayCN());
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  // ── 场景 3：API 通道·Key 无效·无 Cookie → 通知
  {
    console.log("场景3: API Key 无效且无网页凭据 → 通知");
    const r = runCase({
      request: null,
      prefs: {},
      resp: { statusCode: 401, body: '{"code":"INVALID_API_KEY","message":"Invalid API Key","success":false}' },
      apiKey: "badkey",
    });
    await r.finished;
    check("通知 Key 无效", r.notifications.some((n) => n.subtitle.includes("API Key 无效")));
    check("$done 恰一次", r.state.doneCount === 1);
  }

  // ── 场景 4：网页通道·抓包分支·未签 → 趁热直签（fallback id 恰好有效）
  {
    console.log("场景4: 抓包分支趁热补签（直签 fallback id）");
    const r = runCase({
      request: { headers: SAMPLE_HEADERS },
      prefs: {},
      resp: [
        { statusCode: 200, body: WEB_SUCCESS_FLIGHT },
      ],
    });
    await r.finished;
    check("凭据已保存", r.store["RE0_SavedHeaders"] && r.store["RE0_SavedHeaders"].includes("hdhive_session"));
    check("直接 POST 签到", r.fetches[0].method === "POST" && r.fetches[0].url.endsWith("re0.me/"));
    check("POST 带 next-action", /^[0-9a-f]{40,64}$/.test(r.fetches[0].headers["Next-Action"]));
    check("POST 带 next-router-state-tree", r.fetches[0].headers["Next-Router-State-Tree"] && r.fetches[0].headers["Next-Router-State-Tree"].includes("__PAGE__"));
    check("POST body [false]", r.fetches[0].body === "[false]");
    check("POST 带保存的 Cookie", r.fetches[0].headers["Cookie"].includes("hdhive_session"));
    check("记录签到日期", r.store["RE0_LastCheckinDate"] === todayCN());
    check("通知带实时补签", r.notifications.some((n) => n.title.includes("实时补签")));
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  // ── 场景 5：网页通道·抓包分支·今日已签 → 静默保鲜
  {
    console.log("场景5: 抓包分支，今日已签 → 静默保鲜");
    const r = runCase({
      request: { headers: SAMPLE_HEADERS },
      prefs: { RE0_LastCheckinDate: todayCN() },
      resp: null,
    });
    await r.finished;
    check("凭据仍刷新", !!r.store["RE0_SavedHeaders"]);
    check("不发起请求", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
  }

  // ── 场景 6：抓包分支·无 Cookie → 提醒一次（QUIC 排查提示）
  {
    console.log("场景6: 抓包分支，无 Cookie → 提醒一次");
    const r = runCase({ request: { headers: { "User-Agent": "x" } }, prefs: {}, resp: null });
    await r.finished;
    check("不保存凭据", !r.store["RE0_SavedHeaders"]);
    check("提醒没有 Cookie", r.notifications.some((n) => n.subtitle === "请求里没有 Cookie"));
    check("提醒含 QUIC 指引", r.notifications.some((n) => (n.body || "").includes("QUIC")));
  }

  // ── 场景 7：定时分支·无凭据 → 提示两种方式
  {
    console.log("场景7: 定时分支，无凭据 → 提示");
    const r = runCase({ request: null, prefs: {}, resp: null });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("提示配置方式", r.notifications.some((n) => n.subtitle === "暂无可用凭据" && n.body.includes("RE0_API_KEY")));
  }

  // ── 场景 8：定时分支·今日已签 → 静默跳过
  {
    console.log("场景8: 定时分支，今日已签 → 静默跳过");
    const r = runCase({
      request: null,
      prefs: {
        RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS),
        RE0_LastCheckinDate: todayCN(),
      },
      resp: null,
    });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
  }

  // ── 场景 9：网页通道·403 CF 拦截 → 温和提示
  {
    console.log("场景9: 网页通道 403 Cloudflare → 温和提示");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: { statusCode: 403, body: "<html><title>Just a moment...</title></html>" },
    });
    await r.finished;
    check("发起签到", r.fetches.length === 1 && r.fetches[0].method === "POST");
    check("用缓存 action id", r.fetches[0].headers["Next-Action"] === FAKE_ACTION_ID);
    check("403 温和提示", r.notifications.some((n) => n.subtitle.includes("403") && n.body.includes("自动补签")));
    check("不记录日期", !r.store["RE0_LastCheckinDate"]);
  }

  // ── 场景 10：网页通道·action id 404 → 自动重挖重试
  {
    console.log("场景10: action id 失效 404 → 重新发现并重试");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: [
        { statusCode: 404, body: '{"message":"Server action not found"}' },
        { statusCode: 200, body: LANDING_HTML },
        { statusCode: 200, body: LAYOUT_JS },
        { statusCode: 200, body: WEB_SUCCESS_FLIGHT },
      ],
    });
    await r.finished;
    check("先 POST 旧 id", r.fetches[0].headers["Next-Action"] === FAKE_ACTION_ID);
    check("404 后 GET 首页", r.fetches[1].method === "GET");
    check("重挖新 id", r.fetches[3].headers["Next-Action"] === NEW_ACTION_ID);
    check("新 id 已缓存", r.store["RE0_ActionId"] === NEW_ACTION_ID);
    check("最终签到成功", r.store["RE0_LastCheckinDate"] === todayCN());
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  // ── 场景 11：网页通道·已签文案 → 视为完成
  {
    console.log("场景11: 「今天已经签到过了」→ 视为当日完成");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: { statusCode: 200, body: WEB_ALREADY_FLIGHT },
    });
    await r.finished;
    check("通知已签", r.notifications.some((n) => n.subtitle.includes("已经签过")));
    check("记录签到日期", r.store["RE0_LastCheckinDate"] === todayCN());
  }

  // ── 场景 12：抓包抓到签到 action 本体 → 存 action id + 趁热补签
  {
    console.log("场景12: 抓到签到 action 本体 → 存 id 并补签");
    const r = runCase({
      request: {
        headers: { ...SAMPLE_HEADERS, "next-action": FAKE_ACTION_ID },
        body: "[false]",
      },
      prefs: {},
      resp: [
        { statusCode: 200, body: WEB_SUCCESS_FLIGHT },
      ],
    });
    await r.finished;
    check("action id 已存", r.store["RE0_ActionId"] === FAKE_ACTION_ID);
    check("补签成功记录日期", r.store["RE0_LastCheckinDate"] === todayCN());
  }

  // ── 场景 13：API 通道·抓包分支·未签 → 趁热走 API
  {
    console.log("场景13: 有 API Key 时抓包分支直接走 API 补签");
    const r = runCase({
      request: { headers: SAMPLE_HEADERS },
      prefs: {},
      resp: { statusCode: 200, body: API_SUCCESS_BODY },
      apiKey: "mykey123",
    });
    await r.finished;
    check("只打 API 端点", r.fetches.length === 1 && r.fetches[0].url.endsWith("/api/open/checkin"));
    check("记录签到日期", r.store["RE0_LastCheckinDate"] === todayCN());
  }

  // ── 场景 14：网页通道·纯 flight 壳 → 不算成功不记日期
  {
    console.log("场景14: 页面 flight 壳（假成功防线）");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: [
        { statusCode: 200, body: '2:"$Sreact.fragment"\n3:I["./chunk.js"]\n' },
        { statusCode: 403, body: "<html><title>Just a moment...</title></html>" },
      ],
    });
    await r.finished;
    check("壳响应触发重挖", r.fetches.length === 2 && r.fetches[1].method === "GET");
    check("不记录签到日期", !r.store["RE0_LastCheckinDate"]);
    check("最终如实报告失败", r.notifications.some((n) => n.subtitle.includes("403")));
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  // ── 场景 15：网页通道·428 → hdh_sa_token 令牌接力重试
  {
    console.log("场景15: 428 令牌接力（Set-Cookie 换新后重签成功）");
    const r = runCase({
      request: null,
      prefs: { RE0_SavedHeaders: JSON.stringify(SAMPLE_HEADERS), RE0_ActionId: FAKE_ACTION_ID },
      resp: [
        { statusCode: 428, body: "", headers: { "Set-Cookie": "hdh_sa_token=newtok789; Path=/; HttpOnly" } },
        { statusCode: 200, body: WEB_SUCCESS_FLIGHT },
      ],
    });
    await r.finished;
    check("重试第二次 POST", r.fetches.length === 2 && r.fetches[1].method === "POST");
    check("第二次带新令牌", r.fetches[1].headers["Cookie"].includes("hdh_sa_token=newtok789"));
    check("接力后签到成功", r.store["RE0_LastCheckinDate"] === todayCN());
    check("通知签到完成", r.notifications.some((n) => n.subtitle.includes("签到完成")));
    check("$done 恰一次", r.state.doneCount === 1, `实际 ${r.state.doneCount}`);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试崩溃:", e);
  process.exit(1);
});
