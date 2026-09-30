// B站全任务综合测试与诊断脚本 (Surge Generic / Cron 兼容)
// 用途: 一键检测 Cookie 有效性、账号等级经验、硬币余额，并实测主站/直播接口连通性
// 存储键: chavy_cookie_bilibili

const $ = new Env('B站任务综合测试')
const KEY = 'chavy_cookie_bilibili'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const cookie = $.getdata(KEY) || ''
const mCsrf = cookie.match(/(?:^|;\s*)bili_jct\s*=\s*([^;]+)/)
const csrf = mCsrf && mCsrf[1] ? mCsrf[1].trim() : ''

$.desc = []
$.user = {}
$.reward = {}

!(async () => {
  $.log('========== 哔哩哔哩环境诊断开始 ==========')
  if (!cookie) {
    $.desc.push('❌ 未检测到 Cookie (chavy_cookie_bilibili)')
    $.desc.push('💡 请在 Surge 开启抓包脚本，并在 B 站 App 刷新一次')
    await notify()
    return
  }

  // 1. 账号与登录检查
  await checkNav()
  if (!$.user.isLogin) {
    $.desc.push('❌ Cookie 已失效或已过期，请重新抓取')
    await notify()
    return
  }

  // 2. 任务状态检查
  await checkReward()

  // 3. 钱包与硬币
  await checkWallet()

  // 4. 实测：主站观看与分享
  await testMainTasks()

  // 5. 实测：直播签到状态
  await testLive()

  // 6. 大会员签到测试
  await testVip()

  $.log('========== 哔哩哔哩环境诊断结束 ==========')
  await notify()
})()
  .catch((e) => $.logErr(e))
  .finally(() => $.done())

function h(referer) {
  const hd = { 'User-Agent': UA, 'Cookie': cookie }
  if (referer) {
    hd['Referer'] = referer
    hd['Origin'] = (referer.match(/^https?:\/\/[^/]+/) || [])[0]
  }
  return hd
}

function apiGet(url, referer) {
  return new Promise((resolve) => {
    $.get({ url: url, headers: h(referer) }, (err, resp, data) => {
      resolve(err ? null : $.toObj(data))
    })
  })
}

function apiPostForm(url, obj, referer) {
  return new Promise((resolve) => {
    $.post({ url: url, headers: h(referer), body: $.queryStr(obj) }, (err, resp, data) => {
      resolve(err ? null : $.toObj(data))
    })
  })
}

async function checkNav() {
  const res = await apiGet('https://api.bilibili.com/x/web-interface/nav')
  if (res && res.code === 0 && res.data) {
    $.user.isLogin = true
    $.user.name = res.data.uname || '未知用户'
    $.user.mid = res.data.mid
    $.user.level = res.data.level_info ? res.data.level_info.current_level : '?'
    $.user.currentExp = res.data.level_info ? res.data.level_info.current_exp : '?'
    $.user.money = res.data.money || 0
    $.desc.push(`👤 账号: ${$.user.name} (Lv.${$.user.level})`)
    $.desc.push(`✨ 经验: ${$.user.currentExp} | 🪙 硬币: ${$.user.money}`)
    $.log(`[用户信息] ${$.user.name} (UID:${$.user.mid}) Lv.${$.user.level} 经验:${$.user.currentExp}`)
  } else {
    $.user.isLogin = false
    $.log('[登录失效]', JSON.stringify(res))
  }
}

async function checkReward() {
  const res = await apiGet('https://api.bilibili.com/x/member/web/exp/reward')
  if (res && res.code === 0 && res.data) {
    $.reward = res.data
    const w = $.reward.watch ? '已完成' : '未完成'
    const s = $.reward.share ? '已完成' : '未完成'
    const c = `${$.reward.coins || 0}/50`
    $.desc.push(`📋 主站状态: 观看[${w}] 分享[${s}] 投币[${c}]`)
  }
}

async function checkWallet() {
  const res = await apiGet('https://api.live.bilibili.com/xlive/revenue/v1/wallet/myWallet?need_bp=1&need_metal=1&platform=pc')
  if (res && res.code === 0 && res.data) {
    const silver = res.data.silver || 0
    $.desc.push(`🪙 银瓜子: ${silver}`)
  }
}

async function testMainTasks() {
  // 获取一个随机热门视频用于测试
  const pop = await apiGet('https://api.bilibili.com/x/web-interface/popular?ps=10&pn=1')
  const list = (pop && pop.code === 0 && pop.data && pop.data.list) ? pop.data.list : []
  const v = list[0]
  if (!v) {
    $.desc.push('⚠️ 热门视频获取失败，跳过主站连通性实测')
    return
  }

  // 1. 测试观看上报
  const played = 65
  const hb = await apiPostForm(
    'https://api.bilibili.com/x/click-interface/web/heartbeat',
    { bvid: v.bvid, played_time: played },
    'https://www.bilibili.com/video/' + v.bvid
  )
  if (hb && hb.code === 0) {
    $.desc.push(`🎬 观看接口: 连通正常 (${v.title.slice(0, 10)}...)`)
  } else {
    $.desc.push(`🎬 观看接口: 异常 (${hb ? hb.message : '超时'})`)
  }

  // 2. 测试分享接口 (只在今日未分享时执行，避免重复请求)
  if (!$.reward.share) {
    const sh = await apiPostForm(
      'https://api.bilibili.com/x/web-interface/share/add',
      { bvid: v.bvid, csrf: csrf },
      'https://www.bilibili.com/video/' + v.bvid
    )
    if (sh && (sh.code === 0 || sh.code === 71099)) {
      $.desc.push('📢 分享接口: 连通正常 (+5 经验)')
    } else {
      $.desc.push(`📢 分享接口: 响应异常 (${sh ? sh.message : '超时'})`)
    }
  } else {
    $.desc.push('📢 分享接口: 今日已完成 (跳过重复触发)')
  }
}

