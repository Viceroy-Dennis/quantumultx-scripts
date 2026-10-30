'use strict';

// Offline regression: node tests/xianhua.qx.workflow.test.js
// Only local, fictitious fixtures are used. VM exposes no network or require.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/xianhua.qx.task.js'), 'utf8');
const TOKEN = { wx: 'fixture-only-wx-token', xh: 'fixture-only-xh-token', h5: 'fixture-only-h5-token' };
const WX = 'https://wxforum.sanguosha.cn/api';
const XH = 'https://api-xh.sanguosha.cn';
const URLS = {
  shop: `${WX}/shop/taskList`, forever: `${WX}/shop/taskForever`,
  tasks: `${XH}/task/sgxh-task/taskList`, open: `${WX}/openMiniApp`,
  sign: `${WX}/user/signIn`, topics: `${WX}/topics?page=1&category_id=1`,
  page: `https://xh.sanguosha.cn/h5/energy?token=${TOKEN.h5}&c=2`,
  progress: `${XH}/task/heatValue/progress`, reward: `${XH}/task/heatValue/rewardReceive`,
  report: `${XH}/user/weekReport/sgs?date=undefined&gameId=2`,
  taskReward: `${XH}/task/sgxh-task/getReward`,
  update: `${XH}/task/sgxh-task/updateTaskProgress`
};
const copy = value => JSON.parse(JSON.stringify(value));
const ok = (data = {}) => ({ statusCode: 200, json: { code: 1000, success: true, data } });
const businessFailure = () => ({ statusCode: 200, json: { code: 20000, success: false, message: 'fixture rejected', data: {} } });
const NAMES = ['本周查看一次热力竹', '本周查看一次每周战报', '领取一次热力竹奖励'];
function tasks(status = -1) {
  return [1006, 3028, 3014].map((taskId, i) => ({
    taskId, taskType: taskId === 3014 ? 3 : 2, taskDesc: NAMES[i],
    progressStatus: status, taskProgressId: status < 1 ? null : 810000 + taskId,
    currentProgressValue: status < 1 ? 0 : 1, targetProgressValue: 1, rewardInfos: []
  }));
}
function rewards(received = false) {
  return [37, 38, 39, 40].map((id, i) => ({
    id, heatThreshold: [100, 1000, 2000, 3900][i], received, rewardTitle: 'fixture reward'
  }));
}
function complete(state, id) {
  const task = state.tasks.find(t => t.taskId === id);
  if (task && task.progressStatus < 1) {
    task.progressStatus = 1;
    task.taskProgressId = 810000 + id;
    task.currentProgressValue = 1;
  }
}

// Each (method, exact URL) has an explicit queue. No fallback success response.
// Response definitions can validate requests and change the fake server state.
class FetchQueue {
  constructor() { this.queues = new Map(); this.calls = []; this.events = []; this.errors = []; this.active = 0; }
  add(method, url, ...definitions) {
    const key = `${method} ${url}`;
    const queue = this.queues.get(key) || [];
    queue.push(...definitions);
    this.queues.set(key, queue);
    return this;
  }
  fetch(options) {
    const call = copy(options);
    call.method = String(call.method || 'GET').toUpperCase();
    this.calls.push(call);
    const id = this.calls.length;
    this.events.push({ event: 'request', id, method: call.method, url: call.url });
    const queue = this.queues.get(`${call.method} ${call.url}`);
    if (!queue || !queue.length) {
      this.errors.push(new assert.AssertionError({ message: 'unexpected endpoint, method, or repeated request' }));
      return Promise.reject(new Error('mock request rejected'));
    }
    const definition = queue.shift();
    this.active++;
    // Microtasks run normally; response delivery is asynchronous and timers are cancellable.
    return Promise.resolve().then(() => new Promise(resolve => setImmediate(resolve))).then(() => {
      const response = typeof definition === 'function' ? definition(call) : definition;
      assert(response && typeof response.statusCode === 'number', 'mock must define HTTP response');
      this.events.push({ event: 'response', id, method: call.method, url: call.url });
      return { statusCode: response.statusCode, headers: response.headers || {},
        body: response.body !== undefined ? response.body : JSON.stringify(response.json) };
    }).catch(error => {
      this.errors.push(error);
      throw new Error('mock response rejected');
    }).finally(() => { this.active--; });
  }
  verify() {
    assert.equal(this.errors.length, 0, 'all requests must match their response definitions');
    assert.equal(this.active, 0, '$done must follow all response deliveries');
    assert([...this.queues.values()].every(queue => queue.length === 0), 'all required queued requests must execute');
  }
}

