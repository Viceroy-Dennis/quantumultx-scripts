// B站主站每日任务 (观看/分享/投币/大会员签到) — Quantumult X 版
// 由 Surge 版移植：Env 库自带 QX 分支（$task.fetch / $prefs / $notify），仅投币参数改为 QX 读取方式
// Cookie 来源: chavy_cookie_bilibili (与直播/银瓜子脚本共用同一存储池，无需重新抓包)
// 每日投币枚数: 在 task_local 行尾加 #coin=N (0=不投币, 1-5)，不加默认 1
// 接口实测 (2026-09-21): heartbeat/share/add/coin/add/exp/reward 全部存活且无需 wbi 签名

const $ = new Env('B站主站每日任务')
const KEY = 'chavy_cookie_bilibili'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const cookie = $.getdata(KEY) || ''
const mCsrf = cookie.match(/(?:^|;\s*)bili_jct\s*=\s*([^;]+)/)
const csrf = mCsrf && mCsrf[1] ? mCsrf[1].trim() : ''
// 每日投币枚数 (0=不投币, 1-5=每天投 N 枚, 投满 5 枚 = 50 投币经验上限)
// 取值优先级: Surge $argument → QX URL hash(#coin=N) → 持久化键 bili_coin_count → 默认 1
const coinCount = (function () {
  let raw = ''
  try {
    if (typeof $argument !== 'undefined' && $argument !== null && String($argument).trim() !== '') {
      raw = $argument
    } else if (typeof $environment !== 'undefined' && $environment.variables && $environment.variables.coin !== undefined) {
      raw = $environment.variables.coin
    } else {
      raw = $.getdata('bili_coin_count') || ''
    }
  } catch (e) {}
  if (String(raw).trim() === '') return 1
  return Math.max(0, Math.min(5, parseInt(String(raw).trim()) || 0))
})()

$.desc = []
$.curExp = null
$.videos = []
$.video = null
$.status = null

