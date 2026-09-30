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