async function execute(mock, mode = 'run') {
  const logs = [], notices = [], timers = new Set();
  const store = { sgxh_token_wx: TOKEN.wx, sgxh_token_xh: TOKEN.xh, sgxh_token_h5: TOKEN.h5 };
  let doneCount = 0, finish, watchdog;
  const finished = new Promise(resolve => { finish = resolve; });
  const sandbox = {
    $environment: { variables: typeof mode === 'string' && mode.startsWith('#') ? mode : { mode } },
    $prefs: {
      valueForKey: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setValueForKey: (value, key) => { store[key] = String(value); return true; }
    },
    $task: { fetch: options => mock.fetch(options) },
    $notify: (...args) => notices.push(args.map(String)),
    $done: () => { doneCount++; finish(); },
    console: Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => logs.push(args.map(String).join(' '))])),
    setTimeout: (callback, ms, ...args) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, ms >= 2000 ? 1000 : 0);
      timers.add(timer);
      return timer;
    },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
    URL, encodeURIComponent, decodeURIComponent
  };
  try {
    const completion = vm.runInNewContext(source, sandbox, { filename: 'xianhua.qx.task.js', timeout: 1000 });
    await Promise.race([
      Promise.all([finished, completion]),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new assert.AssertionError({ message: '$done deadline exceeded' })), 8000); })
    ]);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doneCount, 1, '$done must execute exactly once');
    mock.verify();
    assert.equal(notices.length, 1, 'one final notification is required');
    const text = [...logs, ...notices.flat()].join('\n');
    for (const token of Object.values(TOKEN)) assert(!text.includes(token), 'credentials must not enter logs or notifications');
    assert(!/脚本运行异常|运行异常:/.test(text), 'workflow must not abort inside main');
    for (const call of mock.calls) {
      if (call.body) {
        const payload = JSON.parse(call.body);
        assert(![3, 4, 5].includes(Number(payload.operateType)), 'operateType 3/4/5 is forbidden');
      }
    }
    return { logs, notices, text, calls: mock.calls, events: mock.events, doneCount };
  } finally {
    clearTimeout(watchdog);
    for (const timer of timers) clearTimeout(timer);
  }
}

function fixture(options = {}) {
  return {
    tasks: tasks(options.status === undefined ? -1 : options.status), shop: [], forever: [],
    heatValue: 3940, rewards: rewards(false), ...options
  };
}
function lists(mock, state, count = 3, overrides = {}) {
  const definitions = {
    shop: () => ok(copy(state.shop)),
    forever: () => ok({ lists: { category8: copy(state.forever) } }),
    tasks: () => ok(copy(state.tasks)), ...overrides
  };
  for (const name of ['shop', 'forever', 'tasks']) {
    mock.add('GET', URLS[name], ...Array.from({ length: count }, () => definitions[name]));
  }
}
function daily(mock, topics = []) {
  mock.add('POST', URLS.open, call => { assert.deepEqual(JSON.parse(call.body), { flag: 1 }, 'open body'); return ok(); });
  mock.add('POST', URLS.sign, call => { assert.deepEqual(JSON.parse(call.body), {}, 'sign body'); return ok(); });
  mock.add('GET', URLS.topics, () => ok(copy(topics)));
  topics.slice(0, 10).forEach(topic => mock.add('POST', `${WX}/topics/${topic.id}/likes`, ok()));
  topics.slice(0, 3).forEach(topic => {
    mock.add('GET', `${WX}/topics/${topic.id}`, ok({ id: topic.id }));
    mock.add('GET', `${XH}/postings/collect/postCollectInfo?postId=${topic.id}&gameId=2`, ok());
    mock.add('GET', `${XH}/sgxh/community/cert-status?gameId=2`, ok());
    mock.add('GET', `${XH}/postings/topic/getPostOfficialActTopicInfo?gameId=2&postId=${topic.id}`, ok());
    mock.add('GET', `${XH}/postings/sgxh/post/getPostLikeEasterEgg?gameId=2&postId=${topic.id}`, ok());
    mock.add('POST', `${XH}/postings/hotpush/order/stat/incr`, ok());
    mock.add('POST', URLS.update, call => { assert.deepEqual(JSON.parse(call.body), { operateType: 1 }, 'browse must use recorded operation'); return ok(); });
  });
  if (topics.length) {
    mock.add('POST', `${WX}/topics/${topics[0].id}/share`, ok());
    for (const body of [{ operateType: 2, gameId: 2 }, { operateType: 2 }]) {
      mock.add('POST', URLS.update, call => { assert.deepEqual(JSON.parse(call.body), body, 'share must use recorded operation'); return ok(); });
    }
    for (const postId of [topics[0].id, String(topics[0].id)]) {
      mock.add('POST', `${XH}/user/act-user-task/updateTaskProgress`, call => {
        assert.deepEqual(JSON.parse(call.body), { channelId: 2, postId, operationType: 1, gameId: 2 }, 'share report body'); return ok();
      });
    }
  }
}

