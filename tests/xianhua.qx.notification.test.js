const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '../scripts/xianhua.qx.task.js'), 'utf8');
const DAILY_TASKS = [
  { taskId: 1001, taskDesc: '今日点赞10次', taskProgressId: 101, currentProgressValue: 10, targetProgressValue: 10, progressStatus: 1 },
  { taskId: 1003, taskDesc: '今日浏览帖子3次', taskProgressId: 103, currentProgressValue: 3, targetProgressValue: 3, progressStatus: 1 },
  { taskId: 1004, taskDesc: '今日分享帖子1次', taskProgressId: 104, currentProgressValue: 1, targetProgressValue: 1, progressStatus: 1 },
];

function reply(data = {}, code = 1000, message = '操作成功', statusCode = 200) {
  return { statusCode, body: JSON.stringify({ code, message, data }) };
}

function defaultReply(request) {
  const url = request.url;
  if (/\/topics\?page/.test(url)) {
    return reply(Array.from({ length: 10 }, (_, i) => ({ id: String(12906766 + i) })), 0);
  }
  if (/\/shop\/taskList$|\/shop\/taskForever$/.test(url)) return reply([], 0);
  if (/\/sgxh-task\/taskList$/.test(url)) return reply(DAILY_TASKS);
  if (/\/getReward$/.test(url)) return reply({ rewardInfos: [] });
  return reply({}, /wxforum/.test(url) ? 0 : 1000);
}

async function runTask(options = {}) {
  const wxToken = 'mock-wx-'.padEnd(375, 'x');
  const xhToken = 'mock-xh-'.padEnd(375, 'x');
  const store = options.store || {
    sgxh_token_wx: wxToken,
    sgxh_headers_wx: JSON.stringify({ authorization: wxToken }),
    sgxh_token_xh: xhToken,
    sgxh_headers_xh: JSON.stringify({
      'appversion-code': '800',
      'current-uri': 'subPackages/index/welfare/welfare',
      'content-type': 'application/json',
      'client-id': 'mock-client',
      'app-system': 'weixin',
      'user-agent': 'mock-agent',
      platform: 'weixin',
      authorization: xhToken,
      'app-version': '8.0.0',
      referer: 'https://xianhua.sanguosha.cn/',
    }),
  };
  const notifications = [];
  const requests = [];
  const logs = [];
  const timers = new Set();
  let doneCount = 0;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const sandbox = {
    $prefs: {
      valueForKey: (key) => store[key] || null,
      setValueForKey: (value, key) => { store[key] = String(value); return true; },
    },
    $task: {
      fetch: (request) => {
        requests.push(request);
        const response = options.respond ? options.respond(request, requests) : undefined;
        return Promise.resolve(response === undefined ? defaultReply(request) : response);
      },
    },
    $notify: (title, subtitle, message) => notifications.push({ title, subtitle, message }),
    $done: () => { doneCount++; finish(); },
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    },
    // Fetch replies settle in microtasks; only the script's deliberate waits are accelerated.
    setTimeout: (callback) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, 1);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
  };
  let watchdog;
  try {
    vm.runInNewContext(SCRIPT, sandbox, { filename: 'xianhua.qx.task.js' });
    await Promise.race([
      finished,
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('$done was not called')), 2000); }),
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(doneCount, 1, '$done must be called exactly once');
    assert.equal(notifications.length, 1, 'one run must produce exactly one notification');
    return { notification: notifications[0], requests, logs };
  } finally {
    clearTimeout(watchdog);
    timers.forEach(clearTimeout);
  }
}

test('completion notification separates results from credential and request diagnostics', async () => {
  const { notification, logs, requests } = await runTask();
  assert.match(logs.join('\n'), /凭据自检:/, 'credential diagnostics remain available in the task log');
  assert.doesNotMatch(notification.message, /凭据自检|api-xh=|头字段|真链路|操作成功|领取\[/);
  assert.equal(notification.title, '三国咸话');
  assert.equal(notification.subtitle, '每日任务完成');
  assert.equal(notification.message, '签到：成功\n点赞 10/10 · 浏览 3/3 · 分享 1/1\n奖励：新领取 3 项');
  assert.equal(requests.length, 45, 'the successful path adds no new HTTP requests');
});

test('an HTTP 200 business failure must not announce full completion', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/signIn$/.test(request.url) ? reply({}, 500, '签到失败') : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /签到：失败（签到失败）/);
});

test('already completed tasks are not counted as newly claimed rewards', async () => {
  const { notification, requests } = await runTask({
    respond: (request) => {
      if (/\/signIn$/.test(request.url)) return reply({}, 1005, '今日已签到');
      if (/\/sgxh-task\/taskList$/.test(request.url)) {
        return reply(DAILY_TASKS.map((task) => ({ ...task, progressStatus: 2 })));
      }
    },
  });
  assert.equal(notification.subtitle, '今日任务已完成');
  assert.match(notification.message, /签到：已签到/);
  assert.match(notification.message, /奖励：今日已领取 3 项/);
  assert.equal(requests.filter((request) => /\/getReward$/.test(request.url)).length, 0);
});

