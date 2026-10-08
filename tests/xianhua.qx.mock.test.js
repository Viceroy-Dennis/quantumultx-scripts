// 三国咸话 QX 任务脚本 mock 测试：验证在 Quantumult X 环境下能端到端跑通
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockBody(url) {
  if (/openMiniApp|signIn/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  if (/\/likes$|\/share$/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  if (/\/topics\?\d*|topics\?page/.test(url)) return '{"code":0,"data":[{"id":"12906766","title":"帖子A"},{"id":"12905506","title":"帖子B"}]}';
  if (/topics\/\d+$/.test(url)) return '{"code":0,"data":{"id":"12906766"}}';
  if (/updateTaskProgress/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  if (/shop\/taskForever/.test(url)) return JSON.stringify({ code: 0, data: [{ taskId: "1003", taskName: "今日浏览帖子3次", isReceive: 0, progress: 3, total: 3 }, { taskId: "1001", taskName: "今日点赞10次", isReceive: 1 }, { taskId: "1004", taskName: "今日分享帖子1次", isReceive: 0 }] });
  if (/taskList/.test(url)) return JSON.stringify({ code: 401, message: "token已经过期" });
  if (/getTaskBonus|taskBonus|receiveTaskBonus/.test(url)) return JSON.stringify({ code: 0, success: true, message: "领取成功", data: { bonus: 10 } });
  if (/getTaskBonus/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  return '{"code":0,"message":"ok","data":{}}';
}

async function main() {
  const cases = [
    ['正常凭据全套流程', { sgxh_token_wx: 'wx-token-abc123456789', sgxh_headers_wx: '{"authorization":"wx-token-abc123456789"}', sgxh_token_xh: 'xh-token-abc123456789', sgxh_headers_xh: '{"authorization":"xh-token-abc123456789"}' }],
    ['无凭据提示', {}],
  ];
  for (const [label, storeInit] of cases) {
    const notifies = [];
    const doneLog = [];
    const logs = [];
    const store = Object.assign({}, storeInit);
    const sandbox = {
      $prefs: {
        valueForKey: (k) => (k in store ? store[k] : null),
        setValueForKey: (v, k) => { store[k] = String(v); return true; },
      },
      $task: { fetch: (o) => new Promise((res) => setTimeout(() => res({ statusCode: 200, headers: {}, body: mockBody(o.url) }), 25)) },
      $notify: (t, s, m) => notifies.push(`${t} | ${s} | ${String(m).replace(/\n/g, ' / ').slice(0, 160)}`),
      $done: (r) => doneLog.push(r === undefined ? '(undefined)' : JSON.stringify(r).slice(0, 60)),
      console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
      setTimeout, clearTimeout, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    };
    const code = fs.readFileSync(`${BASE}/scripts/xianhua.qx.task.js`, 'utf8');
    try {
      vm.runInContext(code, vm.createContext(sandbox), { filename: 'task' });
    } catch (e) {
      console.log(`❌ [${label}] 抛错: ${e.message}`);
      continue;
    }
    await sleep(4000);
    console.log(`\n=== ${label} ===`);
    console.log(`   $done 调用: ${doneLog.length} 次 ${doneLog.length ? '[' + doneLog.join(', ') + ']' : ''}`);
    console.log(`   通知: ${notifies.length} 条`);
    notifies.forEach((n) => console.log(`     📣 ${n}`));
    const errs = logs.filter((l) => l.startsWith('ERR'));
    if (errs.length) errs.slice(0, 4).forEach((e) => console.log(`   ⚠️ ${e.slice(0, 150)}`));
    const keyLines = logs.filter((l) => /领奖试探|锁定|启动|执行完成|识别到/.test(l));
    keyLines.slice(0, 10).forEach((l) => console.log(`   · ${l.slice(0, 150)}`));
  }
}
main();