function page(mock, state, succeed = true) {
  mock.add('GET', URLS.page, call => {
    assert.equal(call.body, undefined, 'H5 must be a GET without body');
    assert.equal(call.headers.accept, 'text/html', 'H5 must request HTML');
    if (succeed) complete(state, 1006);
    return { statusCode: 200, body: '<html><script id="fixture-ssr" type="application/json">' +
      JSON.stringify({ heatValue: state.heatValue, rewards: copy(state.rewards) }) + '</script></html>' };
  });
}
function report(mock, state, succeed = true) {
  mock.add('GET', URLS.report, call => {
    assert.equal(call.headers['current-uri'], 'subPackages/record/weekPaper/weekPaper', 'week report current-uri must match the miniapp page');
    assert.equal(call.headers.authorization, TOKEN.xh, 'week report must use fictional XH credentials');
    assert.equal(call.body, undefined, 'week report must be a GET without body');
    const query = new URL(call.url).searchParams;
    assert.equal(query.get('date'), 'undefined', 'week report must preserve captured date value');
    assert.equal(query.get('gameId'), '2', 'week report gameId');
    assert.equal([...query].length, 2, 'week report must not guess parameters');
    if (!succeed) return businessFailure();
    complete(state, 3028);
    return ok({ noData: true });
  });
}
function progress(mock, state, count = 1) {
  mock.add('GET', URLS.progress, ...Array.from({ length: count }, () => () => {
    const data = { heatValue: state.heatValue, rewards: copy(state.rewards), currentRewardId: state.currentRewardId };
    if (data.currentRewardId === undefined) {
      data.currentRewardId = state.rewards.find(r => r.received === false && r.heatThreshold <= state.heatValue)?.id || null;
    }
    (state.progressReads ||= []).push(copy(data));
    return ok(data);
  }));
}
function bambooClaims(mock, state, ids) {
  for (const id of ids) {
    mock.add('POST', URLS.reward, call => {
      assert.deepEqual(JSON.parse(call.body), { id }, 'bamboo must send only the reward id');
      const item = state.rewards.find(r => r.id === id);
      assert(item && item.received === false && item.heatThreshold <= state.heatValue, 'only unlocked, explicitly unreceived rewards are claimable');
      assert.equal(call.headers['app-system'], 'h5', 'bamboo uses H5 headers');
      assert.equal(call.headers.authorization, `Bearer ${TOKEN.h5}`, 'bamboo uses fictional H5 credentials');
      item.received = true;
      complete(state, 3014);
      return ok();
    });
  }
}
function communityClaims(mock, state, ids) {
  for (const id of ids) {
    mock.add('POST', URLS.taskReward, call => {
      const task = state.tasks.find(t => t.taskId === id);
      assert(task && task.progressStatus === 1 && task.taskProgressId, 'community action must create a claimable progress record first');
      assert.deepEqual(JSON.parse(call.body), { taskProgressId: task.taskProgressId }, 'getReward must send only taskProgressId');
      const pid = task.taskProgressId;
      state.tasks.filter(t => t.taskProgressId === pid).forEach(t => { t.progressStatus = 2; });
      return ok({ rewardInfos: [] });
    });
  }
}
function finalList(run) {
  const indices = run.logs.map((line, i) => line.includes('===== 任务列表 ·') ? i : -1).filter(i => i >= 0);
  assert(indices.length > 0, 'server task list must be printed');
  return run.logs.slice(indices.at(-1) + 1).filter(line => /^\[[^\]]+\] \d+\. /.test(line));
}
function confirmedFinal(run, names = NAMES) {
  const lines = finalList(run);
  assert.equal(lines.length, names.length, 'final list must retain every server task');
  for (const name of names) assert(lines.some(line => line.includes(name) && line.includes('| 已领取')), 'final list must confirm each task as received');
  assert.equal(run.notices[0][1], '任务执行结果 · 已复查', 'successful notification requires final server confirmation');
}
function needsAttention(run) {
  assert.equal(run.notices[0][1], '任务执行结果 · 有待完成或需检查项', 'missing or failed task lists must not claim completion');
  assert(!/全部(?:已)?完成|全部(?:已)?领取|所有任务(?:已)?完成/.test(run.text), 'must not advertise all tasks complete');
}
function serialBamboo(run, ids) {
  const events = run.events.filter(event => [URLS.progress, URLS.reward].includes(event.url));
  const expected = [];
  const pair = (method, url) => expected.push(['request', method, url], ['response', method, url]);
  pair('GET', URLS.progress);
  for (const id of ids) { void id; pair('POST', URLS.reward); pair('GET', URLS.progress); }
  assert.deepEqual(events.map(event => [event.event, event.method, event.url]), expected, 'each reward POST must settle, then GET must settle before the next POST');
  assert.deepEqual(run.calls.filter(call => call.url === URLS.reward).map(call => JSON.parse(call.body).id), ids, 'claim precisely the newly unlocked tiers');
}
function count(run, url) { return run.calls.filter(call => call.url === url).length; }
const cases = [];
function test(name, body) { cases.push({ name, body }); }

