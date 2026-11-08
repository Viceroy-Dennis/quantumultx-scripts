# 淘宝淘金币 · Quantumult X 本机采集与 H5 执行器

**这份交付目前是可运行的请求采集器和待适配的 H5 执行器，不是已经验证可领金币的成品签到脚本。** 没有你的真机请求样本，无法确认当前淘宝版本的签到接口、业务参数和成功字段。脚本因此默认处于 `inspect` 诊断模式，定时任务默认关闭，没有内置猜测的签到 API。

检查日期：2026-11-08。没有使用真实淘宝账号调用签到接口，也没有在 iPhone 上测试。已在模拟 Quantumult X 环境下验证签名、存储、错误处理与执行状态；模拟通过不代表淘宝接口可用。

## 文件

| 文件 | 用途 |
| --- | --- |
| `taobao_coin.js` | 无外部依赖的采集、诊断、标准 H5 签名和定时执行逻辑 |
| `quantumultx.conf` | 合并进现有配置的重写、定时与 MitM 片段 |
| `README.md` | 安装、适配和排错说明 |
| `taobao_coin.snippet` | 可以加入 Quantumult X「重写 → 引用」的远程采集规则 |

## GitHub raw 入口

- [脚本](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/scripts/taobao_coin.js)
- [重写引用资源](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/rewrite/taobao_coin.snippet)
- [手动合并配置](https://raw.githubusercontent.com/Viceroy-Dennis/quantumultx-scripts/main/docs/taobao_coin.conf)
- [完整说明](https://github.com/Viceroy-Dennis/quantumultx-scripts/blob/main/docs/taobao_coin.md)

远程采集可直接导入重写引用资源，再把手动配置中的 `[task_local]` 任务行加入现有配置，保持 `enabled=false` 并手动运行。重写引用和手动配置中的三条重写规则二选一，避免重复。带 `[段名]` 的 `.conf` 是合并说明，不能作为重写引用导入。

需要编辑 `CONFIG` 进行接口适配时，下载脚本到手机本地，并把三条重写规则和任务行的脚本地址统一替换成 `taobao_coin.js`，使用同一份本地配置。远程脚本仍是默认诊断配置，编辑本地副本不会改变远程脚本。

## 先完成本机采集

1. 把 `taobao_coin.js` 保存到 iPhone 的「文件 → 我的 iPhone → Quantumult X → Scripts」，或 Quantumult X 使用的 iCloud Drive `Scripts` 文件夹。文件名保持不变。
2. 把 `quantumultx.conf`（GitHub 中为 `docs/taobao_coin.conf`）的内容分别合并到现有 `[rewrite_local]`、`[task_local]`、`[mitm]` 段；本地使用时将四处 raw 脚本地址改为 `taobao_coin.js`。已有 `hostname` 时，在原列表末尾追加三个域名，保留原配置。不要用这个片段替换整个 Quantumult X 配置。
3. 在 Quantumult X 中启用重写和 HTTPS 解密，按应用内说明安装并信任其 MitM 证书。采集期间若同一接口还有其他重写规则，先停用冲突项。
4. 保持脚本顶部 `mode: "inspect"`、`api: ""` 和任务 `enabled=false`。打开淘宝的淘金币页，手动进行一次签到，然后在 Quantumult X 任务列表中手动运行「淘宝淘金币」，或从脚本编辑器运行。
5. 查看任务日志中的 `[淘金币诊断报告]`。报告包含 API 名、方法、传输类型、请求/响应字段类型和 MTOP 返回码；不会输出 Cookie、完整请求 URL、参数值或响应字符串值。

采集阶段始终用 `$done({})` 放行原请求和响应，不改写淘宝流量。脚本不会自动点击页面或自动选择一个接口去签到。

默认筛选 `mtop.coingame.*`、`mtop.taobao.taocoin.*`、`mtop.taobao.coin.*` 和 `mtop.taobao.bgc.*`。这些只是候选前缀，**并不表示其中任何接口已经确认是签到接口**。如果当前签到使用其他 API，在 Quantumult X 请求记录里找到对应 API 名后填入 `CONFIG.api`，脚本也会采集这个精确名称。

分享诊断时，只分享脚本输出的报告，并再检查一次字段名是否含个人标识。不要分享原始请求、完整 URL、Cookie、token、账号 ID 或 `$prefs` 导出。默认 API 为空时只保存有限条诊断；配置精确 API 后，匹配请求的完整凭据才会随请求一起保存在本机。**本机存储不等于加密存储**，也可能随应用备份迁移。

## 根据真实请求完成适配

需要确认以下信息：

- 哪条请求确实完成「淘金币签到」，而不是加载页面、查询余额、普通领取或提交浏览任务。
- 它是否使用标准 H5 MTOP：HTTPS `/h5/`、`appKey`、`t`、`sign`、JSON `data`，以及对应的 H5 token Cookie。
- 响应中哪些 `data.*` 业务字段明确表示签到完成/今日已签到；不能只看 HTTP 200 或 `ret: SUCCESS`。
- `data` 和其他参数能否跨日复用。含一次性凭证、任务实例 ID、日期、设备证明或变化的活动参数时，需要为该接口编写专用适配逻辑。

脚本顶部的配置字段：

| 字段 | 说明 |
| --- | --- |
| `mode` | `inspect` 查看诊断；`run` 尝试执行；`clear` 清理本脚本数据 |
| `api` / `version` | 从实际签到请求确认的完整 API 名和版本号 |
| `dataMatch` | 精确筛选请求业务动作；路径相对于解析后的请求 `data`，空数组表示不增加筛选条件 |
| `successAll` | 必填的成功条件数组；路径从响应 JSON 根开始，必须为 `data.*`，全部条件严格匹配才成功 |
| `alreadyAll` | 可选的「已签到」条件数组，同样必须为 `data.*`；也要求 MTOP SUCCESS |
| `reusablePayloadConfirmed` | 确认参数能够跨日复用后设为 `true`；开关本身不会刷新动态参数 |
| `maxCaptureHours` | 请求记录的最长可执行年龄，默认 48 小时，允许范围大于 0 且不超过 168 小时；超期只停止执行，不自动删除凭据，删除需使用 `clear` |

规则项的格式是 `{ path: "字段路径", equals: 值 }`。例如，**仅当你实际看见并确认**响应为 `{"data":{"checkin":{"completed":true}}}` 时，成功条件才可以写成 `[{path:"data.checkin.completed", equals:true}]`。这是规则语法说明，不是已验证的淘宝返回字段。布尔 `true` 与字符串 `"true"` 不相等。

配置好规则后，仍先保持 `inspect`，再次手动签到/打开相应功能，让脚本捕获匹配请求和同一次请求的成功响应。只有观察到与当前规则一致的业务结果，才把这份记录标为可执行。修改 API、筛选规则或结果规则后，需要重新采集验证。

某些接口在「已签到」时只查询状态、不再发送签到请求，可能需要等下一次实际签到才能采到请求。不要为了让状态变绿而把页面加载成功字段填成签到成功条件。

## 启用执行

适配完成后：

1. 使用 **Quantumult X build 934 或更新版本**。执行器使用 `auto-cookie: false` 来避免自动 Cookie jar 与保存的 Cookie 混用；旧版本不支持这个选项。
2. 先停用三条采集重写，防止执行请求再次覆盖正在使用的录制记录。需要重新采集时再临时启用。脚本当前保存一个选定请求，请勿同时手动启动多个执行任务。
3. 将 `mode` 改为 `"run"`，手动执行一次，查看通知和淘宝页面的实际结果。
4. 确认适配有效后，把 `[task_local]` 中该任务的 `enabled=false` 改为 `enabled=true`。

默认 cron 是 `14 9 * * *`，即每天手机本地时间 09:14；手机为北京时间时，就是北京时间 09:14。脚本的每日重复检查固定按北京时间计算。iOS/Quantumult X 的后台调度还取决于设备与应用运行状态。

脚本仅刷新标准 H5 的 `t` 和 `sign`，保留捕获的 `data` 原字符串及其他参数。不会自动完成浏览、广告、购物、助力等任务，也不会生成原生安全签名。

**当前不刷新登录态、H5 token 或业务参数，也不合并响应里的 `Set-Cookie`。** Token 到期后会停止并提示重新采集。`maxCaptureHours: 48` 只是记录的年龄上限，不代表 token 有效 48 小时；因此这份执行器目前不保证长期无人值守。真正的持续签到需要依据实际接口继续适配 token 刷新和动态参数。

## 执行结果与错误处理

- 只向所录制的白名单淘宝主机发送成套请求与 Cookie，禁用 HTTP 自动跳转，保持 TLS 证书验证。
- 用原 token、原时间戳、appKey 和原 `data` 校验录制签名，确认它符合本执行器支持的标准 H5 算法后才接受。
- 请求前保存当日「已尝试」状态；每个账号、每个 API、每个北京时间日期最多发起一次。不要同时启动多个实例：`$prefs` 不提供跨实例原子锁。
- 超时、网络中断、结果不明都不自动重试；请求可能已在服务器完成，需要到淘宝确认。
- 只有 MTOP SUCCESS 和配置的业务条件同时匹配，才记录「确认成功」。金币数量以淘宝实际显示为准。
- 账号由 Cookie 内的 `unb` 区分，本机只为执行状态保存其摘要；Cookie 和原请求始终成套保存，不会拼接另一次请求的 Cookie。没有稳定账号标识的请求不会进入执行器。
- 总预算 12 秒。脚本内部对重复 `$done` 和超时后晚到的响应做了保护。

## 常见情况

| 现象 | 含义与下一步 |
| --- | --- |
| 没有诊断记录 | 检查文件名、重写/MitM、证书信任、冲突规则和实际请求域名/API；无匹配不等于没有签到请求 |
| `/gw/` 或带 `x-sign` / `wua` / `x-mini-wua` | 原生安全签名路径，当前 H5 执行器不支持；不能把路径改成 `/h5/` 就认为能执行 |
| 缺少 Cookie、H5 token 或 `unb` | 当前抓到的不是完整可用 H5 登录请求，需重新采集或专用适配 |
| 原签名与 H5 算法不匹配 | 可能是其他签名方式、Cookie/token 不对应或参数编码差异；停止，核实原请求 |
| 捕获请求但没有响应结构 | 响应体为空、响应重写冲突或缺少可关联的 sessionIndex；不能据此验证成功 |
| 只出现 `SUCCESS`，结果未确认 | 网关成功不等于签到成功，需检查真实业务字段 |
| token 已过期 | 当前不自动刷新，需要重新采集；仅调整时间戳无法续期 |
| 返回验证/风险/限流代码 | 到淘宝手动处理，脚本不自动绕过，也不重试 |
| 今日已尝试 | 当天已经发送过请求，包括结果不明的请求；先看淘宝实际状态 |

若 TLS 无法被当前 MitM 解密或请求使用未暴露的原生通道，Quantumult X 采集不到完整样本，需要换用能观察实际请求的设备/环境或采用界面自动化。当前证据不足以断言所有淘宝版本都支持这套 H5 路线。

## 清理

停用本脚本的采集重写和定时任务，将 `mode` 改为 `"clear"`，手动执行一次。它只清理 `local.taobao.coin.` 下本脚本使用的三个记录，不影响其他脚本。随后恢复 `inspect`，或者移除脚本与配置。

清理也会移除当日尝试记录；不要把清理当作重复签到按钮。

## 技术依据与验证范围

- [Quantumult X 官方配置](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)：重写、`url-and-header`、任务与 MitM 配置。
- [官方 task 示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-task.js)：`$task.fetch`、定时退出、重定向和自动 Cookie 设置及版本限制。
- [官方 rewrite 示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-rewrite-with-script.js)：`$prefs`、请求/响应对象和 `sessionIndex`。
- [请求 header 示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-rewrite-request-header.js) / [响应 header 示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-rewrite-response-header.js)：原样放行与状态码读取。
- [H5 MTOP SDK 代码镜像](https://github.com/maozhijun/baiyunpiaopiao/blob/1bfa47895bdeaef5bd145c242acc0115dea49770/encodes/public/js/youku/mtop.js)：通用 H5 签名实现参考，不是淘金币接口的官方文档。

已找到的公开淘金币脚本中存在固定 `sign=ff`、缺少完整签名或仅凭 MTOP SUCCESS 报成功的情况，因此没有照搬其中的签到端点。这次交付没有验证一个真实可用的签到 API，也没有把模拟接口当成正式 API。

离线验证覆盖：UTF-8 MD5、GET/POST 原始 data 保留、请求/响应关联、业务字段严格判断、跨账号状态隔离、每日尝试限制、写入失败、token 到期、网络异常、超时竞态、域名限制、原生签名拒绝、JSONP 不执行代码、日志字段脱敏、数据清理。测试使用虚构数据，不访问淘宝网络。
