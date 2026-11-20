# 候选版相对官方 v2.26.0 的差异报告

**候选分支：** `codex/ticket-14-final-report`
**候选最终 HEAD：** 本报告所在提交（构建源提交 `b596737423c73427a7a5bc6aef8de3d46dac9118`；最终 HEAD 以 `git rev-parse HEAD` 为准）
**对照上游：** `132859f32d854830ce44b509da87409c3ec10a77`（官方 v2.26.0）
**定制基线：** `838843077adfa0fbffb58ecef82c9324412533aa`
**上游增量基线：** `a5affe62c74e39c1e7ac960d50d8418b807d532c`（v2.25.3）

本报告只基于上述固定提交和最终源码的实际 `git diff` 生成；未使用计划中的“预计差异”代替实际结果。完整路径清单见同目录的
[`final-vs-upstream-paths.tsv`](final-vs-upstream-paths.tsv)（`git diff --name-status 132859f32 HEAD`，1,697 行）与
[`upstream-130.tsv`](upstream-130.tsv)（B→U 的 130 个路径及最终关系）。

## 1. 度量口径

```bash
U=132859f32d854830ce44b509da87409c3ec10a77
git diff --shortstat $U HEAD
git diff --name-status --no-renames $U HEAD
git rev-list --count $U..HEAD
```

| 项 | 读数 |
| --- | ---: |
| 相对 v2.26.0 的差异路径 | **1,697** |
| 新增（A） | 1,631 |
| 修改（M） | 62 |
| 删除（D） | 3 |
| 类型变化（T） | 1 |
| B→U 上游路径 | 130（21 A / 109 M） |
| 上游路径最终逐字相同 | **110** |
| 上游路径保留定制差异 | **20** |
| U→HEAD 提交数 | 68（保留上游提交历史，未 squash） |

按顶层归类：`k8s/` 1,012、`.scratch/` 522、`tests/` 64、产品源码/构建 78、文档 12、其他 9。所有 1,697
个路径都在附录 TSV 中逐行出现，没有只给目录或“同上”而省略路径。

## 2. 官方 130 个路径的去向

`a5affe62..132859f32` 的 130 个路径全部存在于最终树，没有遗漏或误删。其中 **110 个与官方 v2.26.0
逐字一致**（包括账单权限、公开链接后端、索引 schema、加密服务、Temporal V112、SES provider、翻译等），
不在此表重复；逐路径关系见 `upstream-130.tsv`。以下 20 个是最终仍与官方不同的路径，全部来自已批准的
定制契约或本轮冲突解决：

