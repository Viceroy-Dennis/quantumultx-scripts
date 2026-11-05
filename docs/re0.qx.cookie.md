# RE0 Cookie 普通签到

这是使用本人网页登录会话的独立可选入口，适用站点为 [RE0 影巢](https://re0.me)。单账号运行，默认每天手机本地时间 **00:20** 执行。

仓库的 [OpenAPI 安装入口](re0.qx.md) 仍然独立可用。仓库已有记录表明，旧 RE0 HTTPS 解密配置曾因访问问题撤回，根因尚未确认。此 Cookie 入口会为 `re0.me` 添加 HTTPS 解密和请求体重写，需要用户选择并在自己的手机上验证网页访问与首次签到。QX Cookie 版与 OpenAPI 版请选择一套任务运行。

## 安装与首次抓取

1. 在 QX 的“工具&分析 → HTTP 请求 → 添加任务仓库”粘贴：

   ```text
   https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/gallery/re0.qx.cookie.gallery.json
   ```

2. 添加 `RE0普通签到（Cookie）` 任务及配套重写。确认重写资源是：

   ```text
   https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/rewrite/re0.qx.cookie.snippet
   ```

3. 启用 QX 重写与 MITM，安装、信任 QX 的 HTTPS 解密证书，确认实际解密域名包含 `re0.me`。
4. 在同一台 iPhone 的浏览器打开 `https://re0.me`，按站点要求完成验证和登录，手动点一次“每日签到／普通签到”。收到“普通签到参数已保存”通知即表示抓取完成。
5. 手动运行 `RE0普通签到（Cookie）` 检查结果。首次手动签到已成功时，任务返回“今天已签到”属于正常结果。

请求体重写需要实际请求体。单独打开首页无法完成首次抓取；当天签到按钮不可用时，等到下一次可签到时抓取。任务的 00:20 以设备时区为准。建议使用 QX build 934 或更新版本。

## 手动配置

也可以将以下条目合并到现有配置的同名区段：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/rewrite/re0.qx.cookie.snippet, tag=RE0普通签到参数捕获（Cookie）, enabled=true

[task_local]
20 0 * * * https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.cookie.js, tag=RE0普通签到（Cookie）, enabled=true
```

重写资源包含 `hostname = re0.me`。本地配置的其他重写、任务和 MITM 域名继续保留。已有相同任务时修改原条目即可。任务仓库刷新后，检查实际任务地址、时间和配套重写。

本地脚本方式也可用：将 `scripts/re0.qx.cookie.js` 保存为“我的 iPhone／iCloud Drive → Quantumult X → Scripts → re0.qx.cookie.js”，把上面脚本 URL 替换为这个文件名，并将 snippet 中的规则加入 `[rewrite_local]`、`re0.me` 加入现有 `[mitm]` 的 `hostname`。

## 出口策略与登录状态

默认由 QX 当前规则选择出口。站点通行状态可能与出口 IP、浏览器 User-Agent 绑定，浏览器抓取与定时任务应使用相同出口。

远程任务可以通过 URL 的 `policy` 参数指定固定节点或策略名称：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/re0.qx.cookie.js#policy=URL编码后的固定节点名称
```

用实际节点名称的 URL 编码替换说明文字。脚本通过 `$environment.variables.policy` 读取，再传入官方 `opts.policy`。本地脚本也可直接填写 `RE0_CONFIG.policy`。更换出口后，重新完成网页验证和普通签到抓取。

Cookie 和同次请求的 User-Agent 保存在本机 QX 的 `re0_qx_session` 中。定时任务收到的新 Cookie 会写回该存储项，供下次使用；登录失效后会提示重新登录并抓取。

若启用此 Cookie 入口后浏览器访问出现问题，可停用／删除 `re0.qx.cookie.snippet` 的订阅及对应本地重写，并从实际 MITM 域名列表移除 `re0.me`，同时检查覆盖该域名的通配符和其他资源。网页恢复情况以同一手机的实际访问为准。清理 Cookie 入口不会配置 OpenAPI 授权，OpenAPI 仍按其独立说明安装。

## 设计与结果判断

- 捕获严格限定 `POST https://re0.me/`，请求体为 JSON 数组 `[false]`，保存真实 `Next-Action`、本人 Cookie 和 User-Agent。
- 签到前 GET 首页，更新 `hdh_sa_token` 等同站 Cookie，再提交普通签到。
- 按 RSC 十六进制记录编号解析 JSON，保留原有转义。HTTP 成功且明确 `response.success === true` 才报告成功。
- 明确的重复签到错误归为“今天已签到”。HTML、登录跳转、HTTP 500 和未知内容无法作为成功依据。
- 服务器明确报告接口编号不存在时，从当前首页同站静态脚本识别 `checkIn` 对应编号；明确报告安全参数失效时刷新首页。恢复后最多再提交一次。
- 网络中断、超时和无法确认的结果会提示在网站查看状态。Cookie、密码和令牌不会输出到日志。

## 验证

```bash
node --check scripts/re0.qx.cookie.js
node tests/re0.qx.cookie.mock.test.js
```

这些检查模拟 QX 的抓取、请求、存储、通知和结束回调，覆盖 Cookie 轮换、结果解析、接口恢复、登录失效、网络失败与超时，并校验任务仓库与重写的链接。

### 网站成功，但脚本提示结果未确认

这种情况需要检查该次签到的实际响应结构。脚本遇到未知结果时会在 QX 任务日志输出一行 `[RE0] RESULT_DIAG {...}`，包含 HTTP 状态、内容类型、响应长度及经过筛选的 JSON／RSC 层级。它仅保留协议字段、布尔状态和有限的结果代码；消息仅转换为状态标记，其他字段值隐藏。

更新任务脚本后手动运行一次，将这行日志用于排查。确认任务实际脚本地址为 `scripts/re0.qx.cookie.js`，有缓存时可在 URL 的 hash 参数前添加 `?v=result-diag` 来刷新。日志不会把 HTTP 200 自动认定为签到成功；在取得能重放问题的实际响应前，成功判断仍保持原有条件。

尚未使用真实登录会话或手机完成线上签到验证。安装后首次真实抓取和手动运行是实际验收步骤。此实现依据公开参考源码；站点更新后，自动识别失败时需要重新手动普通签到抓取。

协议与 QX 格式来源：

- [RE0 签到参考源码](https://github.com/7452323/QuantumultX/blob/7ec05e09a5af322d5f8ca14eaa165846c2b78489/task/Hdhive.js)
- [QX 官方配置](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample.conf)
- [QX 官方任务仓库](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/gallery.json)
- [QX 官方请求与任务参数](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample-task.js)
- [QX 官方重写资源](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample-import-rewrite.snippet)

## 完整可复制的生成提示词

```xml
<System_Instruction>
  <Role>
    你是熟悉 Quantumult X 原生接口、Cookie 会话与
    Next.js Server Action 的 JavaScript 工程师。
  </Role>
  <Task>
    为 RE0 影巢 https://re0.me 制作单账号自动普通签到脚本。
    首次手动签到捕获参数，之后每天设备本地时间 00:20 执行。
    作为独立可选 Cookie 入口，明确说明它需要 HTTPS 解密。
  </Task>
  <Protocol>
    普通签到为 POST https://re0.me/，请求体严格为 [false]。
    从真实请求捕获 Next-Action、本人 Cookie 和 User-Agent。
    Cookie 白名单为 token、refresh_token、csrf_access_token、
    hdh_uid、hdh_sa_token、cf_clearance。
    签到前 GET 首页并合并 Set-Cookie，更新后写回同一存储项。
    按 RSC 十六进制记录编号解析 JSON并保留原有转义。
    HTTP 成功且 response.success 严格为 true 才报告成功。
    明确的已经签到错误可归类为重复签到。
  </Protocol>
  <Implementation>
    使用 $task.fetch、$prefs、$notify、$done 和 script-request-body。
    Cookie 与 User-Agent 保持同次请求的一致性。
    可通过官方任务变量 policy 指定 opts.policy；
    关闭自动重定向，并按官方选项管理 Cookie。
    明确的 Server Action 不存在或 action_token_required 错误
    才尝试恢复，最多重试一次。
    动态编号只从同站静态脚本精确匹配 checkIn，
    限制扫描数量与运行时间。
    网络错误、超时、一般 HTTP 500 和未知响应不自动重发。
    每条执行路径最终恰好调用一次 $done，
    日志和通知不输出 Cookie、密码或令牌。
  </Implementation>
  <Delivery>
    交付独立脚本 scripts/re0.qx.cookie.js、
    原生重写 rewrite/re0.qx.cookie.snippet、
    原生任务仓库 gallery/re0.qx.cookie.gallery.json、
    中文说明 docs/re0.qx.cookie.md 和可复现模拟测试。
    任务与重写引用相同的已发布脚本链接。
    根据已有仓库安装情况保留其他入口，说明首次抓取、
    登录失效、出口绑定与恢复浏览器访问的方法。
    区分模拟测试与真机验收，不编造当前接口编号或验证结果。
    所有文件与说明自成一体，适用于首次阅读的人。
  </Delivery>
</System_Instruction>
```
