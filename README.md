# QuantumultX Scripts

QuantumultX（圈X）脚本与模块仓库。签到、任务自动化、HTTP 重写、抓包辅助脚本统一存放于此。

## 目录结构

- `scripts/` — JS 任务脚本（签到 / 签到任务 / 自动领奖）
- `rewrite/` — QX 重写资源 snippet（纯规则行 + hostname，供「重写 → 引用」导入）
- `gallery/` — QX 任务仓库 JSON（`工具&分析 → HTTP请求 → 右上角 + → 添加任务仓库`）
- `capture/` — 抓包辅助脚本（锁定真实接口用）
- `tests/` — Node mock 回归测试（在本地沙箱里模拟 QX 环境跑脚本）

## ⚠️ QX 没有 Surge 那种 `.module` 格式

这点很重要，别被 Surge 的习惯带偏：

| 客户端 | 模块格式 |
| --- | --- |
| Surge | `.sgmodule` / `.module`（`#!name` + `[Script]` + `[MITM]`）|
| Loon | `.plugin` |
| Stash | `.stoverride`（YAML）|
| **Quantumult X** | **没有统一模块格式** |

QX 里对应拆成两件事：

1. **重写规则** → 用「重写 → 引用」或配置里的 `[rewrite_remote]` 添加一个 **snippet 文件**：只放规则行（可带一行 `hostname = %APPEND% ...`），**不能有 `#!name`、也不能有 `[段名]`**，带了会解析失败。
2. **定时任务** → 写进自己的配置 `[task_local]`，或者用 **任务仓库 JSON**（`gallery/` 目录下）导入；`task[].config` 是任务行，`task[].addons` 是跟着一起导入的重写 snippet。
3. **MitM 域名** → 放进 `[mitm] hostname`，或写在 snippet 的 `hostname = %APPEND% ...` 行里。

## 使用方式

远程直链（raw.githubusercontent.com，永久可用）：

```
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/<路径>
```

任务 URL 支持 hash 参数，例如 `#force-timeout=120000` 延长超时、`#coin=1` 传自定义参数（脚本内用 `$environment.variables` 读）。模块更新后若本地有缓存，给 URL 追加 `?v=日期版本` 强制刷新。

## 已收录

### 三国咸话（每日 / 每周 / 热力竹 · v4.1）

2026-10-30：按用户提供的 QX 请求记录接入热力竹与每周战报；只读接口实查及模拟回归通过。两个查看周任务的“未完成→完成”尚待下一周期验收，本次录制开始时已完成，不能以接口 HTTP 200 代替任务状态。

| 任务 | 周期 / 行为 |
| --- | --- |
| 打开小程序、每日签到 | 每日执行 |
| 今日点赞10次、浏览帖子3次、分享帖子1次 | 按服务器剩余进度执行，已达目标跳过；不使用虚构帖子 ID |
| 本周查看1次热力竹（1006） | 每周；访问已验证的 H5 页面，再复查任务列表 |
| 本周查看1次每周战报（3028） | 每周；请求已记录的周报接口，再复查任务列表 |
| 领取一次热力竹奖励（3014） | **一次性任务**，不按周重置 |
| 热力竹档位奖励 | 根据 `heatValue/progress` 的实际热力值、`heatThreshold` 和明确 `received:false` 顺序领取；每档领取后复查，不硬编码档位 ID。每轮最多20档，余量下次继续 |
| 福利任务 / 商城 / 等级奖励 | 只领取明确完成待领的项目；跨通道 ID 和进度记录去重 |

任务状态：`progressStatus=-1/0` 未完成、`1` 待领取、`2` 已领取。热力竹档位用 `rewardReceive {id}`，福利任务用 `getReward {taskProgressId}`，不混用、不猜 `operateType=3/4/5`。