async function testLive() {
  const res = await apiGet('https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign')
  if (res && res.code === 0) {
    $.desc.push('📺 直播签到: 成功 (首次执行)')
  } else if (res && res.code === 1011040) {
    $.desc.push('📺 直播签到: 今日已签过 (接口正常)')
  } else {
    $.desc.push(`📺 直播签到: 状态[${res ? res.message : '请求失败'}]`)
  }
}

async function testVip() {
  const res = await apiPostForm('https://api.bilibili.com/x/vip/experience/add', { csrf: csrf }, 'https://account.bilibili.com/account/home')
  if (res && res.code === 0) {
    $.desc.push('👑 大会员签到: 成功 (+10 经验)')
  } else if (res && res.code === 235007) {
    $.desc.push('👑 大会员签到: 账号非大会员 (跳过)')
  } else {
    $.desc.push(`👑 大会员签到: ${res ? res.message : '响应失败'}`)
  }
}

function notify() {
  return new Promise((resolve) => {
    const subt = $.user.name ? `${$.user.name} (Lv.${$.user.level || 0})` : '诊断报告'
    $.msg($.name, subt, $.desc.join('\n'))
    resolve()
  })
}
function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`🔔${this.name}, 开始!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}isShadowrocket(){return"undefined"!=typeof $rocket}isStash(){return"undefined"!=typeof $environment&&$environment["stash-version"]}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,n]=i.split("@"),a={url:`http://${n}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(a,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),n=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(n);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){if(t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let s=require("iconv-lite");this.initGotEnv(t),this.got(t).on("redirect",(t,e)=>{try{if(t.headers["set-cookie"]){const s=t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),e.cookieJar=this.ckjar}}catch(t){this.logErr(t)}}).then(t=>{const{statusCode:i,statusCode:r,headers:o,rawBody:n}=t,a=s.decode(n,this.encoding);e(null,{status:i,statusCode:r,headers:o,rawBody:n,body:a},a)},t=>{const{message:i,response:r}=t;e(i,r,r&&s.decode(r.rawBody,this.encoding))})}}post(t,e=(()=>{})){const s=t.method?t.method.toLocaleLowerCase():"post";if(t.body&&t.headers&&!t.headers["Content-Type"]&&(t.headers["Content-Type"]="application/x-www-form-urlencoded"),t.headers&&delete t.headers["Content-Length"],this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient[s](t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())t.method=s,this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let i=require("iconv-lite");this.initGotEnv(t);const{url:r,...o}=t;this.got[s](r,o).then(t=>{const{statusCode:s,statusCode:r,headers:o,rawBody:n}=t,a=i.decode(n,this.encoding);e(null,{status:s,statusCode:r,headers:o,rawBody:n,body:a},a)},t=>{const{message:s,response:r}=t;e(s,r,r&&i.decode(r.rawBody,this.encoding))})}}time(t,e=null){const s=e?new Date(e):new Date;let i={"M+":s.getMonth()+1,"d+":s.getDate(),"H+":s.getHours(),"m+":s.getMinutes(),"s+":s.getSeconds(),"q+":Math.floor((s.getMonth()+3)/3),S:s.getMilliseconds()};/(y+)/.test(t)&&(t=t.replace(RegExp.$1,(s.getFullYear()+"").substr(4-RegExp.$1.length)));for(let e in i)new RegExp("("+e+")").test(t)&&(t=t.replace(RegExp.$1,1==RegExp.$1.length?i[e]:("00"+i[e]).substr((""+i[e]).length)));return t}queryStr(t){let e="";for(const s in t){let i=t[s];null!=i&&""!==i&&("object"==typeof i&&(i=JSON.stringify(i)),e+=`${s}=${i}&`)}return e=e.substring(0,e.length-1),e}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl,i=t["update-pasteboard"]||t.updatePasteboard;return{"open-url":e,"media-url":s,"update-pasteboard":i}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============📣系统通知📣=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`❗️${this.name}, 错误!`,t.stack):this.log("",`❗️${this.name}, 错误!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`🔔${this.name}, 结束! 🕛 ${s} 秒`),this.log(),this.isSurge()||this.isQuanX()||this.isLoon()?$done(t):this.isNode()&&process.exit(1)}}(t,e)}
