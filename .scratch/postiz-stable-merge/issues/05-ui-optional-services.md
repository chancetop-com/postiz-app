# 决定品牌界面与可选服务降级的保留契约

Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: chancetio (agent wayfinder_ui_optional_services)
Parent: ../map.md
Blocked by: 02
Created: 2026-11-11
Resolved: 2026-11-11

## Question

上游界面与服务结构变化后，怎样逐项保留两个 commit 的品牌、入口可见性、默认主题、容错和无可选服务时仍可运行的目标？

范围包括：
- PNG logo、尺寸/出现位置、默认浅色与 SSO 强制浅色、预览页面/wrapper 的外观与容错。
- 隐藏 Agent、Plugs、Integrations、Settings、Design Media、AI 入口；仅隐藏 UI 与禁用服务是不同契约，不据文档推断后端功能已关闭。
- /user/self 无有效用户时的行为，以及网络失败、解析失败的已有回退方式。
- 缺少 OpenAI key 返回 503、MCP 启动失败不阻塞 API、未处理异步异常的处理、chat/agent 构建排除等，与新版运行依赖逐项比较。
- 稳定版新增导航/按钮/服务如何适用现有产品范围，避免自动合并使隐藏功能重新出现或影响发布/分析核心流程。

答案以具体差异及验收场景为单位，任何取代或删除都单独记录用户选择。

## Comments

