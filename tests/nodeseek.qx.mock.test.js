// NodeSeek 签到 · 运行时签名版 v3 — QX mock 测试
// 用法: node tests/nodeseek.qx.mock.test.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCRIPT = path.join(__dirname, "..", "scripts", "nodeseek.qx.checkin.js");
const code = fs.readFileSync(SCRIPT, "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

const SAMPLE_HEADERS = {
  Cookie: "cf_clearance=abc; session=xyz",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)",
  "refract-sign": "sig123",
  "refract-key": "key456",
  Accept: "*/*",
  Referer: "https://www.nodeseek.com/",
};

const UA = SAMPLE_HEADERS["User-Agent"];
function expectedSign(method, url, body, key) {
  return crypto.createHash("sha1").update([method.toUpperCase(), url, UA, body || "", key].join("\n\n")).digest("hex");
}

// 路由型 mock：handler({url, method, headers, body}) → {statusCode, headers, body}
function runCase({ request, prefs, route }) {
  const store = Object.assign({}, prefs || {});
  const notifications = [];
  const fetches = [];
  const state = { doneCount: 0 };
  let resolve;
  const finished = new Promise((r) => (resolve = r));

  const env = {
    $request: request === null ? undefined : request,
    $prefs: {
      setValueForKey: (v, k) => { store[k] = v; return true; },
      valueForKey: (k) => (k in store ? store[k] : null),
    },
    $notify: (t, s, b) => notifications.push({ title: t, subtitle: s, body: b }),
    $done: () => { state.doneCount++; resolve(); },
    $task: {
      fetch: (req) => {
        fetches.push(req);
        const resp = route ? (route(req) || { statusCode: 404, headers: {}, body: "" }) : { statusCode: 200, headers: {}, body: '{"message":"ok"}' };
        return { then: (ok, err) => setImmediate(() => ok(resp)) };
      },
    },
    setTimeout: (fn) => setImmediate(fn), // 抖动/退避不真等
    console: { log: () => {} },
  };

  new Function(...Object.keys(env), `${code}`)(...Object.values(env));
  return { store, notifications, fetches, state, finished };
}

const okPing = () => ({ statusCode: 200, headers: {}, body: "pong" });
const okAtt = (msg) => () => ({ statusCode: 200, headers: {}, body: JSON.stringify({ success: true, message: msg || "签到成功，获得 20 鸡腿" }) });
const okProfile = () => ({ statusCode: 200, headers: {}, body: JSON.stringify({ success: true, detail: { rank: 3, coin: 1234 } }) });

