# QuantumultX Scripts

QuantumultX（圈X）脚本与模块仓库。签到、任务自动化、HTTP 重写、抓包辅助脚本统一存放于此。

## 目录结构

- `scripts/` — JS 任务脚本（签到 / 签到任务 / 自动领奖）
- `modules/` — QuantumultX `.module` 片段（本地引入用）
- `rewrite/` — 独立 rewrite 规则与重写脚本
- `capture/` — 抓包辅助脚本（锁定真实接口用）

## 使用方式

远程订阅（推荐，永久直链）：

```
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/<路径>
```

在 QuantumultX → 重写 / 脚本 中引用上述 URL 即可。模块更新后若本地有缓存，给 URL 追加 `?v=日期版本` 强制刷新。

## 已收录

### 三国咸话（每日全套任务 · QX 版）

由 Surge 版 `xianhua_task_v2.js` 完整移植：`$httpClient` → `$task.fetch`，`$persistentStore` → `$prefs`，`$notification.post` → `$notify`，存储键名与 Surge 版完全一致（可无缝共存）。

| 文件 | 作用 | 原始直链 |
| --- | --- | --- |
| `modules/xianhua.qx.module` | 模块：抓包重写 + 每日 09:15 定时任务 + MitM | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/modules/xianhua.qx.module) |
| `scripts/xianhua.qx.task.js` | 主任务：打开小程序 / 签到 / 点赞10次 / 浏览3次 / 分享1次 / 智能多端点领奖 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/xianhua.qx.task.js) |
| `capture/xianhua.qx.capture.js` | 抓包：双通道凭据隔离 + 真实领奖接口嗅探（header/body 双类型共用） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/capture/xianhua.qx.capture.js) |
| `scripts/xianhua.qx.test.js` | 体检：双通道凭据状态 + 任务列表进度诊断 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/xianhua.qx.test.js) |

安装步骤：

1. QX → 设置 → 重写 → 引用，添加模块链接 `modules/xianhua.qx.module`。
2. 打开微信「三国咸话」小程序逛一下（进社区/帖子页），凭据自动捕获并弹通知。
3. QX 首页任务区可见「咸话任务」，点 ▶ 手动跑一次；此后每天 09:15 自动执行。
4. 排查问题先跑「咸话体检」。

### 哔哩哔哩（主站 + 直播 + 漫画 · QX 版）

由 Surge 版四个脚本移植。主站/直播/漫画三个基于 Env 跨平台库（自带 `$task.fetch` / `$prefs` / `$notify` 分支），仅把投币参数改成 QX 读取方式；银瓜子脚本与抓包脚本为纯 QX 原生 API 重写。Cookie 存储键 `chavy_cookie_bilibili` 与 Surge 版一致。

| 文件 | 作用 | 原始直链 |
| --- | --- | --- |
| `modules/bilibili.qx.module` | 模块：Cookie 抓包 + 4 个定时任务 + MitM | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/modules/bilibili.qx.module) |
| `scripts/bilibili.qx.main.js` | 主站：观看 / 分享 / 投币 / 大会员签到 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/bilibili.qx.main.js) |
| `scripts/bilibili.qx.live.js` | 直播：每日签到 + 粉丝牌点亮/投喂 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/bilibili.qx.live.js) |
| `scripts/bilibili.qx.silver2coin.js` | 银瓜子自动换硬币（700 银瓜子 = 1 硬币） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/bilibili.qx.silver2coin.js) |
| `scripts/bilibili.qx.manga.js` | 哔哩哔哩漫画签到（同时兼任漫画 Cookie 抓包） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/bilibili.qx.manga.js) |
| `scripts/bilibili.qx.test.js` | 体检：Cookie / 等级经验 / 硬币余额 + 接口连通性 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/bilibili.qx.test.js) |
| `capture/bilibili.qx.capture.js` | Cookie 抓包（仅保存含 bili_jct 的完整登录 Cookie） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/capture/bilibili.qx.capture.js) |
| `tests/bilibili.qx.mock.test.js` | 本地 mock 回归测试（Node 运行，验证 QX 分支） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/tests/bilibili.qx.mock.test.js) |

投币枚数设置（三选一，优先级从高到低）：

1. 改模块 `task_local` 里主站任务行尾的 `#coin=N`（0=不投币，1-5，默认 1）。
2. 写入持久化键 `bili_coin_count`（需在 QX 里手动添加）。
3. 不动 = 默认每天投 1 枚。

安装步骤：

1. QX → 设置 → 重写 → 引用，添加模块链接 `modules/bilibili.qx.module`。
2. 打开 B 站 App 随便逛一下（直播间/漫画「我的」页面），Cookie 自动捕获并弹通知。
3. QX 首页任务区可见 4 个 B 站任务，点 ▶ 手动跑一次；此后每天 09:08 起依次自动执行。
4. 排查问题先跑「B站体检」。

本地回归测试：`node tests/bilibili.qx.mock.test.js`（6 个脚本逐个在 QX 模拟环境下执行，校验 `$done` 调用与通知输出）。

### 蜂巢（pting.club 每日签到 · QX 版）

由 Surge 版 `fengchao_task.js` / `fengchao_capture.js` / `fengchao_test.js` 完整移植为 QX 原生 API（`$task.fetch` / `$prefs` / `$notify`），存储键 `pting_cookie` 与 Surge 版一致。抓包自动过滤阿里云 WAF 临时 Cookie（acw_tc / cdn_sec_tc）。

| 文件 | 作用 | 原始直链 |
| --- | --- | --- |
| `modules/fengchao.qx.module` | 模块：Cookie 抓包 + 每天 09:14 签到 + MitM | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/modules/fengchao.qx.module) |
| `scripts/fengchao.qx.task.js` | 签到：POST /api/check-in，解析奖励/连续天数/积分 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/fengchao.qx.task.js) |
| `capture/fengchao.qx.capture.js` | 抓包：Cookie 合并 + WAF 过滤，仅有效变更弹通知 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/capture/fengchao.qx.capture.js) |
| `scripts/fengchao.qx.test.js` | 体检：Cookie 状态 + 签到端点连通性 + 今日签到状态 | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/fengchao.qx.test.js) |
| `tests/fengchao.qx.mock.test.js` | 本地 mock 回归测试（Node 运行，5 个用例） | [raw](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/tests/fengchao.qx.mock.test.js) |

安装步骤：

1. QX → 设置 → 重写 → 引用，添加模块链接 `modules/fengchao.qx.module`。
2. 在 Safari/浏览器登录 pting.club 后打开任意页，Cookie 自动捕获并弹通知。
3. QX 首页任务区可见「蜂巢签到」，点 ▶ 手动跑一次；此后每天 09:14 自动执行。
4. 排查问题先跑「蜂巢体检」。本地测试：`node tests/fengchao.qx.mock.test.js`。
