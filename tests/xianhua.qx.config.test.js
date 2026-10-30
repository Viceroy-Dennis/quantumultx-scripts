'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const gallery=JSON.parse(fs.readFileSync(path.join(root,'gallery/xianhua.qx.gallery.json'),'utf8'));
assert.equal(gallery.task.length,2);
assert(gallery.task[0].config.startsWith('14 9 * * * '));
assert(gallery.task[1].config.startsWith('event-interaction '));
assert(gallery.task[1].config.includes('mode=list'));
for(const entry of gallery.task){assert(entry.addons==='https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/rewrite/xianhua.qx.snippet');assert(!entry.config.includes('paste.rs'));}
const snippet=fs.readFileSync(path.join(root,'rewrite/xianhua.qx.snippet'),'utf8');
assert.equal(snippet.split('\n').filter(x=>x.includes(' url script-')).length,1);
assert(snippet.includes('script-request-header'));assert(!snippet.includes('script-request-body'));
const diagnostic=fs.readFileSync(path.join(root,'scripts/xianhua.qx.test.js'),'utf8');
let count=0,done=0,text='';
const promise=vm.runInNewContext(diagnostic,{$prefs:{valueForKey:()=> 'fixture-key'},$task:{fetch:async req=>{count++;assert.equal(req.method,'GET');assert(req.url.endsWith('/taskList'));return {statusCode:200,body:JSON.stringify({code:1000,success:true,data:[{taskId:1006,taskDesc:'本周查看1次热力竹',taskType:2,progressStatus:2,currentProgressValue:1,targetProgressValue:1}]})};}},$notify:(_t,_s,m)=>{text=m;},$done:()=>done++,console:{log:()=>{}}});
Promise.resolve(promise).then(()=>{assert.equal(count,1);assert.equal(done,1);assert(text.includes('1/1 | 已领取'));assert(!text.includes('fixture-key'));console.log('PASS QX gallery, rewrite and readonly diagnostic configuration');}).catch(e=>{console.error(e.message);process.exitCode=1;});
