# 合并地图初始事实核查

Date: 2026-11-11（Asia/Shanghai）
Repository: /Users/chancetio/Desktop/Web/postiz-app
Status: 只读调查，不是兼容方案或验收完成声明

## 证据与边界

- 历史资料：[版本审计交接](handoff-version-audit.md)、[旧项目改造交接](handoff-project-customizations.md)；均按用户提供的原文保存。
- 当前基线：dev@501e87dbfb2ca6e44662baec308afa468a922b38。6fdf7cb5 后仅 2b2a9d213（AGENTS/CLAUDE/docs/agents）和 501e87dbf（CodeGraph ignore），无产品变更。初查工作树干净。
- 未执行 merge、安装依赖、应用构建、浏览器回归或任何部署。没有读取 secret 或连接集群。
- 来源为本地 Git 历史、CodeGraph 和配置/文档；下面行号基于当前基线，不保证升级后不变。

## 必须进入逐项清单的现有行为

| 领域 | 已观察事实 | 主要证据 |
| --- | --- | --- |
| SSO 输入 | /sso?auth_code；无 URL code 时接收白名单 origin 的 SSO_TOKEN + auth_code；旧 /auth/sso?token 仍做适配 | apps/frontend/src/app/(app)/sso/page.tsx:15；auth/sso/page.tsx:8 |
| SSO 验证 | 向完整 SSO_SERVER_URL POST {auth_code}，要求 merchant_id、merchant_name；不追加路径，无本地签名验证/超时 | apps/backend/src/services/auth/sso.service.ts:17 |
| 身份 | Provider.GENERIC + providerId=merchantId；复用用户及第一个组织；首次自动创建用户与组织，用户邮箱形态 merchantId@sso.merchant | apps/backend/src/services/auth/auth.service.ts:320 |
| 成员 | 新非 LOCAL 用户自动激活，组织成员为 SUPERADMIN | libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts:260 |
| SSO 输出 | auth/可选 showorg 响应头、{login:true}；失败 400；前端强制浅色，依 isGeneral 去 launches 或 analytics | apps/backend/src/api/routes/auth.controller.ts:224；SSO 页面 |
| 整站鉴权 | sessionStorage 的 auth/showorg/impersonate 注入 header；响应保存、logout/401/reload/onboarding 处理；普通登录/注册/激活/OAuth、切组织、impersonation 都涉及 | libraries/helpers/src/utils/custom.fetch.func.ts:21；apps/frontend/src/components/layout/layout.context.tsx:44 |
| 旁路请求 | Uppy 与 Copilot 同样有认证 header 定制，不能只检查统一 fetch | libraries/react-shared-libraries/src/helpers/uppy.upload.ts:101；apps/frontend/src/components/new-layout/layout.component.tsx:86 |
| cookie 兼容 | middleware 仍读 cookies，showorg/impersonate 甚至 cookie 优先；非彻底移除 cookie | apps/backend/src/services/auth/auth.middleware.ts:34 |
| 页面与退出 | proxy 不再使用 auth cookie 门禁；/user/self 非成功跳登录；退出按钮清 sessionStorage 后跳登录，不调用 logout API | apps/frontend/src/proxy.ts；components/new-layout/layout.component.tsx:60；components/layout/logout.component.tsx:25 |
| OAuth relay | iframe 开 popup，以 hash 传会话；relay 转入 popup sessionStorage、设 channel_popup_mode；OAuth 完成通知 opener 并刷新渠道、关闭 popup | apps/frontend/src/components/launches/add.provider.component.tsx:501；app/(app)/channel-relay/page.tsx:10；continue.integration.tsx:45；launches.component.tsx:368 |
| 渠道范围 | 六个 identifier 白名单仅限制 Add Channel UI，不是后端 provider 禁用 | apps/frontend/src/components/launches/add.provider.component.tsx:689 |
| 外观与入口 | PNG logo、默认浅色、隐藏 Agent/Plugs/Integrations/Settings、Design Media/AI；预览及用户请求容错 | components/layout/top.menu.tsx:60；components/media/media.component.tsx:840；两 commit diff |
| 可选服务 | OpenAI key 缺失时 Copilot 503；MCP 失败不阻塞 API；unhandledRejection 记录但不主动退出；chat/agent 构建排除 | apps/backend/src/main.ts:12；api/routes/copilot.controller.ts:42；tsconfig.build.json |
| 反代 | API 300 秒超时，禁 buffering/cache；前端 frame-ancestors * | var/docker/nginx.conf:37 |