- 2026-11-11：本票的新增账户功能界面边界已由 [SSO 身份与整站鉴权契约](03-sso-auth-contract.md#answer) 确定；按该契约核查所有相关新旧界面及移动入口，保留源码，不将界面隐藏扩展成后端禁用。其它品牌、媒体工具及可选服务问题仍由本票讨论。

- 2026-11-11：详见 [前端证据](../assets/customization-frontend-evidence.md) 与 [可选后端服务证据](../assets/customization-auth-evidence.md)。本票保留 open，尚无保留/替换选择。
- 媒体注释块实际还隐藏 ThirdPartyMedia；单媒体 Editor 仍可见。默认 light 也不等于禁止 dark；Logo 仅替换 new-layout 组件，预览/auth 仍有其它标识。需以实际入口和出现位置定义范围。
- 稳定版把 Plugs/Integrations 移入 Settings tabs 并增加移动导航/新入口；菜单条目删除不代表功能删除，隐藏 Settings 也不等于 route/API 禁用。
- 预览文档声称移除宽度/logo，但两提交只增加取数容错；主布局与预览对非2xx、网络拒绝、JSON错误的处理不同。需分别决定已有回退和需要适配的场景。
- 稳定版新增 Copilot single endpoint/Node handler、媒体处理轮询与 MCP_ONLY；503 和 MCP non-fatal 定制虽部分自动合并，仍需确认实际运行模式、请求身份及就绪判断。构建 exclude 不能证明导入链或服务完全被排除。

### 2026-11-11 本轮核查与既定决定的应用

- 本轮认领后使用 wayfinder、grilling、domain-modeling，并按 grilling 的事实调查要求，由两个只读子代理分别复核 C/S 的界面与可选服务。具体原行为、上游变化和适配关系见 [品牌界面与可选服务升级对照](../assets/ui-optional-services-upgrade-comparison.md)。未执行产品合并或运行验证。
- 决定依据是地图已记录的真实用户澄清：**“既然没有冲突不就能直接合并吗，我说的行为不变是指原来的整个flow”**；以及仅在确实无法保持 flow 时，先展示旧行为、新变化、具体冲突，再由用户评估。不是代理替用户回答一组新的产品选择，本轮也没有声称获得新的确认。
- 复核未发现本范围必须改变已定体验或范围的不可兼容分歧。因此直接应用既有跨票决定，不再次询问默认浅色、PNG、原入口隐藏、503 或 MCP 非阻塞启动是否保留。本票早期评论中的待确认表述，以本 Answer 的明确边界为准。
- 纠正本轮初步判断：ThirdPartyMediaLibrary 的 Import 在 C 已存在，并未被 C2 隐藏。它与发帖工具栏被注释的 ThirdPartyMedia 是不同入口；S 增加移动副本可以正常纳入，不能扩大隐藏范围。

## Answer

2026-11-11，依据用户已明确的完整 flow 保留原则及本轮 C/S 核查解决。**保留两个 commit 的品牌、主题、具体界面隐藏与已有容错；纳入不破坏这些目标的上游布局、协议和服务更新。没有新增产品取舍，也没有把技术冲突作为重复批准事项。** 决策完成不表示合并、构建或运行验收已完成。

### 保留与适配契约

| 范围 | 合并执行约束 |
| --- | --- |
| 品牌 | 保留 new-layout 的 `/logo-postiz.png` 与 32×32 显示；适配新版容器和移动布局。保留各页面原有品牌范围，不把局部替换扩大成全站去品牌，也不按旧文档删除预览 Logo/宽度。 |
| 主题 | 保留各处默认 light、SSO 浅色布局及成功后写 light cookie；保留用户随后切换深色的能力。登录页继续使用本地主题 class，同时纳入新版 MantineWrapper/Toaster、字体等兼容更新。 |
| 导航隐藏 | Agent、Settings 继续在桌面/移动导航隐藏。接受上游把 Plugs/Integrations 移入 Settings 的结构调整，不重新加可见顶级入口；保留功能源码、路由和重定向，不新增服务端拒绝。渠道自己的设置入口不在此隐藏范围。 |
| 既定其它界面限制 | 删除账户与永久交换身份的所有界面入口，遵守 [SSO 身份与整站鉴权契约](03-sso-auth-contract.md#answer)；六项渠道添加范围遵守 [OAuth 弹窗回传与六平台限制契约](04-channel-oauth-contract.md#answer)。本票不重述或扩大这些决定。 |
| 媒体工具 | 在新版发帖媒体工具区域继续隐藏 Design Media、ThirdPartyMedia、AiImage、AiVideo。保留媒体库的 ThirdPartyMediaLibrary / Import（按原条件显示）、单媒体 Editor、上传/选择/插入，以及对应新版移动布局。只隐藏原定具体入口，不解释为全站 AI/第三方媒体禁用。 |
| 主布局用户检查 | 保留现有 `/user/self` 非 2xx→null、明确 null→登录及加载等待的分工，与新版用户 effect 做必要兼容。沿用 [SSO 身份与整站鉴权契约](03-sso-auth-contract.md#answer) 的会话行为，不新增全局清理、统一错误跳转或其它认证策略。 |
| 预览 | 保留公开预览 fetch/JSON 异常及非数组数据进入原 Post not found 的回退，叠加新版内容净化、评论与显示结构。PreviewWrapper 保留非 2xx→null 且仍渲染 children 的行为，不套用主布局的登录跳转。网络/JSON 的现有未处理分支只作基线对照，不借升级扩写错误恢复。 |
| OpenAI 缺配置 | 保留已鉴权/满足权限后 chat、agent 在 key 未定义或空字符串时及时返回原 503 JSON。保留其它 API 和服务代码；不扩大成后端 AI 总开关。纳入新版 Node handler、CORS 与前端 useSingleEndpoint，并按既定会话契约保持完整 flow。 |
| MCP 与 rejection | 保留 MCP 异步启动失败记录日志且不阻塞主 API，以及已有 unhandledRejection 日志处理。不新增通用重试/异常吞掉策略，不把核心 API 可用等同于 MCP 就绪。实际 MCP_ONLY、探针和启动入口由后续票决定。 |
| 编译与新增可选依赖 | chat/agent exclude 按新编译链所需适配；它不是必须逐字冻结的业务行为，也不是功能关闭证明。接受媒体处理、上传轮询及其它带配置门控的兼容上游更新，不要求为合并开通 OpenAI/RunPod/Deepgram 等可选服务。缺可选配置时仍须验证原核心 flow。 |
| 真实不兼容的处置 | 技术冲突先做保持完整 flow 的适配。只有确实无法兼容、必须改变已定体验/范围时，列出旧/新行为、复现证据、已尝试办法及方案影响交用户评估；不把未经运行的可能风险当成已经发生的冲突。 |

### 验收场景

1. **品牌与主题**：无 mode cookie、已有 light/dark cookie、SSO 成功和随后手动切换分别验收；覆盖主布局、登录、日历、分析、账单、空媒体及移动导航，检查 PNG、背景/文本可读性和主题一致性。
2. **具体入口**：桌面与移动导航均无原隐藏菜单；发帖媒体工具栏无四项隐藏工具；媒体库 Import 有数据时仍可用，单媒体 Editor 仍可用；六项渠道及两项账户功能按各自已定契约验收。审阅路由/API，确认没有把隐藏要求扩成禁用，也没有误删渠道设置。
3. **用户状态与预览**：分别覆盖 `/user/self` 成功、非 2xx、网络拒绝和无效 JSON；主布局与预览对照各自基线。公开预览取数异常/非数组走原回退，正常帖子显示新版内容与评论；不把取数 catch 当成所有渲染错误均被捕获。
4. **缺少可选服务的完整 flow**：缺 OpenAI/RunPod/Deepgram 等可选配置时，在具备必需基础服务的本地测试环境验证 iframe 商户 SSO → 日历 → 原支持格式媒体上传 → 编辑/排程 → 分析；另验匿名预览。Copilot 的可选请求失败不能使这些原有流程白屏或失效。
5. **明确失败与启动降级**：以已鉴权、满足权限的请求核对 chat/agent 的 503 JSON；受控模拟 startMcp reject，核对日志、核心 API 和完整 flow。只在本地/测试副本中注入故障，不称 MCP 本身已就绪或所有启动失败都可恢复。
6. **可选处理与构建**：关闭媒体处理配置时验原上传完成；确有启用条件时验新版处理、请求身份、轮询和失败收尾。用实际新依赖完成构建检查，不能用 exclude、静态导入分析或文本自动合并代替编译结果。
7. **结果分类**：分别报告基线已有问题、合并新增问题、缺外部条件未验证；真实 SSO/平台授权/运行环境缺失时如实标明，不伪造通过。

### 后续衔接

- 部署入口、环境事实交给 [取得真实部署入口与外部环境证据](06-deployment-evidence.md)，运行版本、MCP_ONLY/就绪与编译策略交给 [决定源码构建与部署运行时的升级方式](07-build-runtime-strategy.md)。本票不自行选择或运行线上部署。
- 媒体处理和 Temporal 的数据/工作流兼容由 [决定现有数据与 Temporal 任务的兼容升级路径](08-data-temporal-upgrade.md) 继续；验证与最终双向差异报告交给 [决定合并验收与执行交接标准](09-acceptance-execution-handoff.md)。
- 本轮没有新增决策票：已具体化的后续事项均有所属票；尚未出现的兼容例外继续留在地图的 Not yet specified。本轮仅解决本票，不继续认领下一张非研究票。