async function main() {
  // ── 场景 1：抓包 + 今日未签 → 保鲜 + 趁热签到成功
  {
    console.log("场景1: 抓包分支，今日未签 → 实时补签");
    const r = runCase({
      request: { url: "https://www.nodeseek.com/api/account/getInfo/26589?readme=1", headers: SAMPLE_HEADERS },
      prefs: {},
      route: (q) => {
        if (q.url.includes("/edge-cgi/ping")) return okPing();
        if (q.url.includes("/api/attendance")) return okAtt()();
        if (q.url.includes("/api/account/getInfo")) return okProfile();
        return { statusCode: 404, headers: {}, body: "" };
      },
    });
    await r.finished;
    check("凭据已保存", r.store["NS_NodeseekHeaders"] && r.store["NS_NodeseekHeaders"].includes("cf_clearance"));
    check("抓到 memberId", JSON.parse(r.store["NS_NodeseekHeaders"]).memberId === "26589");
    check("不落盘 refract-sign", !("refract-sign" in JSON.parse(r.store["NS_NodeseekHeaders"])));
    check("发起签到", r.fetches.some((f) => f.url.includes("/api/attendance") && f.method === "POST"));
    check("记录签到日期", r.store["NS_LastCheckinDate"] === todayCN());
    check("通知签到完成", r.notifications.some((n) => n.title.includes("实时补签") && n.subtitle.includes("签到完成")));
    check("只发一条通知", r.notifications.length === 1, `实际 ${r.notifications.length}`);
    check("通知带鸡腿", r.notifications[0].body.includes("1234"));
    check("$done 恰一次", r.state.doneCount === 1, `实际 doneCount=${r.state.doneCount}`);
  }

  // ── 场景 2：抓包 + 今日已签 → 仅静默保鲜
  {
    console.log("场景2: 抓包分支，今日已签 → 静默保鲜不补签");
    const r = runCase({
      request: { url: "https://www.nodeseek.com/api/board", headers: SAMPLE_HEADERS },
      prefs: { NS_LastCheckinDate: todayCN() },
      route: () => ({ statusCode: 200, headers: {}, body: "{}" }),
    });
    await r.finished;
    check("凭据仍刷新", !!r.store["NS_NodeseekHeaders"]);
    check("不发起签到", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
    check("$done 恰一次", r.state.doneCount === 1);
  }

  // ── 场景 3：定时 + 无凭据 → 提示
  {
    console.log("场景3: 定时分支，无凭据 → 提示打开页面");
    const r = runCase({ request: null, prefs: {}, route: null });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("提示无凭据", r.notifications.some((n) => n.subtitle === "无法签到"));
  }

  // ── 场景 4：定时 + 有凭据 + 今日已签 → 静默跳过
  {
    console.log("场景4: 定时分支，今日已签 → 静默跳过");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS), NS_LastCheckinDate: todayCN() },
      route: null,
    });
    await r.finished;
    check("不发起请求", r.fetches.length === 0);
    check("无通知", r.notifications.length === 0);
  }

  // ── 场景 5：定时 + 403 Cloudflare → 温和提示、不记日期
  {
    console.log("场景5: 定时分支，403 Cloudflare → 温和提示");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS) },
      route: () => ({ statusCode: 403, headers: {}, body: '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>' }),
    });
    await r.finished;
    check("发起签到", r.fetches.some((f) => f.url.includes("/api/attendance")));
    check("403 温和提示", r.notifications.some((n) => n.subtitle.includes("403") && n.body.includes("自动补签")), JSON.stringify(r.notifications));
    check("不记录日期", !r.store["NS_LastCheckinDate"]);
    check("重试次数受控", r.fetches.filter((f) => f.url.includes("/api/attendance")).length <= 3);
  }

  // ── 场景 6：定时 + 凭据损坏 → 提示重抓
  {
    console.log("场景6: 定时分支，凭据损坏 → 提示刷新");
    const r = runCase({ request: null, prefs: { NS_NodeseekHeaders: "{broken json" }, route: null });
    await r.finished;
    check("提示凭据损坏", r.notifications.some((n) => n.subtitle === "凭据损坏"));
  }

  // ── 场景 7：抓包 + 空头 → 通知失败且不崩
  {
    console.log("场景7: 抓包分支，空请求头 → 获取失败通知");
    const r = runCase({ request: { url: "https://www.nodeseek.com/api/x", headers: {} }, prefs: {}, route: null });
    await r.finished;
    check("通知获取失败", r.notifications.some((n) => n.title.includes("获取失败")));
    check("不发起签到", r.fetches.length === 0);
    check("$done 仍被调用", r.state.doneCount === 1);
  }

  // ── 场景 8：key 过期 → 换 key 后签名必须与真实算法一致
  {
    console.log("场景8: key 过期自动刷新 + 签名正确性");
    const NEWKEY = "40b647fe7e46236f8b2f4be398a8d9812d564d2d81852346ca21737834e3bbe6-1792637171251";
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS), NS_RefractKey: "CHICZkKViFoZmVbIH1Y6" },
      route: (q) => {
        if (q.url.includes("/edge-cgi/ping")) {
          return q.headers["refract-key"] === NEWKEY
            ? okPing()
            : { statusCode: 403, headers: { "refract-key-update": NEWKEY }, body: "403 Forbiden" };
        }
        if (q.url.includes("/api/attendance")) {
          const key = q.headers["refract-key"];
          const want = expectedSign("POST", q.url, "", key);
          if (key !== NEWKEY || q.headers["refract-sign"] !== want) {
            return { statusCode: 403, headers: {}, body: "403" };
          }
          return okAtt()();
        }
        return okProfile();
      },
    });
    await r.finished;
    const att = r.fetches.filter((f) => f.url.includes("/api/attendance"));
    check("用上了新 key", att.length && att[0].headers["refract-key"] === NEWKEY, att[0] && att[0].headers["refract-key"]);
    check("签名与 SHA1(method\\n\\nurl\\n\\nUA\\n\\nbody\\n\\nkey) 一致",
      att.length && att[0].headers["refract-sign"] === expectedSign("POST", "https://www.nodeseek.com/api/attendance?random=true", "", NEWKEY));
    check("refract-version 正确", att.length && att[0].headers["refract-version"] === "0.3.34");
    check("签到成功", r.notifications.some((n) => n.subtitle === "签到完成"), JSON.stringify(r.notifications));
    check("新 key 已持久化", r.store["NS_RefractKey"] === NEWKEY);
  }

  // ── 场景 9：旧版拍平 header 格式可平滑迁移
  {
    console.log("场景9: 旧格式凭据迁移");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS), NS_RefractKey: "k1" },
      route: (q) => {
        if (q.url.includes("/edge-cgi/ping")) return okPing();
        if (q.url.includes("/api/attendance")) {
          return q.headers["Cookie"] === SAMPLE_HEADERS.Cookie ? okAtt()() : { statusCode: 403, headers: {}, body: "" };
        }
        return okProfile();
      },
    });
    await r.finished;
    check("旧格式能读到 Cookie", r.fetches.some((f) => f.headers["Cookie"] === SAMPLE_HEADERS.Cookie));
    check("旧格式能签到成功", r.notifications.some((n) => n.subtitle === "签到完成"));
  }

  // ── 场景 10：签名被拒 → 降级无签名
  {
    console.log("场景10: 签名被拒 → 降级无签名重试");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS), NS_RefractKey: "k1" },
      route: (q) => {
        if (q.url.includes("/edge-cgi/ping")) return okPing();
        if (q.url.includes("/api/attendance")) {
          if (q.headers["refract-key"]) return { statusCode: 403, headers: {}, body: "403" };
          return okAtt("签到成功")();
        }
        return okProfile();
      },
    });
    await r.finished;
    const att = r.fetches.filter((f) => f.url.includes("/api/attendance"));
    check("先签名后降级", att.length >= 2 && !att[att.length - 1].headers["refract-key"]);
    check("降级后成功", r.notifications.some((n) => n.subtitle === "签到完成"), JSON.stringify(r.notifications));
  }

  // ── 场景 11：Cookie 失效 → 直接判定，不瞎重试
  {
    console.log("场景11: Cookie 失效 USER NOT FOUND");
    const r = runCase({
      request: null,
      prefs: { NS_NodeseekHeaders: JSON.stringify(SAMPLE_HEADERS), NS_RefractKey: "k1" },
      route: (q) => {
        if (q.url.includes("/edge-cgi/ping")) return okPing();
        return { statusCode: 500, headers: {}, body: JSON.stringify({ message: "USER NOT FOUND", status: 404, success: false }) };
      },
    });
    await r.finished;
    check("提示登录态失效", r.notifications.some((n) => n.subtitle === "登录态失效"), JSON.stringify(r.notifications));
    check("只打一次签到", r.fetches.filter((f) => f.url.includes("/api/attendance")).length === 1);
  }

  // ── 场景 12：SHA-1 向量
  {
    console.log("场景12: SHA-1 向量");
    const fn = new Function(...["$prefs", "$notify", "$done", "$task", "$request"], `${code}\n;globalThis.__s=sha1;`)
    fn({ valueForKey: () => null, setValueForKey: () => true }, () => {}, () => {}, { fetch: () => ({ then: () => {} }) }, undefined);
    check("sha1('abc')", globalThis.__s("abc") === "a9993e364706816aba3e25717850c26c9cd0d89d");
    check("sha1('')", globalThis.__s("") === "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    check("sha1 200 字节", globalThis.__s("x".repeat(200)).length === 40);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试崩溃:", e);
  process.exit(1);
});
