const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "scripts", "re0.qx.cookie.js");
const originalSource = fs.readFileSync(scriptPath, "utf8");
const key = "re0_qx_session";
const oldAction = "a".repeat(40);
const newAction = "b".repeat(40);
const baseSession = {
  action: oldAction,
  ua: "MockBrowser/1.0",
  cookie: "token=MOCK_TOKEN==; refresh_token=MOCK_REFRESH==; hdh_sa_token=OLD_SA==; cf_clearance=MOCK_CF==",
  capturedAt: 123
};
const success = 'a:{"response":{"success":true,"message":"签到成功，获得 8 积分","code":"200"}}';
const response = (statusCode, body = "", headers = {}) => ({ statusCode, body, headers });
const fixtures = {
  page: response(200, "<html><title>RE0</title></html>"),
  success: response(200, success)
};

async function run(options = {}) {
  const prefs = new Map(Object.entries(options.prefs || {}));
  if (options.session) prefs.set(key, JSON.stringify(options.session));
  const calls = [];
  const notifications = [];
  const logs = [];
  const timers = new Set();
  let done = 0;
  let fixtureIndex = 0;
  const context = vm.createContext({
    console: {
      log: (...args) => logs.push(args.join(" ")),
      error: (...args) => logs.push(args.join(" "))
    },
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, Math.min(ms, options.timerCap || 50));
      timers.add(timer);
      return timer;
    },
    clearTimeout: timer => {
      timers.delete(timer);
      clearTimeout(timer);
    },
    $prefs: {
      valueForKey: name => prefs.get(name) || null,
      setValueForKey: (value, name) => {
        if (options.storageFail === true ||
            typeof options.storageFail === "function" && options.storageFail(calls.length)) return false;
        prefs.set(name, value);
        return true;
      }
    },
    $task: {
      fetch: request => {
        calls.push(JSON.parse(JSON.stringify(request)));
        if (options.fetch) return options.fetch(request, calls.length);
        const item = (options.responses || [])[fixtureIndex++];
        if (item instanceof Error) throw item;
        if (!item) throw new Error("Unexpected mocked request");
        return Promise.resolve(item);
      }
    },
    $notify: (...args) => notifications.push(args),
    $done: () => { done += 1; }
  });
  if (options.request) context.$request = options.request;
  if (options.environment) context.$environment = options.environment;
  let source = originalSource;
  if (options.policy) source = source.replace('policy: ""', `policy: ${JSON.stringify(options.policy)}`);
  let completion;
  let guard;
  try {
    completion = vm.runInContext(source, context, { filename: "re0.qx.cookie.js", timeout: 1000 });
    await Promise.race([
      completion,
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("Script did not finish")), 1500); })
    ]);
  } finally {
    clearTimeout(guard);
    for (const timer of timers) clearTimeout(timer);
  }
  assert.equal(done, 1, "$done must be called exactly once");
  for (const secret of ["MOCK_TOKEN", "MOCK_REFRESH", "MOCK_CF", "OLD_SA", "NEW_SA"]) {
    assert.ok(!logs.join("\n").includes(secret), "Console logs must not contain mocked credentials");
  }
  return {
    context, calls, notifications, prefs, logs, done,
    eval(code, inputs = {}) {
      Object.assign(context, inputs);
      const result = vm.runInContext(code, context, { timeout: 1000 });
      return result && typeof result === "object" ? JSON.parse(JSON.stringify(result)) : result;
    }
  };
}

