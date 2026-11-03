// Offline replay of the real QX entry point and the generated browser script.
// No live requests, cookies or API keys are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const script = fs.readFileSync(path.join(__dirname, "../scripts/re0.qx.checkin.js"), "utf8");
const setupScript = fs.readFileSync(path.join(__dirname, "../scripts/re0.qx.setup.js"), "utf8");
const NOW = Date.parse("2026-11-02T02:00:00Z");
const TODAY = "2026-11-02";
const DATE_KEY = "RE0_LastCheckinDate";
const LS_DATE = "re0_auto_checkin_date";
const LAYOUT = "https://re0.me/_next/static/chunks/app/(app)/layout-fixture.js";
const ACTION = "4055877e0a65fb183d3aa623de450ded197271fb60";
const CHUNK = `(0,e.createServerReference)("${ACTION}",r.callServer,void 0,r.findSourceMapURL,"checkIn")`;
const SUCCESS = '1:{"response":{"success":true,"message":"签到成功，获得 10 积分","code":"200"}}';
const CF_HTML = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {};</script></body></html>";
const PAGE_HTML = `<!DOCTYPE html><html><head><script src="/_next/static/chunks/app/(app)/layout-fixture.js"></script></head><body>RE0</body></html>`;
const AUTH_KEY = "re0_openapi_auth";
const VERIFIED_KEY = "re0_verified_checkin_date";
const WAIT_KEY = "re0_api_next_attempt";
const API_URL = "https://re0.me/api/open/checkin";
const REFRESH_URL = "https://re0.me/api/public/openapi/oauth/refresh";
const AUTH = Object.freeze({
  apiKey: "offline-client-key",
  accessToken: "offline-user-access",
  refreshToken: "offline-user-refresh",
  expiresAt: NOW + 60 * 60 * 1000,
});

function authStore(overrides = {}) {
  return { [AUTH_KEY]: JSON.stringify({ ...AUTH, ...overrides }) };
}

function refreshResponse(overrides = {}) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      data: {
        access_token: "offline-rotated-access",
        refresh_token: "offline-rotated-refresh",
        expires_in: 3600,
        ...overrides,
      },
    }),
  };
}

function setupAuth(store, auth) {
  let localSource = setupScript;
  for (const [constant, field] of [
    ["API_KEY", "apiKey"],
    ["ACCESS_TOKEN", "accessToken"],
    ["REFRESH_TOKEN", "refreshToken"],
  ]) {
    localSource = localSource.replace(
      "const " + constant + ' = "";',
      "const " + constant + " = " + JSON.stringify(auth[field] || "") + ";"
    );
  }
  const run = qx({ store, entrySource: localSource });
  assert.equal(run.fetches.length, 0);
  assert.equal(run.done.length, 1);
  return run;
}

async function settleQx() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

function fixedDate(now) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}

function storage(store) {
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
}

function qx({
  response, request, store = {}, apiKey, now = NOW, queued = [],
  writeResult = () => true, entrySource = script,
} = {}) {
  const done = [];
  const fetches = [];
  const notifications = [];
  const logs = [];
  const timers = [];
  const writes = [];
  if (apiKey) {
    if (!store.re0_api_key) store.re0_api_key = AUTH.apiKey;
    if (!store.re0_access_token) store.re0_access_token = AUTH.accessToken;
  }
  const context = {
    Date: fixedDate(now),
    URL,
    URLSearchParams,
    $prefs: {
      valueForKey: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setValueForKey: (value, key) => {
        writes.push({ key, value: String(value) });
        if (writeResult(value, key) === false) return false;
        store[key] = String(value);
        return true;
      },
      removeValueForKey: (key) => { delete store[key]; return true; },
    },
    $done: (value) => done.push(value),
    $notify: (...args) => notifications.push(args),
    $task: {
      fetch: (req) => {
        fetches.push(req);
        const next = queued.shift();
        if (!next) return Promise.reject(new Error("unexpected request"));
        return next.error ? Promise.reject(next.error) : Promise.resolve(next);
      },
    },
    console: { log: (...args) => logs.push(args.join(" ")) },
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.active = false; },
    $environment: {
      variables: { "force-timeout": "60000" },
      sourcePath: "https://example.invalid/re0.qx.checkin.js#force-timeout=60000",
    },
  };
  if (request !== "absent") context.$request = request;
  if (response) context.$response = response;
  vm.createContext(context);
  vm.runInContext(entrySource, context, { timeout: 1000 });
  return { context, done, fetches, notifications, logs, store, timers, writes };
}

function source(store = {}) {
  const context = qx({ store, response: { statusCode: 200, body: PAGE_HTML } }).context;
  return vm.runInContext("injectedSource()", context);
}

