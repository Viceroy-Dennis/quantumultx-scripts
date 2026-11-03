# RE0 签到安装与排查

默认安装只添加 **QX 后台 OpenAPI 签到任务**，在手机本地时间每天 09:00 运行，不附带 RE0 重写或添加 MitM 域名。后台签到需要本人获准使用的应用 Secret，以及 OAuth 用户 Access Token 或同一授权的 Refresh Token；普通签到发送 `is_gambler:false`。

没有 OpenAPI 用户授权时，本脚本不能自动签到。请使用站点原有的手动签到功能；保留的页面注入兼容代码不属于默认安装功能，不再推荐通过 MitM 采集授权。

## 已导入旧重写时，先恢复浏览器访问

1. 在 QX 中手动删除 RE0 重写订阅，包括 `re0.qx.snippet`、`re0.qx.inject.snippet`，并删除本地配置里的 RE0 重写规则。
2. 检查实际生效的 MitM `hostname`，移除 `re0.me`，并处理仍会覆盖该域名的通配符或其他订阅，确保 RE0 不再被 HTTPS 接管。只停用定时任务或删除一条路径规则不会撤销域名的 MitM。
3. 更新任务仓库和脚本。仅刷新 gallery 不会清除旧重写或全局 MitM 域名；两个旧 snippet 只保留撤回说明，不能保证 QX 接受空规则更新或清除旧缓存，必须手动清理旧安装。
4. 用浏览器重新访问 [RE0 首页](https://re0.me/)，按站点要求完成验证和登录，再使用站点原有签到功能。不要重新添加 RE0 重写来尝试解决访问拒绝。

这次撤除的是会影响浏览器 HTTPS 连接的默认接管配置，不调整 DNS 或代理设置。尚未在报错手机复现或确认 DNS 泄露 / Cloudflare 拒绝的根因，也不能承诺清理后一定放行。若仍被拒绝，应记录拒绝页原文、错误码、Ray ID、发生时间，以及同一手机清理前后的访问结果；无需提供 Cookie、Secret 或 Token。

## 直接安装

1. QX → 工具&分析 → HTTP 请求 → 添加任务仓库，导入：

   ```text
   https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/gallery/re0.qx.gallery.json
   ```

2. 仅添加 RE0 签到任务，确认脚本为 `scripts/re0.qx.checkin.js`、时间为 `0 9 * * *`。不要添加 RE0 重写或 MitM 域名。
3. 按下文在手机本地运行授权配置助手。收到保存成功后手动运行一次签到任务，以通知和账户结果确认是否成功。

`gallery/re0.qx.inject.gallery.json` 保留为仅含后台任务的兼容导入入口，两者选一个。`scripts/re0.qx.checkin.js` 与 `scripts/re0.qx.inject.js` 是相同的独立脚本；原有任务地址也可更新到此实现。只保留一个 RE0 签到任务，删除全部旧 RE0 重写安装。

已有任务不会必然随 gallery 更新改地址或执行时间，请检查 QX 实际任务行。若任务仓库无法导入，直接把以下任务行添加到已有 `[task_local]` 段即可，无需任何重写或 MitM 配置：

```ini
0 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js#force-timeout=60000, tag=RE0签到, enabled=true
```

09:00 由手机本地时区决定。已有相同任务时修改原行，不要重复添加。

## 配置后台自动签到

后台使用双层认证：

```text
X-API-Key: 应用 Secret
Authorization: Bearer 用户 Access Token
```

签到要求用户授权包含 `write` 权限。网页登录 Cookie 不能替代 OpenAPI Access Token，仅配置应用 Secret 也不够。请使用你已经获准使用的应用和本人授权，OpenAPI 是否开放申请、账户权限和访问策略以站点当前说明为准。

### 运行一次本地配置脚本

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

本地配置助手是推荐的授权配置方式，不再通过 RE0 重写抓取请求头或 OAuth 响应。也兼容 QX 本地旧键 `re0_api_key`、`re0_access_token` 和 `re0_refresh_token`；只有同时具备应用 Secret 与用户 Token，或具备可刷新的同一授权时，才会执行后台 API 流程。

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

后台任务自己发起的刷新请求能确认所用授权，服务器没有轮换 Refresh Token 时会保留本次请求使用的原值。重新配置或更换授权后，旧的未完成请求不会覆盖新授权、冷却或成功日期。

API 模式需要 QX build 934+，用于关闭自动 Cookie。请求禁止重定向；凭据只发往固定的 `https://re0.me`，不写入网页或日志。此实现为单账户。

只有明确的签到业务结果才记录当天成功。成功 envelope 的 `data.checked_in:true` 表示本次签成；明确已签到文案，或成功的签到 envelope 中 `checked_in:false` 与数值 `points:0`，表示今天已签到。优先保留 `data.message`。HTTP 200、任意 `success:true`、零积分本身、组件数据和失败文案均不足以证明签到成功。

后台请求仍可能被 Cloudflare 或站点访问策略拒绝。脚本识别到挑战或访问拒绝后只会停止并冷却，不能替代浏览器验证或改变站点授权。即使代码不修改挑战页，也无法证明 HTTPS 接管与站点验证兼容，因此默认安装撤除了 RE0 重写。

成功日期与失败冷却独立保存，以 UTC+8 划分签到日期；较长的 `Retry-After` 优先。浏览器访问与手动签到由站点原有页面处理，不依赖本脚本。

## 只读诊断

手动任务使用以下脚本地址：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.checkin.js#mode=diagnose
```

诊断只显示是否已配置凭据、确认成功日期和冷却状态，不显示凭据内容，不发送网络请求，不修改本地状态。日常签到任务应使用没有 `mode=diagnose` 的地址。

QX 日志记录后台 API 的 HTTP 状态和结果代码。默认安装不向浏览器注入脚本，也不提供页面结果回传。

| 结果 | 含义与下一步 |
| --- | --- |
| `CF_CHALLENGE` | 后台 API 被要求验证，已停止并冷却；检查站点访问策略，必要时使用站点手动签到 |
| `ACCESS_DENIED` | 检查账户权限、应用权限和站点访问策略 |
| `RATE_LIMIT` | 已遵循 `Retry-After` 暂停，稍后运行 |
| `UNAUTHORIZED` | 核对应用 Secret 和用户授权；需要重新授权时在站点处理 |
| `HTML_RESPONSE` | 业务请求返回网页或登录页，签到未确认 |
| `TIMEOUT` / `NETWORK_ERROR` | 请求未确认完成，已停止并冷却 |
| `AUTH_RESPONSE_INVALID` | 授权响应格式不完整，未采用该响应中的 Token；核对授权后重试 |
| `STORAGE_ERROR` | 本地状态未能保存，请检查 QX 本地存储后再运行 |
| `BUSINESS_ERROR` / `UNKNOWN_RESPONSE` | 站点拒绝签到，或没有可信的签到结果 |

排查后台任务时提供 HTTP 状态、结果代码、只读诊断结果，以及清除旧 RE0 重写后浏览器能否正常访问和手动签到即可。无需提供 Cookie、Secret 或 Token。

## 验证与协议来源

本地检查执行实际 QX 脚本入口、保留的兼容代码与安装配置，模拟签到结果、授权刷新、挑战、限流、去重、超时和失败状态。测试不访问真实站点，不运行手机上的 QX DNS、TLS 或 MitM 链路，不能复现或证明真机的 Cloudflare 放行。

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

这些客户端引用的站点文档为 [RE0 文档页](https://re0.me/manager/api-docs) 和 [OpenAPI 文档下载](https://re0.me/downloads/openapi-docs/re0-openapi-docs.zip)。本次未直接访问这两份站点资料，也未使用真实账户或报错手机验收。模拟测试通过只能说明脚本逻辑和安装配置符合预期，实际访问和签到结果以手机与站点账户为准。