test('weekly_actions_four_tiers_and_final_receipts', async () => {
  const state = fixture(), mock = new FetchQueue();
  assert.deepEqual(state.tasks.map(t => [t.taskId, t.taskType, t.progressStatus]), [[1006, 2, -1], [3028, 2, -1], [3014, 3, -1]]);
  lists(mock, state);
  daily(mock, [{ id: 420001 }, { id: 420002 }, { id: 420003 }]);
  page(mock, state); progress(mock, state, 5); bambooClaims(mock, state, [37, 38, 39, 40]);
  report(mock, state); communityClaims(mock, state, [1006, 3028, 3014]);
  const run = await execute(mock);
  assert(state.tasks.every(t => t.progressStatus === 2 && t.taskProgressId), 'all three community rewards must be received');
  assert(state.rewards.every(r => r.received === true), 'all four tiers must be received');
  assert.equal(count(run, URLS.taskReward), 3, 'claim each community progress exactly once');
  confirmedFinal(run);
  serialBamboo(run, [37, 38, 39, 40]);
  assert.deepEqual(state.progressReads.map(data => data.rewards.filter(r => r.received === true).length), [0, 1, 2, 3, 4], 'every GET must observe the preceding POST state transition');
  assert.equal(count(run, URLS.page), 1);
  assert.equal(count(run, URLS.report), 1);
  assert(run.logs.some(line => line.includes('动作后 / 领取前')), 'must reload tasks after real actions');
});

test('received_weekly_tasks_skip_views_and_locked_tiers', async () => {
  const state = fixture({ status: 2, heatValue: 3940 }), mock = new FetchQueue();
  state.rewards = [...rewards(true), { id: 41, heatThreshold: 5000, received: false }];
  lists(mock, state); daily(mock); progress(mock, state);
  const run = await execute(mock);
  assert.equal(count(run, URLS.page), 0);
  assert.equal(count(run, URLS.report), 0);
  assert.equal(count(run, URLS.reward), 0);
  assert.equal(count(run, URLS.taskReward), 0);
  confirmedFinal(run); serialBamboo(run, []);
});