function browser({
  store = {}, now = NOW, scripts = [LAYOUT],
  response = { status: 200, body: SUCCESS },
  chunks = {}, chunkResponse, qxStore = {},
} = {}) {
  const fetches = [];
  const timers = [];
  const win = { addEventListener: () => {} };
  const location = { href: "https://re0.me/", origin: "https://re0.me", reload: () => { win.reloads = (win.reloads || 0) + 1; } };
  win.location = location;
  const document = {
    readyState: "complete", title: "RE0",
    scripts: scripts.map((src) => ({ src })),
    querySelector: () => null,
  };
  const context = {
    window: win, document, location,
    Date: fixedDate(now), URL, URLSearchParams, Promise, AbortController,
    localStorage: storage(store),
    fetch: async (url, opts = {}) => {
      fetches.push({ url: String(url), opts });
      const r = opts.method === "POST" ? response : chunkResponse || chunks[String(url)] || { status: 200, body: CHUNK };
      if (r.pending) return new Promise(() => {});
      if (r.error) throw r.error;
      const headers = r.headers || {};
      return {
        status: r.status, ok: r.status >= 200 && r.status < 300,
        redirected: !!r.redirected,
        url: r.url || new URL(url, location.href).href,
        headers: { get: (key) => Object.entries(headers).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] || null },
        text: async () => r.body || "",
      };
    },
    Image: function () {
      Object.defineProperty(this, "src", { set: (url) => fetches.push({ url, opts: { beacon: true } }) });
    },
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.active = false; },
    console: { log() {}, error() {} },
  };
  vm.createContext(context);
  function run() { vm.runInContext(source(qxStore), context, { timeout: 1000 }); }
  async function settle() {
    // Only short scheduling timers are fired. Timeouts and cooldowns are not advanced.
    for (let round = 0; round < 30; round++) {
      for (const timer of timers.filter((t) => t.active && t.ms < 5000)) {
        timer.active = false;
        timer.callback();
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return { context, store, fetches, win, timers, run, settle };
}

test("QX scheduler works when $request is not defined", async () => {
  const r = qx({ request: "absent" });
  assert.equal(r.done.length, 1);
  assert.equal(r.fetches.length, 0);
});

test("Cloudflare challenge HTML is left untouched", () => {
  for (const response of [
    { statusCode: 403, body: CF_HTML },
    { statusCode: 200, headers: { "CF-Mitigated": "challenge" }, body: CF_HTML },
    { statusCode: 503, body: CF_HTML },
  ]) {
    const r = qx({ response, request: { url: "https://re0.me/" } });
    assert.equal(r.done.length, 1);
    assert.equal(typeof r.done[0]?.body, "undefined");
  }
});

test("valid Next.js page is injected only once", () => {
  const first = qx({ response: { statusCode: 200, body: PAGE_HTML } });
  assert.match(first.done[0].body, /id="re0-auto-checkin"/);
  const second = qx({ response: { statusCode: 200, body: first.done[0].body } });
  assert.equal(typeof second.done[0]?.body, "undefined");
});

test("403 does not mark a failed check-in as completed", async () => {
  const b = browser({ response: { status: 403, body: CF_HTML, headers: { "cf-mitigated": "challenge" } } });
  b.run();
  await b.settle();
  assert.equal(b.store[LS_DATE], undefined);
  assert.equal(b.win.__re0Checkin?.ok, false);
  assert.equal(b.win.reloads || 0, 0);
  const again = browser({ store: b.store });
  again.run();
  await again.settle();
  assert.equal(again.fetches.length, 0, "failed request should enter a cooldown");
});

test("challenge on a chunk stops discovery immediately", async () => {
  const b = browser({
    scripts: [LAYOUT, "https://re0.me/_next/static/chunks/second.js"],
    chunkResponse: { status: 403, body: CF_HTML, headers: { "cf-mitigated": "challenge" } },
  });
  b.run();
  await b.settle();
  assert.equal(b.fetches.filter((f) => !f.opts.beacon).length, 1);
  assert.equal(b.store[LS_DATE], undefined);
});

test("stale action never automatically reloads the page", async () => {
  const store = {};
  for (let i = 0; i < 2; i++) {
    const b = browser({ store, response: { status: 404, body: "action not found" } });
    b.run();
    await b.settle();
    assert.equal(b.win.reloads || 0, 0);
    assert.equal(store[LS_DATE], undefined);
  }
});

test("duplicate injection in the same document makes one POST", async () => {
  const b = browser();
  b.run();
  b.run();
  await b.settle();
  assert.equal(b.fetches.filter((f) => f.opts.method === "POST").length, 1);
});

test("discovery excludes external scripts and has a request budget", async () => {
  const scripts = ["https://example.org/tracker.js", ...Array.from({ length: 20 }, (_, i) => `https://re0.me/_next/static/chunks/${i}.js`)];
  const b = browser({ scripts, chunkResponse: { status: 200, body: "no action here" } });
  b.run();
  await b.settle();
  assert.ok(b.fetches.every((f) => f.opts.beacon || f.url.startsWith("https://re0.me/_next/static/chunks/")));
  assert.ok(b.fetches.filter((f) => !f.opts.beacon).length <= 6);
  assert.equal(b.store[LS_DATE], undefined);
});

test("HTTP failure cannot be turned into success by body text", async () => {
  const b = browser({ response: { status: 403, body: SUCCESS } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.ok, false);
  assert.equal(b.store[LS_DATE], undefined);
});

test("business failure mentioning points is not success", async () => {
  const failure = '{"success":false,"message":"签到失败，积分不足","code":"400"}';
  const b = browser({ response: { status: 200, body: failure } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.ok, false);
  assert.equal(b.store[LS_DATE], undefined);
  const r = qx({ apiKey: true, queued: [{ statusCode: 200, body: failure }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
});

test("OpenAPI respects Retry-After and does not replay a web action", async () => {
  const store = {};
  const r = qx({ apiKey: true, store, queued: [{ statusCode: 429, headers: { "Retry-After": "3600" }, body: '{"message":"Too many requests"}' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.fetches.length, 1);
  assert.equal(r.done.length, 1);
  const again = qx({ apiKey: true, store, now: NOW + 10 * 60 * 1000, queued: [{ statusCode: 200, body: SUCCESS }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(again.fetches.length, 0);
  assert.equal(store[DATE_KEY], undefined);
});

test("successful check-in keeps daily deduplication", async () => {
  const b = browser();
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.ok, true);
  assert.equal(b.store[LS_DATE], TODAY);
  const next = browser({ store: b.store });
  next.run();
  await next.settle();
  assert.equal(next.fetches.length, 0);
});

test("old unverified daily marker does not suppress a real attempt", async () => {
  const b = browser({ store: { [LS_DATE]: TODAY } });
  b.run();
  await b.settle();
  assert.equal(b.fetches.filter((f) => f.opts.method === "POST").length, 1);
  assert.equal(b.win.__re0Checkin?.ok, true);
});

test("two pages sharing storage do not overlap while an attempt is pending", async () => {
  const store = {};
  const first = browser({ store });
  const second = browser({ store });
  first.run();
  second.run();
  await first.settle();
  await second.settle();
  assert.equal(first.fetches.filter((f) => f.opts.method === "POST").length, 1);
  assert.equal(second.fetches.length, 0);
});

test("storage failure stops automatic requests", async () => {
  const b = browser();
  b.context.localStorage.setItem = () => { throw new Error("storage disabled"); };
  b.run();
  await b.settle();
  assert.equal(b.fetches.length, 0);
});

test("page RSC component success is not a check-in result", async () => {
  const b = browser({ response: {
    status: 200,
    body: '2:"$Sreact.fragment"\n26:{"response":{"success":true,"data":null,"meta":null}}\n',
  } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.ok, false);
  assert.equal(b.store[LS_DATE], undefined);
  assert.equal(b.fetches.filter((f) => f.opts.method === "POST").length, 1);
});

test("structured already-signed result is accepted on HTTP 400", async () => {
  const body = '1:{"error":{"success":false,"message":"签到失败","description":"你已经签到过了，明天再来吧","code":"400"}}';
  const b = browser({ response: { status: 400, body } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.already, true);
  assert.equal(b.store[LS_DATE], TODAY);
});

test("token-invalid result makes one request without an automatic token retry", async () => {
  const b = browser({ response: {
    status: 409,
    body: '{"success":false,"code":"action_token_invalid","message":"安全验证已更新，请重试"}',
  } });
  b.run();
  await b.settle();
  assert.equal(b.fetches.filter((f) => f.opts.method === "POST").length, 1);
  assert.equal(b.win.__re0Checkin?.code, "TOKEN_INVALID");
  assert.equal(b.store[LS_DATE], undefined);
});

test("action discovery never associates checkIn with a neighbouring reference", async () => {
  const other = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b = browser({ chunkResponse: {
    status: 200,
    body: `(0,e.createServerReference)("${other}",x,"otherAction"); (0,e.createServerReference)("${ACTION}",x,"checkIn")`,
  } });
  b.run();
  await b.settle();
  assert.equal(b.fetches.find((f) => f.opts.method === "POST").opts.headers["Next-Action"], ACTION);
});

test("same deployment reuses the action cache after a cooldown", async () => {
  const first = browser({ response: { status: 409, body: '{"success":false,"code":"action_token_invalid","message":"安全验证已更新"}' } });
  first.run();
  await first.settle();
  const next = browser({ store: first.store, now: NOW + 6 * 60 * 1000 });
  next.run();
  await next.settle();
  assert.equal(next.fetches.filter((f) => !f.opts.beacon).length, 1);
  assert.equal(next.win.__re0Checkin?.ok, true);
});

test("changed deployment and stale actions invalidate the cached reference", async () => {
  const first = browser({ response: { status: 404, body: "action not found" } });
  first.run();
  await first.settle();
  const next = browser({
    store: first.store, now: NOW + 6 * 60 * 1000,
    scripts: [LAYOUT.replace("fixture", "next-deployment")],
  });
  next.run();
  await next.settle();
  assert.equal(next.fetches.filter((f) => !f.opts.beacon).length, 2);
  assert.equal(next.win.__re0Checkin?.ok, true);
});

test("browser Retry-After HTTP date is respected across visits", async () => {
  const first = browser({ response: {
    status: 429, body: "rate limited",
    headers: { "Retry-After": new Date(NOW + 60 * 60 * 1000).toUTCString() },
  } });
  first.run();
  await first.settle();
  const tooEarly = browser({ store: first.store, now: NOW + 30 * 60 * 1000 });
  tooEarly.run();
  await tooEarly.settle();
  assert.equal(tooEarly.fetches.length, 0);
  const ready = browser({ store: first.store, now: NOW + 61 * 60 * 1000 });
  ready.run();
  await ready.settle();
  assert.equal(ready.win.__re0Checkin?.ok, true);
});

test("a stalled POST times out without a reload or success marker", async () => {
  const b = browser({ response: { pending: true } });
  b.run();
  await b.settle();
  const timeouts = b.timers.filter((t) => t.active && t.ms >= 10000);
  assert.equal(timeouts.length, 1);
  timeouts[0].callback();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.code, "TIMEOUT");
  assert.equal(b.store[LS_DATE], undefined);
  assert.equal(b.win.reloads || 0, 0);
  assert.equal(b.fetches.filter((f) => f.opts.method === "POST").length, 1);
});

test("API uses local dual authorization, isolates cookies and never replays a web action on 401", async () => {
  const store = { re0_api_key: "fixture-secret-key", re0_access_token: AUTH.accessToken };
  const r = qx({ store, queued: [{ statusCode: 401, body: '{"success":false,"message":"Invalid API key"}' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].headers["X-API-Key"], "fixture-secret-key");
  assert.equal(r.fetches[0].headers.Authorization, "Bearer " + AUTH.accessToken);
  assert.equal(r.fetches[0].headers.Cookie, undefined);
  assert.equal(r.fetches[0].opts["auto-cookie"], false);
  assert.equal(r.fetches[0].opts.redirection, false);
  assert.equal(r.done.length, 1);
  assert.ok(r.logs.every((line) => !line.includes("fixture-secret-key") && !line.includes("Invalid API key")));
  assert.ok(!source().includes("fixture-secret-key"));
});

test("report echo decodes spaces, rejects stale dates and suppresses duplicate notifications", () => {
  const store = {};
  const url = `https://re0.me/re0-checkin-report.gif?ok=1&already=0&msg=check+in+success&d=${TODAY}`;
  const first = qx({ store, request: { url } });
  assert.equal(first.notifications[0][2], "check in success");
  assert.equal(store[DATE_KEY], TODAY);
  const next = qx({ store, request: { url } });
  assert.equal(next.notifications.length, 0);
  assert.equal(next.fetches.length, 0);
  assert.equal(next.done[0].headers["Content-Type"], "image/gif");
  const staleStore = {};
  const stale = qx({ store: staleStore, request: { url: url.replace(TODAY, "2026-11-01") } });
  assert.equal(staleStore[DATE_KEY], undefined);
  assert.equal(stale.notifications.length, 0);
});

test("normal page keeps its nonce and challenge-looking pages receive no injection", () => {
  const html = PAGE_HTML.replace("<script src=", '<script nonce="fixtureNonce123" src=');
  const normal = qx({ response: { statusCode: 200, body: "\n" + html } });
  assert.match(normal.done[0].body, /id="re0-auto-checkin" nonce="fixtureNonce123"/);
  const challenge = qx({ response: { statusCode: 200, headers: { "cf-mitigated": "challenge" }, body: html } });
  assert.equal(typeof challenge.done[0]?.body, "undefined");
});

test("misconfigured request-header rewrite is passive", () => {
  const r = qx({ apiKey: true, request: { url: "https://re0.me/", headers: { Cookie: "fixture-session" } } });
  assert.equal(r.fetches.length, 0);
  assert.equal(r.done.length, 1);
  assert.equal(r.notifications.length, 0);
  assert.ok(Object.values(r.store).every((value) => !value.includes("fixture-session")));
});

test("login HTML on a chunk stops discovery without a POST", async () => {
  const b = browser({
    scripts: [LAYOUT, "https://re0.me/_next/static/chunks/second.js"],
    chunkResponse: { status: 200, body: "<!DOCTYPE html><html><body>login</body></html>", headers: { "Content-Type": "text/html" } },
  });
  b.run();
  await b.settle();
  assert.equal(b.fetches.filter((f) => !f.opts.beacon).length, 1);
  assert.equal(b.win.__re0Checkin?.code, "HTML_RESPONSE");
  assert.equal(b.store[LS_DATE], undefined);
});

test("API response crossing China midnight cannot mark the new day completed", async () => {
  const beforeMidnight = Date.parse("2026-11-02T15:59:59Z");
  const r = qx({ apiKey: true, now: beforeMidnight, queued: [{ statusCode: 200, body: '{"success":true,"data":{"checked_in":true,"message":"签到成功"}}' }] });
  r.context.Date = fixedDate(beforeMidnight + 2000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.store[DATE_KEY], "2026-11-02");
  assert.equal(r.done.length, 1);
});

test("importing either gallery does not install an HTTPS rewrite or enable RE0 MitM", () => {
  for (const name of ["re0.qx.inject", "re0.qx"]) {
    const gallery = JSON.parse(fs.readFileSync(path.join(__dirname, `../gallery/${name}.gallery.json`), "utf8"));
    assert.equal(gallery.task.length, 1);
    assert.match(gallery.task[0].config, /^0 9 \* \* \* https:\/\/raw\.githubusercontent\.com\/[^/]+\/quantumultx-scripts\/main\/scripts\/re0\.qx\.checkin\.js#force-timeout=60000,/);
    assert.ok(!gallery.task[0].config.includes("re0.qx.inject.js"));
    assert.equal(gallery.task[0].addons, undefined, "task import must not attach a RE0 HTTPS rewrite");
    assert.match(gallery.description, /OpenAPI/);
    assert.match(gallery.description, /Access Token/);
    assert.match(gallery.description, /本地授权助手/);
  }
});

test("legacy rewrite subscriptions do not publish active RE0 HTTPS rules or positive MitM hosts", () => {
  for (const name of ["re0.qx", "re0.qx.inject"]) {
    const lines = fs.readFileSync(path.join(__dirname, `../rewrite/${name}.snippet`), "utf8")
      .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[;#]/.test(line));
    for (const line of lines) {
      assert.ok(!/\surl\s/.test(line), "retired subscription must not publish URL rewrite rules");
      if (/^hostname\s*=/i.test(line)) {
        const hosts = line.replace(/^hostname\s*=\s*(?:%APPEND%\s*)?/i, "").split(",").map((host) => host.trim()).filter(Boolean);
        assert.ok(hosts.every((host) => host.startsWith("-")), "retired subscription must not add a positive MitM hostname");
      }
    }
  }
});

test("missing OpenAPI authorization does not promise automatic browser check-in or send a request", () => {
  const r = qx({ request: "absent" });
  assert.equal(r.fetches.length, 0);
  assert.equal(r.done.length, 1);
  const message = r.notifications.flat().join(" ");
  assert.match(message, /re0\.qx\.setup\.js/);
  assert.match(message, /手动签到/);
  assert.ok(!/或打开首页|页面签到|打开.*首页.*也可/.test(message));
});

test("unrelated points component cannot override the check-in business result", async () => {
  const component = '26:{"response":{"success":true,"message":"积分榜加载完成","code":"200"}}';
  const withoutCheckin = browser({ response: { status: 200, body: component } });
  withoutCheckin.run();
  await withoutCheckin.settle();
  assert.equal(withoutCheckin.win.__re0Checkin?.ok, false);
  assert.equal(withoutCheckin.store[LS_DATE], undefined);
  const withCheckin = browser({ response: { status: 200, body: SUCCESS + "\n" + component } });
  withCheckin.run();
  await withCheckin.settle();
  assert.equal(withCheckin.win.__re0Checkin?.ok, true);
  assert.match(withCheckin.win.__re0Checkin.msg, /签到成功/);
});

test("OpenAPI accepts the local dual-auth record and sends the user Bearer token", async () => {
  const store = authStore();
  const r = qx({ store, queued: [{ statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.equal(r.fetches.length, 1);
  const request = r.fetches[0];
  assert.equal(request.url, API_URL);
  assert.equal(request.method, "POST");
  assert.equal(request.headers["X-API-Key"], AUTH.apiKey);
  assert.equal(request.headers.Authorization, "Bearer " + AUTH.accessToken);
  assert.equal(request.headers.Cookie, undefined);
  assert.equal(request.headers["Next-Action"], undefined);
  assert.deepEqual(JSON.parse(request.body), { is_gambler: false });
  assert.equal(request.opts["auto-cookie"], false);
  assert.equal(request.opts.redirection, false);
  assert.equal(r.store[DATE_KEY], TODAY);
  assert.equal(r.done.length, 1);
});

test("an API key without a user token does not start a request", async () => {
  const r = qx({ store: { re0_api_key: AUTH.apiKey }, queued: [{ statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.equal(r.fetches.length, 0);
  assert.equal(r.store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
  assert.match(r.notifications[0].join(" "), /用户|授权|Token/);
});

test("separate legacy auth keys remain usable and can refresh a missing access token", async () => {
  const store = {
    re0_api_key: AUTH.apiKey,
    re0_access_token: "",
    re0_refresh_token: AUTH.refreshToken,
  };
  const r = qx({ store, queued: [refreshResponse(), { statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.deepEqual(r.fetches.map((req) => req.url), [REFRESH_URL, API_URL]);
  assert.deepEqual(JSON.parse(r.fetches[0].body), { refresh_token: AUTH.refreshToken });
  assert.equal(r.fetches[1].headers.Authorization, "Bearer offline-rotated-access");
  assert.equal(JSON.parse(store[AUTH_KEY]).refreshToken, "offline-rotated-refresh");
  assert.equal(r.done.length, 1);
});

test("expired or missing access authorization refreshes first and saves token rotation", async () => {
  for (const overrides of [
    { expiresAt: NOW - 1000 },
    { accessToken: "", expiresAt: 0 },
  ]) {
    const store = authStore(overrides);
    const r = qx({ store, queued: [refreshResponse(), { statusCode: 200, body: SUCCESS }] });
    await settleQx();
    assert.deepEqual(r.fetches.map((req) => req.url), [REFRESH_URL, API_URL]);
    const refresh = r.fetches[0];
    assert.equal(refresh.method, "POST");
    assert.equal(refresh.headers["X-API-Key"], AUTH.apiKey);
    assert.equal(refresh.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(refresh.body), { refresh_token: AUTH.refreshToken });
    assert.equal(refresh.opts["auto-cookie"], false);
    assert.equal(refresh.opts.redirection, false);
    assert.equal(r.fetches[1].headers.Authorization, "Bearer offline-rotated-access");
    const saved = JSON.parse(store[AUTH_KEY]);
    assert.equal(saved.apiKey, AUTH.apiKey);
    assert.equal(saved.accessToken, "offline-rotated-access");
    assert.equal(saved.refreshToken, "offline-rotated-refresh");
    assert.equal(saved.expiresAt, NOW + 3600 * 1000);
    assert.equal(store[DATE_KEY], TODAY);
    assert.equal(r.done.length, 1);
  }
});

test("401 user-token failure refreshes once and retries only the OpenAPI check-in", async () => {
  const r = qx({
    store: authStore(),
    queued: [
      { statusCode: 401, body: '{"success":false,"code":"TOKEN_EXPIRED","message":"User token expired"}' },
      refreshResponse(),
      { statusCode: 200, body: SUCCESS },
    ],
  });
  await settleQx();
  assert.deepEqual(r.fetches.map((req) => req.url), [API_URL, REFRESH_URL, API_URL]);
  assert.equal(r.fetches[0].headers.Authorization, "Bearer " + AUTH.accessToken);
  assert.equal(r.fetches[2].headers.Authorization, "Bearer offline-rotated-access");
  assert.ok(r.fetches.every((req) => !req.headers.Cookie && !req.headers["Next-Action"]));
  assert.equal(r.store[DATE_KEY], TODAY);
  assert.equal(r.done.length, 1);
});

test("a second 401 stops instead of entering an unbounded refresh loop", async () => {
  const unauthorized = { statusCode: 401, body: '{"success":false,"code":"TOKEN_EXPIRED"}' };
  const r = qx({ store: authStore(), queued: [unauthorized, refreshResponse(), unauthorized, refreshResponse()] });
  await settleQx();
  assert.deepEqual(r.fetches.map((req) => req.url), [API_URL, REFRESH_URL, API_URL]);
  assert.equal(r.store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
});

test("401 invalid application key and HTTP 403 or 429 do not trigger a user-token refresh", async () => {
  for (const response of [
    { statusCode: 401, body: '{"success":false,"code":"INVALID_API_KEY","message":"Invalid API key"}' },
    { statusCode: 403, body: '{"success":false,"message":"Access denied"}' },
    { statusCode: 429, headers: { "Retry-After": "3600" }, body: '{"success":false,"message":"Rate limited"}' },
  ]) {
    const store = authStore();
    const before = store[AUTH_KEY];
    const r = qx({ store, queued: [response, refreshResponse()] });
    await settleQx();
    assert.deepEqual(r.fetches.map((req) => req.url), [API_URL]);
    assert.equal(store[AUTH_KEY], before);
    assert.equal(store[DATE_KEY], undefined);
    assert.equal(r.done.length, 1);
  }
});

test("failed refresh or failed rotation persistence cannot proceed to check-in", async () => {
  const badRefreshes = [
    { statusCode: 401, body: '{"success":false,"code":"INVALID_REFRESH_TOKEN"}' },
    { statusCode: 200, body: '{"success":false,"message":"Refresh failed"}' },
    { statusCode: 200, body: '{"success":true,"data":{"refresh_token":"only-refresh-no-access"}}' },
    { statusCode: 200, body: "not JSON" },
  ];
  for (const response of badRefreshes) {
    const store = authStore({ expiresAt: NOW - 1000 });
    const before = store[AUTH_KEY];
    const r = qx({ store, queued: [response, { statusCode: 200, body: SUCCESS }] });
    await settleQx();
    assert.deepEqual(r.fetches.map((req) => req.url), [REFRESH_URL]);
    assert.equal(store[AUTH_KEY], before);
    assert.equal(store[DATE_KEY], undefined);
    assert.equal(r.done.length, 1);
  }
  const store = authStore({ expiresAt: NOW - 1000 });
  const before = store[AUTH_KEY];
  const r = qx({
    store,
    queued: [refreshResponse(), { statusCode: 200, body: SUCCESS }],
    writeResult: (value, key) => key !== AUTH_KEY,
  });
  await settleQx();
  assert.deepEqual(r.fetches.map((req) => req.url), [REFRESH_URL]);
  assert.equal(store[AUTH_KEY], before);
  assert.equal(store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
  assert.match(r.notifications[0].join(" "), /保存|存储/);
});

test("API and browser use data.message before the envelope message", async () => {
  for (const fixture of [
    { success: true, message: "尚未签到", data: { checked_in: true, message: "签到成功，获得 10 积分" } },
    { success: true, message: "签到成功", data: { checked_in: false, message: "尚未签到" } },
  ]) {
    const body = JSON.stringify(fixture);
    const r = qx({ store: authStore(), queued: [{ statusCode: 200, body }] });
    await settleQx();
    assert.equal(r.notifications[0][2], fixture.data.message);
    assert.equal(r.store[DATE_KEY], fixture.data.checked_in ? TODAY : undefined);
    const b = browser({ response: { status: 200, body: "1:" + JSON.stringify({ response: fixture }) } });
    b.run();
    await b.settle();
    assert.equal(b.win.__re0Checkin?.msg, fixture.data.message);
    assert.equal(b.win.__re0Checkin?.ok, fixture.data.checked_in);
    assert.equal(b.store[LS_DATE], fixture.data.checked_in ? TODAY : undefined);
  }
});

test("typed checked_in false with numeric zero points confirms already signed in", async () => {
  const fixture = { success: true, data: { checked_in: false, points: 0, message: "OK" } };
  const r = qx({ store: authStore(), queued: [{ statusCode: 200, body: JSON.stringify(fixture) }] });
  await settleQx();
  assert.equal(r.store[DATE_KEY], TODAY);
  assert.match(r.notifications[0][1], /已经签过/);
  const b = browser({ response: { status: 200, body: "1:" + JSON.stringify({ response: fixture }) } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.already, true);
  assert.equal(b.store[LS_DATE], TODAY);
});

test("negative check-in state and generic tomorrow text never mark completion", async () => {
  for (const fixture of [
    { success: false, message: "尚未签到" },
    { success: false, message: "明天再来" },
    { success: true, data: { checked_in: false, message: "OK" } },
    { success: true, data: { checked_in: false, points: "0", message: "OK" } },
    { success: true, data: { checked_in: false, points: 0, message: "尚未签到" } },
    { success: false, data: { checked_in: false, points: 0, message: "明天再来" } },
    { success: false, message: "签到失败，积分不足" },
  ]) {
    for (const status of [200, 409]) {
      const body = JSON.stringify(fixture);
      const r = qx({ store: authStore(), queued: [{ statusCode: status, body }] });
      await settleQx();
      assert.equal(r.store[DATE_KEY], undefined, body);
      assert.equal(r.done.length, 1);
      const b = browser({ response: { status, body: "1:" + JSON.stringify({ response: fixture }) } });
      b.run();
      await b.settle();
      assert.equal(b.win.__re0Checkin?.ok, false, body);
      assert.notEqual(b.win.__re0Checkin?.already, true, body);
      assert.equal(b.store[LS_DATE], undefined, body);
    }
  }
});

test("action row 1 wins over unrelated UI check-in failures or success labels", async () => {
  const uiFailure = '26:{"response":{"success":false,"message":"签到组件未加载","code":"400"},"props":{"children":"签到"}}';
  for (const body of [SUCCESS + "\n" + uiFailure, uiFailure + "\n" + SUCCESS]) {
    const b = browser({ response: { status: 200, body } });
    b.run();
    await b.settle();
    assert.equal(b.win.__re0Checkin?.ok, true);
    assert.match(b.win.__re0Checkin.msg, /签到成功/);
    assert.equal(b.store[LS_DATE], TODAY);
  }
  const actionFailure = '1:{"response":{"success":false,"message":"尚未签到","code":"400"}}';
  const uiSuccess = '26:{"response":{"success":true,"message":"签到成功","code":"200"},"props":{"children":"签到"}}';
  for (const body of [actionFailure + "\n" + uiSuccess, uiSuccess + "\n" + actionFailure, uiSuccess]) {
    const b = browser({ response: { status: 200, body } });
    b.run();
    await b.settle();
    assert.equal(b.win.__re0Checkin?.ok, false);
    assert.equal(b.store[LS_DATE], undefined);
  }
});

test("Flight action references choose the referenced record instead of unrelated row 1", async () => {
  const body = '0:{"a":"$@a","f":"","b":"fixture"}\n1:{"response":{"success":false,"message":"尚未签到"}}\na:{"response":{"success":true,"data":{"checked_in":true,"message":"签到成功"}}}';
  const b = browser({ response: { status: 200, body } });
  b.run();
  await b.settle();
  assert.equal(b.win.__re0Checkin?.ok, true);
  assert.equal(b.store[LS_DATE], TODAY);
});

test("authorization capture is passive, case insensitive and clears another user's refresh token", () => {
  const store = authStore();
  const r = qx({
    store,
    request: {
      url: API_URL, method: "POST",
      headers: {
        "x-api-key": AUTH.apiKey,
        authorization: "Bearer offline-another-user",
        Cookie: "offline-browser-cookie",
      },
    },
  });
  const saved = JSON.parse(store[AUTH_KEY]);
  assert.equal(saved.apiKey, AUTH.apiKey);
  assert.equal(saved.accessToken, "offline-another-user");
  assert.equal(saved.refreshToken, "");
  assert.equal(r.fetches.length, 0);
  assert.equal(r.done.length, 1);
  assert.equal(typeof r.done[0]?.headers, "undefined");
  assert.ok(!JSON.stringify(store).includes("offline-browser-cookie"));
});

test("successful refresh-response capture saves rotation and leaves the response untouched", () => {
  const store = authStore();
  const response = refreshResponse();
  const r = qx({
    store,
    request: {
      url: REFRESH_URL, method: "POST",
      headers: { "X-API-Key": AUTH.apiKey },
    },
    response,
  });
  const saved = JSON.parse(store[AUTH_KEY]);
  assert.equal(saved.accessToken, "offline-rotated-access");
  assert.equal(saved.refreshToken, "offline-rotated-refresh");
  assert.equal(r.fetches.length, 0);
  assert.equal(r.done.length, 1);
  assert.equal(typeof r.done[0]?.body, "undefined");
});

test("unrelated URLs cannot capture authorization or rewrite an API response", () => {
  for (const url of [
    "https://example.org/api/open/checkin",
    "https://re0.me.evil/api/open/checkin",
    "https://re0.me/cdn-cgi/challenge-platform/api/open/checkin",
    REFRESH_URL + "/extra",
  ]) {
    const store = authStore();
    const before = store[AUTH_KEY];
    const r = qx({
      store,
      request: { url, method: "POST", headers: { "X-API-Key": AUTH.apiKey, Authorization: "Bearer another-user" } },
      response: refreshResponse(),
    });
    assert.equal(store[AUTH_KEY], before);
    assert.equal(r.fetches.length, 0);
    assert.equal(r.done.length, 1);
    assert.equal(typeof r.done[0]?.body, "undefined");
  }
});

test("saved authorization never appears in logs, notifications or injected page source", async () => {
  const secrets = [AUTH.apiKey, AUTH.accessToken, AUTH.refreshToken];
  const failure = JSON.stringify({ success: false, message: "签到失败 " + secrets.join(" ") });
  const r = qx({ store: authStore(), queued: [{ statusCode: 200, body: failure }] });
  await settleQx();
  const page = qx({
    store: authStore(),
    request: { url: "https://re0.me/" },
    response: { statusCode: 200, body: PAGE_HTML },
  });
  const emitted = JSON.stringify([r.logs, r.notifications, page.logs, page.notifications, page.done[0].body]);
  for (const secret of secrets) assert.ok(!emitted.includes(secret));
  assert.equal(r.done.length, 1);
  const failedNetwork = qx({
    store: authStore(),
    queued: [{ error: { error: "Network error " + secrets.join(" ") } }],
  });
  await settleQx();
  for (const secret of secrets) {
    assert.ok(!JSON.stringify([failedNetwork.logs, failedNetwork.notifications]).includes(secret));
  }
  assert.equal(failedNetwork.done.length, 1);
});

test("a QX watchdog stops late API results from starting a refresh or marking success", async () => {
  let release;
  const r = qx({ store: authStore() });
  r.context.$task.fetch = (request) => {
    r.fetches.push(request);
    return new Promise((resolve) => { release = resolve; });
  };
  await settleQx();
  const watchdog = r.timers.find((timer) => timer.active && timer.ms >= 10000);
  assert.ok(watchdog);
  watchdog.callback();
  assert.equal(r.done.length, 1);
  release({ statusCode: 401, body: '{"success":false,"code":"TOKEN_EXPIRED"}' });
  await settleQx();
  assert.equal(r.fetches.length, 1);
  assert.equal(r.store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
});

test("capturing user B never inherits user A's legacy refresh token for a 401", async () => {
  const store = {
    re0_api_key: AUTH.apiKey,
    re0_access_token: "offline-legacy-user-a-access",
    re0_refresh_token: "offline-legacy-user-a-refresh",
  };
  const captured = qx({
    store,
    request: {
      url: API_URL, method: "POST",
      headers: { "X-API-Key": AUTH.apiKey, Authorization: "Bearer offline-user-b-access" },
    },
  });
  assert.equal(captured.fetches.length, 0);
  assert.equal(JSON.parse(store[AUTH_KEY]).accessToken, "offline-user-b-access");
  assert.equal(JSON.parse(store[AUTH_KEY]).refreshToken, "");
  const signed = qx({
    store,
    queued: [
      { statusCode: 401, body: '{"success":false,"code":"TOKEN_EXPIRED"}' },
      refreshResponse(),
    ],
  });
  await settleQx();
  assert.deepEqual(signed.fetches.map((req) => req.url), [API_URL]);
  assert.equal(signed.fetches[0].headers.Authorization, "Bearer offline-user-b-access");
  assert.notEqual(store[DATE_KEY], TODAY);
  assert.equal(signed.done.length, 1);
});

test("a refresh-only canonical record refreshes first instead of borrowing legacy access authorization", async () => {
  const store = {
    ...authStore({ accessToken: "", refreshToken: "offline-user-b-refresh", expiresAt: 0 }),
    re0_api_key: AUTH.apiKey,
    re0_access_token: "offline-legacy-user-a-access",
    re0_refresh_token: "offline-legacy-user-a-refresh",
  };
  const r = qx({ store, queued: [refreshResponse(), { statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.deepEqual(r.fetches.map((req) => req.url), [REFRESH_URL, API_URL]);
  assert.deepEqual(JSON.parse(r.fetches[0].body), { refresh_token: "offline-user-b-refresh" });
  assert.equal(r.fetches[1].headers.Authorization, "Bearer offline-rotated-access");
  assert.ok(r.fetches.every((req) => !JSON.stringify(req).includes("offline-legacy-user-a")));
  assert.equal(r.done.length, 1);
});

test("intentionally empty canonical user authorization does not resurrect legacy credentials", async () => {
  const store = {
    ...authStore({ accessToken: "", refreshToken: "", expiresAt: 0 }),
    re0_api_key: AUTH.apiKey,
    re0_access_token: "offline-legacy-user-a-access",
    re0_refresh_token: "offline-legacy-user-a-refresh",
  };
  const r = qx({ store, queued: [{ statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.equal(r.fetches.length, 0);
  assert.equal(r.store[DATE_KEY], undefined);
  assert.equal(r.done.length, 1);
});

test("partial refresh capture without a request body preserves the entire local record and daily state", () => {
  for (const tokens of [
    { access_token: "offline-partial-access", refresh_token: undefined },
    { access_token: undefined, refresh_token: "offline-partial-refresh" },
    { access_token: "offline-partial-access", refresh_token: "" },
  ]) {
    const store = {
      ...authStore({ revision: "offline-original-generation" }),
      [DATE_KEY]: TODAY,
      [VERIFIED_KEY]: TODAY,
      [WAIT_KEY]: String(NOW + 3600 * 1000),
    };
    const before = { ...store };
    const r = qx({
      store,
      request: { url: REFRESH_URL, method: "POST", headers: { "X-API-Key": AUTH.apiKey } },
      response: refreshResponse(tokens),
    });
    assert.deepEqual(store, before);
    assert.equal(r.writes.length, 0);
    assert.equal(r.fetches.length, 0);
    assert.equal(r.done.length, 1);
    assert.equal(typeof r.done[0]?.body, "undefined");
  }
});

test("complete refresh capture resets daily markers only when credentials change", () => {
  for (const changed of [false, true]) {
    const store = {
      ...authStore({ revision: "offline-previous-generation" }),
      [DATE_KEY]: TODAY,
      [VERIFIED_KEY]: TODAY,
      [WAIT_KEY]: String(NOW + 3600 * 1000),
    };
    const access = changed ? "offline-new-user-access" : AUTH.accessToken;
    const refresh = changed ? "offline-new-user-refresh" : AUTH.refreshToken;
    const r = qx({
      store,
      request: { url: REFRESH_URL, method: "POST", headers: { "X-API-Key": AUTH.apiKey } },
      response: refreshResponse({ access_token: access, refresh_token: refresh, expires_in: 1800 }),
    });
    const saved = JSON.parse(store[AUTH_KEY]);
    assert.equal(saved.accessToken, access);
    assert.equal(saved.refreshToken, refresh);
    assert.equal(typeof saved.revision, "string");
    assert.ok(saved.revision);
    assert.notEqual(saved.revision, "offline-previous-generation");
    assert.equal(store[DATE_KEY], changed ? "" : TODAY);
    assert.equal(store[VERIFIED_KEY], changed ? "" : TODAY);
    assert.equal(store[WAIT_KEY], changed ? "0" : String(NOW + 3600 * 1000));
    assert.equal(r.fetches.length, 0);
    assert.equal(r.done.length, 1);
    assert.equal(typeof r.done[0]?.body, "undefined");
  }
});

test("a pending OAuth response for user A cannot overwrite setup authorization for user B", async () => {
  const store = authStore({ expiresAt: NOW - 1000, revision: "offline-user-a-generation" });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const userA = qx({ store, queued: [pending, { statusCode: 200, body: SUCCESS }] });
  await settleQx();
  assert.deepEqual(userA.fetches.map((request) => request.url), [REFRESH_URL]);
  const userBAuth = {
    apiKey: AUTH.apiKey,
    accessToken: "offline-user-b-access",
    refreshToken: "offline-user-b-refresh",
  };
  setupAuth(store, userBAuth);
  const beforeLateResponse = { ...store };
  const writesBefore = userA.writes.length;
  release(refreshResponse({ access_token: "offline-stale-a-access", refresh_token: "offline-stale-a-refresh" }));
  await settleQx();
  assert.deepEqual(store, beforeLateResponse);
  assert.equal(userA.writes.length, writesBefore);
  assert.deepEqual(userA.fetches.map((request) => request.url), [REFRESH_URL]);
  assert.equal(JSON.parse(store[AUTH_KEY]).accessToken, userBAuth.accessToken);
  assert.equal(JSON.parse(store[AUTH_KEY]).refreshToken, userBAuth.refreshToken);
  assert.notEqual(store[DATE_KEY], TODAY);
  assert.equal(userA.notifications.length, 0);
  assert.equal(userA.done.length, 1);
  assert.ok(userA.logs.some((line) => line.includes("AUTH_CHANGED")));
});

test("late signer results cannot clear another run's cooldown or mark its current authorization complete", async () => {
  for (const nextAuth of [
    { ...AUTH, accessToken: "offline-user-b-access", refreshToken: "offline-user-b-refresh" },
    { ...AUTH },
  ]) {
    const store = authStore({ expiresAt: 0, revision: "offline-before-local-resave" });
    let releaseA;
    const pendingA = new Promise((resolve) => { releaseA = resolve; });
    const userA = qx({ store, queued: [pendingA, refreshResponse()] });
    await settleQx();
    assert.deepEqual(userA.fetches.map((request) => request.url), [API_URL]);
    setupAuth(store, nextAuth);
    let releaseB;
    const pendingB = new Promise((resolve) => { releaseB = resolve; });
    const userB = qx({ store, queued: [pendingB] });
    await settleQx();
    assert.deepEqual(userB.fetches.map((request) => request.url), [API_URL]);
    const beforeLateResponse = { ...store };
    const writesBefore = userA.writes.length;
    releaseA({ statusCode: 200, body: SUCCESS });
    await settleQx();
    assert.deepEqual(store, beforeLateResponse);
    assert.equal(userA.writes.length, writesBefore);
    assert.equal(userA.fetches.length, 1);
    assert.equal(userA.done.length, 1);
    assert.equal(userA.notifications.length, 0);
    assert.equal(userB.done.length, 0);
    assert.notEqual(store[DATE_KEY], TODAY);
    assert.ok(Number(store[WAIT_KEY]) > NOW);
    assert.ok(userA.logs.some((line) => line.includes("AUTH_CHANGED")));
    releaseB({ statusCode: 200, body: SUCCESS });
    await settleQx();
    assert.equal(userB.done.length, 1);
    assert.equal(store[DATE_KEY], TODAY);
    assert.equal(store[WAIT_KEY], "0");
  }
});

test("authorization replaced before the first async fetch sends no request for the obsolete user", async () => {
  const store = authStore({ revision: "offline-before-fetch" });
  const userA = qx({ store, queued: [{ statusCode: 200, body: SUCCESS }] });
  setupAuth(store, { apiKey: AUTH.apiKey, accessToken: "offline-user-b-access", refreshToken: "" });
  const beforeFetch = { ...store };
  const writesBefore = userA.writes.length;
  await settleQx();
  assert.equal(userA.fetches.length, 0);
  assert.equal(userA.writes.length, writesBefore);
  assert.deepEqual(store, beforeFetch);
  assert.equal(userA.done.length, 1);
  assert.ok(userA.logs.some((line) => line.includes("AUTH_CHANGED")));
});

test("an old browser generation report is ignored after local authorization replacement", async () => {
  const store = authStore({ revision: "offline-browser-generation-a" });
  const oldBrowser = browser({ qxStore: store });
  oldBrowser.run();
  await oldBrowser.settle();
  const beacon = oldBrowser.fetches.find((request) => request.opts.beacon);
  assert.ok(beacon);
  const url = new URL(beacon.url, "https://re0.me/").href;
  assert.equal(new URL(url).searchParams.get("g"), "offline-browser-generation-a");
  setupAuth(store, {
    apiKey: AUTH.apiKey,
    accessToken: "offline-user-b-access",
    refreshToken: "offline-user-b-refresh",
  });
  const before = { ...store };
  const report = qx({ store, request: { url } });
  assert.deepEqual(store, before);
  assert.equal(report.writes.length, 0);
  assert.equal(report.notifications.length, 0);
  assert.equal(report.fetches.length, 0);
  assert.equal(report.done.length, 1);
  assert.equal(report.done[0].headers["Content-Type"], "image/gif");
  const withoutGeneration = qx({ store, request: { url: url.replace(/&g=[^&]*/, "") } });
  assert.equal(withoutGeneration.writes.length, 0);
  assert.equal(withoutGeneration.notifications.length, 0);
  assert.deepEqual(store, before);
});

test("a current browser generation report confirms only the current local authorization", async () => {
  const store = {};
  setupAuth(store, AUTH);
  const currentGeneration = JSON.parse(store[AUTH_KEY]).revision;
  assert.ok(currentGeneration);
  const currentBrowser = browser({ qxStore: store });
  currentBrowser.run();
  await currentBrowser.settle();
  const beacon = currentBrowser.fetches.find((request) => request.opts.beacon);
  assert.ok(beacon);
  const url = new URL(beacon.url, "https://re0.me/").href;
  assert.equal(new URL(url).searchParams.get("g"), currentGeneration);
  const report = qx({ store, request: { url } });
  assert.equal(store[DATE_KEY], TODAY);
  assert.equal(store[VERIFIED_KEY], TODAY);
  assert.equal(report.notifications.length, 1);
  assert.equal(report.fetches.length, 0);
  assert.equal(report.done.length, 1);
  const repeated = qx({ store, request: { url } });
  assert.equal(repeated.notifications.length, 0);
  assert.equal(repeated.fetches.length, 0);
});

test("injected page configuration exposes only the nonsecret authorization revision", () => {
  const store = {};
  setupAuth(store, AUTH);
  const revision = JSON.parse(store[AUTH_KEY]).revision;
  const page = qx({
    store,
    request: { url: "https://re0.me/" },
    response: { statusCode: 200, body: PAGE_HTML },
  });
  assert.equal(page.done.length, 1);
  const generated = page.done[0].body;
  assert.match(generated, /id="re0-auto-checkin"/);
  assert.ok(generated.includes('"generation":' + JSON.stringify(revision)));
  for (const value of [AUTH.apiKey, AUTH.accessToken, AUTH.refreshToken]) {
    assert.ok(!generated.includes(value));
    assert.ok(!generated.includes(encodeURIComponent(value)));
    assert.ok(!JSON.stringify([page.logs, page.notifications]).includes(value));
  }
});