test('server progress overrides optimistic browse request counts', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/sgxh-task\/taskList$/.test(request.url) ? reply(DAILY_TASKS.map((task) => (
      task.taskId === 1003 ? { ...task, currentProgressValue: 0, progressStatus: -1 } : task
    ))) : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /浏览 0\/3/);
  assert.doesNotMatch(notification.message, /浏览 3\/3/);
});

test('a wxforum receipt cannot overwrite unfinished api-xh progress', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/shop\/taskList$/.test(request.url)) {
        return reply([{ id: 3, content: '今日浏览帖子3次', is_finish: 1, is_bonus: 0 }], 0);
      }
      if (/\/sgxh-task\/taskList$/.test(request.url)) {
        return reply(DAILY_TASKS.map((task) => (
          task.taskId === 1003 ? { ...task, currentProgressValue: 0, progressStatus: -1 } : task
        )));
      }
    },
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /浏览 0\/3/);
  assert.match(notification.message, /奖励：新领取 3 项/);
});

test('failed like and browse requests cannot inflate unconfirmed progress', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/likes$|\/topics\/\d+$/.test(request.url)) return reply({}, 500, '操作失败');
      if (/\/sgxh-task\/updateTaskProgress$/.test(request.url) && JSON.parse(request.body).operateType === 1) {
        return reply({}, 500, '任务上报失败');
      }
      if (/\/sgxh-task\/taskList$/.test(request.url)) return reply([]);
      if (/getTaskBonus|sgxh-task\/(?:taskReward|receiveReward|getReward|receive|drawReward|claimReward)$/.test(request.url)) {
        return reply({}, 500, '领取失败');
      }
    },
  });
  assert.match(notification.message, /点赞 0\/10/);
  assert.match(notification.message, /浏览 0\/3/);
  assert.doesNotMatch(notification.message, /点赞 10\/10|浏览 3\/3/);
});

test('unfinished rewards are not reported as already claimed', async () => {
  const { notification, requests } = await runTask({
    respond: (request) => /\/sgxh-task\/taskList$/.test(request.url) ? reply(DAILY_TASKS.map((task) => (
      { ...task, currentProgressValue: 0, progressStatus: -1 }
    ))) : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /奖励：暂无可领取（任务未完成）/);
  assert.doesNotMatch(notification.message, /已领取/);
  assert.equal(requests.filter((request) => /\/getReward$/.test(request.url)).length, 0);
});

test('reward failures remain visible when the other claims succeed', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/getReward$/.test(request.url) && JSON.parse(request.body).taskProgressId === 103) {
        return reply({}, 500, '领取失败');
      }
    },
  });
  assert.equal(notification.subtitle, '奖励领取异常');
  assert.match(notification.message, /奖励：新领取 2 项，失败 1 项/);
});

test('an already-claimed reply is not a new reward', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/getReward$/.test(request.url) && JSON.parse(request.body).taskProgressId === 101) {
        return reply({}, 1005, '奖励已领取');
      }
    },
  });
  assert.equal(notification.subtitle, '每日任务完成');
  assert.match(notification.message, /奖励：新领取 2 项，已领取 1 项/);
});

test('a negative reward message overrides a nominal success code', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/getReward$/.test(request.url) ? reply({}, 0, '任务未完成，不能领取奖励') : undefined,
  });
  assert.equal(notification.subtitle, '奖励领取异常');
  assert.match(notification.message, /奖励：失败 3 项/);
  assert.doesNotMatch(notification.message, /新领取/);
});

test('second-round task progress replaces the initial stale snapshot', async () => {
  let reads = 0;
  const { notification, requests } = await runTask({
    respond: (request) => {
      if (/\/sgxh-task\/taskList$/.test(request.url)) {
        reads++;
        return reply(reads === 1 ? DAILY_TASKS.map((task) => (
          { ...task, currentProgressValue: 0, progressStatus: -1 }
        )) : DAILY_TASKS);
      }
    },
  });
  assert.equal(reads, 2);
  assert.equal(notification.subtitle, '每日任务完成');
  assert.match(notification.message, /点赞 10\/10 · 浏览 3\/3 · 分享 1\/1/);
  assert.match(notification.message, /奖励：新领取 3 项/);
  assert.equal(requests.filter((request) => /\/getReward$/.test(request.url)).length, 3);
});

test('wxforum reward results also feed the compact summary', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/shop\/taskList$/.test(request.url)) {
        return reply(DAILY_TASKS.map((task, i) => (
          { id: i + 1, content: task.taskDesc, is_finish: 1, is_bonus: 0 }
        )), 0);
      }
      if (/\/sgxh-task\/taskList$/.test(request.url)) return reply([]);
      if (/\/getTaskBonus\/\d+$/.test(request.url)) return reply({ bonus: 10 }, 0, '领取成功');
    },
  });
  assert.equal(notification.subtitle, '每日任务完成');
  assert.match(notification.message, /奖励：新领取 3 项/);
  assert.doesNotMatch(notification.message, /30|积分/);
});

