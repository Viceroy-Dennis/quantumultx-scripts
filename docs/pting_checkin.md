# 蜂巢 Quantumult X 每日签到

`pting_checkin.js` 是直接在 Quantumult X 运行的 JavaScript 脚本，同时负责捕获登录 Cookie 和定时签到。

2026-11-08 检查时，访问 `https://pting.club/` 会跳转到 `https://fengchao.chat/login?redirect=%2F`。配置包含两个域名，脚本使用实际捕获 Cookie 的域名，不跨域转发凭据。

## 远程安装

在 Quantumult X「工具&分析 → HTTP 请求 → 右上角 + → 添加任务仓库」中粘贴：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/gallery/pting_checkin.gallery.json
```

添加「蜂巢签到」任务和附带的凭据采集重写，启用重写与 MitM，安装并信任 QX 证书。登录蜂巢后，用同一个 Safari 打开 `https://fengchao.chat/api/auth/me`，看到「凭据已保存」通知，再手动运行一次任务验证。

如果已有蜂巢定时任务，请用本任务替换。任务仓库刷新不一定改写已安装任务的时间，实际任务行应为 `14 9 * * *`。

- [脚本直链](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/pting_checkin.js)
- [重写引用](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/rewrite/pting_checkin.snippet)
- [手动配置片段](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/docs/pting_checkin.conf)

## 本地安装

1. 将 `pting_checkin.js` 保存到 iPhone「文件」里的 `Quantumult X/Scripts` 目录。可使用「我的 iPhone」或 iCloud Drive 下的 Quantumult X 文件夹。
2. 把 `pting_checkin.js` 文件头的本地配置合并到现有配置的 `[rewrite_local]`、`[task_local]` 和 `[mitm]` 对应分区；下载的 `pting_checkin.conf` 使用 GitHub 远程脚本地址，两种方式任选其一。如果已有 `hostname`，在那一行追加列出的域名。
3. 启用 QX 重写与 MitM。HTTPS 抓取需要安装 QX 生成的证书，并在 iOS「设置 → 通用 → 关于本机 → 证书信任设置」中信任该证书。
4. 在 Safari 打开 `https://pting.club/` 并登录。登录后用同一个 Safari 打开 **`https://fengchao.chat/api/auth/me`**。这里展示 JSON 是正常现象；QX 应出现「凭据已保存」通知。
5. 在 Quantumult X 任务界面手动运行「蜂巢签到」。确认提示「签到成功」或「今天已签到」后即可按定时配置运行。

默认每天 **09:14（iPhone 设备时区）**运行，cron 为 `14 9 * * *`。需要保持 Quantumult X 启用，iOS 实际后台执行受系统调度影响。

## 脚本行为

- 凭据保存于本机 `$prefs`，不在代码中填写账户密码，不输出 Cookie 日志。
- 捕获 Cookie、User-Agent 和存在时的 CSRF 请求头；原网页请求透传。
- 先请求 `GET /api/auth/me` 查询 `data.surface.checkedInToday`。已签到时直接通知，不再发送签到请求。
- 未签到时请求 `POST /api/check-in`，正文为 `{"action":"check-in"}`。
- 检查 HTTP 状态与业务错误，然后再次查询今日状态确认结果。网络超时后只查询确认，不重发 POST。
- 通知展示返回的账户、蜂蜜奖励、连续签到天数和蜂蜜余额。
- Cookie 失效、登录重定向、站点验证、业务拒绝及非 JSON 返回都会给出相应提示。

## 排查

**没有「凭据已保存」通知：** 检查本地文件名、重写/MitM 开关、证书信任及域名列表。在已登录的同一个 Safari 再打开 `/api/auth/me`，并检查 QX 通知权限。该通知只在首次保存或域名变更时提示；后续同域凭据更新静默保存。

**「登录失效」或「未检测到登录账户」：** 在 Safari 重新登录，再打开 `/api/auth/me` 更新凭据。网站登录 Cookie 有有效期，脚本不自动输入密码登录。

**「遇到网站验证」：** 在 Safari 完成网站验证，再采集 Cookie。脚本保留浏览器 User-Agent，但网站验证也可能依赖访问出口；可核对 Safari 与 QX 任务使用的网络出口。

**「接口可能已变更」或「签到结果待确认」：** 先在站内查看当天记录；当前接口形态可能发生了变化，避免仅凭 HTTP 200 判断签到成功。

**旧域名返回重定向：** 重新从 `https://fengchao.chat/api/auth/me` 采集凭据。脚本关闭自动重定向，避免把 Cookie 转发到其他主机。

## 依据与验证范围

- 当前入口：实际浏览器访问 [pting.club](https://pting.club/) 并观察到新域名登录页。
- 签到接口、请求体和状态字段依据 [PicoPanel 蜂巢适配器](https://github.com/lyxizq/picopanel-release/blob/f73d153ae173b895a41e194c7ab0b9c332551ff8/internal/ptfetch/fengchao.go)，其源码注明按 2026-10-07 的站点形态适配。
- Quantumult X 语法依据开发者 [sample.conf](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)、[sample-task.js](https://github.com/crossutility/Quantumult-X/blob/master/sample-task.js) 和 [请求头重写示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-rewrite-request-header.js)。

JavaScript 语法检查通过，24 项模拟 QX 流程测试全部通过，覆盖正常签到、重复签到、凭据失效、业务错误、超时确认、零奖励、凭据隔离及任务完成次数。未使用你的账号完成真实签到，也未在 iPhone QX 上进行实机测试。首次安装后请按上述步骤手动运行验证。
