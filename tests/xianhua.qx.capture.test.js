'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../capture/xianhua.qx.capture.js'),'utf8');
let checks=0;
function run(request, initial={}) {
 const store={...initial}, writes=[],logs=[],notices=[];let done=0;
 vm.runInNewContext(source,{$request:request,$prefs:{valueForKey:k=>store[k]||'',setValueForKey:(v,k)=>{writes.push(k);store[k]=v;return true;}},$notify:(...a)=>notices.push(a),$done:r=>{assert.equal(JSON.stringify(r),'{}');done++;},console:{log:(...a)=>logs.push(a.join(' '))},Date,decodeURIComponent});
 assert.equal(done,1);checks++;
 const text=JSON.stringify([logs,notices]);
 for(const secret of ['fixture-query-secret','fixture-header-secret','fixture-cookie-secret','fixture-password-secret']) assert(!text.includes(secret),'no secret logs');
 assert(writes.every(k=>!k.startsWith('sgxh_confirmed_reward')),'no guessed rewards');
 return {store,writes,logs,notices};
}
const wx={url:'https://wxforum.sanguosha.cn/api/shop/taskList?token=fixture-query-secret',method:'POST',headers:{authorization:'fixture-header-secret'},body:'{"password":"fixture-password-secret"}'};
let r=run(wx);assert.equal(r.store.sgxh_token_wx,'fixture-header-secret');checks++;
r=run({url:'https://xh.sanguosha.cn/h5/energy?token=fixture-query-secret&c=2',method:'GET',headers:{}},{sgxh_token_xh:'old-xh'});assert.equal(r.store.sgxh_token_h5,'fixture-query-secret');assert.equal(r.store.sgxh_token_xh,'old-xh');assert(!r.writes.includes('sgxh_token'));checks++;
r=run({url:'https://api-xh.sanguosha.cn/task/heatValue/progress',headers:{Authorization:'Bearer fixture-header-secret','App-System':'h5'}},{sgxh_token_xh:'old-xh',sgxh_headers_xh:'old-xh-headers'});assert.equal(r.store.sgxh_token_h5,'Bearer fixture-header-secret');assert.equal(r.store.sgxh_token_xh,'old-xh');assert.equal(r.store.sgxh_headers_xh,'old-xh-headers');checks++;
r=run({url:'https://api-xh.sanguosha.cn/task/sgxh-task/taskList',headers:{Authorization:'fixture-header-secret','App-System':'weixin','App-Code':'[object Null]','Bad':null,'nullvalue':'null','newline':'x\r\ny'}},{sgxh_token_h5:'old-h5'});assert.equal(r.store.sgxh_token_h5,'old-h5');const h=JSON.parse(r.store.sgxh_headers_xh);assert(!h['app-code']&&!h.bad&&!h.nullvalue&&!h.newline);checks++;
for(const url of ['https://evil.example/task','https://evil.xh.sanguosha.cn/h5/energy?token=fixture-query-secret','https://xh.sanguosha.cn.evil/h5/energy?token=fixture-query-secret','https://evil@xh.sanguosha.cn/h5/energy?token=fixture-query-secret','https://xh.sanguosha.cn/h5/other?token=fixture-query-secret']) {r=run({url,headers:{}});assert.equal(r.writes.length,0);checks++;}
r=run({url:'https://wxforum.sanguosha.cn/api/profile',headers:{}});assert.equal(r.writes.length,0);checks++;
r=run({url:'https://wxforum.sanguosha.cn/api/profile',headers:{Cookie:'one=updated; token=fixture-cookie-secret'}},{sgxh_cookie:'one=old; two=keep'});assert(r.store.sgxh_cookie.includes('two=keep'));assert(r.store.sgxh_cookie.includes('one=updated'));assert.equal(r.store.sgxh_token_wx,'fixture-cookie-secret');checks++;
r=run({url:'https://xh.sanguosha.cn/h5/energy?token=%zz',headers:{}});assert.equal(r.writes.length,0);checks++;
r=run(wx,{sgxh_notify_ts:String(Date.now())});assert.equal(r.notices.length,0);checks++;
console.log('PASS capture security and credential isolation: '+checks+' checks');
