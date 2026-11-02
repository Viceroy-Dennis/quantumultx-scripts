// Offline replay of the real QX entry point and the generated browser script.
// No live requests, cookies or API keys are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const script = fs.readFileSync(path.join(__dirname, "../scripts/re0.qx.inject.js"), "utf8");
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

function qx({ response, request, store = {}, apiKey, now = NOW, queued = [] } = {}) {
  const done = [];
  const fetches = [];
  const notifications = [];
  const logs = [];
  const context = {
    Date: fixedDate(now),
    URL,
    URLSearchParams,
    $prefs: {
      valueForKey: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setValueForKey: (value, key) => { store[key] = String(value); return true; },
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
  };
  if (request !== "absent") context.$request = request;
  if (response) context.$response = response;
  let code = script;
  if (apiKey) code = code.replace('const RE0_API_KEY = "";', 'const RE0_API_KEY = "fixture-api-key";');
  vm.createContext(context);
  vm.runInContext(code, context, { timeout: 1000 });
  return { context, done, fetches, notifications, logs, store };
}

function source() {
  const context = qx({ response: { statusCode: 200, body: PAGE_HTML } }).context;
  return vm.runInContext("injectedSource()", context);
}

function browser({
  store = {}, now = NOW, scripts = [LAYOUT],
  response = { status: 200, body: SUCCESS },
  chunks = {}, chunkResponse,
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
  function run() { vm.runInContext(source(), context, { timeout: 1000 }); }
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

test("API uses a local key, isolates cookies and never falls back on 401", async () => {
  const store = { re0_api_key: "fixture-secret-key" };
  const r = qx({ store, queued: [{ statusCode: 401, body: '{"success":false,"message":"Invalid API key"}' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].headers["X-API-Key"], "fixture-secret-key");
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

test("both gallery entries and snippets use the fixed script and only the intended URLs", () => {
  for (const name of ["re0.qx.inject", "re0.qx"]) {
    const gallery = JSON.parse(fs.readFileSync(path.join(__dirname, `../gallery/${name}.gallery.json`), "utf8"));
    assert.equal(gallery.task.length, 1);
    assert.match(gallery.task[0].config, /scripts\/re0\.qx\.inject\.js/);
    assert.ok(!gallery.task[0].config.includes("re0.qx.checkin.js"));
    const lines = fs.readFileSync(path.join(__dirname, `../rewrite/${name}.snippet`), "utf8").trim().split(/\r?\n/).filter((line) => !line.startsWith(";") && !line.startsWith("hostname"));
    assert.equal(lines.length, 2);
    const page = new RegExp(lines[0].split(" url ")[0]);
    const report = new RegExp(lines[1].split(" url ")[0]);
    for (const url of ["https://re0.me", "https://re0.me/", "https://re0.me/?ref=bookmark"]) assert.ok(page.test(url));
    for (const url of ["https://re0.me/_next/static/chunks/a.js", "https://re0.me/cdn-cgi/challenge-platform/a", "https://re0.me/re0-checkin-report.gif?ok=1"]) assert.ok(!page.test(url));
    assert.ok(report.test("https://re0.me/re0-checkin-report.gif?ok=1"));
    assert.ok(!report.test("https://re0.me/re0-checkin-report.gif.evil?ok=1"));
  }
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
