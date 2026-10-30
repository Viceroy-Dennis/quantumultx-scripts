// 三国咸话 QX 只读诊断：仅查询任务列表，不执行任务或领取奖励。
const NAME = "三国咸话任务列表";
const token = $prefs.valueForKey("sgxh_token_xh") || $prefs.valueForKey("sgxh_token_wx") || $prefs.valueForKey("sgxh_token") || "";
function status(t) {
  return {"-1":"未完成","0":"未完成","1":"待领取","2":"已领取"}[String(t.progressStatus)] || "状态未知";
}
function finish(title,text) {console.log(`[${NAME}] ${text}`);$notify(NAME,title,text);$done();}
if (!token) finish("缺少凭据", "请更新凭据重写，并在小程序打开福利页和热力竹页面");
else $task.fetch({url:"https://api-xh.sanguosha.cn/task/sgxh-task/taskList",method:"GET",headers:{authorization:token,"app-code":"2",platform:"weixin","app-system":"weixin","app-version":"8.0.0","appversion-code":"800","current-uri":"subPackages/index/welfare/welfare",accept:"application/json"},opts:{"auto-cookie":false,redirection:false}}).then(r=>{
  let json;try{json=JSON.parse(r.body||"{}");}catch(e){}
  if (r.statusCode!==200 || !json || String(json.code)!=="1000" || json.success===false || !Array.isArray(json.data)) {finish("查询失败",`HTTP ${Number(r.statusCode)||0}，请检查凭据和网络`);return;}
  const lines=json.data.map(t=>{
    const cycle={1:"每日",2:"每周",3:"一次性/累计"}[Number(t.taskType)]||"其他";
    const label=String(t.taskDesc||t.taskName||t.taskId||"任务").replace(/<[^>]*>/g,"").slice(0,90);
    return `[${cycle}] ${label}: ${t.currentProgressValue}/${t.targetProgressValue} | ${status(t)}`;
  });
  finish("任务列表（只查询）",lines.join("\n")||"服务器未返回任务");
},()=>finish("网络请求失败","未执行任何任务或领奖操作，请检查网络后重试"));