| Path | B→U | Final vs U | Source | Why retained | Verification |
| --- | --- | --- | --- | --- | --- |
| `.env.example` | M | M | U+F | Documents upstream SES/KMS/attribution and fork SSO/connect/deployment variables. | Names checked; no runtime effect. |
| `apps/backend/src/api/routes/auth.controller.ts` | M | M | U+F | Fork merchant SSO, tab auth headers, OAuth state proof and reset endpoints; upstream invite join merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/main.ts` | M | M | U+F | Fork CORS exposed/allowed headers and ALB idle timeout; upstream keep-alive merged. | T02 CORS suite; 695 tests. |
| `apps/backend/src/services/auth/auth.service.ts` | M | M | U+F | Fork SSO/session signing/reset; upstream invite membership and attribution. | T02/T03/T04. |
| `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx` | M | M | U+F | Fork preview fallback plus upstream PlatformIcon. | T09 preview; 695 tests. |
| `apps/frontend/src/app/(app)/auth/layout.tsx` | M | M | U+F | Fork light theme shell plus upstream attribution component. | T09 theme; 695 tests. |
| `apps/frontend/src/app/(app)/integrations/connect/layout.tsx` | A | M | U+F | Fork light theme over the new upstream Connect Link layout. | T06 screenshot; T07 e2e. |
| `apps/frontend/src/components/auth/register.tsx` | M | M | U+F | Fork registration session/invite forwarding plus upstream attribution. | T02/T03; 695 tests. |
| `apps/frontend/src/components/launches/add.provider.component.tsx` | M | M | U+F | Fork six-entry allowlist/popup relay plus upstream extension/YouTube UI. | T05/T09; 695 tests. |
| `apps/frontend/src/components/launches/connect.link.tsx` | A | M | U+F | Fork logo/light consent page over upstream link lifecycle. | T06 screenshots; T07 e2e. |
| `apps/frontend/src/components/launches/continue.integration.tsx` | M | M | U+F | Fork popup relay/two-step retry; upstream cross-org public save and return-URL preservation. | T05/T07 37/37 final. |
| `apps/frontend/src/components/launches/launches.component.tsx` | M | M | U+F | Fork refresh subscription/theme/reconnect; upstream PlatformIcon/extension. | T05/T09; 695 tests. |
| `apps/frontend/src/components/layout/impersonate.tsx` | M | M | U+F | Fork refund-failure feedback plus upstream billing changes. | T09; 695 tests. |
| `apps/frontend/src/components/layout/layout.context.tsx` | M | M | U+F | Fork session headers/401/406 plus upstream 402 admin message. | T02/T09; 695 tests. |
| `apps/frontend/src/proxy.ts` | M | M | U+F | Fork cookie-free gating/invite routing/oauth split plus upstream public connect. | T02/T03/T06; 695 tests. |
| `apps/orchestrator/src/activities/integrations.activity.ts` | M | M | U+F | Fork refresh activity plus upstream decrypt/encrypt calls. | T11/T12. |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` | M | M | U+F | Fork batch continuation/first-flag notify, upstream Connect Link, ticket-11 parallel winner reuse. | T11 19/19 + 6/6 DB; T06/T07. |
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` | M | M | U+F | Upstream selected-channel operations plus fork cross-org 404. | T08 real-DB; 695 tests. |
| `package.json` | M | M | U+F | Upstream dependencies plus fork scripts/toolchain. | Build/test/typecheck. |
| `pnpm-lock.yaml` | M | M | U+F | One resolved lock graph for both dependency sets. | Build/test/typecheck. |


## 3. 相对官方版保留的产品差异（78 个路径）

这 78 个路径是 `apps/`、`libraries/`、`var/docker/`、根构建文件中的全部产品差异，包含 61 个修改和
17 个新增。**40 个在本轮升级中被实际改动**（冲突解决或票内实现），**38 个是升级前定制版已存在、本轮
未改动的保留差异**。下表逐路径给出源、保留理由和验证结果：

| Path | Source | Why the fork difference is kept | Verification |
| --- | --- | --- | --- |
| `.env.example` | U+F | Upstream SES/KMS/attribution variables plus fork SSO/connect/deployment variables. | No runtime effect; names checked against code. |
| `.gitignore` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `Dockerfile.dev` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `apps/backend/src/api/api.module.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/api/routes/auth.controller.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/api/routes/copilot.controller.ts` | F | Optional AI service returns 503 `AI not configured`. | T09 503; 695 tests. |
| `apps/backend/src/api/routes/users.controller.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/cors.config.ts` | F | Iframe CORS policy exposing auth/showorg/impersonate/reload/oauth-state headers; ALB idle timeout. | T02 HTTP suite; 695 tests. |
| `apps/backend/src/main.ts` | F | Iframe CORS policy exposing auth/showorg/impersonate/reload/oauth-state headers; ALB idle timeout. | T02 HTTP suite; 695 tests. |
| `apps/backend/src/services/auth/auth.middleware.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/services/auth/auth.service.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/src/services/auth/sso.service.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `apps/backend/tsconfig.build.json` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `apps/frontend/next.config.js` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `apps/frontend/public/logo-postiz.png` | F | Fork brand: logo-postiz.png 32x32, default light theme, nav visibility. | T09 screenshots/tests. |
| `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx` | F+U | Preview fallback plus upstream PlatformIcon/new providers. | T09 preview evidence; 695 tests. |
| `apps/frontend/src/app/(app)/auth/layout.tsx` | F+U | Fork theme shell plus upstream attribution component. | T09 theme; 695 tests. |
| `apps/frontend/src/app/(app)/auth/sso/page.tsx` | F | Merchant SSO landing/iframe pages and light theme. | T02 exchange; T09 theme. |
| `apps/frontend/src/app/(app)/channel-relay/page.tsx` | F | Iframe popup relay passes the tab session and keeps reconnect inside the popup. | T05 relay evidence; 37/37 connect e2e. |
| `apps/frontend/src/app/(app)/integrations/connect/layout.tsx` | F+U | Public Connect Link consent page: fork logo/light theme, upstream platform/permission copy and lifecycle. | T06 screenshots; T07 37/37 final. |
| `apps/frontend/src/app/(app)/integrations/social/[provider]/page.tsx` | F | Fork provider callback page wiring. | T05/T07 callbacks. |
| `apps/frontend/src/app/(app)/layout.tsx` | F | Fork brand: logo-postiz.png 32x32, default light theme, nav visibility. | T09 screenshots/tests. |
| `apps/frontend/src/app/(app)/oauth/authorize/page.tsx` | F | Fork OAuth authorize shell. | Typecheck/test. |
| `apps/frontend/src/app/(app)/sso/layout.tsx` | F | Merchant SSO landing/iframe pages and light theme. | T02 exchange; T09 theme. |
| `apps/frontend/src/app/(app)/sso/page.tsx` | F | Merchant SSO landing/iframe pages and light theme. | T02 exchange; T09 theme. |
| `apps/frontend/src/components/agents/agent.chat.tsx` | F | Fork UI surfaces (agent, analytics, media tools, settings, icons). | T09 screenshots; 695 tests. |
| `apps/frontend/src/components/analytics/chart-social.tsx` | F | Fork UI surfaces (agent, analytics, media tools, settings, icons). | T09 screenshots; 695 tests. |
| `apps/frontend/src/components/auth/login.tsx` | F+U | Tab session + signed invite forwarding; upstream attribution fields. | T02/T03; 695 tests. |
| `apps/frontend/src/components/auth/org.invite.ts` | F+U | Tab session + signed invite forwarding; upstream attribution fields. | T02/T03; 695 tests. |
| `apps/frontend/src/components/auth/providers/wallet.provider.tsx` | F | Fork wallet provider login surface. | Typecheck/test. |
| `apps/frontend/src/components/auth/register.tsx` | F+U | Tab session + signed invite forwarding; upstream attribution fields. | T02/T03; 695 tests. |
| `apps/frontend/src/components/billing/embedded.billing.tsx` | F | Fork billing wording/layout. | T09 billing evidence. |
| `apps/frontend/src/components/billing/faq.component.tsx` | F | Fork billing wording/layout. | T09 billing evidence. |
| `apps/frontend/src/components/launches/add.provider.component.tsx` | F+U | Six-entry allowlist, popup relay, reconnect-in-popup, two-step retry, return-URL preservation; upstream extension/YouTube/cross-org merged. | T05; T07 37/37 final; 695 tests. |
| `apps/frontend/src/components/launches/allowed.channels.ts` | F+U | Six-entry allowlist, popup relay, reconnect-in-popup, two-step retry, return-URL preservation; upstream extension/YouTube/cross-org merged. | T05; T07 37/37 final; 695 tests. |
| `apps/frontend/src/components/launches/channel.popup.ts` | F | Iframe popup relay passes the tab session and keeps reconnect inside the popup. | T05 relay evidence; 37/37 connect e2e. |
| `apps/frontend/src/components/launches/connect.link.tsx` | F+U | Public Connect Link consent page: fork logo/light theme, upstream platform/permission copy and lifecycle. | T06 screenshots; T07 37/37 final. |
| `apps/frontend/src/components/launches/continue.integration.tsx` | F+U | Six-entry allowlist, popup relay, reconnect-in-popup, two-step retry, return-URL preservation; upstream extension/YouTube/cross-org merged. | T05; T07 37/37 final; 695 tests. |
| `apps/frontend/src/components/launches/launches.component.tsx` | F+U | Six-entry allowlist, popup relay, reconnect-in-popup, two-step retry, return-URL preservation; upstream extension/YouTube/cross-org merged. | T05; T07 37/37 final; 695 tests. |
| `apps/frontend/src/components/layout/impersonate.tsx` | F+U | Session headers, 401/logout, hidden nav, default light, impersonation refund feedback, upstream 402 admin message. | T02/T09; 695 tests. |
| `apps/frontend/src/components/layout/layout.context.tsx` | F+U | Session headers, 401/logout, hidden nav, default light, impersonation refund feedback, upstream 402 admin message. | T02/T09; 695 tests. |
| `apps/frontend/src/components/layout/logout.component.tsx` | F | Logout clears tab session keys and returns to /auth/login. | T02 logout evidence. |
| `apps/frontend/src/components/layout/mode.component.tsx` | F+U | Session headers, 401/logout, hidden nav, default light, impersonation refund feedback, upstream 402 admin message. | T02/T09; 695 tests. |
| `apps/frontend/src/components/layout/top.menu.tsx` | F+U | Session headers, 401/logout, hidden nav, default light, impersonation refund feedback, upstream 402 admin message. | T02/T09; 695 tests. |
| `apps/frontend/src/components/media/media.component.tsx` | F | Fork UI surfaces (agent, analytics, media tools, settings, icons). | T09 screenshots; 695 tests. |
| `apps/frontend/src/components/new-layout/layout.component.tsx` | F | Fork brand: logo-postiz.png 32x32, default light theme, nav visibility. | T09 screenshots/tests. |
| `apps/frontend/src/components/new-layout/logo.tsx` | F | Fork brand: logo-postiz.png 32x32, default light theme, nav visibility. | T09 screenshots/tests. |
| `apps/frontend/src/components/oauth/authorize.component.tsx` | F | Fork OAuth authorize shell. | Typecheck/test. |
| `apps/frontend/src/components/preview/preview.wrapper.tsx` | F+U | Preview fallback plus upstream PlatformIcon/new providers. | T09 preview evidence; 695 tests. |
| `apps/frontend/src/components/settings/global.settings.tsx` | F | Fork UI surfaces (agent, analytics, media tools, settings, icons). | T09 screenshots; 695 tests. |
| `apps/frontend/src/components/ui/icons/index.tsx` | F | Fork UI surfaces (agent, analytics, media tools, settings, icons). | T09 screenshots; 695 tests. |
| `apps/frontend/src/proxy.ts` | F+U | Cookie-free gating, tab invite routing, login OAuth split; upstream public Connect Link pass-through. | T02/T03/T06; 695 tests. |
| `apps/orchestrator/.swcrc` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `apps/orchestrator/src/activities/integrations.activity.ts` | F+U | Fork refresh activity plus upstream token decrypt/encrypt. | T11/T12. |
| `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts` | F | Fork V112 pending/finalize and timeout-unknown handling. | T12/T13 live. |
| `eslint.config.mjs` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |
| `libraries/helpers/src/auth/auth.service.ts` | F | Tab-scoped `auth`/`showorg`/`impersonate` headers with legacy cookie fallback. | T02 live evidence; 695 tests. |
| `libraries/helpers/src/utils/custom.fetch.func.ts` | F | Tab-scoped `auth`/`showorg`/`impersonate` headers with legacy cookie fallback. | T02 live evidence; 695 tests. |
| `libraries/helpers/src/utils/custom.fetch.tsx` | F | Tab-scoped `auth`/`showorg`/`impersonate` headers with legacy cookie fallback. | T02 live evidence; 695 tests. |
| `libraries/helpers/src/utils/public.preview.ts` | F+U | Preview fallback plus upstream PlatformIcon/new providers. | T09 preview evidence; 695 tests. |
| `libraries/nestjs-libraries/src/database/prisma/autopost/autopost.service.ts` | F | Explicit array type keeps fork TypeScript build clean. | Typecheck/build. |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` | F+U | Batch refresh continuation/first-flag notification, Connect Link, ticket-11 parallel-refresh winner reuse. | T11 19/19 live + 6/6 DB; T06/T07. |
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` | F+U | Selected-channel operations plus fork cross-org 404. | T08 real-DB suite; 695 tests. |
| `libraries/nestjs-libraries/src/dtos/auth/sso.create-account.dto.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `libraries/nestjs-libraries/src/dtos/auth/sso.login.dto.ts` | F+U | Merchant SSO/sessionStorage, tab invite join, header-over-cookie org selection, reset-token isolation; upstream invite/attribution merged. | T02/T03/T04; 695 tests. |
| `libraries/nestjs-libraries/src/emails/empty.provider.ts` | F | Empty optional e-mail/short-link providers. | Typecheck/test; T09 optional services. |
| `libraries/nestjs-libraries/src/short-linking/providers/empty.ts` | F | Empty optional e-mail/short-link providers. | Typecheck/test; T09 optional services. |
| `libraries/nestjs-libraries/src/temporal/temporal.module.ts` | F | Compat workflow queues for old V101/V102 executions; provider workers stay activity-only by default. | T12 replay 16/16, live 8/8. |
| `libraries/nestjs-libraries/src/temporal/worker.queues.ts` | F | Compat workflow queues for old V101/V102 executions; provider workers stay activity-only by default. | T12 replay 16/16, live 8/8. |
| `libraries/react-shared-libraries/src/helpers/uppy.upload.ts` | F | Fork media upload/tracking helpers. | T09 upload; 695 tests. |
| `libraries/react-shared-libraries/src/helpers/use.is.visible.tsx` | F | Fork media upload/tracking helpers. | T09 upload; 695 tests. |
| `libraries/react-shared-libraries/src/helpers/use.track.tsx` | F | Fork media upload/tracking helpers. | T09 upload; 695 tests. |
| `package.json` | U+F | Upstream dependencies plus fork scripts/toolchain; one resolved lock graph. | build/test/typecheck pass. |
| `pnpm-lock.yaml` | U+F | Upstream dependencies plus fork scripts/toolchain; one resolved lock graph. | build/test/typecheck pass. |
| `var/docker/ecosystem.config.cjs` | F | Deployment runtime: nginx proxy/CSP, PM2 backend/frontend/orchestrator topology, startup sync entrypoint. | T10 74 PASS; 3 PM2 processes. |
| `var/docker/entrypoint.sh` | F | Deployment runtime: nginx proxy/CSP, PM2 backend/frontend/orchestrator topology, startup sync entrypoint. | T10 74 PASS; 3 PM2 processes. |
| `var/docker/nginx.conf` | F | Deployment runtime: nginx proxy/CSP, PM2 backend/frontend/orchestrator topology, startup sync entrypoint. | T10 74 PASS; 3 PM2 processes. |
| `vitest.config.mts` | F | Fork build/test tooling: flat ESLint, Vitest, plain Next output for `next start`, SWC path aliases, local ignores. | Gates + image build. |


## 4. 非产品路径

| 类别 | 数量 | 内容与理由 | 验证 |
| --- | ---: | --- | --- |
| `k8s/**` | 1,012 | 991 个由 `prepare-build-context.sh` 从最终根源码生成的副本 + 21 个上下文专用文件（Dockerfile、构建/部署脚本、lib、tests、配置）。保留原因：K8s 构建必须来自最终根源码；不另行维护业务代码。 | `prepare-build-context.sh --check` 通过；镜像 `postiz-ticket14:b596737423c7` 实跑（T10/14）。 |
| `.scratch/postiz-v2.26.0-implementation/**` | 522 | 实施票、验收记录、rehearsal 脚本与证据。保留原因：审计与复现；不进入运行时。 | 本报告与 `_reports/ticket-*.md`。 |
| `tests/**` | 64 | 新增的回归、结构守卫和真实数据库/Temporal 测试（商户 SSO、邀请、重置、渠道、公开链接、多选帖子、索引、Temporal、工具链等）。 | `DATABASE_URL=… pnpm test` → 64 文件 / 695 项全部通过。 |
| 文档 | 12 | `AGENTS.md`、`CONTEXT.md`、`doc/`、`docs/agents/`、`README.md`、`CLAUDE.md`（类型变化）。 | 不参与运行时。 |
| 其他 | 9 | `.codegraph/.gitignore`、`docker/` 本地编排、`var/` 调研文档与图片（6 A）；删除 `.eslintignore`、`jest.config.ts`、`jest.preset.js`（3 D）。 | 构建/测试使用 ESLint flat config 与 Vitest。 |

### 删除与类型变化

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `.eslintignore` | D | 由 `eslint.config.mjs` 的 flat config ignores 取代；`pnpm lint` 通过。 |
| `jest.config.ts` / `jest.preset.js` | D | 由 `vitest.config.mts` 取代；`pnpm test` 通过。 |
| `CLAUDE.md` | T | 定制版为普通文件、官方为符号链接；内容为代理说明，不参与构建。 |

## 5. 验证结果索引

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 完整测试 | 64 文件 / **695 通过 / 0 失败 / 0 跳过**（带隔离 PostgreSQL） | `verification/14/gate-test-db.log` |
| 普通 `pnpm test`（无 DB） | 63 文件通过 / 1 文件跳过；682 通过 / 13 跳过 | `verification/14/gate-test.log` |
| 类型检查 | 前端 typegen + 前端/后端/orchestrator tsc，exit 0 | `verification/14/gate-typecheck.log` |
| Lint | 0 errors / 696 warnings，exit 0 | `verification/14/gate-lint.log` |
| 构建 | `pnpm build` 首次被 Next 16.4.2 安全提示中止，重试 exit 0 | `verification/14/gate-build.log` |
| 构建上下文 | `--check` 通过；manifest `sourceCommit=b5967374…`、`worktreeState=clean`、991 生成文件、sha256 `2225421d…` | `verification/14/k8s-context-check.txt` |
| 镜像与三进程 | `postiz-ticket14:b596737423c7`，image ID `sha256:478e6150…`，linux/arm64；nginx :5000 + PM2 backend/frontend/orchestrator | `rehearsals/14/evidence/`、`verification/14/image-build.log` |
| 公开链接跨组织复跑 | 37/37 checks，A/B 组织、匿名/登录、取消/重试/二步/重定向/三方 Cookie 禁用 | `verification/14/ticket14-connect-e2e.json` |
| 祖先关系 | F、U、B 均为最终 HEAD 祖先；合并提交 `52d6a79a4` 双亲为 F/U | 本文第 1 节命令与 `git log` |

未验证项与外部条件见同目录 [`final-vs-fork.md`](final-vs-fork.md) 第 4 节；官方差异中的每项保留都能追溯到
上述票号或本报告的非产品路径说明，没有未解释的整文件覆盖。
