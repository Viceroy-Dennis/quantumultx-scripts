"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../scripts/wn4k.qx.checkin.js"), "utf8");
const STORE = "wn4k.checkin.accounts.v1";
const LOCK = "wn4k.checkin.lock.v1";
const BASE = Date.parse("2026-10-28T01:05:00Z");

function response(status = 200, body = { code: 1, msg: "Check-in successful" }, headers = {}) {
  return { statusCode: status, body: typeof body === "string" ? body : JSON.stringify(body), headers };
}

function request(id = "11", overrides = {}) {
  return Object.assign({
    url: "https://wn4k.com/user/ajax_sign.html",
    method: "POST",
    headers: { Cookie: "user_id=" + id + "; user_name=test" + id + "; session=SECRET" + id,
      "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "7", "X-Noise": "ignore" },
    body: "mode=daily"
  }, overrides);
}

async function execute(options = {}) {
  const store = options.store || new Map();
  const notifications = [];
  const requests = [];
  const logs = [];
  const waits = [];
  let time = options.time || BASE;
  let doneCount = 0;
  const queue = [...(options.responses || [])];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  let resolveDone;
  const complete = new Promise(resolve => { resolveDone = resolve; });
  const context = {
    Date: Clock,
    console: { log: value => logs.push(value) },
    setTimeout(callback, ms) {
      if (ms >= 100000) return { watchdog: true };
      waits.push(ms);
      time += ms;
      queueMicrotask(callback);
      return {};
    },
    clearTimeout() {},
    $prefs: {
      valueForKey: key => store.get(key),
      setValueForKey(value, key) {
        if (options.failWrite) return false;
        store.set(key, value);
        return true;
      },
      removeValueForKey(key) { store.delete(key); return true; }
    },
    $notify: (...args) => notifications.push(args),
    $done: () => { doneCount++; resolveDone(); },
    $task: { async fetch(req) {
      requests.push(JSON.parse(JSON.stringify(req)));
      const step = queue.shift();
      if (!step) throw new Error("Missing mock response");
      if (step.advance) time += step.advance;
      if (step.update) step.update(store);
      if (step.error) throw new Error(step.error);
      return step.response || step;
    } }
  };
  if (options.request) context.$request = options.request;
  vm.runInNewContext(source, context, { filename: "wn4k-checkin.js" });
  const timeout = setTimeout(() => resolveDone(new Error("Script did not finish")), 2000);
  const result = await complete;
  clearTimeout(timeout);
  if (result instanceof Error) throw result;
  await Promise.resolve();
  assert.equal(doneCount, 1, "Must finish exactly once");
  return { store, requests, notifications, waits, logs, time };
}

async function seed(ids = ["11"]) {
  const store = new Map();
  for (const id of ids) await execute({ store, request: request(id) });
  return store;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function accounts(store) { return JSON.parse(store.get(STORE) || "[]"); }
function text(result) { return JSON.stringify(result.notifications); }

test("captures and deduplicates accounts, preserving body and only allowed headers", async () => {
  const store = await seed(["11", "22", "11"]);
  assert.equal(accounts(store).length, 2);
  assert.equal(accounts(store)[0].body, "mode=daily");
  assert.equal(accounts(store)[0].headers["content-length"], undefined);
  assert.equal(accounts(store)[0].headers["x-noise"], undefined);
});

test("ignores login, unrelated routes, foreign hosts, and password payloads", async () => {
  for (const req of [request("11", { url: "https://wn4k.com/user/login.html", body: "action=checkin&user_pwd=SECRET" }),
    request("11", { url: "https://wn4k.com/user/points.html" }),
    request("11", { url: "https://wn4k.com.evil.test/user/ajax_sign.html" }),
    request("11", { body: '{"password":"SECRET"}' }),
    request("11", { body: '{"profile":{"password":"SECRET"}}' }),
    request("11", { body: "user%5Fpwd=SECRET" }),
    request("11", { url: "https://wn4k.com/user/ajax_sign.html?password=SECRET" })]) {
    const result = await execute({ request: req });
    assert.equal(accounts(result.store).length, 0);
  }
});

test("does not invent account identity or store binary payloads", async () => {
  const missing = await execute({ request: request("11", { headers: { Cookie: "session=SECRET" } }) });
  assert.equal(accounts(missing.store).length, 0);
  const binary = await execute({ request: request("11", { body: undefined, bodyBytes: new ArrayBuffer(4) }) });
  assert.equal(accounts(binary.store).length, 0);
});

test("isolates two accounts and skips successful accounts the same day", async () => {
  const store = await seed(["11", "22"]);
  const first = await execute({ store, responses: [response(), response()] });
  assert.equal(first.requests.length, 2);
  assert.notEqual(first.requests[0].headers.cookie, first.requests[1].headers.cookie);
  for (const req of first.requests) {
    assert.equal(req.opts["auto-cookie"], false);
    assert.equal(req.opts.redirection, false);
    assert.equal(req.opts["skip-cert-verify"], false);
  }
  assert.ok(accounts(store).every(a => a.lastDay === "2026-10-28"));
  const second = await execute({ store });
  assert.equal(second.requests.length, 0);
  assert.equal(store.has(LOCK), false);
});

test("retries HTTP 500 and network errors, never more than three attempts", async () => {
  const store = await seed();
  const success = await execute({ store, responses: [response(500), { error: "timeout SECRET" }, response()] });
  assert.equal(success.requests.length, 3);
  assert.ok(success.waits.includes(1500));
  assert.ok(success.waits.includes(3000));
  assert.equal(text(success).includes("SECRET"), false);
  const failureStore = await seed();
  const failure = await execute({ store: failureStore, responses: [response(500), response(500), response(500), response()] });
  assert.equal(failure.requests.length, 3);
  assert.equal(accounts(failureStore)[0].lastDay, undefined);
});

test("does not retry authentication or challenge failures", async () => {
  for (const resp of [response(401), response(403), response(200, { code: 1004 }),
    response(200, { code: 0, msg: "Please solve captcha" }), response(302)]) {
    const store = await seed();
    const result = await execute({ store, responses: [resp] });
    assert.equal(result.requests.length, 1);
    assert.equal(accounts(store)[0].lastDay, undefined);
  }
});

test("does not treat HTML, ambiguous JSON, or failure messages as success", async () => {
  for (const resp of [response(200, "<html>Welcome</html>"), response(200, { code: 0, msg: "Unknown" }),
    response(200, { code: 1, msg: "Check-in failed" }),
    response(200, { code: 0, msg: "\u5df2\u7b7e\u5230\u5931\u8d25" }),
    { body: '{"code":1}', headers: {} }]) {
    const store = await seed();
    await execute({ store, responses: [resp] });
    assert.equal(accounts(store)[0].lastDay, undefined);
  }
});

test("recognizes the already-signed-in message without repeating requests", async () => {
  const store = await seed();
  await execute({ store, responses: [response(200, { code: 0, msg: "\u4eca\u5929\u5df2\u7ecf\u7b7e\u5230" })] });
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
});

test("honors Retry-After and defers waits exceeding the runtime budget", async () => {
  const store = await seed();
  const result = await execute({ store, responses: [response(429, {}, { "Retry-After": "300" })] });
  assert.equal(result.requests.length, 1);
  assert.equal(result.waits.includes(300000), false);
  assert.equal(accounts(store)[0].lastDay, undefined);
  const shortStore = await seed();
  const short = await execute({ store: shortStore, responses: [response(429, {}, { "retry-after": "5" }), response()] });
  assert.ok(short.waits.includes(5000));
});

test("refreshes cookies only for previously captured accounts", async () => {
  const store = await seed();
  await execute({ store, request: request("11", { method: "GET", url: "https://wn4k.com/user/index/", body: "",
    headers: { Cookie: "user_id=11; session=NEW", "X-CSRF-Token": "WRONG" } }) });
  assert.equal(accounts(store)[0].headers.cookie, "user_id=11; session=NEW");
  assert.equal(accounts(store)[0].url, "https://wn4k.com/user/ajax_sign.html");
  assert.equal(accounts(store)[0].headers["x-csrf-token"], undefined);
  await execute({ store, request: request("22", { method: "GET", url: "https://wn4k.com/user/index/" }) });
  assert.equal(accounts(store).length, 1);
});

test("preserves concurrent credential refresh when marking success", async () => {
  const store = await seed();
  await execute({ store, responses: [{ response: response(), update(data) {
    const current = accounts(data);
    current[0].headers.cookie = "user_id=11; session=ROTATED";
    data.set(STORE, JSON.stringify(current));
  } }] });
  assert.equal(accounts(store)[0].headers.cookie, "user_id=11; session=ROTATED");
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
});

test("protects a live task lock and preserves corrupt account data", async () => {
  const store = await seed();
  store.set(LOCK, String(BASE + 60000));
  const busy = await execute({ store });
  assert.equal(busy.requests.length, 0);
  assert.equal(store.get(LOCK), String(BASE + 60000));
  const corrupt = new Map([[STORE, "{broken"]]);
  await execute({ store: corrupt, request: request() });
  assert.equal(corrupt.get(STORE), "{broken");
});

test("rejects tampered foreign-host and mismatched-account replay", async () => {
  for (const tamper of [a => { a.url = "https://evil.test/sign"; },
    a => { a.headers.cookie = "user_id=22; session=OTHER"; }]) {
    const store = await seed();
    const current = accounts(store);
    tamper(current[0]);
    store.set(STORE, JSON.stringify(current));
    const result = await execute({ store });
    assert.equal(result.requests.length, 0);
  }
});

test("does not credit a midnight-crossing request to the next day", async () => {
  const store = await seed();
  await execute({ store, time: Date.parse("2026-10-28T15:59:59Z"), responses: [{ advance: 3000, response: response() }] });
  assert.equal(accounts(store)[0].lastDay, undefined);
});

test("attempt ordering prevents permanently failing accounts from starving others", async () => {
  const store = await seed(["11", "22"]);
  await execute({ store, responses: [{ advance: 89000, response: response(500) }] });
  assert.ok(accounts(store)[0].lastAttemptAt);
  assert.equal(accounts(store)[1].lastAttemptAt, undefined);
  const next = await execute({ store, time: BASE + 15 * 60000, responses: [response(), response()] });
  assert.ok(next.requests[0].headers.cookie.includes("user_id=22"));
});

test("learns alternate routing and request-body actions without guessing an endpoint", async () => {
  const routed = await execute({ request: request("11", { url: "https://www.wn4k.com/index.php?s=%2Fuser%2Fajax_sign.html" }) });
  assert.equal(accounts(routed.store).length, 1);
  const action = await execute({ request: request("11", { url: "https://wn4k.com/user/action.html", body: '{"action":"checkin","csrf":"LOCAL"}' }) });
  assert.equal(accounts(action.store).length, 1);
});

test("configuration rewrite rules match every documented member-route variant", async () => {
  const config = fs.readFileSync(path.join(__dirname, "../rewrite/wn4k.qx.snippet"), "utf8");
  const pattern = config.split("\n").find(line => line.includes(" url script-request-body ")).split(" url ")[0];
  const regex = new RegExp(pattern);
  for (const url of ["https://wn4k.com/user/ajax_sign.html", "https://wn4k.com/user/index/",
    "https://www.wn4k.com/index.php/user/ajax_sign.html", "https://wn4k.com/index.php?s=/user/ajax_sign.html",
    "https://wn4k.com/index.php?s=%2Fuser%2Fajax_sign.html"]) {
    assert.ok(regex.test(url), "Rule did not match " + url);
  }
  assert.equal(regex.test("https://wn4k.com.evil.test/user/ajax_sign.html"), false);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log("PASS " + name);
  }
  console.log("\n" + tests.length + " tests passed (mock Quantumult X, no real account requests).");
})().catch(error => { console.error(error); process.exitCode = 1; });
