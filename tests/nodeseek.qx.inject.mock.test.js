/*
 * NodeSeek 注入版 v5 · Node mock 回归测试
 * 跑法：node tests/nodeseek.qx.inject.mock.test.js
 *
 * 两件事要验：
 *   1. 注入逻辑（有 </body> / 没 </body> / 已注入过）
 *   2. 注入进去的那段 JS 真能跑：拿假 DOM 跑一遍，看它有没有按预期 POST /api/attendance
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "scripts", "nodeseek.qx.inject.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, e) => (c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${e ? " → " + e : ""}`)));
const eq = (n, a, b) => ok(n, a === b, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`);

/* 跑外层脚本，拿它 $done 出去的东西 */
function runInject(body) {
  let result = null;
  let doneCalled = 0;
  const sandbox = {
    console: { log: () => {} },
    setTimeout,
    JSON, String, Object, Array, RegExp, Date,
    $response: body === null ? undefined : { statusCode: 200, headers: {}, body },
    $done: (o) => { doneCalled++; if (o) result = o; },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "nodeseek.qx.inject.js" });
  return { result, doneCalled, sandbox };
}

/* 把注入的 <script> 内容抠出来 */
function extractScript(html) {
  const m = html.match(/<script id="ns-qd-v5">([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

/* 在假 DOM 里跑注入的那段 JS */
function runInjected(js) {
  const calls = [];
  const tips = [];
  const store = new Map();

  const mkEl = () => ({
    style: {},
    textContent: "",
    parentNode: null,
    remove() {},
  });

  const sandbox = {
    console: { log: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    JSON, String, Object, Array, Date, RegExp,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    document: {
      readyState: "complete",
      body: {
        appendChild: (el) => { tips.push(el.textContent); el.parentNode = { removeChild() {} }; },
      },
      createElement: mkEl,
    },
    window: { addEventListener: () => {} },
    fetch: (url, opts) => {
      calls.push({ url, opts });
      const payload = JSON.stringify({ success: true, message: "签到成功" });
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(payload),
      });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: "inject.js" });
  return new Promise((r) => setTimeout(() => r({ calls, tips, store }), 60));
}

(async () => {
  console.log("\n[1] 注入：正常 HTML 带 </body>");
  {
    const html = '<html><body><div id="app"></div></body></html>';
    const { result, doneCalled } = runInject(html);
    eq("$done 调了 1 次", doneCalled, 1);
    ok("body 变长了", result.body.length > html.length);
    ok("注入了 script 标签", /<script id="ns-qd-v5">/.test(result.body));
    ok("插在 </body> 前面", /<script id="ns-qd-v5">[\s\S]*<\/script><\/body>/.test(result.body));
  }

  console.log("\n[2] 幂等：已经注入过的不重复插");
  {
    const first = runInject("<body></body>").result.body;
    const { result, doneCalled } = runInject(first);
    eq("$done 仍然调用", doneCalled, 1);
    ok("没带 body（原样放行）", !result || !("body" in result), JSON.stringify(result));
    eq("script 标签只出现一次", (first.match(/id="ns-qd-v5"/g) || []).length, 1);
    const again = runInject(first).result;
    eq("二次跑不改内容", again && again.body ? again.body : first, first);
  }

  console.log("\n[3] 没有 </body> 时追加到末尾");
  {
    const { result } = runInject("<div>spa shell</div>");
    ok("追加在末尾", /<\/script>$/.test(result.body));
    ok("内容还在", result.body.startsWith("<div>spa shell</div>"));
  }

  console.log("\n[4] 注入的 JS 语法合法");
  {
    const js = extractScript(runInject("<body></body>").result.body);
    ok("抠到了脚本", !!js);
    try {
      new Function(js);
      ok("语法 OK", true);
    } catch (e) {
      ok("语法 OK", false, String(e));
    }
    ok("没有裸的 </script>", !/<\/script>/.test(js));
  }

  console.log("\n[5] 注入的 JS 会真的去 POST /api/attendance");
  {
    const js = extractScript(runInject("<body></body>").result.body);
    const { calls, tips, store } = await runInjected(js);
    eq("发了一次请求", calls.length, 1);
    eq("URL 正确", calls[0].url, "/api/attendance?random=true");
    eq("method 是 POST", calls[0].opts.method, "POST");
    eq("带 cookie", calls[0].opts.credentials, "include");
    ok("弹了提示", tips.length >= 1, JSON.stringify(tips));
    ok("提示是成功语气", /签到成功/.test(tips[0] || ""), tips[0]);
    ok("写入了当天标记", store.get("ns_qd_v5") === new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), String(store.get("ns_qd_v5")));
  }

  console.log("\n[6] 当天已签过：注入的 JS 不发请求");
  {
    const js = extractScript(runInject("<body></body>").result.body);
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    // 手工塞好 localStorage 再跑
    const calls = [];
    const sandbox = {
      console: { log: () => {} },
      setTimeout: (fn) => setTimeout(fn, 0),
      JSON, String, Object, Array, Date, RegExp,
      localStorage: { getItem: () => day, setItem: () => {} },
      document: { readyState: "complete", body: { appendChild() {} }, createElement: () => ({ style: {} }) },
      window: { addEventListener: () => {} },
      fetch: (u, o) => { calls.push(u); return Promise.resolve({ status: 200, text: () => Promise.resolve("{}") }); },
    };
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox, { filename: "inject.js" });
    await new Promise((r) => setTimeout(r, 60));
    eq("零请求", calls.length, 0);
  }

  console.log("\n[7] 业务层回「今日已签」→ 也算成功并记标记");
  {
    const js = extractScript(runInject("<body></body>").result.body);
    const store = new Map();
    const tips = [];
    const sandbox = {
      console: { log: () => {} },
      setTimeout: (fn) => setTimeout(fn, 0),
      JSON, String, Object, Array, Date, RegExp,
      localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
      document: {
        readyState: "complete",
        body: { appendChild: (el) => { tips.push(el.textContent); el.parentNode = { removeChild() {} }; } },
        createElement: () => ({ style: {}, textContent: "" }),
      },
      window: { addEventListener: () => {} },
      fetch: () => Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: false, message: "您已完成签到，请勿重复" })),
      }),
    };
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox, { filename: "inject.js" });
    await new Promise((r) => setTimeout(r, 60));
    ok("提示「今日已签」", /今日已签/.test(tips[0] || ""), tips[0]);
    ok("标记已写", !!store.get("ns_qd_v5"));
  }

  console.log("\n[8] 未登录（USER NOT FOUND）→ 静默，不打扰");
  {
    const js = extractScript(runInject("<body></body>").result.body);
    const tips = [];
    const sandbox = {
      console: { log: () => {} },
      setTimeout: (fn) => setTimeout(fn, 0),
      JSON, String, Object, Array, Date, RegExp,
      localStorage: { getItem: () => null, setItem: () => {} },
      document: {
        readyState: "complete",
        body: { appendChild: (el) => { tips.push(el.textContent); el.parentNode = { removeChild() {} }; } },
        createElement: () => ({ style: {}, textContent: "" }),
      },
      window: { addEventListener: () => {} },
      fetch: () => Promise.resolve({ status: 500, text: () => Promise.resolve(JSON.stringify({ success: false, message: "USER NOT FOUND" })) }),
    };
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox, { filename: "inject.js" });
    await new Promise((r) => setTimeout(r, 60));
    eq("不弹任何提示", tips.length, 0);
  }

  console.log("\n[9] 误挂成定时任务：走兜底通知，不崩");
  {
    const notes = [];
    let doneCalled = 0;
    const sandbox = {
      console: { log: () => {} },
      setTimeout, JSON, String, Object, Array, RegExp, Date,
      $notify: (t, s) => notes.push(`${t} | ${s}`),
      $done: () => { doneCalled++; },
    };
    vm.createContext(sandbox);
    vm.runInContext(CODE, sandbox, { filename: "nodeseek.qx.inject.js" });
    ok("有兜底通知", notes.length === 1, JSON.stringify(notes));
    eq("$done 调了", doneCalled, 1);
  }

  console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
