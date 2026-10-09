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

### 三国咸话（每日全套任务 · QX 版）

由 Surge 版 `xianhua_task_v2.js` 完整移植：`$httpClient` → `$task.fetch`，`$persistentStore` → `$prefs`，`$notification.post` → `$notify`，存储键名与 Surge 版完全一致（可无缝共存）。

| 文件 | 作用 |
| --- | --- |
| `gallery/xianhua.qx.gallery.json` | 任务仓库：咸话任务 + 抓包重写一体导入（**推荐从这个装**）|
| `scripts/xianhua.qx.task.js` | 主任务：打开小程序 / 签到 / 点赞10次 / 浏览3次 / 分享1次 / 智能多端点领奖 |
| `capture/xianhua.qx.capture.js` | 抓包：双通道凭据隔离 + 真实领奖接口嗅探（header/body 双类型共用）|
| `rewrite/xianhua.qx.snippet` | 重写 snippet：两条抓包规则 + hostname |
| `scripts/xianhua.qx.test.js` | 体检：双通道凭据状态 + 任务列表进度诊断 |

安装：QX → 工具&分析 → HTTP请求（定时任务）→ 右上角 `+` → 添加任务仓库 → 粘贴 gallery JSON 链接 → 添加「咸话任务」（重写规则会一起进来）。然后打开微信「三国咸话」小程序逛一下即可捕获凭据。

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

### NodeSeek 签到（风控优化版 · QX 版）

原作：[ZenmoFeiShi/Qx](https://github.com/ZenmoFeiShi/Qx) 怎么肥事，风控优化版。

| 文件 | 作用 |
| --- | --- |
| `gallery/nodeseek.qx.gallery.json` | 任务仓库：NS签到 + 凭据抓包重写一体导入（**推荐从这个装**）|
| `rewrite/nodeseek.qx.snippet` | 重写 snippet：`/api/` 全域抓包规则 + hostname |
| `scripts/nodeseek.qx.checkin.js` | 脚本本体（抓包保鲜 + 趁热补签 + 定时兜底）|
| `tests/nodeseek.qx.mock.test.js` | 本地 mock 回归测试（20 个用例）|

**为什么要优化**：签到接口挂 Cloudflare 盾，抓包存的 `cf_clearance` 短命且绑定 IP/指纹，QX 的 TLS 栈与 Safari 指纹不同，深夜定时重放必吃 403「Just a moment...」。优化版把签到时机挪到「打开 NS 页面、CF 刚放行、凭据最新鲜」的瞬间（当日仅一次），定时任务（每天 9:00）降级为兜底。

安装：任务仓库导入「NS签到」后，打开一次 nodeseek.com 任意页面即完成首次抓包+自动签到。

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
```

在 Node 沙箱里模拟 QX 的 `$prefs` / `$task.fetch` / `$notify` / `$done` / `$environment` / `$request`，逐个执行脚本并校验 `$done` 调用与通知输出。

### 途虎养车（每日双通道签到 · QX 版）

第三方脚本托管订阅（脚本源：[Sliverkiss/GoodNight](https://github.com/Sliverkiss/GoodNight)，FoKit 原作 + blackBox 修复，本仓库只托管 QX 订阅配置，脚本更新自动跟随源仓库）。

| 文件 | 作用 |
| --- | --- |
| `gallery/tuhu.qx.gallery.json` | 任务仓库：途虎养车签到 + Token 抓包重写一体导入（**推荐从这个装**）|
| `rewrite/tuhu.qx.snippet` | 重写 snippet：`GetInternalCenterInfo` 抓包规则 + hostname |

安装：QX → 工具&分析 → HTTP请求（定时任务）→ 右上角 `+` → 添加任务仓库 → 粘贴 gallery JSON 链接 → 添加「途虎养车签到」。然后进入微信「途虎养车」小程序的积分页面（触发 `api.tuhu.cn/User/GetInternalCenterInfo` 请求）即可捕获 Token，支持多账号。脚本每天 7:17 自动执行 App + 微信双通道签到，blackBox 由脚本在线获取。