test('below_threshold_received_and_unknown_flags_are_skipped', async () => {
  const state = fixture({ status: 2, heatValue: 5 }), mock = new FetchQueue();
  state.rewards = [
    { id: 501, heatThreshold: 6, received: false },
    { id: 502, heatThreshold: 0, received: true },
    ...[undefined, null, 'unknown', 0, 1, 'false', 'true'].map((received, i) => ({ id: 503 + i, heatThreshold: 0, received }))
  ];
  lists(mock, state); daily(mock); progress(mock, state);
  const run = await execute(mock);
  assert.equal(count(run, URLS.reward), 0);
  assert.equal(count(run, URLS.taskReward), 0, 'bamboo ineligibility must not fall back to community getReward');
  serialBamboo(run, []);
});

test('http200_business_failure_does_not_claim_or_retry', async () => {
  const state = fixture({ status: 2 }), mock = new FetchQueue();
  Object.assign(state.tasks.find(t => t.taskId === 3014), { progressStatus: -1, taskProgressId: null, currentProgressValue: 0 });
  lists(mock, state); daily(mock); progress(mock, state);
  mock.add('POST', URLS.reward, call => {
    assert.deepEqual(JSON.parse(call.body), { id: 37 }, 'failed bamboo request still uses only tier id');
    return businessFailure();
  });
  const run = await execute(mock);
  assert.equal(count(run, URLS.reward), 1, 'business failure must stop without retrying other tiers');
  assert.equal(count(run, URLS.progress), 1, 'business failure must not be treated as accepted');
  assert.equal(count(run, URLS.taskReward), 0, 'must not borrow community getReward for a bamboo failure');
  assert(state.rewards.every(r => r.received === false));
  assert(run.text.includes('热力竹奖励[37]: 请求失败'), 'HTTP 200 with code 20000 must report failure');
  assert(!run.text.includes('已复查领取'), 'failed business response must not count as receipt');
  needsAttention(run);
});

test('business_failure_without_success_flag_is_not_success', async () => {
  const state = fixture({ status: 2 }), mock = new FetchQueue();
  lists(mock, state); daily(mock);
  mock.add('GET', URLS.progress, { statusCode: 200, json: { code: 20000, data: { heatValue: 3940, rewards: rewards(false) } } });
  const run = await execute(mock);
  assert.equal(count(run, URLS.reward), 0);
  assert.equal(count(run, URLS.taskReward), 0);
  assert(run.text.includes('热力竹进度查询: 请求失败'), 'code alone must reject a business failure');
});

test('accepted_bamboo_post_requires_confirmed_received_state', async () => {
  const state = fixture({ status: 2 }), mock = new FetchQueue();
  lists(mock, state); daily(mock); progress(mock, state, 2);
  mock.add('POST', URLS.reward, ok()); // Deliberately leave server progress unchanged.
  const run = await execute(mock);
  assert.equal(count(run, URLS.reward), 1, 'unconfirmed receipt must never cause blind retries');
  assert.equal(count(run, URLS.taskReward), 0);
  assert(run.text.includes('尚未确认已领取'), 'must disclose stale progress');
  needsAttention(run);
  assert(!run.text.includes('已复查领取'), 'accepted POST is not a confirmed receipt');
  serialBamboo(run, [37]);
});

test('failed_bamboo_recheck_stops_without_retry', async () => {
  const state = fixture({ status: 2 }), mock = new FetchQueue();
  lists(mock, state); daily(mock); progress(mock, state);
  mock.add('GET', URLS.progress, businessFailure());
  bambooClaims(mock, state, [37]);
  const run = await execute(mock);
  assert.equal(count(run, URLS.reward), 1);
  assert.equal(count(run, URLS.taskReward), 0);
  assert(run.text.includes('进度复查失败'));
  needsAttention(run);
  assert(!run.text.includes('已复查领取'), 'failed recheck must not confirm receipt');
  serialBamboo(run, [37]);
});