| 文件 | 作用 |
| --- | --- |
| `gallery/xianhua.qx.gallery.json` | 每天09:14任务 + 手动只读任务列表，附凭据采集重写 |
| `scripts/xianhua.qx.task.js` | 主流程；日志列出全部每日、周、一次性/累计、商城任务的进度与状态 |
| `capture/xianhua.qx.capture.js` | 仅请求头采集；微信与H5凭据分开，不输出令牌、请求体或带凭据链接 |
| `rewrite/xianhua.qx.snippet` | 一条请求头规则 + hostname，不改请求、不用请求体嗅探 |
| `scripts/xianhua.qx.test.js` | 只读任务诊断入口 |
| `tests/xianhua.qx.workflow.test.js` | 严格请求队列的端到端模拟回归 |
| `tests/xianhua.qx.capture.test.js` | 凭据隔离、脏头过滤、无敏感日志、仅放行 |

安装：QX → 工具&分析 → HTTP请求 → 添加任务仓库，导入 gallery。升级时同步更新任务脚本和重写资源，关闭旧咸话重复任务/旧重写；已有定时行不会随 gallery 刷新自动改时，请确认 `14 9 * * *`。手机本地时区决定09:14的实际执行时刻。

首次升级后，先更新凭据重写，再在小程序依次打开福利页和热力竹页面，即使奖励已领也能捕获独立H5授权。2026-10-30抓包中的任务跳转链接 `token` 仅为一位占位值，不能据此恢复H5授权，不能用微信令牌替代。只有服务器真正下发有效H5凭据时才可在本轮内存使用。档位未检查与本周查看任务已领是两种独立状态；缺凭据时会明确提示未检查。

v4.1 日常通知仅显示签到、任务最终状态与热力竹档位检查结果，凭据自检和请求详情保留在日志；已达标任务不显示 `0/0`。只读列表入口不签到、不查看业务页面、不上报、不领奖，日志也不输出原始任务跳转URL。QX hash参数读取需要1.5.6 build918+；关闭自动Cookie需要build934+。

验收：`node tests/xianhua.qx.workflow.test.js`、`node tests/xianhua.qx.capture.test.js`、`node tests/xianhua.qx.weekly.test.js`。模拟通过仅证明流程与边界，不等于未完成周任务已在真实账户首次达成。

### 哔哩哔哩（主站 + 直播 + 漫画 · QX 版）

由 Surge 版四个脚本移植。主站/直播/漫画/体检基于 Env 跨平台库（自带 `$task.fetch` / `$prefs` / `$notify` 分支），仅把投币参数改成 QX 读取方式；银瓜子脚本与抓包脚本为纯 QX 原生 API 重写。Cookie 存储键 `chavy_cookie_bilibili` 与 Surge 版一致。

| 文件 | 作用 |
| --- | --- |
| `gallery/bilibili.qx.gallery.json` | 任务仓库：4 个任务 + 抓包重写一体导入（**推荐从这个装**）|
| `scripts/bilibili.qx.main.js` | 主站：观看 / 分享 / 投币 / 大会员签到 |
| `scripts/bilibili.qx.live.js` | 直播：每日签到 + 粉丝牌点亮/投喂 |
| `scripts/bilibili.qx.silver2coin.js` | 银瓜子自动换硬币（700 银瓜子 = 1 硬币）|
| `scripts/bilibili.qx.manga.js` | 哔哩哔哩漫画签到（同时兼任漫画 Cookie 抓包）|
| `scripts/bilibili.qx.test.js` | 体检：Cookie / 等级经验 / 硬币余额 + 接口连通性 |
| `capture/bilibili.qx.capture.js` | Cookie 抓包（仅保存含 bili_jct 的完整登录 Cookie）|
| `rewrite/bilibili.qx.snippet` | 重写 snippet：漫画 myinfo + 全站 Cookie 抓包 + hostname |
| `tests/bilibili.qx.mock.test.js` | 本地 mock 回归测试（6 个用例）|

投币枚数设置：改 gallery JSON 或 task_local 里那个 URL 的 `#coin=N`（0=不投币，1-5，默认 1）。

### 蜂巢（pting.club 每日签到 · QX 版）

