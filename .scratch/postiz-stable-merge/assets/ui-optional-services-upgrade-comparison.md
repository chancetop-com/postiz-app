# 品牌界面与可选服务升级对照

Date: 2026-11-11（Asia/Shanghai）

本文件为 [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) 的事实证据；决议只保存在该票的 Answer。对照 C=`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`（两次定制后的产品基线）与 S=`a5affe62c74e39c1e7ac960d50d8418b807d532c`（已锁定稳定版）。C1=`f042c177`，C2=`6fdf7cb5`；各自完整改动来源见 [前端逐项证据](customization-frontend-evidence.md) 与 [身份、鉴权和可选服务逐项证据](customization-auth-evidence.md)。

先用 CodeGraph 定位当前源码，再在已有隔离副本 `/private/tmp/postiz-wayfinder-three-way-n90eeeum/repo` 读取明确 C/S 引用；历史读取使用 `GIT_NO_LAZY_FETCH=1`。没有把诊断合并目录中的工作树当作官方 S。以下为静态事实及可行适配分析，不代表运行验收通过。

## 原定制、上游变化与兼容关系

本节路径以 `apps/frontend/src/` 为根，行号分别对应所标 C/S 版本。

| 范围 | 两次定制建立的实际行为 | 锁定上游的变化 | 兼容关系 |
| --- | --- | --- | --- |
| PNG 标识 | C2 将 `components/new-layout/logo.tsx:5–9` 改为 `/logo-postiz.png`，32×32、marginTop 20；未统一替换所有页面的标识。 | S 主布局 `components/new-layout/layout.component.tsx:137–139` 增加居中容器与移动抽屉；Logo 文件本身仍是原 SVG。 | 可以使用本地 PNG 并保留新版容器/移动布局；不需要恢复 SVG，也不必重写全站品牌。 |
| 默认主题 | C2 将根布局、ModeComponent、Launches、ChartSocial、EmbeddedBilling、NoMediaIcon 的缺省值改 light；SSO 成功写 light cookie，SSO 布局为浅色。`components/layout/mode.component.tsx:10–20` 仍可切换 dark。 | S 保留主题切换；主布局增加字体、时区和移动布局等。 | 默认浅色与上游新增结构可叠加；“默认浅色”不等于全站永久禁止深色。 |
| 登录页面 | C2 将 auth layout 内部硬编码黑底白字换成主题 class。 | S `app/(app)/auth/layout.tsx:19–26` 增加 MantineWrapper/Toaster，内部仍为旧暗色 class。 | 文本冲突可以组合解决：保留本地主题 class，加上新版 wrapper/Toaster。 |
| 菜单 | C1 隐藏 Settings；C2 隐藏 Agent、Plugs、Integrations；未删路由和服务。 | S 把 Plugs/Integrations 迁入 Settings tabs（`components/layout/settings.component.tsx:109–111`）；旧路由重定向到对应 tab。移动抽屉使用同一个 TopMenu（主布局 S:116–140），两组菜单均过滤 hide（top.menu S:240–243、267–270）。 | 保留 Agent/Settings hide；接受上游菜单迁移并保留功能源码、路由。不能把导航隐藏扩展为后端禁用。名为 SettingsComponent 的渠道设置是另一组件，不能因同名误删。 |
| 发帖媒体工具栏 | C2 在 `components/media/media.component.tsx:841–865` 注释掉 Design Media、ThirdPartyMedia、AiImage、AiVideo 四项。 | S 重排该区域为响应式工具栏，增加工具插槽及移动样式；旧注释不能不经适配原封粘贴。 | 在新版对应工具区域继续隐藏这四项，保留上传、媒体选择和其它上游改进；不整文件回退 C。 |
| 媒体库 Import | **C 已在 media.component.tsx:445、507 渲染 ThirdPartyMediaLibrary**，有可用数据时显示 Import；不在上述注释块内。它查询 `position === 'media-library'`，被隐藏的 ThirdPartyMedia 查询 `position === 'media'`。 | S:504、589 延续原入口，S:711 添加移动底部副本。 | 新位置不是定制隐藏失效；保持媒体库 Import 的既有条件及新版移动适配。不能把 ThirdPartyMedia 和 ThirdPartyMediaLibrary 当成一个隐藏对象。 |
| 单媒体编辑 | C `MediaComponent:990–992` 仍有 Editor，打开 Polotno；两次定制未隐藏它。 | 新版工具栏调整不等于本地要求关闭所有编辑器。 | 保留 Editor，不因 Design Media 的隐藏要求连带删除。 |
| 主布局取用户 | C1 主布局 load 对非 2xx 返回 null；user 严格为 null 时转 `/auth/login`，其它 falsy 状态渲染 null。未新增网络/JSON catch。 | S 增加用户时区、Sentry、账单及移动状态等 effect。 | 可将原用户检查与新版 effect 组合；不能让新版 effect 在 user 缺失时先抛异常，也不把原所有失败都重新定义为“未登录”。 |
| 公开预览 | C2 `app/(app)/(preview)/p/[id]/page.tsx:37–46` 捕获 fetch/JSON 异常，并只接受数组，失败进入原 Post not found 分支。C/S 都保留 `max-w-[1346px]` 与该页原 Logo；旧交接称去宽度/去 Logo 不符合这两笔提交。 | S:41 仍直接解析，但页面新增 PreviewCommentsProvider、PostContentClient、内容净化和其它预览显示。 | 可在新版结构外保留本地取数容错；不按旧文档补做去品牌/去宽度。上游预览评论不等于读取/回复社交平台评论的新项目。 |
| 预览用户包装 | C2 `components/preview/preview.wrapper.tsx:14–18` 对 `/user/self` 非 2xx 返回 null；仍渲染 children，不新增跳登录；没有网络或 JSON 本地 catch。 | S 增加 ToolTip、Copilot useSingleEndpoint。 | 保留匿名预览与原状态码保护，再纳入新版组件；不要套用主布局的 null→登录规则。 |