test('HTTP 401 reports expired credentials rather than success', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/signIn$/.test(request.url) ? reply({}, 401, '未登录', 401) : undefined,
  });
  assert.equal(notification.subtitle, '登录凭据失效');
  assert.match(notification.message, /请重新打开小程序/);
  assert.doesNotMatch(notification.message, /凭据自检|authorization/);
});

test('business-level HTTP 200 auth errors also request credential refresh', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/getReward$/.test(request.url) ? reply({}, 401, 'Unauthorized') : undefined,
  });
  assert.equal(notification.subtitle, '登录凭据失效');
  assert.match(notification.message, /请重新打开小程序/);
});

test('missing welfare credentials stay actionable without exposing diagnostics', async () => {
  const { notification } = await runTask({
    store: { sgxh_token_wx: 'mock-wx' },
  });
  assert.equal(notification.subtitle, '凭据需更新');
  assert.match(notification.message, /福利页.*凭据|凭据.*福利页/);
  assert.doesNotMatch(notification.message, /api-xh=|头字段|位 \|/);
});

test('unknown claim responses do not imply reward success', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/getReward$/.test(request.url) ? { statusCode: 200, body: '{"message":"ok"}' } : undefined,
  });
  assert.equal(notification.subtitle, '执行结果待确认');
  assert.match(notification.message, /奖励：未确认 3 项/);
  assert.doesNotMatch(notification.message, /新领取/);
});

test('string progress statuses follow the same claim and summary rules', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/sgxh-task\/taskList$/.test(request.url) ? reply(DAILY_TASKS.map((task) => (
      { ...task, progressStatus: '1' }
    ))) : undefined,
  });
  assert.equal(notification.subtitle, '每日任务完成');
  assert.match(notification.message, /奖励：新领取 3 项/);
});

test('completed tasks without a progress id leave rewards unconfirmed', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/sgxh-task\/taskList$/.test(request.url) ? reply(DAILY_TASKS.map((task) => (
      { ...task, taskProgressId: null }
    ))) : undefined,
  });
  assert.equal(notification.subtitle, '执行结果待确认');
  assert.match(notification.message, /奖励：未确认 3 项/);
  assert.doesNotMatch(notification.message, /新领取|已领取/);
});

test('nested second-round task lists retain the real progress and claim results', async () => {
  let reads = 0;
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/sgxh-task\/taskList$/.test(request.url)) {
        reads++;
        return reply({ lists: reads === 1 ? DAILY_TASKS.map((task) => (
          { ...task, currentProgressValue: 0, progressStatus: -1 }
        )) : DAILY_TASKS });
      }
    },
  });
  assert.equal(reads, 2);
  assert.equal(notification.subtitle, '每日任务完成');
  assert.match(notification.message, /奖励：新领取 3 项/);
});

test('failed opening tasks remain visible even when all reward claims succeed', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/openMiniApp$/.test(request.url) ? reply({}, 500, '操作失败') : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /提示：打开任务操作失败/);
});

test('a timed-out request still ends once and reports a failure', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/signIn$/.test(request.url) ? new Promise(() => {}) : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.match(notification.message, /签到：失败（网络超时）/);
});

test('confirmed server completion is not undone by failed redundant requests', async () => {
  const { notification } = await runTask({
    respond: (request) => {
      if (/\/signIn$/.test(request.url)) return reply({}, 1005, '今日已签到');
      if (/\/likes$/.test(request.url)) return reply({}, 500, '操作失败');
      if (/\/sgxh-task\/taskList$/.test(request.url)) {
        return reply(DAILY_TASKS.map((task) => ({ ...task, progressStatus: 2 })));
      }
    },
  });
  assert.equal(notification.subtitle, '今日任务已完成');
  assert.match(notification.message, /点赞 10\/10/);
  assert.match(notification.message, /奖励：今日已领取 3 项/);
});

test('backend messages cannot turn the compact banner into a multiline log', async () => {
  const { notification } = await runTask({
    respond: (request) => /\/signIn$/.test(request.url) ? reply({}, 500, '签到失败\n'.repeat(100)) : undefined,
  });
  assert.equal(notification.subtitle, '部分任务未完成');
  assert.ok(notification.message.split('\n').length <= 5);
  assert.ok(notification.message.length <= 200);
});

test('no credentials produce one setup notification and no network requests', async () => {
  const { notification, requests } = await runTask({ store: {} });
  assert.equal(notification.title, '三国咸话');
  assert.equal(notification.subtitle, '未检测到凭据');
  assert.equal(requests.length, 0);
});

test('unexpected errors produce one safe failure notification', async () => {
  const { notification, logs } = await runTask({
    respond: () => { throw new Error('mock unexpected error'); },
  });
  assert.equal(notification.subtitle, '脚本运行异常');
  assert.match(notification.message, /任务日志/);
  assert.doesNotMatch(notification.message, /mock unexpected error/);
  assert.match(logs.join('\n'), /mock unexpected error/);
});