function captureRequest(body = "[false]", extras = {}) {
  return {
    url: "https://re0.me/",
    method: "POST",
    headers: {
      "nExT-aCtIoN": oldAction,
      "uSeR-aGeNt": baseSession.ua,
      cOoKiE: baseSession.cookie + "; tracking_cookie=SHOULD_NOT_SAVE"
    },
    body,
    ...extras
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const hasTitle = (result, text) => result.notifications.some(item => item[1] === text);
const postCount = result => result.calls.filter(item => item.method === "POST").length;

test("script parses as JavaScript", async () => {
  new vm.Script(originalSource, { filename: scriptPath });
});

test("ordinary capture stores only own credentials and preserves equals", async () => {
  const result = await run({ request: captureRequest() });
  const saved = JSON.parse(result.prefs.get(key));
  assert.equal(saved.action, oldAction);
  assert.equal(saved.ua, baseSession.ua);
  assert.equal(saved.cookie, baseSession.cookie);
  assert.ok(hasTitle(result, "普通签到参数已保存"));
  assert.equal(result.calls.length, 0);
});

test("same ordinary capture is quiet", async () => {
  const result = await run({ session: baseSession, request: captureRequest() });
  assert.equal(result.notifications.length, 0);
});

test("capture rejects gambler, wrong body, method, domain and path", async () => {
  for (const request of [
    captureRequest("[true]"),
    captureRequest("[false,false]"),
    captureRequest("false"),
    captureRequest("[0]"),
    captureRequest("{}"),
    captureRequest("invalid"),
    captureRequest("[false]", { method: "GET" }),
    captureRequest("[false]", { url: "https://re0.me/login" }),
    captureRequest("[false]", { url: "https://re0.me/api" }),
    captureRequest("[false]", { url: "https://re0.me.evil.example/" }),
    captureRequest("[false]", { url: "http://re0.me/" })
  ]) {
    const result = await run({ request });
    assert.equal(result.prefs.has(key), false);
    assert.equal(result.notifications.length, 0);
    assert.equal(result.calls.length, 0);
  }
});

test("capture accepts root query and JSON whitespace", async () => {
  const result = await run({
    request: captureRequest(" \n[ false ]\n ", { url: "https://re0.me/?page=1" })
  });
  assert.ok(result.prefs.has(key));
});

test("capture missing token does not save", async () => {
  const request = captureRequest();
  request.headers.cOoKiE = "cf_clearance=MOCK_CF==";
  const result = await run({ request });
  assert.equal(result.prefs.has(key), false);
  assert.ok(hasTitle(result, "签到参数未完整"));
});

test("storage failure finishes and shows a safe message", async () => {
  const result = await run({ request: captureRequest(), storageFail: true });
  assert.ok(hasTitle(result, "保存失败"));
});

test("cookie merge handles combined Expires, equals, deletion and allowlist", async () => {
  const result = await run();
  const cookies = result.eval(
    `const testJar = re0CookieMap(inputCookie);
     re0MergeCookies(testJar, inputHeaders);
     re0CookieString(testJar);`,
    {
      inputCookie: baseSession.cookie,
      inputHeaders: [
        "token=NEW_TOKEN==; Expires=Wed, 01 Jan 2099 00:00:00 GMT; Path=/, hdh_sa_token=NEW_SA==; Path=/",
        "refresh_token=; Max-Age=0; Path=/",
        "csrf_access_token=CSRF==; Secure; Path=/; Domain=.re0.me",
        "tracking_cookie=SHOULD_NOT_SAVE; Path=/",
        "cf_clearance=EVIL; Domain=other.example; Path=/",
        "hdh_uid=WRONG_PATH; Path=/login"
      ]
    }
  );
  assert.equal(cookies, "token=NEW_TOKEN==; csrf_access_token=CSRF==; hdh_sa_token=NEW_SA==; cf_clearance=MOCK_CF==");
});

test("cookie merge honors max-age deletion and expired date", async () => {
  const result = await run();
  const cookies = result.eval(
    `const deletionJar = re0CookieMap(inputCookie);
     re0MergeCookies(deletionJar, inputHeaders);
     re0CookieString(deletionJar);`,
    {
      inputCookie: baseSession.cookie,
      inputHeaders: "token=deleted; Max-Age=0; Expires=Wed, 01 Jan 2099 00:00:00 GMT; Path=/, refresh_token=deleted; Expires=Wed, 01 Jan 2000 00:00:00 GMT; Path=/"
    }
  );
  assert.equal(cookies, "hdh_sa_token=OLD_SA==; cf_clearance=MOCK_CF==");
});

test("result parser handles strict success, hex RSC, escapes and failures", async () => {
  const result = await run();
  const cases = [
    [fixtures.success, "success"],
    [response(200, 'f:{"response":{"success":true,"message":"签到成功，获得 \\"8\\" 积分","code":"200"}}'), "success"],
    [response(200, '1:{"error":{"success":false,"message":"签到失败","description":"你已经签到过了，明天再来吧","code":"400"}}'), "already"],
    [response(200, '1:{"error":{"success":false,"message":"没有签到成功","code":"400"}}'), "failed"],
    [response(200, '1:{"error":{"success":false,"message":"明天再来参与活动"}}'), "failed"],
    [response(200, "<html><p>签到成功</p></html>"), "unknown"],
    [response(500, success), "unknown"],
    [response(500, '1:{"error":{"success":false,"message":"今天已签到"}}'), "failed"],
    [response(401, '1:{"error":{"success":false,"message":"请先登录","code":"401"}}'), "auth"],
    [response(200, '1:{"error":{"success":true,"message":"签到成功"}}'), "unknown"],
    [response(200, '1:{"response":{"success":true,"message":"签到成功"}}\n2:{"error":{"success":false,"message":"失败"}}'), "unknown"],
    [response(200, '{"response":{"success":true,"message":"签到成功"},"error":{"success":false,"message":"失败"}}'), "unknown"],
    [response(200, "签到成功"), "unknown"],
    [response(404, "Server action not found"), "stale-action"],
    [response(428, "action_token_required"), "stale-token"],
    [response(200, '1:{"error":{"success":false,"code":"action_token_required","message":"expired"}}'), "stale-token"],
    [response(undefined, success), "unknown"],
    [response("200", success), "success"],
    [response(404, '1:{"response":{"success":true,"message":"Server action not found"}}\n2:{"error":{"success":false,"message":"Server action not found"}}'), "unknown"]
  ];
  for (const [input, kind] of cases) {
    assert.equal(result.eval("re0Result(inputResponse).kind", { inputResponse: input }), kind);
  }
  const parsed = result.eval("re0Result(inputResponse)", {
    inputResponse: response(200, 'f:{"response":{"success":true,"message":"签到成功，获得 \\"8\\" 积分"}}')
  });
  assert.equal(parsed.message, '签到成功，获得 "8" 积分');
});

test("GET rotates security cookies, POST uses them, next run reuses persistence", async () => {
  const result = await run({
    session: baseSession,
    policy: "Fixed-Node",
    responses: [
      response(200, fixtures.page.body, {
        "sEt-CoOkIe": "hdh_sa_token=NEW_SA==; Path=/, token=NEW_TOKEN==; Path=/"
      }),
      fixtures.success
    ]
  });
  assert.equal(result.calls.length, 2);
  assert.equal(postCount(result), 1);
  const post = result.calls[1];
  assert.equal(post.body, "[false]");
  assert.equal(post.headers["Next-Action"], oldAction);
  assert.ok(post.headers.Cookie.includes("hdh_sa_token=NEW_SA=="));
  assert.ok(post.headers.Cookie.includes("token=NEW_TOKEN=="));
  for (const request of result.calls) {
    assert.deepEqual(request.opts, { redirection: false, "auto-cookie": false, policy: "Fixed-Node" });
  }
  assert.ok(hasTitle(result, "签到成功"));
  const second = await run({ prefs: Object.fromEntries(result.prefs), responses: [fixtures.page, fixtures.success] });
  assert.ok(second.calls[0].headers.Cookie.includes("hdh_sa_token=NEW_SA=="));
});

test("deleted auth cookie stops before POST and is persisted", async () => {
  const result = await run({
    session: baseSession,
    responses: [response(200, fixtures.page.body, { "Set-Cookie": "token=; Max-Age=0; Path=/" })]
  });
  assert.equal(postCount(result), 0);
  assert.ok(hasTitle(result, "登录信息已失效"));
  assert.ok(!/(?:^|;\s*)token=/.test(JSON.parse(result.prefs.get(key)).cookie));
});

test("POST cookie storage failure reports unconfirmed and does not retry", async () => {
  const result = await run({
    session: baseSession,
    storageFail: count => count === 2,
    responses: [
      fixtures.page,
      response(200, success, { "Set-Cookie": "hdh_sa_token=NEW_SA==; Path=/" })
    ]
  });
  assert.equal(postCount(result), 1);
  assert.ok(hasTitle(result, "签到结果未确认"));
});

test("GET missing HTTP status cannot trigger POST", async () => {
  const result = await run({ session: baseSession, responses: [response(undefined, fixtures.page.body)] });
  assert.equal(postCount(result), 0);
  assert.ok(hasTitle(result, "请求失败"));
});

test("stale security token refreshes once", async () => {
  const result = await run({
    session: baseSession,
    responses: [
      fixtures.page,
      response(428, "action_token_required"),
      response(200, fixtures.page.body, { "Set-Cookie": "hdh_sa_token=NEW_SA==; Path=/" }),
      fixtures.success
    ]
  });
  assert.equal(postCount(result), 2);
  assert.ok(result.calls[3].headers.Cookie.includes("hdh_sa_token=NEW_SA=="));
  assert.ok(hasTitle(result, "签到成功"));
});

test("second stale-token response never causes third POST", async () => {
  const result = await run({
    session: baseSession,
    responses: [fixtures.page, response(428, "action_token_required"), fixtures.page, response(428, "action_token_required")]
  });
  assert.equal(postCount(result), 2);
  assert.ok(hasTitle(result, "签到安全参数需要更新"));
});

test("stale action discovers exact checkIn ID, saves and retries once", async () => {
  let rootCount = 0;
  let postNumber = 0;
  const html = '<script src="/_next/static/chunks/layout.js"></script><script src="https://evil.example/_next/static/chunks/evil.js"></script><script src="/_next/static/chunks/page.js"></script>';
  const result = await run({
    session: baseSession,
    fetch: request => {
      if (request.method === "POST") return Promise.resolve(++postNumber === 1 ? response(404, "Server action not found") : fixtures.success);
      if (request.url === "https://re0.me/") return Promise.resolve(++rootCount === 1 ? fixtures.page : response(200, html));
      if (request.url.endsWith("/layout.js")) return Promise.resolve(response(200,
        `const login=(0,x.createServerReference)("${"c".repeat(40)}",x.callServer,void 0,x.findSourceMapURL,"login");
         const check=(0,x.createServerReference)("${newAction}",x.callServer,void 0,x.findSourceMapURL,"checkIn");`
      ));
      if (request.url.endsWith("/page.js")) return Promise.resolve(response(200, "const nothing=1;"));
      throw new Error("Unexpected asset path");
    }
  });
  assert.equal(postCount(result), 2);
  assert.equal(result.calls.filter(item => item.method === "POST")[1].headers["Next-Action"], newAction);
  assert.equal(JSON.parse(result.prefs.get(key)).action, newAction);
  assert.ok(result.calls.every(item => item.url.startsWith("https://re0.me/")));
  assert.ok(hasTitle(result, "签到成功"));
});

test("ambiguous action IDs do not retry", async () => {
  let postNumber = 0;
  const result = await run({
    session: baseSession,
    fetch: request => {
      if (request.method === "POST") {
        postNumber += 1;
        return Promise.resolve(response(404, "Server action not found"));
      }
      if (request.url.endsWith(".js")) return Promise.resolve(response(200,
        `x.createServerReference("${newAction}",x.callServer,void 0,x.findSourceMapURL,"checkIn");
         x.createServerReference("${"c".repeat(40)}",x.callServer,void 0,x.findSourceMapURL,"checkIn");`
      ));
      return Promise.resolve(response(200, '<script src="/_next/static/chunks/layout.js"></script>'));
    }
  });
  assert.equal(postNumber, 1);
  assert.ok(hasTitle(result, "签到接口需要更新"));
});

test("POST timeout and rejected network request never retry or leak details", async () => {
  for (const failure of ["timeout", "network"]) {
    const result = await run({
      session: baseSession,
      timerCap: 10,
      fetch: request => {
        if (request.method === "GET") return Promise.resolve(fixtures.page);
        if (failure === "timeout") return new Promise(() => {});
        return Promise.reject(new Error("MOCK_TOKEN secret URL error detail"));
      }
    });
    assert.equal(postCount(result), 1);
    assert.ok(hasTitle(result, "签到结果未确认"));
    assert.ok(!JSON.stringify(result.notifications).includes("MOCK_TOKEN"));
  }
});

test("HTTP 500 never retries and remains unconfirmed", async () => {
  const result = await run({ session: baseSession, responses: [fixtures.page, response(500, success)] });
  assert.equal(postCount(result), 1);
  assert.ok(hasTitle(result, "签到结果未确认"));
});

test("GET Cloudflare challenge, auth redirect and login HTML stop before POST", async () => {
  for (const [input, title] of [
    [response(403, "<html>Cloudflare: You have been blocked</html>"), "需要更新网站通行状态"],
    [response(200, "<html>Just a moment</html>", { "cf-mitigated": "challenge" }), "需要更新网站通行状态"],
    [response(302, "", { Location: "/login" }), "登录信息已失效"],
    [response(200, "<html><title>RE0 登录</title></html>"), "登录信息已失效"],
    [response(401, ""), "登录信息已失效"]
  ]) {
    const result = await run({ session: baseSession, responses: [input] });
    assert.equal(postCount(result), 0);
    assert.ok(hasTitle(result, title));
  }
});

test("POST auth failure and Cloudflare stop without retry", async () => {
  for (const [input, title] of [
    [response(401, '1:{"error":{"success":false,"message":"未登录"}}'), "登录信息已失效"],
    [response(403, "<html>Cloudflare: You have been blocked</html>"), "需要更新网站通行状态"]
  ]) {
    const result = await run({ session: baseSession, responses: [fixtures.page, input] });
    assert.equal(postCount(result), 1);
    assert.ok(hasTitle(result, title));
  }
});

test("POST login redirect is classified as auth", async () => {
  const result = await run({
    session: baseSession,
    responses: [fixtures.page, response(302, "", { Location: "/login?next=%2F" })]
  });
  assert.equal(postCount(result), 1);
  assert.ok(hasTitle(result, "登录信息已失效"));
});

test("POST login HTML is classified as auth", async () => {
  const result = await run({
    session: baseSession,
    responses: [fixtures.page, response(200, "<html><title>RE0 登录</title></html>")]
  });
  assert.equal(postCount(result), 1);
  assert.ok(hasTitle(result, "登录信息已失效"));
});

test("unknown response diagnostic retains protocol structure without private values", async () => {
  const body = '0:{"a":"$@a","f":[{"private_profile":{"email":"PRIVATE_EMAIL"}}]}\n' +
    'a:{"success":true,"data":{"code":200,"message":"签到成功 PRIVATE_EMAIL MOCK_TOKEN",'+
    '"description":"请先登录 PRIVATE_PERSON","cookie":"MOCK_CF","points":8,"unknown":"PRIVATE_VALUE"}}';
  const result = await run({
    session: baseSession,
    responses: [fixtures.page, response(200, body, { "Content-Type": "text/x-component;charset=UTF-8" })]
  });
  assert.ok(hasTitle(result, "签到结果未确认"));
  assert.equal(postCount(result), 1);
  const line = result.logs.find(item => item.startsWith("[RE0] RESULT_DIAG "));
  assert.ok(line);
  const diagnostic = JSON.parse(line.slice("[RE0] RESULT_DIAG ".length));
  assert.equal(diagnostic.http, 200);
  assert.equal(diagnostic.type, "text/x-component");
  assert.equal(diagnostic.format, "rsc");
  assert.equal(diagnostic.roots[0].value.a, "$@a");
  assert.equal(diagnostic.roots[1].id, "a");
  assert.equal(diagnostic.roots[1].value.success, true);
  assert.equal(diagnostic.roots[1].value.data.code, 200);
  assert.deepEqual(diagnostic.roots[1].value.data.message._signals, ["checkin_success_text"]);
  for (const privateValue of ["PRIVATE_EMAIL", "PRIVATE_PERSON", "PRIVATE_VALUE", "MOCK_TOKEN", "MOCK_CF"]) {
    assert.ok(!line.includes(privateValue));
  }
});

test("diagnostic has bounded size and does not print unknown body or code values", async () => {
  const result = await run();
  const diagnostic = result.eval("re0Diagnostic(inputResponse)", {
    inputResponse: response(200, JSON.stringify({
      success: "PRIVATE_SUCCESS",
      code: 123456,
      error: { description: "COOKIE_PRIVATE", secrets: "MOCK_TOKEN" },
      data: Array.from({ length: 100 }, () => ({ value: { data: { response: { message: "PRIVATE_MESSAGE" } } } }))
    }), { "Content-Type": "text/plain; private=PRIVATE_HEADER" })
  });
  assert.equal(diagnostic.truncated, true);
  assert.equal(diagnostic.roots[0].value.code, "<number>");
  const line = JSON.stringify(diagnostic);
  for (const privateValue of ["PRIVATE_SUCCESS", "123456", "COOKIE_PRIVATE", "MOCK_TOKEN", "PRIVATE_MESSAGE", "PRIVATE_HEADER"]) {
    assert.ok(!line.includes(privateValue));
  }
  assert.ok(line.length < 5000);
  for (const raw of ["PRIVATE_TEXT", "<html>PRIVATE_HTML</html>"]) {
    const unreadable = result.eval("re0Diagnostic(inputResponse)", {
      inputResponse: response(200, raw)
    });
    assert.ok(!JSON.stringify(unreadable).includes("PRIVATE_"));
  }
  const opaque = "a".repeat(10000);
  const opaqueDiagnostic = result.eval("re0Diagnostic(inputResponse)", {
    inputResponse: response(200, opaque + ':{"a":"$@' + opaque + '"}',
      { "Content-Type": "text/" + opaque })
  });
  assert.equal(opaqueDiagnostic.roots[0].id, "<id>");
  assert.equal(opaqueDiagnostic.roots[0].value.a, "<string>");
  assert.equal(opaqueDiagnostic.type, "unknown");
  assert.ok(JSON.stringify(opaqueDiagnostic).length < 1000);
});

test("diagnostic logging failure preserves the unknown result", async () => {
  const result = await run();
  const parsed = result.eval(
    `const originalLog = console.log;
     console.log = () => { throw new Error("Log failure"); };
     let guardedResult;
     try { guardedResult = re0Result(inputResponse); }
     finally { console.log = originalLog; }
     guardedResult;`,
    { inputResponse: response(200, '{"success":true,"data":{"code":200}}') }
  );
  assert.equal(parsed.kind, "unknown");
});

test("recognized success does not add unknown-response diagnostics", async () => {
  const result = await run({ session: baseSession, responses: [fixtures.page, fixtures.success] });
  assert.ok(hasTitle(result, "签到成功"));
  assert.ok(result.logs.every(item => !item.startsWith("[RE0] RESULT_DIAG ")));
});

test("optional task environment policy selects the requested route", async () => {
  const selected = await run({
    session: baseSession,
    environment: { variables: { policy: "  Task-Selected-Node  " } },
    responses: [fixtures.page, fixtures.success]
  });
  assert.ok(selected.calls.every(request => request.opts.policy === "Task-Selected-Node"));
  const ignored = await run({
    session: baseSession,
    environment: { variables: { policy: 123 } },
    responses: [fixtures.page, fixtures.success]
  });
  assert.ok(ignored.calls.every(request => !Object.hasOwn(request.opts, "policy")));
});

test("Cookie gallery, rewrite and docs share existing targets and 00:20 cron", async () => {
  const uploadRoot = path.join(__dirname, "..");
  const galleryPath = path.join(uploadRoot, "gallery", "re0.qx.cookie.gallery.json");
  const rewritePath = path.join(uploadRoot, "rewrite", "re0.qx.cookie.snippet");
  const docPath = path.join(uploadRoot, "docs", "re0.qx.cookie.md");
  const gallery = JSON.parse(fs.readFileSync(galleryPath, "utf8"));
  const rewrite = fs.readFileSync(rewritePath, "utf8");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.ok(gallery.name.includes("Cookie"));
  assert.equal(gallery.task.length, 1);
  const task = gallery.task[0];
  const columns = task.config.split(/\s+/);
  assert.equal(columns.slice(0, 5).join(" "), "20 0 * * *");
  const scriptUrl = columns[5].replace(/,$/, "");
  const parsed = new URL(scriptUrl);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "raw.githubusercontent.com");
  assert.match(parsed.pathname, /^\/[^/]+\/quantumultx-scripts\/main\/scripts\/re0\.qx\.cookie\.js$/);
  const rawPrefix = scriptUrl.slice(0, -"scripts/re0.qx.cookie.js".length);
  assert.equal(task.addons, rawPrefix + "rewrite/re0.qx.cookie.snippet");
  assert.ok(task.config.includes("tag=RE0普通签到（Cookie）"));
  assert.ok(task.config.includes("enabled=true"));
  assert.ok(fs.existsSync(scriptPath));
  assert.match(rewrite, /^hostname\s*=\s*re0\.me\s*$/m);
  assert.ok(!rewrite.includes("%APPEND%"));
  const rule = rewrite.split(/\r?\n/).find(line => line.trim().startsWith("^"));
  assert.equal(
    rule,
    "^https://re0\\.me/(?:\\?.*)?$ url script-request-body " + scriptUrl
  );
  assert.ok(doc.includes(rawPrefix + "gallery/re0.qx.cookie.gallery.json"));
  assert.ok(doc.includes(task.addons));
  assert.ok(doc.includes(scriptUrl));
  assert.ok(doc.includes("20 0 * * * " + scriptUrl));
  assert.ok(doc.includes("(re0.qx.md)"));
  assert.ok(doc.includes("MITM"));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log("PASS " + name);
    } catch (error) {
      failed += 1;
      console.error("FAIL " + name + ": " + error.message);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
