const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../scripts/xianhua.qx.task.js'), 'utf8');
const weekly = [
  {taskId: 9101, taskDesc: '本周查看一次热力竹', currentProgressValue: 0, targetProgressValue: 1, progressStatus: -1},
  {taskId: 9102, taskDesc: '领取热力竹奖励', currentProgressValue: 0, targetProgressValue: 1, progressStatus: -1},
  {taskId: 9103, taskDesc: '本周查看一次每周战报', currentProgressValue: 0, targetProgressValue: 1, progressStatus: -1}
];
async function execute(tasks = weekly, override = {}) {
  const calls = [], logs = [], notices = [], store = {sgxh_token_wx:'fixture-wx-token', sgxh_token_xh:'fixture-xh-token', ...override};
  let doneCount = 0, done;
  const finished = new Promise(r => { done = r; });
  const sandbox = {
    $prefs: {valueForKey: k => store[k] || '', setValueForKey: (v,k) => {store[k]=v; return true;}},
    $task: {fetch: async o => {
      calls.push(o);
      let data = {};
      if (/sgxh-task\/taskList/.test(o.url)) data = tasks;
      else if (/shop\/taskList|shop\/taskForever/.test(o.url)) data = [];
      else if (/topics\?/.test(o.url)) data = Array.from({length:10}, (_,i)=>({id:80000+i}));
      return {statusCode:200, body:JSON.stringify({code:1000, success:true, message:'操作成功',data})};
    }},
    $notify: (...a) => notices.push(a),
    $done: () => {doneCount++; done();},
    console: {log:(...a)=>logs.push(a.join(' ')), warn:(...a)=>logs.push(a.join(' '))},
    setTimeout:(f,ms)=>setTimeout(f,ms>=2000?300:0), clearTimeout,
    Date, JSON, Promise, URL, encodeURIComponent, decodeURIComponent
  };
  vm.runInNewContext(source, sandbox, {filename:'xianhua.qx.task.js'});
  await Promise.race([finished,new Promise((_,rej)=>setTimeout(()=>rej(Error('script did not finish')),4000))]);
  assert.equal(doneCount,1,'$done must be called once');
  return {calls,logs,notices,store};
}
(async()=>{
  const run = await execute();
  for (const t of weekly) assert(run.logs.some(x=>x.includes(t.taskDesc)), `任务列表遗漏：${t.taskDesc}`);
  assert(run.logs.some(x=>/未完成|待完成/.test(x)), '列表必须标明未完成，不能把请求成功当任务完成');
  console.log('PASS weekly tasks appear individually with truthful status');
})().catch(e=>{console.error(e.message); process.exitCode=1;});
module.exports = {execute};
