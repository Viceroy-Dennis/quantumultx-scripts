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
