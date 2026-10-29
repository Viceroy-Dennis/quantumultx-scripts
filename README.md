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

### 三国咸话（每日全套任务 · v3.6 正式版）

**状态：正式版** ✅（2026-10-11 实测验收通过）

- 动作：打开小程序 / 每日签到 / 点赞10次 / 浏览3次（wxforum 真阅读 + api-xh 五连链） / 分享1次
- 领奖：api-xh `getReward{taskProgressId}` 主通道（st1=完成待领取）+ wxforum 商城备用
- 抓包：双通道凭据（wxforum + api-xh），脏头过滤（`[object Null]` / undefined / null 统一丢弃）

| 文件 | 作用 |
| --- | --- |
| `gallery/xianhua.qx.gallery.json` | 任务仓库：咸话任务 + 抓包重写一体导入（**推荐从这个装**）|
| `scripts/xianhua.qx.task.js` | 主任务脚本 |
| `capture/xianhua.qx.capture.js` | 抓包：双通道凭据 + 领奖接口嗅探 |
| `rewrite/xianhua.qx.snippet` | 重写规则（若手动配置用这个）|
| `scripts/xianhua.qx.test.js` | 体检测试脚本 |
| `tests/xianhua.qx.mock.test.js` | Node mock 回归测试 |
| `tests/xianhua.qx.notification.test.js` | 通知与状态判断回归测试（25 个用例）|
| `rewrite/xianhua.qx.snippet` | 重写 snippet：两条抓包规则 + hostname |
| `scripts/xianhua.qx.test.js` | 体检：双通道凭据状态 + 任务列表进度诊断 |

安装：QX → 工具&分析 → HTTP请求（定时任务）→ 右上角 `+` → 添加任务仓库 → 粘贴 gallery JSON 链接 → 添加「咸话任务」（重写规则会一起进来）。然后打开微信「三国咸话」小程序逛一下即可捕获凭据。

#### 任务结果通知

正常完成时，通知正文只显示三行结果，例如：

```text
三国咸话 · 每日任务完成
签到：成功
点赞 10/10 · 浏览 3/3 · 分享 1/1
奖励：新领取 3 项
```

- 凭据长度、请求头字段、浏览链路和逐项领奖响应保留在 QX 任务日志，不再塞进结果弹窗。
- 点赞、浏览、分享优先展示服务端任务进度；api-xh 进度优先于 wxforum，备用通道的领奖成功不会覆盖主通道的未完成状态。
- 奖励区分新领取、此前已领取、失败、待领取和未确认；没有领取请求不等于奖励已领取，也不会根据任务次数推算积分数量。
- 只有任务与奖励结果均已确认，才显示完成标题；部分失败、登录凭据失效或结果未确认会显示对应状态。正常执行、无凭据和异常退出均只发一条通知。

任务脚本路径、定时计划、重写规则和本地凭据键不变，已有安装只需要刷新主脚本缓存，不必重新导入任务或重新抓取有效凭据。通知逻辑通过 25 项本地模拟测试，未使用真实账户或 iOS 设备验收；实际弹窗是否折叠仍受 iOS 通知展示方式影响。

本地验证咸话流程与通知：

```bash
node tests/xianhua.qx.mock.test.js
node tests/xianhua.qx.notification.test.js
```

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

### 影巢 RE0 签到（v4 注入式 · QX 版）

re0.me（影巢/HDHive 的新家，hdhive.com 已停放）每日签到。Next.js 架构，全站（网页 Server Action、`/api/customer/*`）挂 Cloudflare 交互盾。

> **为什么是 v4**：cf_clearance 绑定 Safari 的 TLS/JA3 指纹。旧版（v1~v3）让 QX 用 `$task.fetch` 在后台重放 Server Action，TLS 指纹对不上，深夜/无浏览器上下文时必然 403 撞墙。v4 彻底换思路——**不在 QX 后台发请求，而是借 Safari 的手签**。

| 文件 | 作用 |
| --- | --- |
| `gallery/re0.qx.inject.gallery.json` | 任务仓库：RE0签到 v4 + 注入重写一体导入（**推荐从这个装**）|
| `rewrite/re0.qx.inject.snippet` | 重写 snippet：首页响应注入 + 图片信标回包，两条规则 |
| `scripts/re0.qx.inject.js` | 脚本本体（响应注入 + 信标接收 + 可选 OpenAPI 定时）|
| `tests/re0.qx.inject.test.js` | 注入 JS 浏览器沙箱测试（17 个用例）|

**v4 工作原理**：

1. `script-response-body` 拦截 re0.me 首页，在 `</body>` 前注入一段 IIFE。
2. 注入 JS 在 **Safari 页面上下文**里运行：动态读首页引用的 `(app)/layout-*.js`，正则挖当前部署的 `checkIn` action id（不写死，站点重新部署自适应），然后 `fetch("/", {method:"POST", headers:{"Next-Action":id,...}})` 发**同源** Server Action。真 TLS、真 cf_clearance、真浏览器，CF 从原理上无法拦截。
3. 结果通过一张同源图片信标 `/re0-checkin-report.gif?ok=&msg=` 递回 QX（`script-echo-response` 接住回 1×1 GIF 并发系统通知）。
4. 当日去重用页面 `localStorage`（跨天自动失效）。打开任意 re0.me 页面即自动签到。

**可选 OpenAPI 通道**：在脚本顶部填 `RE0_API_KEY`（re0.me 个人设置/开发者页申请），定时任务走 `POST /api/open/checkin`——全站唯一不挂 CF 盾的接口，可纯后台签到，无需开页面。

安装：任务仓库导入「影巢 RE0 签到·注入式」，打开一次 re0.me 即完成首次签到。旧版 `re0.qx.checkin.js`（v3 fetch 重放）因撞墙已弃用，仅留档。