由 Surge 版 `fengchao_task.js` / `fengchao_capture.js` / `fengchao_test.js` 完整移植为 QX 原生 API，存储键 `pting_cookie` 与 Surge 版一致。抓包自动过滤阿里云 WAF 临时 Cookie（acw_tc / cdn_sec_tc）。

| 文件 | 作用 |
| --- | --- |
| `gallery/fengchao.qx.gallery.json` | 任务仓库：蜂巢签到 + 抓包重写一体导入（**推荐从这个装**）|
| `scripts/fengchao.qx.task.js` | 签到：POST /api/check-in，解析奖励/连续天数/积分 |
| `capture/fengchao.qx.capture.js` | 抓包：Cookie 合并 + WAF 过滤，仅有效变更弹通知 |
| `rewrite/fengchao.qx.snippet` | 重写 snippet：抓包规则 + hostname |
| `scripts/fengchao.qx.test.js` | 体检：Cookie 状态 + 签到端点连通性 + 今日签到状态 |
| `tests/fengchao.qx.mock.test.js` | 本地 mock 回归测试（5 个用例）|

#### WPS 签到（每日 10:00 · QX 版）

第三方脚本托管订阅（脚本源：[MaYIHEI/paperclip](https://github.com/MaYIHEI/paperclip)，本仓库只托管 QX 订阅配置，脚本更新自动跟随源仓库）。

| 文件 | 作用 |
| --- | --- |
| `gallery/wps.qx.gallery.json` | 任务仓库：WPS签到 + Cookie 抓包重写一体导入（**推荐从这个装**）|
| `rewrite/wps.qx.snippet` | 重写 snippet：`page_info` 抓包规则 + hostname |

安装：QX → 工具&分析 → HTTP请求（定时任务）→ 右上角 `+` → 添加任务仓库 → 粘贴 gallery JSON 链接 → 添加「WPS签到」。然后打开一次 WPS App 的活动页（触发 `personal-act.wps.cn` 请求）即可捕获 Cookie。

### 蜗牛 I 4K 签到（wn4k.com · QX 版）

网站公开页面 https://wn4k.com/user/checkin.html 的内联 JavaScript 已核实：签到按钮使用 jQuery AJAX `POST /user/checkin.html`，`dataType: 'json'`，没有 `data` 请求体。`code: 1` 表示成功，`code: 1001` 表示今日已签到。此版本使用请求头采集 Cookie，不再依赖请求体钩子。

| 文件 | 作用 |
| --- | --- |
| `gallery/wn4k.qx.gallery.json` | 09:14 签到任务和抓包重写的导入入口 |
| `rewrite/wn4k.qx.conf` / `rewrite/wn4k.qx.snippet` | 两者二选一，会员路径的 `script-request-header` 规则和 hostname |
| `scripts/wn4k.qx.checkin.js` | 请求头采集、本地诊断和多账户签到 |
| `tests/wn4k.qx.mock.test.js` | 32 项模拟回归测试 |

需要 QX build 934+，以确保 `auto-cookie: false` 生效、不同账户的 Cookie 不混用。更新任务和重写资源后，逐个登录账户并打开会员中心或每日签到页面，即可保存 Cookie 和已核实的空体 POST 动作；收到“已保存签到请求”表示录入完成，不表示已签到。已经签到的按钮不需要再点击。

上一版保存在 `wn4k.checkin.accounts.v1` 中的 GET 签到页记录，会在采集或正常任务运行时修复成空体 POST，补上 AJAX 请求头。不清空 Cookie、不合并不同身份、不向其他域名转发凭据；已有正确 POST 动作不会被页面访问覆盖。更早的 `WN4K_CREDS` 存储仍不自动迁移，请重新打开各账户的会员页采集。

任务仍为 `14 9 * * *`。手机时区必须是 Asia/Shanghai（UTC+8）才对应北京时间 09:14。多账户串行请求；每账户临时失败最多请求三次，尊重 Retry-After，单次运行有 100 秒内部保护。HTML、验证码/访问限制、未知 JSON 不会被当成成功，也不会绕过验证。没有密码自动登录功能。

任务和重写加载同一个固定提交的脚本。升级需要替换两处地址，原 log1/capture2 固定链接不会自动升级；不要同时启用旧规则，已有任务时间不会因 gallery 刷新而自动改写。启动版本为 `2026-10-29-header3`，已通过 32 项模拟测试，手机真实账户是否签到成功仍需验收。

日志包含 `[WN4K] START/END`、账户数量、`CAPTURE saved`、`REPAIR ... GET_PAGE_TO_VERIFIED_POST`、请求方法、HTTP 状态/数字 code 和响应格式。不会打印 Cookie、账户名、完整 URL 或响应正文。HTTP 200 本身不算签到成功。

任务 URL 末尾加 `#mode=diagnose` 可手动检查本地状态，不发送请求或修改存储；移除该参数恢复签到。若正常运行仍失败，提供 `[WN4K] REQUEST` 和 `RESULT` 行即可，无需发送 Cookie。

## 手动配置（不想用任务仓库时）

把对应 snippet 的规则行贴进 `[rewrite_local]`（hostname 贴进 `[mitm]`），任务行贴进 `[task_local]`，例如：

```ini
[rewrite_local]
^https:\/\/pting\.club\/ url script-request-header https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/capture/fengchao.qx.capture.js

[task_local]
14 9 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/fengchao.qx.task.js, tag=蜂巢签到, enabled=true

[mitm]
hostname = %APPEND% pting.club
```

## 本地回归测试

```bash
node tests/bilibili.qx.mock.test.js   # 6 个用例
node tests/fengchao.qx.mock.test.js   # 5 个用例
node tests/wn4k.qx.mock.test.js      # 32 个用例
```

在 Node 沙箱里模拟 QX 的 `$prefs` / `$task.fetch` / `$notify` / `$done` / `$environment` / `$request`，逐个执行脚本并校验 `$done` 调用与通知输出。

### 途虎养车（每日双通道签到 · QX 版）

第三方脚本托管订阅（脚本源：[Sliverkiss/GoodNight](https://github.com/Sliverkiss/GoodNight)，FoKit 原作 + blackBox 修复，本仓库只托管 QX 订阅配置，脚本更新自动跟随源仓库）。

| 文件 | 作用 |
| --- | --- |
| `gallery/tuhu.qx.gallery.json` | 任务仓库：途虎养车签到 + Token 抓包重写一体导入（**推荐从这个装**）|
安装：QX → 工具&分析 → HTTP请求（定时任务）→ 右上角 `+` → 添加任务仓库 → 粘贴 gallery JSON 链接 → 添加「途虎养车签到」。然后进入微信「途虎养车」小程序的积分页面（触发 `api.tuhu.cn/User/GetInternalCenterInfo` 请求）即可捕获 Token，支持多账号。脚本每天 7:17 自动执行 App + 微信双通道签到，blackBox 由脚本在线获取。

### 影巢 RE0 签到（09:00 定时 + 打开首页自动签到 · QX 版）

导入 [RE0 任务仓库](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/gallery/re0.qx.gallery.json) 添加签到任务及附带重写，确认 MitM 包含 `re0.me`。浏览器完成站点验证和登录后打开首页，页面会自动尝试一次普通签到。后台任务每天手机本地时间 09:00 执行；后台签到需要有效的 OpenAPI 应用 Secret 和用户 OAuth Access Token。

| 文件 | 作用 |
| --- | --- |
| `gallery/re0.qx.gallery.json` / `gallery/re0.qx.inject.gallery.json` | 相同功能的任务仓库入口，两者选一个 |
| `scripts/re0.qx.checkin.js` | 签到主脚本，原有地址直接升级 |
| `scripts/re0.qx.inject.js` | 与主脚本相同的独立兼容入口 |
| `scripts/re0.qx.setup.js` | 本地授权配置助手，保存凭据，不发送网络请求 |
| `rewrite/re0.qx.snippet` / `rewrite/re0.qx.inject.snippet` | 正常首页注入、结果回传及真实 OpenAPI 授权采集 |
| `tests/re0.qx.inject.test.js` / `tests/re0.qx.regression.test.js` | 浏览器与 QX 入口、异常响应和状态回归检查 |
| `tests/re0.qx.mock.test.js` | 两个独立脚本入口、订阅和配置助手的兼容检查 |
| `docs/re0.qx.md` | 安装、本地配置、诊断和协议来源 |

后台请求使用 `X-API-Key: <应用 Secret>` 与 `Authorization: Bearer <用户 Access Token>`，发送 `POST /api/open/checkin` 和 `{"is_gambler":false}`；要求 `write` 权限。旧的 Key-only 配置缺少用户授权，网页登录 Cookie 也不能替代 OpenAPI Token。已有 Refresh Token 时支持授权续期，单次运行最多刷新一次；403、429、挑战、超时和网络失败停止并冷却。

首次配置：将 [re0.qx.setup.js](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.setup.js) 保存为 QX 本地脚本，填写自己的应用 Secret，以及 Access Token 或 Refresh Token，然后运行一次。凭据保存在 QX 本地 `re0_openapi_auth`，真实值不要写入 GitHub、远程脚本地址或任务 URL 参数。重写也能从用户真实 OpenAPI 请求和成功的 OAuth refresh 响应采集授权；被动 refresh 采集必须有完整 Access/Refresh Token 对，缺失时保持已有授权。后台自己发起的刷新能确认原授权，服务器未轮换 Refresh Token 时可保留原值。更换授权后，旧未完成请求的结果不会覆盖新状态。普通网页登录不等同于 OpenAPI 授权。具体步骤见 [安装与排查](docs/re0.qx.md)。

没有 OpenAPI 授权时，后台任务会提醒打开首页。页面方式使用浏览器当前会话，每次尝试最多一次签到 POST；只扫描页面引用的同源 Next.js JS，去重后最多 6 个，按部署缓存动作 ID。遇到挑战、权限拒绝、限流或登录页停止，尊重 `Retry-After`，不自动刷新页面或重试网页安全令牌。

只有明确业务成功或已签到结果才记录当天成功，保留 API 的 `data.message` 和 `checked_in` 结果。HTTP 200、任意组件 `success:true` 和零积分本身都不会算成功。成功日期与失败冷却独立保存，以 UTC+8 划分日期；任务的 09:00 仍由手机本地时区决定。API 模式需要 QX build 934+。

升级时同时更新任务脚本与重写资源，只保留一个 RE0 签到任务和一份重写订阅。旧 `re0.qx.checkin.js` 地址已替换成当前实现；旧全站请求头规则要更新为当前 snippet，才能获得首页注入。gallery 刷新不一定改写已有任务地址或时间，请检查实际任务行。手动任务 URL 加 `#mode=diagnose` 可只读检查配置、确认日期和冷却，不请求网络或显示凭据。

协议参考已检查的 [115-Station 客户端](https://github.com/pancras-loe/115-station/blob/38fc82a30015116de68063935639357a9439acbe/internal/api/re0.go) 与 [MoviePilot 插件](https://github.com/behinder85/MoviePilot-Plugins/blob/aa41de98498494cd25e78c2b066295d190c51902/plugins.v2/hdhivedian115checkin/search/hdhive/open/client.py)。它们引用的 [RE0 官方文档](https://re0.me/manager/api-docs) 本次未直接访问；OpenAPI 申请、账户权限和访问策略以站点当前说明为准。

本地验收运行 `node tests/re0.qx.inject.test.js`、`node tests/re0.qx.regression.test.js`、`node tests/re0.qx.mock.test.js` 及三份脚本的 `node --check`。模拟检查不代表真实账户已经签到，实际结果以手机通知和站点账户为准。
