'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../scripts/xianhua.qx.task.js'),'utf8');
const tasks=[1001,1003,1004,1006,3028,3014].map((id,i)=>({taskId:id,taskDesc:['今日点赞10次','今日浏览帖子3次','今日分享帖子1次','本周查看1次热力竹','本周查看1次每周战报','领取一次热力竹奖励'][i],taskType:i<3?1:i<5?2:3,progressStatus:2,currentProgressValue:1,targetProgressValue:1,taskProgressId:7000+i,jumpPageUrl:id===1006?'/pages/webview/webview?src=https://xh.sanguosha.cn/h5/energy&fullscreen=1&c=2&token=1':''}));
async function run(hasH5){
 const calls=[],logs=[],notices=[],store={sgxh_token_xh:'fixture-wx-authorization',sgxh_token_wx:'fixture-wx-authorization',...(hasH5?{sgxh_token_h5:'fixture-h5-authorization'}:{})};
 let done=0,finish;const completion=new Promise(r=>finish=r);
 vm.runInNewContext(code,{$prefs:{valueForKey:k=>store[k]||'',setValueForKey:()=>{throw Error('no writes expected');}},$task:{fetch:async o=>{calls.push(o);let data={};if(o.url.includes('sgxh-task/taskList'))data=tasks;else if(o.url.includes('shop/task'))data=[];else if(o.url.includes('topics?'))data=[{id:80001}];else if(o.url.endsWith('heatValue/progress'))data={heatValue:3940,currentRewardId:null,rewards:[{id:37,heatThreshold:3600,received:true}]};return{statusCode:200,body:JSON.stringify({code:1000,success:true,message:'操作成功',data})};}},$notify:(...a)=>notices.push(a),$done:()=>{done++;finish();},console:{log:(...a)=>logs.push(a.join(' '))},setTimeout:(fn,ms)=>setTimeout(fn,ms>=2000?500:0),clearTimeout,encodeURIComponent,decodeURIComponent});
 let timer;try{await Promise.race([completion,new Promise((_,rej)=>timer=setTimeout(()=>rej(Error('deadline')),2000))]);}finally{clearTimeout(timer);}
 assert.equal(done,1);assert.equal(notices.length,1);const text=notices[0][2];
 assert(!/凭据自检|头字段|375位|api-xh=|wx=/.test(text),'日常弹窗不应包含凭据自检');
 assert(!/0\/0/.test(text),'已完成任务不应显示0/0');
 assert.equal((text.match(/今日点赞/g)||[]).length,1,'点赞结果只显示一次');
 assert.equal((text.match(/今日浏览/g)||[]).length,1,'浏览结果只显示一次');
 assert(logs.some(x=>x.includes('凭据自检')),'凭据自检保留在日志');
 assert(!/fixture-/.test(text),'通知不能泄漏凭据');
 if(hasH5){assert(calls.some(c=>c.url.endsWith('heatValue/progress')));assert(text.includes('热力竹档位'),'展示档位检查结果');assert(!text.includes('未检查'));}
 else {assert(!calls.some(c=>c.url.includes('heatValue')||c.url.includes('/h5/energy')),'缺H5凭据时不使用微信授权或占位符发送请求');assert(text.includes('热力竹档位：未检查'),'区分周任务已领与档位未检查');assert(text.includes('打开一次热力竹页面'));assert(notices[0][1].includes('需检查'));}
 assert(text.length<650,'日常通知应保持紧凑');
}
(async()=>{for(const h5 of [true,false]){await run(h5);console.log('PASS notification '+(h5?'valid_h5':'placeholder_without_h5'));}})().catch(e=>{console.error(e.message);process.exitCode=1;});
