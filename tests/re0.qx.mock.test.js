// Offline compatibility coverage for both published RE0 task URLs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const NOW = Date.parse("2026-11-02T02:00:00Z");
const TODAY = "2026-11-02";
const DATE_KEY = "RE0_LastCheckinDate";
const AUTH_KEY = "re0_openapi_auth";
const API_URL = "https://re0.me/api/open/checkin";
const ENTRIES = ["re0.qx.checkin.js", "re0.qx.inject.js"];
const sources = Object.fromEntries(ENTRIES.map((name) => [
  name, fs.readFileSync(path.join(__dirname, "../scripts", name), "utf8"),
]));
const AUTH = {
  apiKey: "compat-client-key",
  accessToken: "compat-user-access",
  refreshToken: "compat-user-refresh",
  expiresAt: NOW + 4 * 3600 * 1000,
};
const SUCCESS = {
  statusCode: 200,
  body: '{"success":true,"data":{"checked_in":true,"points":10,"message":"签到成功"}}',
};

function localAuth() {
  return { [AUTH_KEY]: JSON.stringify(AUTH) };
}

function execute(name, { store = localAuth(), request, now = NOW, queued = [] } = {}) {
  const fetches = [];
  const done = [];
  const notifications = [];
  const logs = [];
  const queue = queued.slice();
  const context = {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    URL, URLSearchParams,
    $prefs: {
      valueForKey: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setValueForKey: (value, key) => { store[key] = String(value); return true; },
      removeValueForKey: (key) => { delete store[key]; return true; },
    },
    $task: {
      fetch: (req) => {
        fetches.push(req);
        if (!queue.length) return Promise.reject({ error: "unexpected offline request" });
        return Promise.resolve(queue.shift());
      },
    },
    $done: (value) => done.push(value),
    $notify: (...args) => notifications.push(args),
    console: { log: (...args) => logs.push(args.join(" ")) },
    setTimeout: (callback, ms) => ({ callback, ms, active: true }),
    clearTimeout: (timer) => { if (timer) timer.active = false; },
    $environment: {
      sourcePath: "https://example.invalid/scripts/" + name + "#force-timeout=60000",
      variables: { "force-timeout": "60000" },
    },
  };
  if (request) context.$request = request;
  vm.createContext(context);
  vm.runInContext(sources[name], context, { timeout: 1000 });
  return { store, fetches, done, notifications, logs };
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("the canonical legacy URL and inject alias contain the same current implementation", () => {
  const files = ENTRIES.map((name) => fs.readFileSync(path.join(__dirname, "../scripts", name)));
  assert.ok(files[0].equals(files[1]));
  assert.ok(files[0].length > 1000);
});

test("old request-header usage is passive even with a saved OpenAPI authorization", async () => {
  for (const name of ENTRIES) {
    const store = localAuth();
    const before = store[AUTH_KEY];
    const r = execute(name, {
      store,
      request: {
        url: "https://re0.me/", method: "GET",
        headers: { Cookie: "compat-browser-session", Authorization: "Bearer compat-browser-token" },
      },
      queued: [SUCCESS],
    });
    await settle();
    assert.equal(r.fetches.length, 0);
    assert.equal(r.done.length, 1);
    assert.equal(r.notifications.length, 0);
    assert.equal(store[AUTH_KEY], before);
    assert.ok(!JSON.stringify(store).includes("compat-browser-session"));
    assert.ok(!JSON.stringify(store).includes("compat-browser-token"));
  }
});

test("the old task URL reaches the actual OpenAPI signer with saved dual authorization", async () => {
  const r = execute("re0.qx.checkin.js", { queued: [SUCCESS] });
  await settle();
  assert.equal(r.fetches.length, 1);
  assert.equal(r.fetches[0].url, API_URL);
  assert.equal(r.fetches[0].headers["X-API-Key"], AUTH.apiKey);
  assert.equal(r.fetches[0].headers.Authorization, "Bearer " + AUTH.accessToken);
  assert.equal(r.fetches[0].headers.Cookie, undefined);
  assert.equal(r.fetches[0].headers["Next-Action"], undefined);
  assert.equal(r.store[DATE_KEY], TODAY);
  assert.equal(r.done.length, 1);
});

test("both published task paths classify API failures and typed already-signed results consistently", async () => {
  for (const name of ENTRIES) {
    for (const [response, expectedDone] of [
      [SUCCESS, true],
      [{ statusCode: 200, body: '{"success":false,"message":"签到失败，积分不足"}' }, false],
      [{ statusCode: 200, body: '{"success":false,"message":"尚未签到"}' }, false],
      [{ statusCode: 409, body: '{"success":false,"message":"明天再来"}' }, false],
      [{ statusCode: 403, body: SUCCESS.body }, false],
      [{ statusCode: 200, body: '{"success":true,"data":{"checked_in":false,"points":0,"message":"OK"}}' }, true],
    ]) {
      const r = execute(name, { queued: [response] });
      await settle();
      assert.equal(r.fetches.length, 1);
      assert.equal(r.store[DATE_KEY], expectedDone ? TODAY : undefined, name + " " + response.body);
      assert.equal(r.done.length, 1);
    }
  }
});

test("old and new task URLs share successful-day deduplication in either order", async () => {
  for (const order of [ENTRIES, ENTRIES.slice().reverse()]) {
    const store = localAuth();
    const first = execute(order[0], { store, queued: [SUCCESS] });
    await settle();
    const next = execute(order[1], { store, queued: [SUCCESS] });
    await settle();
    assert.equal(first.fetches.length, 1);
    assert.equal(next.fetches.length, 0);
    assert.equal(store[DATE_KEY], TODAY);
    assert.equal(first.done.length, 1);
    assert.equal(next.done.length, 1);
  }
});

test("old and new task URLs share Retry-After cooldown in either order", async () => {
  for (const order of [ENTRIES, ENTRIES.slice().reverse()]) {
    const store = localAuth();
    const first = execute(order[0], {
      store,
      queued: [{ statusCode: 429, headers: { "Retry-After": "3600" }, body: '{"message":"Too many requests"}' }],
    });
    await settle();
    const tooEarly = execute(order[1], { store, now: NOW + 10 * 60 * 1000, queued: [SUCCESS] });
    await settle();
    assert.equal(first.fetches.length, 1);
    assert.equal(tooEarly.fetches.length, 0);
    assert.equal(store[DATE_KEY], undefined);
    const ready = execute(order[1], { store, now: NOW + 61 * 60 * 1000, queued: [SUCCESS] });
    await settle();
    assert.equal(ready.fetches.length, 1);
    assert.equal(store[DATE_KEY], TODAY);
  }
});

test("a pending task holds shared backoff before the other task path can start", async () => {
  const store = localAuth();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = execute(ENTRIES[0], { store, queued: [pending] });
  await settle();
  const second = execute(ENTRIES[1], { store, queued: [SUCCESS] });
  await settle();
  assert.equal(first.fetches.length, 1);
  assert.equal(second.fetches.length, 0);
  assert.equal(second.done.length, 1);
  release(SUCCESS);
  await settle();
  assert.equal(first.done.length, 1);
  assert.equal(store[DATE_KEY], TODAY);
});
