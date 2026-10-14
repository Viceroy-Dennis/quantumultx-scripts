// 影巢 re0.me 注入式签到 v4 — 注入 JS 沙箱测试
// 用法: node tests/re0.qx.inject.test.js

const fs = require("fs");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "scripts", "re0.qx.inject.js");
const code = fs.readFileSync(SCRIPT, "utf8");

let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}

// 从脚本里抠出 injectedSource() 函数体并执行，拿到注入源码字符串
function getInjectedSource() {
  const env = {
    $prefs: { valueForKey: () => null, setValueForKey: () => {} },
    $notify: () => {},
    console: { log: () => {} },
  };
  // 截到 injectedSource 定义结束即可，避免跑入口
  const cut = code.indexOf("// ─────────────────── 分支 A");
  const fn = new Function(...Object.keys(env), cut > 0 ? code.slice(0, cut) : code);
  fn(...Object.values(env));
  // injectedSource 在该作用域内，重新包装返回
  const fn2 = new Function(
    ...Object.keys(env),
    (cut > 0 ? code.slice(0, cut) : code) + "\nreturn injectedSource();"
  );
  return fn2(...Object.values(env));
}

// 极简浏览器环境模拟
function makeBrowser({ chunkText, checkinResp, alreadyDate }) {
  const fetches = [];
  const ls = {};
  if (alreadyDate) ls["re0_auto_checkin_date"] = alreadyDate;

  const layoutSrc =
    "https://re0.me/_next/static/chunks/app/(app)/layout-4b4a886620b8a1fe.js";

  const document = {
    readyState: "complete",
    title: "RE0",
    scripts: [{ src: layoutSrc }],
    _injected: null,
  };
  // 注入脚本假定 script 标签字符串只是被嵌入，不真的解析；这里不模拟 DOM 插入
  const listeners = {};
  const win = {
    __re0Checkin: undefined,
    addEventListener: (ev, cb) => (listeners[ev] = cb),
    location: { reload: () => (win.__reloaded = true) },
  };

  function makeResponse(body, status) {
    return {
      ok: status >= 200 && status < 300,
      status,
      redirected: false,
      text: () => Promise.resolve(body),
    };
  }

  function fetchImpl(url, opts) {
    fetches.push({ url, opts });
    if (url.indexOf("layout-") >= 0) {
      return Promise.resolve(makeResponse(chunkText, 200));
    }
    if (url === "/" || /re0\.me\/$/.test(url) || /\/re0-checkin-report/.test(url)) {
      if (url.indexOf("re0-checkin-report") >= 0) {
        return Promise.resolve(makeResponse("GIF", 200));
      }
      const r = checkinResp();
      return Promise.resolve(makeResponse(r.body, r.status));
    }
    return Promise.resolve(makeResponse("", 404));
  }

  // Image 信标
  let beacon = null;
  function Image() {
    Object.defineProperty(this, "src", {
      set(v) {
        beacon = v;
        fetches.push({ url: v, opts: { method: "GET", beacon: true } });
      },
      get() {
        return beacon;
      },
    });
  }

  const sandbox = {
    window: win,
    document,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => (ls[k] = String(v)),
    },
    fetch: fetchImpl,
    Image,
    URLSearchParams,
    setTimeout: (fn, ms) => fn(), // 立即执行
    console: { log: () => {}, error: () => {} },
  };

  return { sandbox, fetches, ls, win };
}

function runInjected(injected, b) {
  const keys = Object.keys(b.sandbox);
  const fn = new Function(...keys, injected + "\n;return window.__re0Checkin;");
  fn(...Object.values(b.sandbox));
  // 注入逻辑是 Promise 链 + setTimeout(立即执行)，等微任务跑完
  return new Promise((resolve) => {
    setTimeout(() => resolve(b.win.__re0Checkin), 30);
  });
}

async function main() {
  const injected = getInjectedSource();
  check("注入源码非空", injected.length > 1000);
  check("注入源码是 IIFE", /^\(function/.test(injected.trim()));
  check(
    "动态挖 action id（不写死）",
    injected.includes("createServerReference") && injected.includes("layout-")
  );

  const LAYOUT =
    'xxx(0,e.createServerReference)("4055877e0a65fb183d3aa623de450ded197271fb60",r.callServer,void 0,r.findSourceMapURL,"checkIn")';

  const SUCCESS =
    '...i:false}\n1:{"response":{"success":true,"message":"签到成功，获得 10 积分","code":"200"}}\ne:Tc';
  const ALREADY =
    '1:{"error":{"success":false,"message":"签到失败","description":"你已经签到过了，明天再来吧","code":"400"}}';
  const CONFLICT =
    '{"success":false,"code":"action_token_invalid","message":"安全验证已更新，请重试"}';

  // 场景1：成功签到
  {
    console.log("场景1: 注入后自动签到成功");
    const b = makeBrowser({
      chunkText: LAYOUT,
      checkinResp: () => ({ body: SUCCESS, status: 200 }),
    });
    const r = await runInjected(injected, b);
    check("拉取了 layout chunk", b.fetches.some((f) => f.url.indexOf("layout-") >= 0));
    const post = b.fetches.find((f) => f.opts && f.opts.method === "POST");
    check("POST / 签到", post && post.url === "/");
    check(
      "带 Next-Action 新 id",
      post && post.opts.headers["Next-Action"] === "4055877e0a65fb183d3aa623de450ded197271fb60"
    );
    check("body 为 [false]", post && post.opts.body === "[false]");
    check("记录成功到 localStorage", b.ls["re0_auto_checkin_date"]);
    check("结果 ok=true", r && r.ok === true, JSON.stringify(r));
    const beacon = b.fetches.find((f) => f.opts && f.opts.beacon);
    check("发出成功信标 ok=1", beacon && /ok=1/.test(beacon.url));
    check("信标带签到文案", beacon && /%E7%AD%BE%E5%88%B0%E6%88%90%E5%8A%9F/.test(beacon.url));
  }

  // 场景2：已签
  {
    console.log("场景2: 今天已签（error.description）");
    const b = makeBrowser({
      chunkText: LAYOUT,
      checkinResp: () => ({ body: ALREADY, status: 200 }),
    });
    const r = await runInjected(injected, b);
    check("识别已签", r && r.already === true);
    const beacon = b.fetches.find((f) => f.opts && f.opts.beacon);
    check("信标 already=1", beacon && /already=1/.test(beacon.url));
  }

  // 场景3：409 安全令牌 → 不报成功
  {
    console.log("场景3: 409 安全令牌失效");
    const b = makeBrowser({
      chunkText: LAYOUT,
      checkinResp: () => ({ body: CONFLICT, status: 409 }),
    });
    const r = await runInjected(injected, b);
    check("不判成功", r && r.ok !== true);
    const beacon = b.fetches.find((f) => f.opts && f.opts.beacon);
    check("信标 ok=0", beacon && /ok=0/.test(beacon.url));
  }

  // 场景4：当天已跑过 → 直接跳过不请求
  {
    console.log("场景4: localStorage 标记当天已处理 → 静默");
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const b = makeBrowser({
      chunkText: LAYOUT,
      checkinResp: () => ({ body: SUCCESS, status: 200 }),
      alreadyDate: today,
    });
    runInjected(injected, b);
    check("不发起任何 POST", !b.fetches.some((f) => f.opts && f.opts.method === "POST"));
    check("不拉 chunk", !b.fetches.some((f) => f.url.indexOf("layout-") >= 0));
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试崩溃:", e);
  process.exit(1);
});