注意：当前 CHANNEL_UPDATED 发送 targetOrigin=*、接收方不校验 origin/source、relay 不校验 redirect；SSO_PARENT_ORIGINS 未发现服务端读取。它们是需要具体决策的实现事实，不是默认已批准修复或必须原样保留的业务目标。

## 历史交接的修正

1. 旧交接明确“不修改父应用代码”，需用现有外部接口来落实；父应用真实采用 URL 还是 postMessage 尚无运行证据。
2. 两份 SSO 文档声称独立 /auth/sso/create-account、needsCreation、SSO 完成/失败通知父页；源码没有这些实现。SsoCreateAccountDto 存在但无调用。现有流程自动开户。不能把文档的完成状态当作实际完成。
3. 旧交接一处要求自动追加 /api/sso/verify，另一处却配置完整 /auth/code/redeem。源码直接使用完整 SSO_SERVER_URL，升级不能按错误段落拼接路径。
4. 旧交接称 preview.wrapper 去掉固定宽度及 logo；两个 commit 的实际 diff 仅增加 fetch 失败返回 null，不据此新增“去掉 logo”任务。
5. 首个定制 commit 引用第二个才加入的 SsoService/SsoLoginDto，不应当作独立可构建的验收单位。

## 构建与部署证据

- k8s/build-postiz.sh:99 删除副本后于 101–136 复制根源码，再以 k8s 为 ACR context；所以“必须手工同步”不成立。但源目录是 :13 硬编码的 /Users/cyril/workspaces/postiz-app，不是自动定位当前工作区。
- 脚本 :166 会 kubectl set image，再等待 rollout；默认 ACR 与 --local 推镜像路径均会部署。不能把运行此脚本当成仅本地构建检查。
- k8s tracked 文件共 804；799 个有根同名文件，797 个相同；两个差异为 .dockerignore 与 apps/frontend/public/magic.svg。共用业务源码当前一致。
- docker/docker-compose.yaml:3 和 .github/workflows/build-containers.yml:52 使用根 Dockerfile.dev；根 docker-compose.yaml 直接用官方镜像。实际入口尚未知。
- 根 Dockerfile.dev → pnpm pm2 → package.json:18 会先 prisma-db-push；:34 含 --accept-data-loss。k8s/Dockerfile:67 直接 nginx + pm2-runtime，没有同样步骤。未执行上述命令。
- var/docker/docker-build.sh:6 引用 Dockerfile.dev 中不存在的 dist/devcontainer stages；k8s/Dockerfile.runtime 的输入被对应 .dockerignore 排除。存在文件不等于入口已经可用。
- 旧交接指向外部 fbr-env-project/azure/dev/kube/resource/app/ai/positz/，并描述 AKS/ACR、PVC、ConfigMap、探针等。这是历史线索，不是当前集群事实。只做了有限常见路径检查，未找到该仓库，不能据此声称整台机器不存在。
- 用户答复实际线上构建路径“不确定”；无需猜测。应获取清单位置或去敏证据，不索取 secret 值。

## 验证准备

本机 Node 22.22.3、pnpm 10.6.1 可用；根及 k8s 无 node_modules 和三应用构建产物。Git tracked 文件未见 *.test.* / *.spec.*，SSO mock 为手工辅助。根 package.json 有 build/Jest test，但无 lint script；后续需核实实际可用命令，不能把“运行 pnpm lint”当成已有验证方案。

尚不能宣称可构建、可回归或无升级风险。完整变更清单、三方试合并、稳定版新增 schema/workflow/运行时差异均留给后续票。
