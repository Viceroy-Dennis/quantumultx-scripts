// 蜂巢 (pting.club) QX 环境 mock 测试：签到 / 体检 / 抓包 三个脚本逐个沙箱执行
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockBody(url) {
  if (/check-in/.test(url)) return JSON.stringify({ code: 0, message: "成功", data: { reward: 5, streak: 3, points: 120, alreadyCheckedIn: false } });
  return JSON.stringify({ code: 0, message: "ok", data: {} });
}

async function runOne(relFile, label, extra = {}, storeInit = {}) {
  const notifies = [];
  const doneLog = [];
  const logs = [];
  const store = Object.assign({ pting_cookie: 'acw_tc=tmp; uid=42; token=abc123def456; session=xyz' }, storeInit);

  const sandbox = Object.assign({
    $prefs: {
      valueForKey: (k) => (k in store ? store[k] : null),
      setValueForKey: (v, k) => { store[k] = String(v); return true; },
      removeValueForKey: (k) => { delete store[k]; return true; },
    },
    $task: {
      fetch: (o) => new Promise((res) => setTimeout(() => res({ statusCode: 200, headers: {}, body: mockBody(o.url) }), 30)),
    },
    $notify: (t, s, m) => notifies.push(`${t} | ${s} | ${String(m).replace(/\n/g, ' / ').slice(0, 130)}`),
    $done: (r) => doneLog.push(r === undefined ? '(undefined)' : JSON.stringify(r).slice(0, 40)),
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  }, extra);

  const code = fs.readFileSync(`${BASE}/${relFile}`, 'utf8');
  try {
    vm.runInContext(code, vm.createContext(sandbox), { filename: relFile, timeout: 15000 });
  } catch (e) {
    console.log(`❌ ${label} 抛错: ${e.message}`);
    return;
  }
  await sleep(1500);
  console.log(`\n=== ${label} ===`);
  console.log(`   $done 调用: ${doneLog.length} 次`);
  console.log(`   通知: ${notifies.length} 条`);
  notifies.forEach((n) => console.log(`     📣 ${n}`));
  const errs = logs.filter((l) => l.startsWith('ERR'));
  if (errs.length) errs.slice(0, 3).forEach((e) => console.log(`   ⚠️ ${e.slice(0, 140)}`));
}

(async () => {
  // 1. 签到任务（有 Cookie）
  await runOne('scripts/fengchao.qx.task.js', '1. 蜂巢签到（有 Cookie）');
  // 2. 签到任务（无 Cookie）
  await runOne('scripts/fengchao.qx.task.js', '2. 蜂巢签到（无 Cookie）', {}, { pting_cookie: '' });
  // 3. 体检测试
  await runOne('scripts/fengchao.qx.test.js', '3. 蜂巢体检');
  // 4. 抓包（携带 Cookie + WAF 临时 Cookie，应过滤 acw_tc 并写入）
  await runOne('capture/fengchao.qx.capture.js', '4. Cookie 抓包（过滤 WAF）', { $request: { url: 'https://pting.club/', method: 'GET', headers: { Cookie: 'acw_tc=tmp; uid=42; token=abc123def456; session=xyz' } } }, { pting_cookie: '' });
  // 5. 抓包（Cookie 未变化，应静默）
  await runOne('capture/fengchao.qx.capture.js', '5. Cookie 抓包（未变化静默）', { $request: { url: 'https://pting.club/', method: 'GET', headers: { Cookie: 'uid=42; token=abc123def456; session=xyz' } } }, { pting_cookie: 'uid=42; token=abc123def456; session=xyz' });
})();
