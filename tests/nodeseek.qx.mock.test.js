// NodeSeek 签到风控优化版 — QX mock 测试
// 用法: node tests/nodeseek.qx.mock.test.js

const fs = require("fs");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "scripts", "nodeseek.qx.checkin.js");
const code = fs.readFileSync(SCRIPT, "utf8");

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
  Cookie: "cf_clearance=abc; session=xyz",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)",
  "refract-sign": "sig123",
  "refract-key": "key456",
  "Accept": "*/*",
  "Referer": "https://www.nodeseek.com/",
};

function runCase({ request, prefs, fetchResp, async }) {
  const store = Object.assign({}, prefs || {});
  const notifications = [];
  const fetches = [];
  const state = { doneCount: 0 };
  let resolve;
  const finished = new Promise((r) => (resolve = r));

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
        return {
          then: (onOk, onErr) => {
            setImmediate(() => {
              if (fetchResp && fetchResp.error) onErr(fetchResp);
              else onOk(fetchResp || { statusCode: 200, body: '{"message":"ok"}' });
            });
          },
        };
      },
    },
    console: { log: () => {} },
  };

  const fn = new Function(
    ...Object.keys(env),
    `${code}\n;return { doneGuard: true };`
  );
  fn(...Object.values(env));

  return { store, notifications, fetches, state, finished };
}

async function main() {
  // ── 场景 1：抓包分支 + 今日未签 → 保鲜 + 趁热签到成功
  {
    console.log("场景1: 抓包分支，今日未签 → 实时补签");
    const r = runCase({
      request: { headers: SAMPLE_HEADERS },
      prefs: {},
      fetchResp: { statusCode: 200, body: '{"success":true,"message":"签到成功，获得 20 鸡腿"}' },
    });
    await r.finished;
    check("凭据已保存", r.store["NS_NodeseekHeaders"] && r.store["NS_NodeseekHeaders"].includes("cf_clearance"));
    check("发起签到", r.fetches.length === 1 && r.fetches[0].url.includes("/api/attendance"));
    check("签的是 attendance 接口", r.fetches[0].method === "POST");
    check("记录签到日期", r.store["NS_LastCheckinDate"] === todayCN());
    check("通知签到完成", r.notifications.some((n) => n.title.includes("实时补签") && n.subtitle.includes("签到完成")));
    check("$done 恰一次", r.state.doneCount === 1, `实际 doneCount=${r.state.doneCount}`);
  }

  // ── 场景 2：抓包分支 + 今日已签 → 仅静默保鲜
  {
    console.log("场景2: 抓包分支，今日已签 → 静默保鲜不补签");
    const r = runCase({
      request: { headers: SAMPLE_HEADERS },
      prefs: { NS_LastCheckinDate: todayCN() },
      fetchResp: { statusCode: 200, body: "{}" },
    });
    await r.finished;
    check("凭据仍刷新", !!r.store["NS_NodeseekHeaders"]);
    check("不发起签到", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
    check("$done 恰一次", r.state.doneCount === 1);
  }

  // ── 场景 3：定时分支 + 无凭据 → 提示
  {
    console.log("场景3: 定时分支，无凭据 → 提示打开页面");
    const r = runCase({ request: null, prefs: {}, fetchResp: null });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("提示无凭据", r.notifications.some((n) => n.subtitle === "无法签到"));
  }

  // ── 场景 4：定时分支 + 有凭据 + 今日已签 → 静默跳过
  {
    console.log("场景4: 定时分支，今日已签 → 静默跳过");
    const r = runCase({
      request: null,
      prefs: {
        NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS),
        NS_LastCheckinDate: todayCN(),
      },
      fetchResp: null,
    });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
  }

  // ── 场景 5：定时分支 + 403 CF 拦截 → 温和提示
  {
    console.log("场景5: 定时分支，403 Cloudflare → 温和提示");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS) },
      fetchResp: {
        statusCode: 403,
        body: '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head></html>',
      },
    });
    await r.finished;
    check("发起签到", r.fetches.length === 1);
    check("403 温和提示", r.notifications.some((n) => n.subtitle.includes("403") && n.body.includes("自动补签")));
    check("不记录日期", !r.store["NS_LastCheckinDate"]);
  }

  // ── 场景 6：定时分支 + 凭据损坏 → 提示重抓
  {
    console.log("场景6: 定时分支，凭据损坏 → 提示刷新");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: "{broken json" },
      fetchResp: null,
    });
    await r.finished;
    check("提示凭据损坏", r.notifications.some((n) => n.subtitle === "凭据损坏"));
  }

  // ── 场景 7：抓包分支 + 空头 → 通知失败且不崩
  {
    console.log("场景7: 抓包分支，空请求头 → 获取失败通知");
    const r = runCase({ request: { headers: {} }, prefs: {}, fetchResp: null });
    await r.finished;
    check("通知获取失败", r.notifications.some((n) => n.title.includes("获取失败")));
    check("不发起签到", r.fetches.length === 0);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试崩溃:", e);
  process.exit(1);
});
