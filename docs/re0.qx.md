# RE0 签到安装与排查

脚本支持两种使用方式：

- **浏览器打开首页时自动签到**：完成 `re0.me` 的验证与登录后，正常首页加载会使用浏览器当前会话尝试一次签到。
- **QX 后台定时签到**：手机本地时间每天 09:00 运行，需要有效的 OpenAPI 应用 Secret 和已授权用户 Access Token；可选 Refresh Token 用于授权续期。普通签到默认发送 `is_gambler:false`。

没有 OpenAPI 授权时，后台任务会提示打开首页。浏览器方式需要实际打开页面。

## 直接安装

1. QX → 工具&分析 → HTTP 请求 → 添加任务仓库，导入：

   ```text
   https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/gallery/re0.qx.gallery.json
   ```

2. 添加 RE0 签到任务及其附带的重写订阅，确认 MitM 包含 `re0.me`，并已安装、信任 QX 的 MitM 证书。
3. 更新任务脚本与重写资源，确认签到任务使用 `scripts/re0.qx.checkin.js`，时间为 `0 9 * * *`。
4. 浏览器打开 [RE0 首页](https://re0.me/)，完成站点验证与登录，观察签到通知。

`gallery/re0.qx.inject.gallery.json` 是同等功能的兼容导入入口，两者选一个。`scripts/re0.qx.checkin.js` 与 `scripts/re0.qx.inject.js` 是相同的独立脚本；原有任务地址也可更新到此实现。只保留一个 RE0 签到任务和一份重写订阅，避免重复执行。

已有任务不会必然随 gallery 更新改地址或执行时间；请检查 QX 实际任务行。旧的全站 `script-request-header` 规则需要更新成当前 snippet，才能使用首页注入。更新后的脚本在旧请求头规则下会直接放行，只有真实 OpenAPI 请求可以采集授权。

## 配置后台自动签到

后台使用双层认证：

```text
X-API-Key: 应用 Secret
Authorization: Bearer 用户 Access Token
```

签到要求用户授权包含 `write` 权限。网页登录 Cookie 不能替代 OpenAPI Access Token，仅配置应用 Secret 也不够。请使用你已经获准使用的应用和本人授权，OpenAPI 是否开放申请、账户权限和访问策略以站点当前说明为准。

### 方式一：运行一次本地配置脚本

下载 [re0.qx.setup.js](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.setup.js)，保存到“我的 iPhone → Quantumult X → Scripts”或“iCloud Drive → Quantumult X → Scripts”，在**本地副本**填写：

```javascript
const API_KEY = "";       // 你的应用 Secret
const ACCESS_TOKEN = "";  // 你的 OAuth 用户 Access Token
const REFRESH_TOKEN = ""; // 同一授权的 Refresh Token；与 Access Token 至少填写一个
```

在 QX 配置的 `[task_local]` 添加以下手动任务，并在 QX 隧道运行时点选执行一次：

```ini
event-interaction re0.qx.setup.js, tag=RE0本地授权, enabled=true
```

应用 Secret 必填；Access Token 和 Refresh Token 至少填写一个。只有 Refresh Token 时，签到任务会先请求授权续期。配置助手只保存 QX 本地授权记录 `re0_openapi_auth` 并重置签到状态，不发送网络请求。看到保存成功后，手动运行 RE0 签到任务检查首次结果，后续由每日任务执行。QX 本地脚本目录和 `event-interaction` 任务写法见 [官方示例配置](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample.conf)。

填写后的配置脚本保留在手机本地即可；真实凭据不要写进 GitHub、远程脚本地址或任务 URL 的 hash 参数。

### 方式二：从真实 OpenAPI 请求采集

当前重写支持：

- 从 `https://re0.me/api/open/` 下的真实请求采集同时存在的应用 Secret 与 Bearer 用户 Token。
- 从成功的 `POST /api/public/openapi/oauth/refresh` 响应更新本地授权，但必须同时包含完整的 Access Token 和 Refresh Token；缺少任意一个时，保持已有授权不变。QX 响应重写不保证提供原请求体，因此不会拼接无法确认属于同一授权的 Token。

采集原样放行请求或响应，采集时不会额外签到。普通网页登录不触发 OpenAPI 授权采集；从未使用过 OpenAPI 的账户应先完成站点要求的授权，或使用浏览器方式。

也兼容 QX 本地旧键 `re0_api_key`、`re0_access_token` 和 `re0_refresh_token`。只有同时具备应用 Secret 与用户 Token，或具备可刷新的同一授权时，才会执行后台 API 流程。

## 后台请求与结果

签到请求：

```http
POST https://re0.me/api/open/checkin
Content-Type: application/json
X-API-Key: <应用 Secret>
Authorization: Bearer <用户 Access Token>

{"is_gambler":false}
```

授权缺少有效 Access Token 或已过期时，有 Refresh Token 才尝试一次 OAuth 刷新请求。签到返回可刷新的授权错误时，也最多刷新一次后补发；不会反复刷新。403、429、挑战、超时或网络失败会停止并进入冷却。

后台任务自己发起的刷新请求能确认所用授权，因此服务器没有轮换 Refresh Token 时保留本次请求使用的原值；这与被动响应采集要求完整 Token 对的规则不同。重新配置或更换授权后，旧的未完成 API 请求和网页结果不会覆盖新授权、冷却或成功日期。

API 模式需要 QX build 934+，用于关闭自动 Cookie。请求禁止重定向；凭据只发往固定的 `https://re0.me`，不写入网页或日志。此实现为单账户。

只有明确的签到业务结果才记录当天成功。成功 envelope 的 `data.checked_in:true` 表示本次签成；明确已签到文案，或成功的签到 envelope 中 `checked_in:false` 与数值 `points:0`，表示今天已签到。优先保留 `data.message`。HTTP 200、任意 `success:true`、零积分本身、组件数据和失败文案均不足以证明签到成功。

## 浏览器请求与状态

- 正常首页加载后延迟 1.2 秒开始，同一页面只启动一次；浏览器本地存储保存去重和冷却状态。
- 动作发现只读取页面引用的同源 `/_next/static/chunks/` JS，优先 layout，最多 6 个去重文件。动作 ID 按部署文件列表缓存。
- 一次页面尝试最多一个签到 POST；单请求超时 10 秒，流程预算 30 秒。
- 挑战、拒绝访问、限流、登录页、服务器异常会停止后续扫描。动作过期时清除动作缓存；冷却后手动重新打开首页。
- 不自动刷新页面或重试网页安全令牌。失败冷却与成功日期独立保存，以 UTC+8 划分签到日期；较长的 `Retry-After` 优先。

重写只注入正常首页 HTML。挑战页、错误页、非 HTML 响应和重复注入会直接放行；页面已有 CSP nonce 时会复用，不放宽页面 CSP。静态文件和 Cloudflare 验证路径不注入。站点改版、页面脚本未执行或返回需要人工操作时，使用站点原有签到功能。

## 只读诊断

手动任务使用以下脚本地址：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js#mode=diagnose
```

诊断只显示是否已配置凭据、确认成功日期和冷却状态，不显示凭据内容，不发送网络请求，不修改本地状态。日常签到任务应使用没有 `mode=diagnose` 的地址。

浏览器页面结果在 `window.__re0Checkin`，最近一次阶段日志在 `localStorage.getItem("re0_auto_checkin_log")`。QX 日志记录请求状态和结果代码。

| 结果 | 含义与下一步 |
| --- | --- |
| `CF_CHALLENGE` | 完成浏览器验证，等待冷却后再打开首页 |
| `ACCESS_DENIED` | 检查账户权限、应用权限和站点访问策略 |
| `RATE_LIMIT` | 已遵循 `Retry-After` 暂停，稍后运行 |
| `UNAUTHORIZED` | 核对应用 Secret 和用户授权；需要重新授权时在站点处理 |
| `TOKEN_INVALID` | 网页安全令牌未通过，稍后手动重新打开首页 |
| `STALE_ACTION` / `NO_ACTION_ID` | 动作未确认或无法发现，稍后打开首页；站点改版可能需要更新脚本 |
| `HTML_RESPONSE` | 业务请求返回网页或登录页，签到未确认 |
| `TIMEOUT` / `NETWORK_ERROR` | 请求未确认完成，已停止并冷却 |
| `AUTH_RESPONSE_INVALID` | 授权响应格式不完整，未采用该响应中的 Token；核对授权后重试 |
| `STORAGE_ERROR` | 本地状态未能保存，请检查 QX 本地存储后再运行 |
| `BUSINESS_ERROR` / `UNKNOWN_RESPONSE` | 站点拒绝签到，或没有可信的签到结果 |

排查时提供 HTTP 状态、结果代码、只读诊断结果，以及浏览器手动签到能否成功即可。无需提供 Cookie、Secret 或 Token。

## 验证与协议来源

本地检查执行实际 QX 入口与生成的浏览器源码，模拟签到结果、授权刷新、挑战、限流、去重、超时和失败状态；测试不访问真实站点。

```bash
node tests/re0.qx.inject.test.js
node tests/re0.qx.regression.test.js
node tests/re0.qx.mock.test.js
node --check scripts/re0.qx.checkin.js
node --check scripts/re0.qx.inject.js
node --check scripts/re0.qx.setup.js
```

OpenAPI 双层认证、刷新路径和签到 payload 参考已检查的第三方客户端源码：[115-Station](https://github.com/pancras-loe/115-station/blob/38fc82a30015116de68063935639357a9439acbe/internal/api/re0.go)、[其签到实现](https://github.com/pancras-loe/115-station/blob/38fc82a30015116de68063935639357a9439acbe/internal/api/re0checkin.go) 和 [MoviePilot 插件](https://github.com/behinder85/MoviePilot-Plugins/blob/aa41de98498494cd25e78c2b066295d190c51902/plugins.v2/hdhivedian115checkin/search/hdhive/open/client.py)。

QX 请求选项参考已检查的 [官方 fetch 示例](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample-task.js)。

这些客户端引用的站点文档为 [RE0 文档页](https://re0.me/manager/api-docs) 和 [OpenAPI 文档下载](https://re0.me/downloads/openapi-docs/re0-openapi-docs.zip)。本次未直接访问这两份站点资料，也未使用真实账户验收。模拟测试通过只能说明请求和状态处理符合预期，实际签到结果以手机通知和站点账户为准。