for (const mode of ['list', '#mode=list']) {
  test(mode === 'list' ? 'list_mode_only_three_gets' : 'hash_list_mode_only_three_gets', async () => {
    const state = fixture(), mock = new FetchQueue();
    lists(mock, state, 1);
    const run = await execute(mock, mode);
    assert.equal(run.calls.length, 3, 'list mode must perform exactly three requests');
    assert(run.calls.every(call => call.method === 'GET' && call.body === undefined));
    assert.deepEqual(run.calls.map(call => call.url).sort(), [URLS.shop, URLS.forever, URLS.tasks].sort());
    assert.equal(run.notices[0][1], '任务列表（只查询）');
    assert.equal(finalList(run).length, 3);
    assert(state.tasks.every(t => t.progressStatus === -1), 'list mode must not mutate community progress');
  });
}

test('same_task_id_across_channels_is_retained_and_claimed', async () => {
  const state = fixture({ status: 2 }), mock = new FetchQueue();
  state.tasks[0].progressStatus = 1;
  state.shop = [{ id: 1006, content: '商城同号任务', is_finish: 1, is_bonus: 0 }];
  state.rewards = rewards(true);
  lists(mock, state); daily(mock); progress(mock, state);
  communityClaims(mock, state, [1006]);
  mock.add('POST', `${WX}/shop/getTaskBonus/1006`, call => {
    assert.deepEqual(JSON.parse(call.body), {}, 'shop rewards use their own endpoint');
    state.shop[0].is_bonus = 1;
    return ok();
  });
  const run = await execute(mock);
  assert.equal(count(run, URLS.taskReward), 1);
  assert.equal(count(run, `${WX}/shop/getTaskBonus/1006`), 1);
  confirmedFinal(run, [...NAMES, '商城同号任务']);
  const lines = finalList(run);
  assert(lines.some(line => line.includes(NAMES[0]) && line.includes('社区福利')));
  assert(lines.some(line => line.includes('商城同号任务') && line.includes('商城')));
});

test('duplicate_task_progress_id_is_claimed_once', async () => {
  const state = fixture({ status: 1, rewards: rewards(true) }), mock = new FetchQueue();
  state.tasks.forEach(t => { t.taskProgressId = 889900; });
  lists(mock, state); daily(mock); progress(mock, state);
  communityClaims(mock, state, [1006]);
  const run = await execute(mock);
  assert.equal(count(run, URLS.taskReward), 1, 'duplicate progress ids must be deduplicated across tasks and rechecks');
  confirmedFinal(run);
});

test('failed_community_reward_is_not_retried_on_recheck', async () => {
  const state = fixture({ status: 2, rewards: rewards(true) }), mock = new FetchQueue();
  state.tasks[0].progressStatus = 1;
  lists(mock, state); daily(mock); progress(mock, state);
  mock.add('POST', URLS.taskReward, call => {
    assert.deepEqual(JSON.parse(call.body), { taskProgressId: state.tasks[0].taskProgressId });
    return businessFailure();
  });
  const run = await execute(mock);
  assert.equal(count(run, URLS.taskReward), 1);
  assert.equal(state.tasks[0].progressStatus, 1);
  assert(run.text.includes(`领取[${NAMES[0]}]: 请求失败`));
  assert(finalList(run).some(line => line.includes(NAMES[0]) && line.includes('| 待领取')));
  needsAttention(run);
});

for (const scenario of ['empty', 'missing_data', 'business_failure']) {
  test(`community_task_list_${scenario}_does_not_claim_completion`, async () => {
    const state = fixture({ tasks: [], rewards: rewards(true) }), mock = new FetchQueue();
    const response = scenario === 'empty' ? ok([]) : scenario === 'missing_data'
      ? { statusCode: 200, json: { code: 1000, success: true } } : businessFailure();
    lists(mock, state, 3, { tasks: () => copy(response) });
    daily(mock); progress(mock, state);
    const run = await execute(mock);
    needsAttention(run);
    assert.equal(count(run, URLS.page), 0, 'missing tasks must not trigger blind page visits');
    assert.equal(count(run, URLS.report), 0, 'missing tasks must not trigger blind report requests');
    assert.equal(count(run, URLS.taskReward), 0, 'missing tasks cannot produce synthetic community rewards');
    assert(run.text.includes(scenario === 'empty' ? '接口未返回此任务' : '任务列表查询失败'), 'notification must disclose missing or failed task lists');
    assert.equal(finalList(run).length, 0);
  });
}