!(async () => {
  if (!cookie) {
    $.desc.push('未获取到 Cookie，请先装抓包脚本并在 B 站 App 内刷新一次')
    await notify()
    return
  }
  await checkLogin()
  if ($.expired) { await notify(); return }
  await getTaskStatus()
  if (!$.status || $.status.watch !== false) {
    $.desc.push('观看: 今日已完成')
  } else {
    await pickVideo()
    if ($.video) { await doWatch(); await $.wait(2000) }
  }
  if (!$.status || $.status.share !== false) {
    $.desc.push('分享: 今日已完成')
  } else {
    if (!$.video) { await pickVideo(); await $.wait(1500) }
    if ($.video) { await doShare(); await $.wait(2000) }
  }
  if (coinCount <= 0) {
    $.desc.push('投币: 未开启 (模块参数 coin_count 改 1-5 可开)')
  } else if (!$.status || $.status.coins >= 50) {
    $.desc.push('投币: 今日投币经验已满')
  } else {
    await doCoin()
  }
  await doVipSign()
  await getTaskStatus(true)
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

function checkLogin() {
  return apiGet('https://api.bilibili.com/x/web-interface/nav').then((r) => {
    if (r && r.code === 0) {
      const cur = r.data && r.data.level_info && r.data.level_info.current_exp
      $.curExp = typeof cur === 'number' ? cur : null
    } else if (r && r.code === -101) {
      $.expired = true
      $.desc.push('Cookie 已过期，请在 B 站 App 内刷新一次重新抓取')
    } else {
      $.desc.push('登录检查: ' + ((r && r.code + ' ' + r.message) || '请求失败'))
    }
  })
}

function getTaskStatus(final) {
  return apiGet('https://api.bilibili.com/x/member/web/exp/reward').then((r) => {
    let res = r
    if (!res || res.code !== 0) {
      // 偶发性请求失败，再请求一次
      return apiGet('https://api.bilibili.com/x/member/web/exp/reward').then((r2) => {
        res = r2
        if (res && res.code === 0) { $.status = res.data || {} }
        else if (!final) { $.desc.push('任务状态: ' + ((res && res.code + ' ' + res.message) || '获取失败')) }
      })
    }
    $.status = res.data || {}
  })
}

function pickVideo() {
  return apiGet('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1').then((r) => {
    const list = (r && r.code === 0 && r.data && r.data.list) ? r.data.list : []
    const ok = list.filter((v) => v.bvid && (v.duration || 0) >= 30)
    $.videos = ok.length ? ok : list
    $.video = $.videos[Math.floor(Math.random() * $.videos.length)] || null
    if (!$.video) $.desc.push('热门视频: 获取失败，观看/分享跳过')
  })
}

function doWatch() {
  const v = $.video
  const played = 60 + Math.floor(Math.random() * 30)
  return apiPostForm('https://api.bilibili.com/x/click-interface/web/heartbeat', { bvid: v.bvid, played_time: played }, 'https://www.bilibili.com/video/' + v.bvid).then((r) => {
    if (r && r.code === 0) $.desc.push('观看: 上报成功 ' + played + 's (' + v.title + ')')
    else $.desc.push('观看: 失败 ' + ((r && r.code + ' ' + r.message) || '请求失败'))
  })
}

function doShare() {
  const v = $.video
  return apiPostForm('https://api.bilibili.com/x/web-interface/share/add', { bvid: v.bvid, csrf: csrf }, 'https://www.bilibili.com/video/' + v.bvid).then((r) => {
    if (r && r.code === 0) $.desc.push('分享: 成功 +5 经验 (' + v.title + ')')
    else $.desc.push('分享: ' + ((r && r.code === 71099 ? '今日已分享过' : '失败 ' + r.code + ' ' + r.message) || '请求失败'))
  })
}

function doCoin() {
  return apiGet('https://account.bilibili.com/site/getCoin').then((bal) => {
    const coin = bal && bal.data && typeof bal.data.coin === 'number' ? bal.data.coin : null
    if (coin !== null && coin < 1) { $.desc.push('投币: 硬币不足 1 枚，跳过'); return }
    const needExp = 50 - ($.status.coins || 0)
    let remaining = Math.min(coinCount, Math.ceil(needExp / 10))
    let vi = 0
    let doneN = 0
    const run = () => {
      if (remaining <= 0 || vi >= $.videos.length) {
        if (!doneN) $.desc.push('投币: 未能投出 (视频上限或接口失败)')
        return Promise.resolve()
      }
      const v = $.videos[vi++]
      const multiply = Math.min(2, remaining)
      return apiPostForm('https://api.bilibili.com/x/web-interface/coin/add', { aid: v.aid, multiply: multiply, select_like: 1, csrf: csrf }, 'https://www.bilibili.com/video/' + v.bvid).then((r) => {
        if (r && r.code === 0) {
          doneN += multiply
          remaining -= multiply
          $.desc.push('投币: ' + v.title + ' x' + multiply + ' (+' + (multiply * 10) + ' 经验)')
        } else if (r && r.code === 34002) {
          // 该视频已投满 2 枚，换下一个
        } else if (r && (r.code === -104 || r.code === 34003)) {
          $.desc.push('投币: 硬币不足，跳过')
          remaining = 0
        } else {
          $.desc.push('投币: 失败 ' + ((r && r.code + ' ' + r.message) || '请求失败'))
          remaining = 0
        }
        return $.wait(2500).then(run)
      })
    }
    return run()
  })
}

function doVipSign() {
  return apiPostForm('https://api.bilibili.com/x/vip/experience/add', { csrf: csrf }, 'https://account.bilibili.com/account/home').then((r) => {
    if (r && r.code === 0) $.desc.push('大会员签到: 成功')
    else if (r && r.code === 235007) $.desc.push('大会员签到: 非大会员，跳过')
    else $.desc.push('大会员签到: 失败 ' + ((r && r.code + ' ' + r.message) || '请求失败'))
  })
}

function notify() {
  return new Promise((resolve) => {
    $.subt = $.expired ? 'Cookie 已过期' : ($.curExp !== null ? '当前经验 ' + $.curExp : '')
    $.msg($.name, $.subt, $.desc.join('\n'))
    resolve()
  })
}
function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`🔔${this.name}, 开始!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}isShadowrocket(){return"undefined"!=typeof $rocket}isStash(){return"undefined"!=typeof $environment&&$environment["stash-version"]}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,n]=i.split("@"),a={url:`http://${n}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(a,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),n=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(n);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){if(t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let s=require("iconv-lite");this.initGotEnv(t),this.got(t).on("redirect",(t,e)=>{try{if(t.headers["set-cookie"]){const s=t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),e.cookieJar=this.ckjar}}catch(t){this.logErr(t)}}).then(t=>{const{statusCode:i,statusCode:r,headers:o,rawBody:n}=t,a=s.decode(n,this.encoding);e(null,{status:i,statusCode:r,headers:o,rawBody:n,body:a},a)},t=>{const{message:i,response:r}=t;e(i,r,r&&s.decode(r.rawBody,this.encoding))})}}post(t,e=(()=>{})){const s=t.method?t.method.toLocaleLowerCase():"post";if(t.body&&t.headers&&!t.headers["Content-Type"]&&(t.headers["Content-Type"]="application/x-www-form-urlencoded"),t.headers&&delete t.headers["Content-Length"],this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient[s](t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())t.method=s,this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let i=require("iconv-lite");this.initGotEnv(t);const{url:r,...o}=t;this.got[s](r,o).then(t=>{const{statusCode:s,statusCode:r,headers:o,rawBody:n}=t,a=i.decode(n,this.encoding);e(null,{status:s,statusCode:r,headers:o,rawBody:n,body:a},a)},t=>{const{message:s,response:r}=t;e(s,r,r&&i.decode(r.rawBody,this.encoding))})}}time(t,e=null){const s=e?new Date(e):new Date;let i={"M+":s.getMonth()+1,"d+":s.getDate(),"H+":s.getHours(),"m+":s.getMinutes(),"s+":s.getSeconds(),"q+":Math.floor((s.getMonth()+3)/3),S:s.getMilliseconds()};/(y+)/.test(t)&&(t=t.replace(RegExp.$1,(s.getFullYear()+"").substr(4-RegExp.$1.length)));for(let e in i)new RegExp("("+e+")").test(t)&&(t=t.replace(RegExp.$1,1==RegExp.$1.length?i[e]:("00"+i[e]).substr((""+i[e]).length)));return t}queryStr(t){let e="";for(const s in t){let i=t[s];null!=i&&""!==i&&("object"==typeof i&&(i=JSON.stringify(i)),e+=`${s}=${i}&`)}return e=e.substring(0,e.length-1),e}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl,i=t["update-pasteboard"]||t.updatePasteboard;return{"open-url":e,"media-url":s,"update-pasteboard":i}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============📣系统通知📣=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`❗️${this.name}, 错误!`,t.stack):this.log("",`❗️${this.name}, 错误!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`🔔${this.name}, 结束! 🕛 ${s} 秒`),this.log(),this.isSurge()||this.isQuanX()||this.isLoon()?$done(t):this.isNode()&&process.exit(1)}}(t,e)}
