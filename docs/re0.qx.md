# RE0 签到安装与排查

脚本针对 `re0.me` 的正常 Next.js 首页。请先在浏览器完成站点要求的验证和登录，再打开首页。浏览器会使用当前会话尝试一次签到。站点仍可能返回验证、权限错误或限流；脚本会停止并记录原因。

## 安装

1. QX 导入 `gallery/re0.qx.inject.gallery.json`，只保留一个 RE0 任务和一份重写订阅。`gallery/re0.qx.gallery.json` 是兼容入口，两者选一个。
2. 更新任务脚本和重写资源，确认任务 URL 是 `scripts/re0.qx.inject.js`。
3. 关闭旧 `scripts/re0.qx.checkin.js` 定时任务，以及旧 `script-request-header` 规则。旧后台重放脚本继续留档，不能和当前规则同时启用。
4. 确认 MitM 包含 `re0.me`。重写只处理 HTTPS 首页（含查询参数）与本地结果信标，不处理 JS 文件、Cloudflare 验证路径或其他页面。
5. 在浏览器访问 `https://re0.me/`，完成验证与登录，观察签到通知。重新导入 gallery 不一定替换已有任务 URL，需要检查实际任务行。

正常首页的响应体才会注入。挑战页、错误页、非 HTML 响应和重复注入会直接放行。页面已有 CSP nonce 时会复用它；脚本不修改 CSP。站点改版或 CSP 不允许执行时，应使用站点原有签到功能。

## 后台定时签到

默认定时任务在手机本地时间 09:00 执行。没有 API Key 时，它只提醒打开首页。页面签到需要浏览器加载页面，不能在后台完成浏览器验证。

如账户提供 OpenAPI 功能，可使用用户自己的有效 API Key。脚本延续仓库已有端点 `POST https://re0.me/api/open/checkin`，使用 `X-API-Key`，发送 `{"is_gambler":false}`。这里没有实测端点当前的可用性或站点访问策略。

Key 可以保存在 QX 本地 `$prefs` 的 `re0_api_key`，或者填入本地脚本的 `RE0_API_KEY`。不要将真实 Key 写入 GitHub。Key 不会注入到网页，也不会写入日志。

API 模式需要 QX build 934+，用于关闭自动 Cookie。每次运行只发一个 API 请求，禁止重定向；Key 无效、网络失败、挑战或限流后不会降级为后台网页重放。

## 请求与状态

- 正常首页加载后延迟 1.2 秒开始；同一页面只启动一次，共享浏览器存储的页面检查待执行状态。
- 动作发现只读取同源 `/_next/static/chunks/` 中页面已经引用的 JS，优先 layout，最多 6 个去重文件。读取使用浏览器缓存，动作 ID 按部署文件列表缓存。
- 每次尝试最多一次签到 POST。单请求超时 10 秒，流程预算 30 秒。任何请求出现挑战、拒绝访问、限流、登录页或服务器异常都会停止后续扫描。
- 不自动刷新页面，不自动重试安全令牌。动作过期时清除动作缓存，冷却后由用户手动重新打开首页。
- 挑战、401、403 和 429 默认冷却至少 15 分钟；其他失败至少 5 分钟。服务器给出的较长 `Retry-After`（秒数或 HTTP 日期）优先。冷却结束不会自动发送请求，只在后续手动打开首页或运行任务时尝试。
- 只有明确业务成功或明确“已签到”结果才记录成功日期。HTTP 200、纯页面渲染流、组件的 `success:true` 和含“积分”的失败文案不会算成功。
- 旧版的“当天已处理”可能来自失败，因此首次升级会重新核实一次。成功日期与失败冷却独立保存，以 UTC+8 划分日期。

## 查看原因

QX 日志保留：

```text
[RE0] INJECT normal_html
[RE0] API status=429 result=RATE_LIMIT
[RE0] REPORT result=FAILED
```

浏览器页面的结果在 `window.__re0Checkin`；最近一次阶段日志在 `localStorage.getItem("re0_auto_checkin_log")`。

| 结果 | 含义与下一步 |
| --- | --- |
| `CF_CHALLENGE` | 已识别 Cloudflare 挑战。完成浏览器验证，等待冷却后再打开首页 |
| `ACCESS_DENIED` | HTTP 403，未识别挑战页特征。检查账户访问权限和登录状态 |
| `RATE_LIMIT` | HTTP 429，已遵循 `Retry-After` 暂停 |
| `UNAUTHORIZED` | HTTP 401，检查登录状态或 API Key |
| `TOKEN_INVALID` | 站点安全令牌失效。稍后手动重新打开首页 |
| `STALE_ACTION` / `NO_ACTION_ID` | 当前动作未确认或无法发现。稍后重新打开首页；改版后可能需要更新脚本 |
| `HTML_RESPONSE` | 原应返回业务结果或 JS 的请求返回了网页，可能是登录页 |
| `TIMEOUT` / `NETWORK_ERROR` | 请求未确认完成，已停止并冷却 |
| `BUSINESS_ERROR` / `UNKNOWN_RESPONSE` | 站点明确拒绝签到，或没有找到可信的业务结果 |

排查时提供状态码、结果代码、是否开启旧规则，以及浏览器手动签到能否成功即可。不要提供 Cookie 或 API Key。

## 验证

```bash
node tests/re0.qx.inject.test.js
node tests/re0.qx.regression.test.js
node --check scripts/re0.qx.inject.js
```

原有浏览器沙箱 17 项检查、新增 31 个回归场景均通过。新增测试执行实际 QX 入口与生成的浏览器源码，重放挑战、限流、登录页、动作过期、超时和状态异常，校验后续请求数量与成功标记。测试不访问真实站点。

这些测试证明脚本的请求和状态处理符合预期，不能证明手机已签到成功或 Cloudflare 一定放行。
