/* B站直播 Cookie 抓取（Quantumult X）
 * 用途: 仅当请求携带含 bili_jct 的完整登录 Cookie 时保存，其余静默跳过
 * 存储键: chavy_cookie_bilibili（与主站/直播/银瓜子/漫画之外的旧脚本共用，Surge 版同一键名）
 * 参考: [rewrite_local] ^https:\/\/(www|live|api\.live|app)\.bilibili\.com\/ url script-request-header <此脚本>
 */
const KEY = 'chavy_cookie_bilibili';

function read(k) { try { return $prefs.valueForKey(k) || ''; } catch (e) { return ''; } }
function write(v, k) { try { $prefs.setValueForKey(String(v), k); } catch (e) {} }

try {
  const h = (typeof $request !== 'undefined' && $request.headers) || {};
  const cookie = h.Cookie || h.cookie || '';
  const url = String((typeof $request !== 'undefined' && $request.url) || '');
  const dest = /live|api\.live/i.test(url) ? 'B站直播' : 'B站主站';
  if (!cookie) {
    console.log(`[${dest}] 请求未携带 Cookie，跳过`);
  } else if (!/(?:^|;\s*)bili_jct=/.test(cookie)) {
    console.log(`[${dest}] 未检测到 bili_jct（可能未登录），跳过`);
  } else {
    const old = read(KEY) || '';
    if (old !== cookie) {
      write(cookie, KEY);
      $notify(dest, 'Cookie 获取成功', '已保存主站任务、直播签到、粉丝牌与银瓜子兑换凭据');
      console.log(`[${dest}] Cookie 已更新 (${cookie.length} 字节)`);
    } else {
      console.log(`[${dest}] Cookie 未变化`);
    }
  }
} catch (e) {
  console.log('[B站抓包] 抓取异常 ' + e);
}
$done({});
