# 确定新入口与历史业务流程的合并验收

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Codex
Resolved: 2026-11-20
Blocked by: 01, 02, 03

## Question

在核实上游行为后，如何逐项验收商户 SSO、普通登录与组织邀请、sessionStorage 的组织及代入身份、iframe 渠道弹窗与 relay、新版公开连接、品牌和隐藏入口、存量数据和任务？哪些结果可由本地隔离验证，哪些需要父应用、Safari 或真实渠道授权？仅将有证据且无法技术兼容的业务取舍交由用户决定。

## 讨论输入与建议验收样例

历史定制 `6fdf7cb5` 在添加界面的社交平台列表按 identifier 过滤。上次合并规格将六项约束应用于所有添加渠道选择列表，并保留其他 provider、接口及存量绑定。v2.26.0 新增按链接指定平台的访客同意页。用户已确认下表中的渠道范围和品牌要求。[旧版列表实现](https://github.com/chancetop-com/postiz-app/blob/6fdf7cb53543fa28a470ad63e7619e8b98bcee43/apps/frontend/src/components/launches/add.provider.component.tsx#L687-L693) · [既有渠道规格](../../postiz-stable-merge/spec.md) · [新版页面](https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/frontend/src/components/launches/connect.link.tsx)

| 入口 | 候选版本要观察的结果 |
| --- | --- |
| 父应用 iframe、商户 SSO、组织与代入身份 | 禁用第三方 Cookie，首次兑换建立商户共享账户，再次兑换复用同一账户。两个标签分别选择组织，核对刷新后的身份、管理员代入与退出，以及请求头和各自的 sessionStorage。 |
| 普通登录和组织邀请 | 通过 `/?org=…` 进入，分别用密码、普通 OAuth 完成登录；邀请参数经过后端校验，新增成员的目标组织通过 `showorg` 响应头落在当前标签页。单列已是成员、无效邀请、无邀请及未激活用户；SSO 的默认组织按旧规则选择。 |
| 普通 OAuth 与仪表盘添加渠道 | 普通登录验证 provider 和 state 绑定。仪表盘所有添加列表只提供 `youtube`、`linkedin`、`tiktok`、`facebook`、`instagram`、`instagram-standalone`。从 iframe 添加渠道时验证弹窗授权、二步选择和回传刷新。 |
| API／MCP 公开授权页 | 两个创建入口均按上游支持范围生成链接，分别覆盖六项之内和之外的渠道。匿名收件人打开链接，仅看到指定平台、我们的 Logo、默认浅色、平台图标、权限说明和授权按钮。点击继续才前往平台。验证链接一小时内可重试、到期被拒，以及取消时不会新增绑定。 |
| 公开授权回调 | 覆盖匿名、已登录同组织和已登录其他组织的收件人。验证二步选择完成后绑定归于签发链接的组织，原有标签页会话保持原身份，并覆盖自定义返回地址已有查询参数的情况。 |
| 找回密码 | 在修复前的旧格式和本地现行格式上，分别检查新鲜及到期的重置链接只能按其用途使用，既有正常会话仍能认证；20 分钟边界及两种认证传输路径都有拒绝断言。复用[专项目标与验证](../../password-reset-token-fix/review.md)。 |
| 新 UI、存量数据与任务 | 仪表盘只显示约定六项，隐藏菜单与账户入口、主题、匿名预览和可选服务降级保持原有表现。覆盖多渠道保存／删除仅影响所选项及所属组织，并核对旧渠道凭证、排程、时区、刷新和在途任务。 |
| 构建与证据 | 根目录 pnpm 测试、三端类型、lint、K8s 构建上下文一致性，以及隔离数据库升级、Temporal replay 与发送次数断言。按[前次验收规格](../../postiz-stable-merge/spec.md)记录结果；真实父应用、Safari 和各渠道授权独立记录。交付时分别列出相对旧 fork 的变化及相对官方 tag 保留的差异。 |

## Answer

2026-11-20，用户确认采用上表作为 v2.26.0 候选版本的逐流程验收标准。两个新增入口须从实际链接走到最终组织归属。

- **组织邀请。** 从邀请链接分别走密码登录、普通 OAuth 和已有 sessionStorage 会话。首次接受有效邀请时，核对新增成员的组织及角色，只有接受邀请的标签页切到受邀组织。重复邀请不新增成员，无效邀请不改变组织归属。
- **公开 Connect Link。** 用组织 A 签发的链接，覆盖匿名收件人、A 的成员及当前使用组织 B 的收件人。需要二步选择时，完成后核对绑定只出现在 A，B 的原标签页仍在 B。覆盖取消、到期和自定义返回地址携带已有查询参数的情况。

实施者须在隔离环境实跑商户 SSO、iframe 弹窗授权与回传、找回密码、旧数据升级及在途任务接续等本地必验项。Temporal 除历史回放外，还须核对 worker 的实际消费及平台替身收到的发送次数。[既有本地验收规格](../../postiz-stable-merge/spec.md) · [核实渠道凭证、在途任务与启动数据的升级条件](03-upgrade-data.md#answer)

真实父应用联调、Safari 跨站行为和六个渠道各自的真实授权须逐项记录。所有本地必验项实际通过且仅缺外部条件时，交付状态可写为「代码合并完成、本地验收通过、外部验证待补」。已观察到的流程失败按失败记录。候选版本的运行结果由实施阶段填写。[既有交付标准](../../postiz-stable-merge/issues/09-acceptance-execution-handoff.md#answer)