test('failed_shop_list_prevents_all_complete_notification', async () => {
  const state = fixture({ status: 2, rewards: rewards(true) }), mock = new FetchQueue();
  lists(mock, state, 3, { shop: () => businessFailure() });
  daily(mock); progress(mock, state);
  const run = await execute(mock);
  needsAttention(run);
  assert(run.logs.some(line => line.includes('商城任务: 查询失败')));
});

test('failed_week_report_does_not_complete_community_task', async () => {
  const state = fixture({ status: 2, rewards: rewards(true) }), mock = new FetchQueue();
  Object.assign(state.tasks[1], { progressStatus: -1, taskProgressId: null, currentProgressValue: 0 });
  lists(mock, state); daily(mock); progress(mock, state); report(mock, state, false);
  const run = await execute(mock);
  assert.equal(count(run, URLS.report), 1, 'business failure must not blindly retry week report');
  assert.equal(count(run, URLS.taskReward), 0);
  assert(run.text.includes('本周查看每周战报: 请求失败'));
  assert(finalList(run).some(line => line.includes(NAMES[1]) && line.includes('| 未完成')));
  needsAttention(run);
});

for (const [label, value] of [['missing', undefined], ['null', null], ['invalid', 'unknown']]) {
  test(`invalid_heat_${label}_skips_reward_claims`, async () => {
    const state = fixture({ status: 2, heatValue: value }), mock = new FetchQueue();
    lists(mock, state); daily(mock); progress(mock, state);
    const run = await execute(mock);
    assert.equal(count(run, URLS.reward), 0);
    assert.equal(count(run, URLS.taskReward), 0);
    assert(run.text.includes('热力值缺失或无效'), 'must explicitly skip invalid heat values');
  });
}

test('empty_topics_do_not_invent_post_ids_or_post_actions', async () => {
  const state = fixture({ status: 2, rewards: rewards(true) }), mock = new FetchQueue();
  lists(mock, state); daily(mock, []); progress(mock, state);
  const run = await execute(mock);
  assert.equal(count(run, URLS.topics), 1);
  assert.equal(count(run, URLS.update), 0, 'empty posts must not generate task progress reports');
  assert(!run.calls.some(call => /\/topics\/|\/postings\/|act-user-task/.test(call.url)), 'empty posts must not trigger likes, views, shares, or guessed post ids');
  assert(run.text.includes('帖子列表查询失败或为空：点赞、浏览、分享暂未执行'));
  confirmedFinal(run);
});

for (const value of ['', ' ', false, true, [], {}, null]) {
  test('invalid_threshold_' + JSON.stringify(value), async () => {
    const state = fixture({status:2,rewards:[{id:37,heatThreshold:value,received:false}],heatValue:0}), mock=new FetchQueue();
    lists(mock,state);daily(mock);progress(mock,state);
    const run=await execute(mock);
    assert.equal(count(run,URLS.reward),0);
    needsAttention(run);
  });
}

test('initial_task_query_failure_skips_views_even_if_later_recovers', async () => {
  const state=fixture({status:2,rewards:rewards(true)}),mock=new FetchQueue();let reads=0;
  lists(mock,state,3,{tasks:()=>++reads===1?businessFailure():ok(copy(state.tasks))});
  daily(mock);progress(mock,state);
  const run=await execute(mock);
  assert.equal(count(run,URLS.page),0);assert.equal(count(run,URLS.report),0);
  needsAttention(run);
});

// Only case names reach stdout/stderr. Captured URLs, request bodies, tokens,
// server fixtures and VM notifications are never dumped, even on assertion failure.
(async () => {
  let failed = false;
  for (const item of cases) {
    try {
      await item.body();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed = true;
      assert(error instanceof Error, 'test failure must be an Error');
      console.error(`FAIL ${item.name}`);
    }
  }
  if (failed) process.exitCode = 1;
})();
