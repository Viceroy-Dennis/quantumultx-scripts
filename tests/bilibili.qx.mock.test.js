// QX 环境 mock 测试（顺序执行，每个脚本独立沙箱与通知池）
const fs = require('fs');
const vm = require('vm');

const path = require('path');
const BASE = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockBody(url) {
  if (/fansMedal\/panel/.test(url)) return '{"code":0,"data":{"list":[{"medal_name":"测试牌子","level":5,"todayFeed":0,"dayLimit":5,"isLighted":1,"roomid":12345,"uid":678}],"special_list":[]}}';
  if (/DoSign|GetSignInfo/.test(url)) return '{"code":0,"data":{"hadSignDays":1,"allDays":3,"text":"签到成功","status":0}}';
  if (/msg\/send|likeInteract|TrigerInteract/.test(url)) return '{"code":0,"msg":"ok","data":{}}';
  if (/myWallet/.test(url)) return '{"code":0,"data":{"silver":1500}}';
  if (/getCoin/.test(url)) return '{"code":0,"data":{"coin":66}}';
  if (/silver2coin/.test(url)) return '{"code":0,"data":{"coin":1,"silver":800}}';
  if (/nav|myinfo/.test(url)) return '{"code":0,"data":{"isLogin":true,"uname":"测试账号","coin":66,"level_info":{"current_level":5,"current_exp":1000,"next_exp":2000}}}';
  if (/taskStatus|exp\/reward/.test(url)) return '{"code":0,"data":{"watch":true,"share":true,"coins":50}}';
  if (/live\/userInfo|getUserInfo|signInfo/.test(url)) return '{"code":0,"data":{"info":{"uid":123,"uname":"测试"},"user_info":{"uid":123}}}';
  if (/getSignInfo|live.*sign/.test(url)) return '{"code":0,"data":{"status":0,"text":"","hadSignDays":1}}';
  if (/medal|fansMedal|getFansMedal|myMedal/.test(url)) return '{"code":0,"data":{"list":[],"medal_list":[]}}';
  if (/popular|rank|recommend|getList|feed|region/.test(url)) return '{"code":0,"data":{"list":[{"arcurl":"bvid:BV1xx","bvid":"BV1xx","aid":1,"cid":2,"title":"mock","owner":{"name":"up"}}]}}';
  if (/x\/v2\/account\/myinfo|logout/.test(url)) return '{"code":0,"data":{}}';
  if (/silver2coin|Exchange/.test(url)) return '{"code":0,"data":{"coin":1,"silver":800}}';
  if (/fansMedal\/panel/.test(url)) return '{"code":0,"data":{"list":[{"medal_name":"测试牌子","level":5,"todayFeed":0,"dayLimit":5,"isLighted":1,"roomid":12345,"uid":678}],"special_list":[]}}';
  if (/DoSign|GetSignInfo/.test(url)) return '{"code":0,"data":{"hadSignDays":1,"allDays":3,"text":"签到成功","status":0}}';
  if (/msg\/send|likeInteract|TrigerInteract/.test(url)) return '{"code":0,"msg":"ok","data":{}}';
  if (/api-xh|wxforum|sgxh/.test(url)) return '{"code":0,"data":[]}';
  return '{"code":0,"message":"ok","data":{"watch":false,"share":false,"coins":0}}';
}

async function runOne(relFile, label, extra = {}) {
  const notifies = [];
  const doneLog = [];
  const logs = [];
  const store = { chavy_cookie_bilibili: 'buvid3=abc; bili_jct=deadbeefdeadbeef; SESSDATA=xyz; DedeUserID=12345' };

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
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, Buffer, module: { exports: {} },
  }, extra);

  const code = fs.readFileSync(path.join(BASE, relFile), 'utf8');
  try {
    vm.runInContext(code, vm.createContext(sandbox), { filename: relFile, timeout: 20000 });
  } catch (e) {
    console.log(`❌ ${label} 抛错: ${e.message}`);
    return;
  }
  await sleep(2500);
  console.log(`\n=== ${label} ===`);
  console.log(`   $done 调用: ${doneLog.length} 次 ${doneLog.length ? '[' + doneLog.join(', ') + ']' : ''}`);
  console.log(`   通知: ${notifies.length} 条`);
  notifies.forEach((n) => console.log(`     📣 ${n}`));
  const errs = logs.filter((l) => l.startsWith('ERR'));
  if (errs.length) errs.slice(0, 3).forEach((e) => console.log(`   ⚠️ ${e.slice(0, 140)}`));
}

(async () => {
  await runOne('scripts/bilibili.qx.main.js', '1. 主站每日任务（默认投币=1）');
  await runOne('scripts/bilibili.qx.main.js', '2. 主站每日任务（#coin=0 不投币）', { $environment: { variables: { coin: '0' } } });
  await runOne('scripts/bilibili.qx.silver2coin.js', '3. 银瓜子换硬币');
  await runOne('scripts/bilibili.qx.live.js', '4. 直播签到与粉丝牌');
  await runOne('scripts/bilibili.qx.test.js', '5. B站体检测试');
  await runOne('capture/bilibili.qx.capture.js', '6. Cookie 抓包（携带 bili_jct）', { $request: { url: 'https://live.bilibili.com/1', method: 'GET', headers: { Cookie: 'buvid3=abc; bili_jct=tok123; SESSDATA=zzz' } } });
})();
