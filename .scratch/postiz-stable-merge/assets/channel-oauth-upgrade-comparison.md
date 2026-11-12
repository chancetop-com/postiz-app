# 渠道升级行为对照与待评估方案

日期：2026-11-11。对应 [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md#answer)。本文保留事实对照及先前提案；最终结论以该票 Answer 为准。

用户最终澄清“行为不变”指原来的整个flow。不破坏flow的402中止、凭据重连表单、时区等上游更新直接纳入，不再逐项待批。下文“需用户评估”“前轮提案”等记录反映此前讨论过程，不能据此重新阻塞已明确的兼容更新；只有实际无法维持flow的冲突才需用户评估。

## 用户硬约束与冲突分类补充

用户进一步明确“两笔 commit 的行为必须不变”。以下上游变化表不是三项都与定制冲突的结论，前轮将它们统一作为取舍问题过于宽泛：

- **凭据重连表单：未发现直接冲突。** 两个提交未修改重连逻辑；上游新增账号/密钥类provider分支，六项普通OAuth仍当前窗口导航，不覆盖本地添加popup或六项过滤。
- **连接时区：未发现直接冲突。** 两个提交没有定制该计算；上游改变连接请求的时区值，不替换sessionStorage传递、回传消息、关闭逻辑或白名单。这是上游行为变化，但不是已发现的定制取舍。
- **402：存在失败路径交互，尚不能断言定制冲突。** C2先解析JSON，根据err等既有条件决定是否继续，后面才有定制popup；S在解析JSON前对402直接return。它不改变正常取得授权URL时的popup链，但会改变402下的控制流。旧版是否曾继续进入popup取决于实际响应体和统一fetch/布局处理，不能简单断言“旧版402一定开窗”。应核对具体路径后判断是否破坏必须保留的行为，未经用户决定不把影响定制的变化当成已批准。

下表建议为前轮提案记录；不能解释成用户已选择它们，也不能把一般新版变化混同于必须牺牲定制的冲突。

## 比较对象与证据范围

- 定制前基线 B：`0b554e684483932d394e703208fe21648e7acd6f`。
- 第一次定制 C1：`f042c177c1a378edacd54790614bdd9f709a2480`。
- 第二次定制 C2：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`；两次定制后的行为是当前产品代码基准。
- 本次已锁定官方稳定版 S：`v2.25.3` / `a5affe62c74e39c1e7ac960d50d8418b807d532c`。这里的“新版”专指这个目标，不表示重新查询了今天的最新发布。
- 使用 CodeGraph 核对当前代码，通过 `git show C1`、`git show C2`、`git diff B S` 分别核对历史与上游变化；S 来自既有隔离副本的明确提交引用。未执行合并或运行 OAuth。静态分支和已有诊断 merge 不能证明浏览器行为通过。

## 两个 commit 分别改变了什么

| 用户操作 | 第一次定制 C1 | 第二次定制 C2 | 两次提交后的实际行为 |
| --- | --- | --- | --- |
| iframe 添加渠道 | 普通添加分支检测 iframe，把 auth/showorg/impersonate 编入 relay 地址的 hash，打开600×700 popup 并关闭添加对话框；普通浏览器仍当前页跳转 | 新增 channel-relay 页面，把 hash 中会话写入 popup 的 sessionStorage，设置 popup 标记，再跳外部 OAuth | 被覆盖的 iframe 添加分支在新窗口授权；普通浏览器不改成 popup。C1 单独提交引用了尚未加入的 relay 页面，不能将其视为独立完整实现 |
| 完成回传与刷新 | callback 识别 popup 标记，发 CHANNEL_UPDATED 给 opener 并尝试关闭；原页面监听消息并刷新渠道列表 | 未改 callback 或消息处理 | 保留跨窗口通知链；它也会在412/406分支触发，因此不是连接成功证明 |
| 可见渠道 | 未增加白名单 | 添加精确六 identifier 白名单 | social 添加列表只显示 youtube、linkedin、tiktok、facebook、instagram、instagram-standalone；article 列表、后端、已有绑定未被该过滤器禁用 |
| 重新连接 | 未修改重连 | 未修改重连 | 仍在当前窗口导航，不是 popup |
| 渠道区域主题 | 只增加消息刷新所需代码 | mode 默认 dark 改 light | 默认浅色；未因此取消用户切换主题的能力 |

## 官方稳定版变化与拟合并方案

以下“建议”供用户评估，不能从总体保留原则推出已批准。

| 项目 | 当前行为 | 官方稳定版实际变化 | 建议合并后的行为与影响 |
| --- | --- | --- | --- |
| 六项入口与新 provider | 六个精确 identifier | 新增 TikTok Business、Tumblr；上游没有本地白名单 | 保留已确认的六项；新 provider 代码保留、添加入口隐藏。`tiktok-business` 添加列表也显示 TikTok，过滤必须按 identifier |
| iframe popup 链 | 本地 relay/sessionStorage/message/close 链 | 上游没有这套定制，也没有提供等价替代 | 沿用已确认原则，完整保留本地链路，不把普通重连改 popup，不因升级顺便改来源校验或异常回退 |
| HTTP 402 时的添加流程 | 获取授权地址等请求后继续解析和使用返回值；两个定制 commit 未增加本地402中止分支 | 遇到402立即返回，覆盖普通 OAuth、账号/密钥表单、Web3、扩展四类添加路径；共享布局原有付款提示，guard 本身不新增付款 UI | **建议接受新版中止行为**：请求已被拒绝时，不继续拿返回值打开授权页或执行后续步骤。六项正常授权不变，但六项遇402的行为确实会改变，需用户评估 |
| 重连时重新输入凭据 | 统一请求重连 URL 并在当前窗口导航 | customFields provider 改为先打开表单重新输入账号/密钥等；普通 OAuth 仍当前窗口导航 | **建议保留新版表单分支**，六项普通 OAuth 重连方式不变。若已有 Bluesky 等非白名单绑定，其重连体验会变；入口隐藏不能说明存量绑定不受影响 |
| 连接请求中的时区 | `dayjs.tz().utcOffset()` | 改为 `newDayjs().utcOffset()`；helper 使用应用用户时区，连接页可从 timezoneName 缓存恢复，否则回退浏览器时区 | **建议随新版采用应用用户时区**，与新版时区设置一致；若用户设置与原推导时区不同，连接请求的偏移量会不同。这是请求数据变化，不只是显示变化，需用户评估 |
| 自定义字段说明 | 字段缺少新版 hint 提示能力 | 自定义字段可以有说明图标和悬浮提示 | 随新版保留相关代码；不开放额外渠道入口 |
| Web3 / 浏览器扩展 | Web3 code 直接拼接；部分浏览器可能在读取不存在的 chrome 全局时抛错 | Web3 code 改为 URL 编码；先检查 chrome 是否存在，缺失时走“扩展未安装”提示 | 随新版保留这些分支代码；不把它们描述成六项 OAuth popup 的必需重写 |
| 新 provider / 扩展 callback | 无 TikTok Business 参数适配及新增名称；扩展回调不处理该 lastError | 将 auth_code 转 code；新增 Tumblr/TikTok Business 名称；读取 chrome.runtime.lastError 后返回 | 保留上游兼容代码，不扩展可见渠道；不会因此增加 popup 的新成功/失败通知协议 |
| 渠道界面 | 当前布局及默认浅色 | 新移动端渠道抽屉、分组改名、支付后/HubSpot 组件 | 记录为界面变化，交由「决定品牌界面与可选服务降级的保留契约」展示具体前后对照后评估；本票不批量批准新入口或界面范围 |

## 明确不是“新版要求”的变化

将普通 OAuth 重连改成 popup、增加 postMessage origin/source 校验、校验 relay redirect、重新定义 CHANNEL_UPDATED、补失败回退或修复二步失败被选择器遮住，均不是上述稳定版相应文件的变化。此前用户要求维持现状，不能借“必要适配”把这些改进去。

目前证据没有证明必须放弃现有 popup 才能接入稳定版。已有诊断 merge 中 add.provider 与 continue.integration 均无文本冲突，本地 popup/白名单和上游变化可以同时出现在文本中；这只支持“未发现文本层面的互斥”，不证明运行兼容。

## 源码与诊断定位

- C1：`apps/frontend/src/components/launches/add.provider.component.tsx` 当前501–525；`continue.integration.tsx` 当前43–58；`launches.component.tsx` 当前365–380。
- C2：新增 `apps/frontend/src/app/(app)/channel-relay/page.tsx`；`add.provider.component.tsx` 当前687起白名单；`launches.component.tsx` 当前363默认主题。
- S `add.provider.component.tsx`：217/443/488/623的402分支；239–269的hint；557–567的chrome判断；458的Web3编码。
- S `continue.integration.tsx`：74–81的TikTok Business参数；107的时区；186–190的扩展错误；273–274的名称。
- S `launches.component.tsx`：550–589重连，561表单分支，587普通OAuth导航。此文件诊断文本冲突为import，以及light与新增移动端状态的相邻块；不能从解决冲突行推断全部行为已决定。
- S `set.timezone.tsx`：292–310缓存/回退；318–332的newDayjs。
- 相关材料：[前端逐项证据](customization-frontend-evidence.md)、[渠道静态补充](channel-oauth-discussion-evidence.md)、[诊断 merge 原始记录](diagnostic-merge.log)。