## 可选服务与运行依赖

本节路径均相对仓库根目录。M 指此前诊断合并的 stage-0，仅表示文本结果，不是已编译或运行的版本。

| 范围 | C 原行为与 S 变化 | 兼容关系及边界 |
| --- | --- | --- |
| 缺 OpenAI key | C1 在 `apps/backend/src/api/routes/copilot.controller.ts:41–47,67–73` 为 chat、agent 加入 `503 {error:'AI not configured'}`，条件为 key 未定义或空字符串。S 对应分支仍裸 return；M:55、82 已保留 503。 | 无上游等价替代，保留这两处明确失败响应；不扩展成全部 AI API 禁用、空白字符串校验或新的异常处理。验证时须先满足鉴权/权限，否则会先得到其它错误。 |
| Copilot 新协议 | S controller:84–87 读取 `body.body.forwardedProps.integrations`，:104–116 改为 Node HTTP handler，并添加 copilotCors；前端主布局、预览、Agent 配套 useSingleEndpoint。 | 协议、handler、前端配置成套纳入，与 503 及已有会话请求头兼容适配；不能只回退其中一半。原主布局与预览一直包着 Copilot，隐藏 AI 按钮不能证明 SDK 没有请求；也不能未经运行认定缺 key 必然使页面空白。 |
| MCP 启动 | C1 `apps/backend/src/main.ts:57` 不 await startMcp，catch 记录错误；S:59 仍 await。M:69 保留 C，同时纳入新版 Copilot Express 路径语法和帖子校验 filter。S start.mcp 增加工具/widget 初始化。 | 继续保持 MCP 异步启动失败不阻塞核心 API 的处理。它不保证 MCP 就绪，也不覆盖 Nest 创建前模块加载/DI 的失败。MCP_ONLY 与真实 readiness 属于后续部署/运行时证据，不在此擅选。 |
| 未处理异步 rejection | C1 main:12–14 添加进程级 unhandledRejection 日志监听器，不主动退出；S 无该定制，M 保留。 | 保留现状，不扩大为所有异常都可恢复、不新增重试或忽略其它致命错误的策略。 |
| chat/agent 编译 exclude | C1 `apps/backend/tsconfig.build.json:8–9` 增加两个 exclude；S 与原基线相同。main 仍导入 startMcp，ChatModule 仍注册相关依赖，S 又添加 McpRelayService。 | 保留可兼容的编译配置，但 exclude 不是功能删除或成功构建证据。只按新编译链实际需要做技术适配，不能把配置字符串本身等同于产品契约。 |
| 媒体处理 | S `libraries/nestjs-libraries/src/upload/upload.factory.ts:34–51` 仅在 cloudflare、RunPod key 与 endpoint 齐备时创建 processor，否则 null；clipping 还有 ingest/clipper/Deepgram/OpenAI 条件（:54–90）。`database/prisma/media/media.service.ts:184–218` 无 processor 时返回已保存媒体，工作流启动失败有释放原媒体分支。前端 app layout 使用对应门控。 | 静态证据不支持“缺少这些可选配置必然阻塞原上传 flow”。纳入处理/轮询更新；未启用时需验原上传，实际启用时另验身份、轮询与失败状态。运行与配置事实由后续票核实。 |
| 其它可选依赖 | S Chatbase 无 token 时不渲染，GTM 无 id 时返回；Deepgram 到方法调用才请求服务，Seedance 根据 key 标记 available。 | 不因完整合并上游历史要求额外开通这些服务；源码门控不替代实际启动与核心流程验证。 |

## 核查中的纠正

本轮最初将新版第三方媒体库入口误判为会使隐藏功能重新出现；继续比对 C/S 后已纠正，且已在聊天中明确说明。上表的 ThirdPartyMedia / ThirdPartyMediaLibrary 区别是最终结论。它也修正“隐藏 AI / 第三方媒体”这种过宽的概括：本地改动只隐藏已指出的具体入口，不能由此推导全站功能或后端已经关闭。

## 证据限制

本轮没有安装依赖、构建、运行浏览器或连接服务，没有产品代码变更、实际合并、部署或真实数据操作。源码显示这些 UI 定制可与锁定上游结构共存；最终像素、主题闪烁、移动点击、匿名预览、Copilot 请求及外部服务可用性仍须在执行阶段验证。部署入口、Node/依赖版本和实际运行模式已有后续决策票负责，不能由静态分析代填。
