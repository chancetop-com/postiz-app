# Postiz v2.25.3 合并 — 最终改动与验收报告

生成时间：2026-11-12（Asia/Shanghai）。本报告基于**最终源码与实际运行结果**生成，随最终修订更新。
完整逐路径差异见 [文件差异附录](final-diff-file-appendix.tsv)（1512 行数据，含表头共 1513 行，无遗漏）。

> 阅读顺序：第 1 节锁定引用 → 第 2 节相对升级前 fork 的变化 → 第 3 节相对锁定上游的差异 →
> 第 4 节两个定制提交的逐项去向 → 第 5 节冲突与适配 → 第 6 节验证与交付状态。
> 只想看结论的读者请直接读第 6.7 节的交付定级。

---

## 0. 结论摘要

- **代码合并完成、本地必验通过、外部验证待补。** 这不是“可以上线”的结论。
- 锁定目标：官方稳定版 `v2.25.3` / `a5affe62c74e39c1e7ac960d50d8418b807d532c`，
  完整 999 个上游提交历史已作为第二个父提交并入；`S..U` 的 94 个稳定版之后的提交**没有**被带入。
- 最终修订见第 1 节。相对上游全部差异共 **1510 个路径**（不含本报告与差异附录，含这两者时为
  **1512**）；其中 **969 个是 `k8s/` 生成副本**、**20 个是 `k8s/` 部署树文件与契约测试**
  （`k8s/` 合计 989，见 3.2–3.3），真正的手写源码差异是 `apps/` + `libraries/` 的 56 个路径，
  其余为回归测试、文档、运行配置与规划证据。
- 本地必验在本修订上实际重跑：install / typecheck / lint / test×2 / replay / build /
  build-context `--check` / 两个 k8s 契约测试，结果见 6.1。
- 从最终根源码重新生成干净构建输入并重建候选镜像（image ID 见 6.2），在其上重跑镜像、
  启动同步、排程接续、维护任务与故障恢复演练；结果见 6.2–6.3。
- **外部条件缺口**（真实六渠道 OAuth、真实父应用/iframe、Safari 第三方 cookie、真实 Pod/imageID、
  线上 schema 漂移、在途任务清单、备份恢复与停写窗口）逐项列在 6.4，全部标为“缺条件未验证”。
- **未推送、未创建 PR、未部署、未更新集群、未迁移真实数据、未读取真实 Secret、未重新启用 Build。**
  候选镜像只存在于本机 Docker daemon，没有 registry digest。

---

## 1. 锁定引用（pinned refs）

所有引用均以本地 Git 对象与完整 SHA 计算，未使用短 SHA、分支名或“最新”指针。

| 名称 | 值 | 说明 |
| --- | --- | --- |
| 共同基线 `B` | `0b554e684483932d394e703208fe21648e7acd6f` | `merge-base(501e87db, a5affe62)`；最近可达 tag `v2.21.6` 仅作参考 |
| 执行前 fork `H` | `501e87dbfb2ca6e44662baec308afa468a922b38` | 执行起点（`dev`），工作区干净、无 stash |
| 定制提交 1 `C1` | `f042c177c1a378edacd54790614bdd9f709a2480` | 提交信息 `sso`；357 文件 / +92949 / −316 |
| 定制提交 2 `C2` | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` | **产品行为基准**；509 文件 / +86093 / −37 |
| 目标上游 `S` | `a5affe62c74e39c1e7ac960d50d8418b807d532c` | 官方 `v2.25.3`；`git ls-remote https://github.com/gitroomhq/postiz-app.git refs/tags/v2.25.3` 于 2026-11-12 实测返回该 SHA（`rehearsals/18/evidence/upstream-tag-ls-remote.txt`） |
| 稳定版之后的已知 main `U` | `80c3e55dc025c57c00bc4ecc146125125851dc41` | 仅用于证明“未纳入”，不是目标 |
| 合并提交 | `af5bd67744193420768be265ba85048cce9a463c` | 父提交 `a18025b6`（集成分支）与 `a5affe62`（上游） |
| 集成分支 ticket 18 起点 | `ccefd6dc` | ticket 17 合入后的集成 tip，本票起点 |
| 代码审查修复分支 | `codex/review-fixes`，8 个提交 | 依 2026-11-12 双轴评审修复：`1800edb6` 让 `--check` 只读并恢复脏工作区守卫、`8ef5c719` 品牌 32×32 防压缩、`61bb2b9d` 移除未使用的 Jest 工具链、`9b1562b3` 重新生成构建副本、`e68528c0` 修正报告并补做真实浏览器 iframe/popup 验证，其余为文档同步 |
| **最终代码修订** | **`bfc012c74b240eff6f0071556ee6ec06d434c9e0`** | 生成干净构建输入、重建镜像所用的提交 |
| **最终交付修订** | **`91463306998c41d04f319f408a52ea7ae2a27247`** | 集成分支 `codex/postiz-stable-merge` 的 HEAD：把 `codex/review-fixes` 以 `--no-ff` 合入后的交付点。相对最终代码修订只差修复提交与文档/证据 |

祖先关系（逐项实测，不使用提交数替代）：

| 检查 | 结果 |
| --- | --- |
| `501e87db`、`f042c177`、`6fdf7cb5`、`0b554e68`、`a5affe62` 都是最终修订的祖先 | 全部 `merge-base --is-ancestor` 为真 |
| 从 `S` 或 `H` 可达、但从最终修订不可达的提交数 | **0** |
| `B..S` / `B..H` | 999 / 4 |
| `S..U` 中进入最终修订的提交 | **0**（94 个全部不在） |
| 合并提交父数 | 2 |

**未提交内容：** 交付时工作区干净。本报告与附录是同一次交付提交的内容，未在其它分支或 stash 中
留下未提交改动；临时编译器产物（`dist/`、`.next/`、`next-env.d.ts`）由构建生成且被忽略，
不属于源码。

---

## 2. 相对升级前 fork 的功能级前后对照

“原行为”= 执行前 fork（`H`，产品行为等于 `C2`）。“最终行为”= 本修订。四类变化分开列，
不把上游自动合入的内容说成本次新写的修复。

### 2.1 随上游引入的更新（不是本次新写）

`B..S` 999 个提交把产品从 2026-04 的形态带到 2026-10 的 v2.25.3。按官方发布说明与源码核对，
影响约定流程的更新如下（发布说明未提示不等于无破坏性变化，故每项都落到本仓库的实际验证）：

| 上游更新 | 对用户/流程的影响 | 本仓库的实际落点与验证 |
| --- | --- | --- |
| v2.23.0：流式媒体上传、pending-post workflow v1.0.6、SSRF 防护、邮箱查找不区分大小写 | 上传更省内存；中断后的发布状态可恢复；外部 URL 取数受限；登录邮箱大小写不再影响匹配 | 流式上传与 pending/finalize：10、13、15；SSRF 与邮箱匹配随上游合入，未单独改测 |
| v2.24.0：新 Prisma 模型 Clipping/mastra_*、post workflow v1.0.7–v1.1.2、clipping/generate.video/process.media 工作流、Meta Graph v25.0、Stripe webhook 通用路径并保留旧 `/stripe` | 日历/媒体/发布多出可选能力；发布改用 V112 pending→check→finalize；Meta 平台版本升级；支付回调路径变化 | 03（数据）、15（V112）、14（历史 replay）、12（可选服务门控） |
| v2.25.0：Comments 字段变化、新 `OAuthSelfHostedAuthorization` 表与索引、官方镜像启动时推送 schema、可选 captcha/Canva/MCP 变量 | 首次启动自动同步表结构；可选能力默认关闭 | 03（官方同步）、12（可选变量不自动启用）、15/16（comments） |
| v2.25.1：重连时保留 refresh token；安全公告 | 渠道重连不再丢 refresh token | 09（凭据轮换/重连） |
| v2.25.2：登录后只跟随本应用内 returnUrl；invite/showorg cookie 时效与 token 到期对齐；安全公告 | 登录跳转受限；组织 cookie 时效变化 | 05（组织归属/会话）、02（冲突消解） |
| v2.25.3：修复 `PSA-2026-E9AHFV`、`PSA-2026-YT2HMH` | 官方建议立即升级 | 随上游合入；本报告不宣称对具体漏洞做过可利用性验证 |
| 前端形态：Next 16（`searchParams` 为 Promise）、MantineWrapper/Toaster、Sentry 用户上下文、移动端布局、Copilot 改为 Node handler + `useSingleEndpoint` | 页面结构与请求协议变化；旧页面代码直接运行会拿不到查询参数 | 04（Next 16 转接修复）、02（layout 合并）、12（Copilot 协议） |
| 上游移除/替换的可选能力（v2.24–v2.25 期间）：PostHog 追踪、nowpayments 加密支付页、veo3 视频 provider；Farcaster 登录由 SIWN 改为 Neynar managed signers | 这些可选入口在合并后消失或改由 Neynar 承担 | 本地定制不依赖它们；旧 k8s 镜像副本中的对应文件随镜像刷新消失（见 4.2），未手删 |
| 组织默认值改为“优先有订阅的组织”（`5f6008bb`） | 多组织用户默认落到订阅组织 | **已被本地定制改回**，见 2.2（ticket 05） |

### 2.2 保留的本地定制（继承，非本次新写）

| 范围 | 原行为（`H`） | 最终行为 | 用户可感知变化 |
| --- | --- | --- | --- |
| 商户 SSO 进入 | `/sso`、`/auth/sso`、`SsoService`、DTO、`api.module` 注册、`auth.controller` 登录端点 | 全部保留；`/auth/sso?token` 转接改为 `await searchParams`（Next 16 必需） | 父应用带 token 进入的行为从“必然落到无 code 页”变为真正兑换；redirect 目标不变 |
| 身份/组织 | `showorg`/`impersonate` 15 分钟 host-only cookie；默认组织 `orgs[0]`；`proxy.ts` 不做 cookie 页门禁 | 保留；默认组织重新固定为第一个可用成员关系 | 与升级前一致；不再因上游“订阅优先”改归属 |
| 六渠道添加入口 | `linkedin`、`facebook`、`instagram`、`instagram-standalone`、`youtube`、`tiktok` 六个 identifier | 保留，抽成 `allowed.channels.ts` 单一来源 | 入口集合、顺序、图标不变；存量渠道（含 `linkedin-page`/`tiktok-business`/`tumblr`）继续可管理 |
| popup/iframe 授权 | relay 页把 `auth/showorg/impersonate` 写入弹窗 sessionStorage；回传 `CHANNEL_UPDATED` 后关闭 | 保留，抽成 `channel.popup.ts`；多步选择失败不再被选择器遮住（ticket 08） | 回传→刷新→关闭顺序不变；失败时用户第一次能看到平台错误 |
| 品牌与主题 | PNG 标识 32×32、默认浅色、SSO/登录浅色、Agent/Settings 隐藏、删除账户与永久换身份入口隐藏、Design Media/ThirdPartyMedia/AiImage/AiVideo 隐藏 | 保留，且与上游新布局/响应式工具栏/MantineWrapper 共存 | 视觉一致；获得上游移动端与字体修复 |
| 媒体 | 旧媒体按原路径读取、上传插入、单媒体 Editor、媒体库 Import 条件 | 保留；Editor 与上传未受影响 | 无变化 |
| 公开预览 | 匿名可读；取数失败回退 `Post not found`；不跳登录 | 保留；取数容错提取为 `loadPublicPreview()`（可测，行为不变） | 无变化 |
| 可选服务 | 缺 OpenAI key 时 chat/agent 返回 503；MCP 启动失败不阻塞 API；无邮件/短链配置时用空实现 | 保留；媒体处理仍按 RunPod/cloudflare 配置门控 | 无变化 |
| 部署与构建 | 本地 `k8s/` 构建树、nginx/PM2、三进程、`Dockerfile.dev` | 保留并扩展为共享入口 `var/docker/entrypoint.sh`（先官方 `db push`） | 部署方式不变；启动顺序变化见 2.4 |

隐藏入口的性质：**只是界面隐藏**。`DeleteAccountComponent`、`SwitchUser`、Agent 路由、
`/settings?tab=plugs`、`/settings?tab=integrations`、四个媒体工具的组件与后端能力全部保留，
没有新增后端禁用、没有删除 provider、没有停用存量绑定（ticket 06/07 的渲染与源码断言）。

### 2.3 为兼容新增的适配（本次合并真正新写的代码）

| 适配 | 位置 | 为什么必须有 |
| --- | --- | --- |
| 恢复 `getCookieUrlFromDomain` 导入 | `apps/backend/src/api/routes/auth.controller.ts` | 双方都改该文件、Git 无冲突标记，但合并结果缺导入，后端 typecheck 直接失败 |
| `message.content` 防御式收窄 | `apps/frontend/src/components/agents/agent.chat.tsx` | 上游把 content 收窄为 `string` 却保留 `map()` 分支（`a5affe62` 自身缺陷），产生 9 个类型错误 |
| 默认组织回到第一个可用成员 | `apps/backend/src/services/auth/auth.middleware.ts` | 上游改成订阅优先，会改变既有商户的默认归属 |
| `refreshTokens()` 单渠道失败不中断批次 | `libraries/.../integrations/integration.service.ts` | 原来一个被撤销的渠道 `return` 掉整个批处理，后面的渠道永不刷新 |
| `refreshToken` 补 `@ActivityMethod()` | `apps/orchestrator/src/activities/integrations.activity.ts` | 方法存在但未被 Temporal 注册，`refreshTokenWorkflow` 实际无法刷新 |
| `usePageVisibility` 的 hook 顺序与监听器清理 | `libraries/react-shared-libraries/src/helpers/use.is.visible.tsx` | 上游把 hook 放在 SSR 早退之后，并从 `document` 移除从未注册的 `window` 监听器、引用不存在的 `focus`；属上游基线缺陷，不修则 hooks 规则与事件清理都错 |
| V112 finalize 心跳超时视为“未知” | `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts` | 原实现把带 details 的超时当瞬时错误重试，会把已接受的发布再发一次；用 `patched()` 保护旧历史 |
| `.swcrc` 改为可移植 `baseUrl` | `apps/orchestrator/.swcrc` | 上游写死作者机器绝对路径，任何其它 checkout 的 worker 都无法产出 workflow bundle |
| 兼容队列显式开关 | `libraries/.../temporal/{temporal.module,worker.queues}.ts` | 需要在不引入 Worker Versioning 的前提下，能显式让 provider 队列消费旧 workflow |
| 前端测试基础设施 | `vitest.config.mts`、`eslint.config.mjs`、`package.json` 脚本 | 原 Jest 入口依赖未安装的 Nx 集成、零用例；必须有非零有效回归。已删除 `package.json` 中只服务 Jest 的依赖（`jest`、`ts-jest`、`babel-jest`、两个 `jest-environment-*`、`@types/jest`、`jest-junit`、未被引用的 `jest-mock-extended`）与 `jest-junit` 输出块，锁文件随之重算 |
| 可测的共享模块 | `allowed.channels.ts`、`channel.popup.ts`、`public.preview.ts` | 把入口集合/回传协议/预览容错变成可断言单元，**不改行为** |

### 2.4 配置、构建与数据变化

| 类别 | 变化 | 依据 |
| --- | --- | --- |
| 配置 | `.env.example` 同时保留 SSO 段与上游 reCAPTCHA/HIDDEN_PROVIDERS/MIGRATE_PROVIDERS；`MIGRATE_PROVIDERS` 未启用；`COMPAT_WORKFLOW_QUEUES` 默认空 | 02、16 |
| 构建 | 根 `k8s/prepare-build-context.sh` 从根源码重建 970 个生成文件并写清单；`build-local.sh` 只做本地 `docker build`；`build-postiz.sh` 只构建/推送；`deploy-postiz.sh` 只 `kubectl set image` | 01 |
| 镜像 | `Dockerfile.dev`（根）与 `k8s/Dockerfile`（专用单镜像）共享 `var/docker/entrypoint.sh`：先 `pnpm run prisma-db-push`，成功才 `exec` 应用；失败非零退出且不启动应用；无 `--accept-data-loss` | 03 |
| 数据库 | 首次启动执行官方 `prisma db push`（Prisma 6.5.0）：新增 Comments 字段、`OAuthSelfHostedAuthorization`、Clipping/mastra_* 等；旧行不被迁移、重写或补发 | 03（49 项断言，旧 schema→候选容器实测） |
| 运行时 | 三进程 `backend`/`frontend`/`orchestrator`（PM2）+ nginx:5000；`/api/` 与 `/api` 行为不同（后者见 6.3） | 13 |
| 前端构建值 | `NEXT_PUBLIC_*` 在构建期内联；运行期环境变量只覆盖非公开值 | 13（哨兵验证） |
| 锁文件 | `pnpm-lock.yaml` 由 pnpm 重算，未手工拼接 | 02/14 |

### 2.5 仍存在的旧缺口（本次未修复，也不属于本次范围）

1. 组织切换 A→B 成功后响应不带 `impersonate` 头，旧代入值留在 sessionStorage 并被后续请求继续发送；
   B 认证失败时 A 的整套会话原样保留（ticket 05 记录，基线行为）。
2. 停止代入发送空头，客户端只覆盖非空头；secured 路径也不清旧 cookie；本地 XHR 上传只带
   `auth/showorg` 不带 `impersonate`（与 multipart 路径不一致）。
3. 预览 Copilot 不发显式请求头，依赖 cookie。
4. 评论超时会把**已发布的 root** 改写成 `ERROR`（上游 `markUnconfirmed` 以 `postsList[0]` 为目标），
   comment 行留在 `QUEUE`；属本地状态误报（ticket 17 记录，未修）。
5. 公开 API 对 `QUEUE` 帖 `action=update` 只改数据库日期、不重启执行（页面不会这样调用）。
6. 上游 `oneTimeToken` 的 `updateMany` 只按 root id、不按组织限定（ticket 09 记录，未断言也未改动）。
7. `k8s/apps/frontend/public/magic.svg` 的行尾（root CRLF / 副本 LF）导致 `--check` 在“刚跑完
   Next 代码生成”的树上报告漂移；`git add` 归一化后内容不变，属生成器既有行为（ticket 06/11 记录）。
8. 未知结果风险与邮件/webhook 静默失败，见 6.6（ticket 17 原样带入）。

---

## 3. 相对锁定上游（`a5affe62`）的全部差异

在证据提交 `1042a9e7`（不含本报告与附录）上，`git diff --stat a5affe62...1042a9e7` 为
**1474 files changed, 349440 insertions(+), 720 deletions(-)**。最终交付树在此基础上再增加本报告、
差异附录、一条上游 tag 查询记录（1477），以及评审修订新增的 `k8s/lib/json.sh`、`rehearsals/19/`
演练与门禁日志（共 35 个路径），合计 **1512** 个路径；这两类报告的增行数见附录中各自的 `added_lines`。逐路径清单见 [附录](final-diff-file-appendix.tsv)，
列含：路径、相对上游状态、来源分类、分组、是否在上游/定制提交中、是否与 `C2` 完全一致、
增删行、保留原因、验证票。

差异的**形状**很重要：上游文件被改的只有 56 个（52 M + 3 D + 1 T），其余 1300+ 都是“上游没有、
本地有”的新增（定制继承、测试、k8s 树、证据文档）。没有整文件回退，也没有未解释的覆盖。

### 3.1 `apps/` 与 `libraries/` 源码（56 个路径）

| 分组 | 路径数 | 内容 | 来源 | 保留原因 | 用户影响 | 必要兼容适配？ |
| --- | ---: | --- | --- | --- | --- | --- |
| backend 源码 | 9 | SSO 服务/DTO/控制器、组织默认值、Copilot 503、MCP 非阻塞、`main.ts` | 定制 + 适配 | 保留商户 SSO 与可选服务降级 | SSO/组织/降级行为不变 | 部分是（import 修复、组织默认值） |
| frontend 源码 | 30 | SSO 三页、relay 页、六入口/弹窗模块、品牌主题、媒体、预览、会话 | 定制 + 适配 | 保留完整使用流程与界面范围 | 见 2.2 | 部分是（Next 16 await、content 类型、二步错误） |
| orchestrator | 3 | `.swcrc`、`@ActivityMethod`、V112 finalize 未知结果 | 适配 | 让 worker 在非作者机器可用、刷新真的执行、不重复发布 | 排程投递正确性 | **是** |
| 共享库 | 14 | 会话 fetch、预览取数、刷新批次、Temporal 队列、上传钩子、空邮件/短链 | 定制 + 适配 | 会话头、刷新、预览容错 | 无感知或修复既有故障 | 部分是 |

删除的 3 个上游文件：`jest.config.ts`、`jest.preset.js`、`.eslintignore`（Jest 入口不可用、被
flat config 取代）。类型变化 1 个：`CLAUDE.md` → 指向 `AGENTS.md` 的符号链接（上游同名普通文件被丢弃）。

### 3.2 `k8s/` 生成副本（969 个路径）

`k8s/apps/`（586）、`k8s/libraries/`（377）、`k8s/var/docker/`（6）是 `./k8s/prepare-build-context.sh`
从根源码重建的镜像，**从不手改**。它们相对上游“全部是新增”，因为上游没有这套本地部署树。
内容与根路径逐字节对应（`--check` 实测 in sync）；保留原因是构建输入必须自包含、可离线构建；
用户影响为零（只在构建/部署时使用）；属于必要的构建适配。验证：`--check`、
`k8s/tests/prepare-build-context.test.sh`（48）、`k8s/tests/runtime-contract.test.sh`（54）。

数量口径：附录按 git 受版本控制的路径计，生成副本是 **969** 个。ticket 18 构建时的
`BUILD_CONTEXT_MANIFEST.json` 记的是 **970** 个生成文件，差额是 `apps/frontend/next-env.d.ts`：
`next typegen` 生成、`apps/frontend/.gitignore` 忽略，`prepare-build-context.sh` 仍会把它复制进上下文，
所以它出现在清单里，但不是 git 差异路径。两者不矛盾，只是“清单里的文件”与“受版本控制的差异路径”
两个口径。

### 3.3 `k8s/` 部署树本体（20 个路径）

`prepare-build-context.sh`、`build-local.sh`、`build-postiz.sh`、`deploy-postiz.sh`、`Dockerfile`、
`Dockerfile.runtime`、`package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`tsconfig*.json`、
`public-build-config.env`、`ecosystem.config.cjs`、`.npmrc`、`.dockerignore`、`.core-ai/tool-permissions.json`、
`README.md`、共享转义 helper `lib/json.sh`，以及两个契约测试
`tests/prepare-build-context.test.sh`、`tests/runtime-contract.test.sh`。
来源：ticket 01 的本地构建/发布/部署拆分（发布/部署脚本不在本次执行链上）；测试脚本随 ticket 18 的门禁补齐，
`lib/json.sh` 随评审修订补齐。
保留原因：可复现的干净输入与“构建 ≠ 发布 ≠ 部署”。用户影响：无。必要性：构建适配。

数量对账：969 个生成副本 + 20 个部署树路径 = **989 个 `k8s/` 路径**，与附录中 `k8s/` 开头的行数一致
（附录把部署树与契约测试分成 18 + 2 两组；此前把两个 `k8s/tests/*.sh` 漏在部署树之外，
导致 969 + 17 = 986 对不上）。

### 3.4 回归测试（53 个路径，+10961 行）

`tests/*.test.{ts,tsx}`，覆盖 SSO、会话/组织、六入口、弹窗/二步选择、凭据刷新、媒体/编辑、
公开预览、可选服务、Temporal 结构契约、排程接续、维护任务、故障恢复。来源：各实施票。
保留原因：规格要求“非零有效回归”，且这些测试是各项定制的可执行契约。用户影响：无（不进入产物）。
必要性：验收基础设施。上游没有等价测试，故全部为新增。

### 3.5 文档（8 个路径）

`doc/sso-test/{index.html,mock-sso-server.js}`、`doc/social-platform-comments-api.md`、`doc/Logo.png`、
`docs/sso-migration-plan.md`、`docs/agents/{domain,issue-tracker,triage-labels}.md`。来源：定制提交与
仓库工具约定。用户影响：无。必要性：非运行时资产（`doc/sso-test` 是父页/兑换的本地替身起点）。

### 3.6 静态资产

`apps/frontend/public/logo-postiz.png`（32×32 品牌 PNG）、`doc/Logo.png`、
`var/social-media-tools-research.assets/image-20260414143850204.png`（研究文档配图）。
保留原因：品牌与文档引用。用户影响：主布局/登录/预览的标识。

### 3.7 运行配置与本地编排

`var/docker/{entrypoint.sh,ecosystem.config.cjs,nginx.conf}`、`docker/docker-compose.yaml`、
`docker/dynamicconfig/development-sql.yaml`、`.env.example`、`.gitignore`、`Dockerfile.dev`。
来源：ticket 03/13 的启动同步与三进程；compose 仅供本地演练。用户影响：启动顺序与代理行为。

### 3.8 仓库工具与规划证据

`AGENTS.md`、`CONTEXT.md`、`CLAUDE.md`（symlink）、`.codegraph/.gitignore`、`vitest.config.mts`、
`eslint.config.mjs`；`.scratch/**`（规格、18 张票、演练与证据，349 个路径）。来源：本次执行与仓库约定。
保留原因：让结论可复核。用户影响：无；`prepare-build-context.sh` 明确排除 `.scratch/` 与 `.md` 证据，
它们不进入镜像。本报告与附录同属该组，在附录中单列（附录行 `added_lines=self`）。

---

## 4. 两个定制提交的逐项去向

### 4.0 规模与构成

| 提交 | 信息 | 文件 | 增/删 |
| --- | --- | ---: | --- |
| `f042c177` | `sso` | 357 | +92949 / −316 |
| `6fdf7cb5` | `feat: SSO integration, channel relay, UI improvements, and documentation` | 509 | +86093 / −37 |
| 净变更 `B..C2` | — | **863** | — |

863 个净路径的构成：**804 个是 `k8s/` 路径**（第二个提交把整棵旧镜像目录一并提交），
**59 个是真正手写的根路径**。804 个中 791 个是生成副本，4 个是构建树独有文件
（`Dockerfile`、`Dockerfile.runtime`、`.dockerignore`、`.core-ai/tool-permissions.json`），
2 个后续被适配（`build-postiz.sh`、`ecosystem.config.cjs`），7 个因上游删除根源文件而消失；
与下表逐项相加为 863。逐路径映射见
[定制路径附录](final-customization-appendix.tsv)（863 行，列：路径、领域、归属票、追踪处置、
最终是否存在、是否与 `C2` 一致、相对上游状态、保留方式、最终实现、验证票）。

| 保留方式 | 路径数 | 含义 |
| --- | ---: | --- |
| `regenerated mirror` | 791 | 旧镜像路径，由 `prepare-build-context.sh` 从合并后的根源码重新生成 |
| `merged and re-adapted` | 30 | 同路径保留，内容同时吸收定制与上游变化 |
| `kept verbatim` | 27 | 内容与 `C2` 完全一致 |
| `kept, re-adapted` | 7 | 追踪时标为 retained，但后续票（含评审修订）在上游形态上做了适配（见 4.4） |
| `mirror path gone` | 7 | 上游删除了对应根源文件，镜像刷新后自然消失（见 4.2） |
| `upstream version kept` | 1 | `media.repository.ts`，定制只是类型 workaround（见 4.4） |

**没有一条定制路径“无法解释地消失”**：791 个镜像路径由生成器统一重建，7 个消失的路径都能指到
上游删除提交。

### 4.1 按功能逐项

| 定制项 | 原实现（`C2`） | 最终实现（本修订） | 保留方式 | 端到端结果 | 验证票 |
| --- | --- | --- | --- | --- | --- |
| 商户 SSO 进入与兑换 | `/sso`、`/auth/sso`、`SsoService`、两个 DTO、`api.module` 注册、`auth.controller` 端点 | 同路径全部保留；`/auth/sso?token` 改为 `await searchParams` 后转 `/sso?auth_code=` | 保留 + Next 16 适配 | 父页带 token → 一次性 code → 复用/新建商户用户与组织 → `auth`+`showorg` 头；失败 400 且不写会话 | 04 |
| SSO 页面与会话头 | `sso/page.tsx`、`sso/layout.tsx`、`custom.fetch(.func)` | 同路径；header 判空写入、402/406 文案 | 保留 + 适配 | 成功后写 light cookie 并跳 `/launches`/`/analytics`；切组织改变下一请求归属 | 04/05 |
| 组织默认与切换 | `auth.middleware`、`users.controller`、`proxy.ts` | `orgs[0]` 默认、`showorg` 15 分钟 host-only、`/auth/logout` 清旧 cookie、无 cookie 页门禁 | 保留 + 适配 | 多组织、首组织禁用回退、全部不可用 403 与基线一致 | 05 |
| 退出/401/代入 | `logout.component`、`layout.context`、`impersonate` | 同路径；隐藏“永久换身份”按钮，保留停止代入 | 保留 | 退出清三项并跳登录；401 清 cookie；代入仍可用 | 05/06 |
| 六渠道添加入口 | `add.provider.component` 内联白名单 | `allowed.channels.ts` 单一来源，六 identifier 精确集合 | 重构保留（行为不变） | 桌面/移动/onboarding 三种渲染都是同一组六个图标；TikTok-business 不出现 | 07 |
| popup/iframe 会话传递 | relay 页 + 组件内联 hash 逻辑 | `channel.popup.ts` 共享协议；relay 页保留 | 重构保留 | 弹窗 sessionStorage 只覆盖非空值；`CHANNEL_UPDATED` → 重取列表 → 关闭 | 07 |
| 多步单选（YouTube/Meta） | `continue.integration` 二步选择 | 同路径；失败错误留在选择步骤内 | 保留 + 修复 | 选中项决定保存体；失败可见、可重选；成功只回传一次并关闭 | 08 |
| 凭据刷新与重连 | `integration.service`、渠道 provider | 同路径；单渠道失败不再中断整批 | 保留 + 修复 | 六渠道 + `tumblr`/`linkedin-page` 轮换；失败置 `refreshNeeded` 不写空 token | 09 |
| 媒体/编辑/Import | `media.component`、uppy 上传 | 同路径；上游响应式工具栏上继续隐藏四项工具，Editor/上传/媒体库 Import 保留 | 保留 + 适配 | 旧媒体按原路径渲染；新上传落盘并可读；视频 Range 206（`bytes=0-3`、`bytes=4-`、末端夹紧）与 416（起始越界，`tests/media-upload-route.test.ts`） | 10 |
| 公开预览 | `(preview)/p/[id]/page.tsx`、`preview.wrapper` | 同路径；取数容错提取为 `loadPublicPreview()` | 保留（行为不变） | 匿名可读；取数失败/非 JSON/非数组 → `Post not found`，不跳登录 | 11 |
| 品牌/主题/隐藏入口 | PNG 标识、默认 light、菜单与账户入口隐藏 | 同路径；与上游新布局、MantineWrapper、字体并存 | 保留 + 适配 | 默认浅色、可切深色；Agent/Settings/删除账户/换身份入口不渲染，路由与组件仍在 | 06 |
| 可选服务降级 | `copilot.controller` 503、`main.ts` MCP 非阻塞、空邮件/短链 | 同路径；上游 Node handler 与 `startMcp` 并存 | 保留 + 适配 | 无 OpenAI key 时 chat/agent 503；MCP reject 不阻塞 `/api`；无邮件配置不阻塞核心流程 | 12 |
| 构建与部署树 | 自定义 `k8s/`、`Dockerfile.dev`、nginx/PM2 | 同路径；新增共享 `entrypoint.sh` 与三脚本拆分 | 保留 + 扩展 | 三进程与 nginx 实测；`/api/` 200；镜像内工具链/原生依赖可用 | 01/03/13 |
| 启动同步 | 无（定制提交只有构建树） | `var/docker/entrypoint.sh`：官方 `db push` → 成功才 `exec` | 新增（ticket 03） | 旧库升级、重复启动、连接失败、破坏性变更、恢复全部实测 | 03 |
| 数据层适配 | `autopost.service`、`media.repository` | 同路径；`media.repository` 采用上游版本 | 保留 / 上游覆盖 | 旧行不被迁移；`deletedAt: null` 过滤仍在 | 03 |
| 文档与研究资产 | `doc/`、`docs/`、`var/*.md` | 同路径保留 | 保留 | 不进入构建输入 | 02 |

### 4.2 804 个 `k8s/` 路径与 7 个消失路径

`k8s/apps/**`、`k8s/libraries/**`、`k8s/var/**` 是 `prepare-build-context.sh` 的输出，
**从不手改**（编辑根路径后重新生成）。本次从合并后的根源码重建 970 个文件（969 个受版本控制的
生成副本，加上 gitignored 的 `apps/frontend/next-env.d.ts`；见 3.2），`--check` 报告
in sync。7 个镜像路径（`nayner.auth.button.tsx`、`purchase.crypto.tsx`、`veo3.provider.tsx`、
`read.or.fetch.ts`、`nowpayments.ts`、`veo3.ts`、`posthog.tsx`）的对应根源文件已被上游删除
（Farcaster 迁移到 Neynar、移除 PostHog、移除 nowpayments 与 veo3、媒体读取加边界），
镜像刷新后自然消失——不是本票手删，也没有产品契约依赖它们。

### 4.3 明确的保留边界（不是“全部关闭”）

- 隐藏的是界面入口，不是能力：Agent 路由、Settings tabs、删除账户 API、`SwitchUser`、
  四个媒体工具组件、六渠道之外的 provider 全部保留。
- `MIGRATE_PROVIDERS` 未启用；`COMPAT_WORKFLOW_QUEUES` 默认空；没有强制重新授权，
  没有停用存量绑定，没有补发旧帖。
- 旧 workflow 导出（V101–V112、`sendEmailWorkflow`、`streakWorkflow` 等）全部保留。

### 4.4 七处“retained 但后来被适配”与一处上游覆盖

| 路径 | 为什么不再与 `C2` 逐字一致 |
| --- | --- |
| `apps/frontend/next.config.js` | 合并上游配置项，保留本地构建设置 |
| `apps/frontend/src/app/(app)/auth/sso/page.tsx` | ticket 04 的 Next 16 `await searchParams` 修复 |
| `apps/frontend/src/app/(app)/channel-relay/page.tsx` | ticket 07 改用共享 session key 与 `markChannelPopup()` |
| `k8s/Dockerfile`、`k8s/Dockerfile.runtime` | ticket 03 接入共享 entrypoint 与本地 Prisma CLI |
| `var/docker/ecosystem.config.cjs` | ticket 13 的三进程定义与上游产物路径对齐 |
| `apps/frontend/src/components/new-layout/logo.tsx` | 评审修订给 32×32 PNG 补 `minWidth`/`minHeight`，与上游 SVG 的 `min-w`/`min-h` 等价（见 5.2 / B1） |
| `libraries/.../media/media.repository.ts` | 定制内容只是 `deletedAt: null as null` 类型 workaround；上游已是 `deletedAt: null`，无行为差异，故采用上游版本 |

---

## 5. 冲突与兼容适配说明

### 5.1 十四个文本冲突（合并提交 `af5bd677`）

| 路径 | 冲突/取舍 | 最终处理 | 依据与验证 |
| --- | --- | --- | --- |
| `.env.example` | SSO 段 vs 上游 reCAPTCHA/HIDDEN_PROVIDERS/MIGRATE_PROVIDERS | 两段并存 | 配置文档不互斥；`MIGRATE_PROVIDERS` 未启用（03/12） |
| `apps/backend/src/api/api.module.ts` | 定制 `SsoService` vs 上游 `StripeController` | 两者都注册 | 04/12 |
| `apps/backend/src/services/auth/auth.service.ts` | 定制 `signJwt` vs 上游 `sendEmailSync` | 保留 `signJwt`，采用上游方法名 | 上游仅改名（02/04） |
| `apps/frontend/src/app/(app)/auth/layout.tsx` | 本地浅色 class vs 上游 MantineWrapper/Toaster | 浅色 class 放进上游 wrapper | 06 渲染断言 |
| `apps/frontend/src/components/analytics/chart-social.tsx` | 默认 mode | `light` | 06 |
| `apps/frontend/src/components/layout/top.menu.tsx` | 上游把 Plugs/Integrations 移入 Settings | 采用上游结构，保留 Agent/Settings `hide: true` | 06：隐藏范围不变 |
| `apps/frontend/src/components/media/media.component.tsx` | 上游移动端工具栏重排 vs 四项工具注释 | 在上游新位置继续隐藏四项；Import/Editor 保留 | 10：工具栏断言 |
| `apps/frontend/src/components/new-layout/layout.component.tsx` | 上游 Sentry effect vs 本地 `user===null → /auth/login` | 两者合并，登录跳转保留 | 11：主布局对照断言 |
| `apps/frontend/src/components/launches/launches.component.tsx` | 本地 `useRef` vs 上游 `CustomVariables`/`channelsOpen` | 互补合并，默认 light | 02/07 |
| `apps/frontend/src/proxy.ts` | 旧 auth cookie 门禁与 `showorg` | 保留清旧 cookie 的 `/auth/logout` 分支与 15 分钟 host-only `showorg`；页面不再强制登录 | 04/05 |
| `libraries/.../media/media.repository.ts` | `deletedAt: null` vs 上游 `status != processing` | 采用上游（已含 `deletedAt: null`） | 10 媒体列表断言 |
| `CLAUDE.md` | 符号链接 vs 上游普通文件 | 保留 symlink → `AGENTS.md` | 仓库约定 |
| `.gitignore` | 生成清单 vs 上游 `g.js` | 两者都忽略 | 01/02 |
| `pnpm-lock.yaml` | 双方依赖变化 | 取上游后由 `pnpm install` 重算 | 02/14；`--frozen-lockfile` 通过 |

### 5.2 无冲突标记但必须语义修复的路径（7 处）

这 7 处都会改变实际行为：既有合并缺口（导入、类型），也有上游基线缺陷（hook 顺序与监听器清理、
刷新批次中断、`refreshToken` 未注册、finalize 超时重复发布），还有为保持既有契约所做的适配
（默认组织）。它们都没有冲突标记，但不修就无法满足既有契约；提交列给出实际落点。

| 路径 | 症状（不修的后果） | 修复 | 提交 | 验证 |
| --- | --- | --- | --- | --- |
| `libraries/react-shared-libraries/src/helpers/use.is.visible.tsx` | 上游把两个 hook 写在 `typeof document === 'undefined'` 早退之后（SSR 与水合走不同的 hook 数，违反 hooks 规则）；cleanup 从 `document` 移除却从未在 `document` 上注册 `blur`/`focus`，还引用了不存在的 `focus` 变量，监听器永不释放 | hook 提到 SSR 早退之前，事件在 `window` 注册/清理同一组（`window` `blur`/`focus` + `document` `visibilitychange`），依赖改为 `[page]` | `e331b115`（01/02 合并复核） | 无消费方，故无行为用例；由 lint 的 `react-hooks/rules-of-hooks` 与 typecheck 守住 |
| `apps/backend/src/api/routes/auth.controller.ts` | 合并结果丢失 `getCookieUrlFromDomain` 导入 → 后端 typecheck 失败、`/auth/logout` 运行时报错 | 补回导入 | `e331b115` | typecheck + 05 生命周期用例 |
| `apps/frontend/src/components/agents/agent.chat.tsx` | 上游把 `content` 收窄为 `string` 却保留 `content.map()` 分支（`a5affe62` 同址同码，属上游自身缺陷），9 个类型错误 | 改为 `unknown` + `Array.isArray` 防御，渲染分支行为不变 | `e331b115` | typecheck + Agent 渲染用例 |
| `apps/backend/src/services/auth/auth.middleware.ts` | 上游改为“订阅组织优先”，会改掉既有商户的默认组织归属 | 默认回到第一个可用成员关系，显式 `showorg`/禁用回退不变 | `c2fe9ceb` | 05 的 `session-org-flow` |
| `libraries/.../integrations/integration.service.ts` | 一个被撤销渠道 `return` 掉整批，后续渠道永不刷新 | 改为 `continue`，仅该渠道置 `refreshNeeded`（依据见下） | `e89cd57d` | 09 的 20 个用例 |
| `apps/orchestrator/src/activities/integrations.activity.ts` | `refreshToken` 没有 `@ActivityMethod()` → Temporal 不注册，`refreshTokenWorkflow` 永远刷不动 | 补装饰器（依据见下） | `01afc48a` | 16 刷新 backlog 场景 |
| `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts` | finalize 心跳超时（带 details）被当瞬时错误重试 → **同一帖被接受两次** | 超时且有 heartbeats 时标记未确认并结束，`patched('post-finalize-timeout-unknown')` 保护旧历史 | `38957d20` | 17 故障注入（先红后绿） |

两处上游基线缺陷的规格依据（ticket 09/16 原先只写了现象，没有引用条款）：规格用户故事
26–27（“已有渠道可以刷新凭据、重新授权并继续发布”“既有绑定和发布能力得到保留”），以及
[规格](../spec.md#六项渠道与完整授权回传)中“六项渠道”/旧渠道凭据的裁定“已有渠道可以刷新凭据、
重新授权并继续发布”。`return` 让批次中第一个失败渠道之后的**所有**渠道失去刷新机会，缺注册让
`refreshTokenWorkflow` 根本不产生刷新调用；两者都直接使该裁定不成立，因此属于必须修复的基线缺陷，
不是新功能。

### 5.3 其它有业务意义的适配

| 适配 | 原因 |
| --- | --- |
| `apps/orchestrator/.swcrc` 的 `baseUrl` 改为相对仓库根 | 上游写死 `/Users/nevodavid/Projects/gitroom`，任何其它 checkout 的 worker 都无法打包 workflow（ticket 14 阻塞项） |
| `COMPAT_WORKFLOW_QUEUES` 与 `temporal.module` 的按队列注册 | 现网是否存在 provider 队列上的旧 workflow 未知；默认关闭，需要时显式开启，不引入 Worker Versioning |
| V112 的 `patched()` 门 | 让升级前已记录旧命令序列的历史继续按旧路径 replay，避免 DeterminismViolation |
| `allowed.channels.ts` / `channel.popup.ts` / `public.preview.ts` 抽取 | 把入口集合、回传协议、预览容错变成可断言模块；行为不变（票内变异测试证明） |
| flat ESLint 配置 + vitest 入口 | 原 Jest 配置依赖未安装的 Nx 集成且零用例；必须有非零有效回归 |
| `Dockerfile.dev` / `k8s/Dockerfile(.runtime)` 接入 entrypoint | 官方 `db push` 必须发生在应用启动前，且失败不可绕过 |

---

## 6. 验证与交付状态

标记约定：**通过** = 在本修订上实际运行并成功；**失败** = 实际运行且失败；**缺条件未验证** =
缺少真实账号/父应用/浏览器/集群等外部条件，未运行，也不以替身推断为通过。
工具、依赖与测试基础设施缺失不被归为外部条件。

### 6.1 本地必验门（本修订实测）

环境：macOS arm64，Node `v22.23.4`、pnpm `10.6.1`、Prisma `6.5.0`、Docker `29.7.2`；
`rm -rf node_modules` 后 `pnpm install --frozen-lockfile`（exit 0）。ticket 18 原始日志在
`rehearsals/18/gate-logs/`；评审修订后的同一组门禁在最终交付树上重跑，日志在
`rehearsals/19/gate-logs/`，下表的数字以该次重跑为准。

| # | 命令 | 结果 | 记录 |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile`（先删除 `node_modules`） | 通过，exit 0 | `01-install.log`（安装输出） |
| 2 | `pnpm run typecheck` | 通过，exit 0（frontend `next typegen`+tsc、backend、orchestrator） | `01-typecheck.log` |
| 3 | `pnpm run lint` | 通过，**0 errors / 713 warnings** | `02-lint.log` |
| 4 | `pnpm run test`（第 1 次） | 通过，**53 files / 475 tests** | `03-test-run1.log` |
| 5 | `pnpm run test`（第 2 次） | 通过，**53 files / 475 tests** | `04-test-run2.log` |
| 6 | `pnpm run test:replay` | 通过，**16/16 histories** replay（评审修订重跑 bundle `3ef120b90bfd`；ticket 18 首跑 `de20c87f30fd`） | `05-test-replay.log`、`rehearsals/19/gate-logs/11-replay.log` |
| 7 | `NODE_OPTIONS=--max-old-space-size=4096 pnpm run build` | 通过，exit 0（三应用） | `06-build.log` |
| 8 | `./k8s/prepare-build-context.sh --check` | 通过（重新生成后 in sync，source `bfc012c7`） | `07b-…-after-regeneration.log` |
| 9 | `./k8s/tests/prepare-build-context.test.sh` | 通过，**48 passed / 0 failed** | `08-…test.log` |
| 10 | `./k8s/tests/runtime-contract.test.sh` | 通过，**54 passed / 0 failed** | `09-…test.log` |

关于第 8 项的完整说明（避免“先失败后通过”被隐藏）：在**刚跑完** `typecheck`/`build` 的树上直接
`--check` 会以 exit 1 报告两个漂移——`apps/frontend/next-env.d.ts`（Next 代码生成产生，git 忽略）
和 `apps/frontend/public/magic.svg`（root CRLF / 副本 LF，打印后 `git add` 归一化，内容不变）。
按 ticket 01 的流程重新执行 `./k8s/prepare-build-context.sh` 生成镜像输入后，`--check` 报告
in sync；这条流程正是构建镜像前的必做步骤，因此第 8 项以“重新生成后”的结果为最终门禁，
两次输出都保留在证据目录（`07-…check.log` 与 `07b-…log`）。

基线对照：ticket 17 交出的基线是 52 files / 459 tests、0 errors / 713 warnings；本修订为
53 files / 475 tests（新增 1 文件 / 16 例，为 ticket 17 的 `tests/fault-recovery.test.ts` 纳入最终树），
**没有下降**。

### 6.2 最终候选镜像（从最终根源码重建）

| 项 | 值 |
| --- | --- |
| image | `postiz-ticket18:candidate` |
| image ID | `sha256:c77e3edea504ff786974039a79bab74e61e1027d1c548730e92754dba0a69e6a` |
| 构建时间 | 2026-11-12T00:31:56Z |
| 源 commit / 状态 | `bfc012c74b240eff6f0071556ee6ec06d434c9e0`，工作区 **clean**，`contextMatchesHead: true` |
| 分支 | `codex/ticket-18-final-acceptance` |
| 构建输入清单 | `k8s/BUILD_CONTEXT_MANIFEST.json` sha256 `8f5b55fe…`（970 个生成文件） |
| lockfile | sha256 `caba97c3e0351d85…` |
| Dockerfile / nginx / PM2 / entrypoint | `a1afb788…` / `9c460391…` / `2318b72b…` / `4f8419ee…` |
| 公开构建配置 | sha256 `4b3eb53c…`，`NEXT_PUBLIC_VERSION=ticket18-build-sentinel` |
| 基镜像 | `node@sha256:7702d8aa…`（builder）、`node@sha256:5ec23b7c…`（runtime） |
| 目标架构 | `linux/arm64`（本机） |
| registry digest | **无**：未登录、未推送，image ID 只对本机 Docker daemon 有效 |
| 生成资产 | `apps/frontend/public/g.js` 未生成（`NEXT_PUBLIC_GTM_ID` 为空） |

构建命令：`NEXT_PUBLIC_VERSION=ticket18-build-sentinel ./k8s/build-local.sh --tag postiz-ticket18:candidate`
（只做 `docker build`，脚本明确不发布、不部署）。完整 provenance 见 `k8s/BUILD_PROVENANCE.json`
（gitignored，副本 `rehearsals/18/evidence/50-provenance.json`）。

与 ticket 13 的中途镜像相比：lockfile/Dockerfile/nginx/PM2/entrypoint 的摘要**未变**，
变的是源码提交与构建输入清单（`7ad47092` → `bfc012c7`，清单 `d6812dab…` → `8f5b55fe…`）。
中途镜像**没有被当作最终证据**。

评审修订（review fixes，见 ticket 18 的 `## Review fixes`）在 `bfc012c7` 之后又改了源码与工具：
品牌 PNG 增加 `min-width/min-height`、新增共享 `k8s/lib/json.sh`、`--check` 改为严格只读、
构建入口不再隐式传 `--allow-dirty`、移除只服务 Jest 的依赖与 `jest-junit` 配置块。
**没有为此重建镜像**：6.2 与 6.3 的镜像/容器/浏览器证据仍对应 `bfc012c7` 构建的
`postiz-ticket18:candidate`。这些改动不改变三进程启动、健康入口、路由或会话协议；
门禁已在最终交付树上重跑（6.1），`--check` 与两个 k8s 套件同样重跑。

### 6.3 容器、数据库、Temporal 与浏览器演练（本修订重跑）

| 演练 | 场景 / 断言 | 结果 | 证据 |
| --- | --- | --- | --- |
| 镜像运行时（ticket 13 套件，最终镜像） | 三进程/nginx/`/api/`/哨兵/身份头/原生依赖/媒体持久化，85 项 | **85 passed / 0 failed**（首次在最终镜像上为 84/85：构建哨兵常量不匹配，见 6.3.1；修正后重跑） | `rehearsals/13/evidence/summary.txt`、`gate-logs/10-rehearsal-13.log` |
| 官方启动同步（ticket 03 套件，最终镜像） | 旧 schema→升级、重复启动、连接失败、破坏性变更、恢复、spans、真实三进程，49 项 | **49 passed / 0 failed**（最终镜像的真实 entrypoint） | `rehearsals/03/evidence/summary.txt`、`gate-logs/11-rehearsal-03.log` |
| 排程接续（ticket 15，最终编译产物） | 8 场景 / 107 断言（V112、V102 接续、改期、DRAFT、删除、邮件 backlog、missing sweep、autopost、streak） | **8 场景 / 107 断言，全部 PASS** | `rehearsals/15/evidence/summary.txt`、`latest.json` |
| 维护队列（ticket 16，最终编译产物） | 10 场景 / 122 断言（repeat child 旧/新、autopost/sweep/streak CaN、评论、刷新、双邮件、provider 队列） | **10 场景 / 122 断言，全部 PASS**（修正前两轮全量运行各有 1 条时序断言失败，见 6.3.1） | `rehearsals/16/evidence/summary.txt`、`latest.json` |
| 故障与恢复（ticket 17，最终编译产物） | 15 场景 / 108 断言（拒绝后崩溃、心跳有无 details、写回失败、邮件、CaN、协调恢复） | **15 场景 / 108 断言，全部 PASS** | `rehearsals/17/evidence/summary.txt`、`latest.json` |
| 真实浏览器冒烟（本票新增，最终镜像） | Chromium 桌面 1440×900 + 移动 390×844：登录页、无会话跳转、SSO token 转接、匿名预览回退 | **17 passed / 0 failed**：4 个场景 × 桌面/移动，零未捕获异常 | `rehearsals/18/evidence/browser/summary.txt` + 截图 |
| 父页 → iframe → SSO 与 popup → relay（评审修订新增，最终镜像） | 跨源父页（`127.0.0.1:5099`）嵌入 `/auth/sso?token`：iframe 内走到 `/sso?auth_code`、替身兑换后落到 `/launches`，**0 次** `/auth/login` 跳转；父页点击打开 `/channel-relay?redirect=…#auth&showorg&impersonate`，三项会话值与 popup 标记落在**弹窗自身** sessionStorage，redirect 后才离开 relay；桌面/移动各一遍 | **31 passed / 0 failed** | `rehearsals/19/evidence/summary.txt` + 截图 |

所有容器、网络、卷在演练结束时删除；只使用 `postgres:15`、`redis:7-alpine`、`node:*` 与
`postiz-ticket18:candidate`，未删除既有基线镜像。平台、邮件、评论、凭据刷新只进入录制替身，
没有触发任何真实发布。

#### 6.3.1 演练脚本的两处修正（只改 harness，不改产品，也未放宽断言）

诚实记录：最终镜像上的首次运行并不是一次全绿，原因都在演练脚本，而不在产品行为。两处修正都
随本票提交，修正前后日志都在 `gate-logs/`。

1. **ticket 13 套件的构建哨兵与等待循环**（`rehearsals/13/run-rehearsal.sh`）：
   - 脚本把 `NEXT_PUBLIC_VERSION` 的期望值写死为 `ticket13-build-sentinel`，而本票按自己的命名
     构建为 `ticket18-build-sentinel`，于是唯一失败项是“构建值是否内联进浏览器包”。
     直接检查最终镜像：`ticket18-build-sentinel` 出现在 5 个 `.next` 产物（含 1 个客户端 chunk，
     `evidence/sentinel-check.txt`），属性成立；修正为从 `BUILD_SENTINEL` 环境变量读取。
   - 脚本用 `set -uo pipefail` + `docker logs … | grep -q` 做等待循环：`grep -q` 提前关闭管道，
     `docker logs` 收到 SIGPIPE 使整条管道失败，循环永远无法提前退出（首次运行因此耗时约 35 分钟）。
     改为 `grep -c … >/dev/null`（读完全部输入，语义不变）。
   - 修正后重跑：**85 passed / 0 failed**。
2. **ticket 16 的 provider 队列完成断言**（`rehearsals/16/lib/scenarios.mjs`）：
   平台替身在 activity 内记录发布，工作流要再经过一次服务端往返才转为 `COMPLETED`；断言在
   `waitPublished` 之后**立即**读状态，于是全量运行时读到 `RUNNING`。两次全量运行都只错这一条，
   而单独运行该场景能读到 `COMPLETED`，发布次数、类型、队列、业务 id 等断言在两次运行中都已通过。
   改为有界轮询（30 秒，超时才失败），**断言本身没有放宽**。修正后全量重跑：
   **10 场景 / 122 断言全部通过**。

这两处都只影响演练脚本的等待方式与常量来源，不触及任何产品代码；也没有把失败改写成“缺条件”。

### 6.4 必需验证矩阵逐行

| # | 领域 | 结果 | 证据与边界 |
| --- | --- | --- | --- |
| 1 | 合并与来源 | **通过** | 第 1 节祖先检查（`S`、`H`、两个定制提交全是祖先，`S..U` 一个都没进）；附录逐路径 |
| 2 | SSO 与认证 | **通过**（提供方替身） | ticket 04：真实页面函数 + 真实 controller/pipe/service + `node:http` 真实 socket + 一次性 code；真实 SSO 服务器见 6.5 |
| 3 | 组织与会话 | **通过** | ticket 05：8+5+3+7+2+4+4+4 例；A→B、B 失败、首组织禁用、缺组织、手动切换、刷新/复制标签、popup |
| 4 | 登录以外的请求 | **通过**（含记录的基线缺口） | ticket 05：退出/401/网络错误/开始停止代入/上传/主布局/Agent/预览 Copilot；缺口见 2.5(1)(2)(3) |
| 5 | 浏览器与入口 | **通过**（本地部分）：真实 Chrome 桌面 1440×900 / 移动 390×844 的登录页、无会话跳转、SSO token 转接、匿名预览回退（17/17），以及跨源父页 → iframe → SSO 与 popup → relay（31/31，0 次 `/auth/login`）；Safari 与已部署父应用仍缺条件 | 6.3 的两行浏览器演练；ticket 04/05/06 的 jsdom 与渲染断言；Safari、真实父应用与第三方 cookie 受限浏览器见 6.5 |
| 6 | 六渠道完整流程 | **通过**（平台边界替身） | ticket 07：六 identifier 在三种渲染下一致 + 逐跳 relay/hash/回调/`CHANNEL_UPDATED`/关闭；ticket 08：二步保存与绑定写回 |
| 7 | 授权结果与异常 | **通过** | ticket 07/08：200/201/412/406/402、取消、popup 阻止、opener 缺失、close 失败、relay 缺参、重复 flag、重复提交 |
| 8 | 品牌、主题与媒体界面 | **通过** | ticket 06 七个渲染套件 + 10 媒体工具栏；默认浅色、可切深色、隐藏项不渲染、路由/接口仍在 |
| 9 | 用户检查与公开预览 | **通过** | ticket 11：取数函数 13 例（含真实 socket）+ 路由 10 例 + 预览/主布局对照 6 例；6.3 真实浏览器回退 |
| 10 | 无可选服务 | **通过** | ticket 12：9+4+12 例（真实 HTTP 503/401/402/204、MCP reject/挂起、SSO/日历/媒体/排程/分析/匿名预览） |
| 11 | 构建、类型和 lint | **通过** | 6.1 第 1–7 项 |
| 12 | 镜像与配置 | **通过** | 6.2/6.3：三进程、`/api/`、sentinel、来源头、iframe CSP、健康、native、上传 |
| 13 | 文件与媒体持久化 | **通过** | 6.3 镜像演练：旧媒体读取、新上传、Range、删除、重启后仍在；ticket 10 的上传/编辑器断言 |
| 14 | 官方同步生命周期 | **通过** | 6.3 启动同步演练（同一最终镜像的 entrypoint）；另实测无 `DATABASE_URL` 时 entrypoint 以 exit 1 拒绝启动（`evidence/entrypoint-refuses-without-db.txt`） |
| 15 | 数据保留与读取 | **通过** | 6.3：主键集合、列摘要、关系、帖子状态、媒体摘要 0 行 diff；重复样本与默认值 |
| 16 | 历史 replay | **通过** | 6.1 第 6 项：16/16，含 V101/V102、sleep、repeat child、延迟评论、refresh、旧邮件、patch 前后 |
| 17 | 完整任务接续 | **通过** | 6.3：新旧任务、目标渠道、时间、调用次数、最终状态 |
| 18 | 故障和恢复 | **通过**（含 6.6 的未知结果残余风险） | 6.3 故障演练：平台事实/Temporal/数据库分别核对；未知结果与恢复边界按 ticket 17 记录 |

### 6.5 外部条件缺口（缺条件未验证，不是“通过”）

| 缺口 | 缺少的条件 | 需要的步骤 | 影响 | 结果位置 | 待安排执行人 |
| --- | --- | --- | --- | --- | --- |
| 六个渠道的真实 OAuth | 六个 provider 的真实应用/凭据、同意页与真实账号（LinkedIn、Facebook Page、Instagram Business、Instagram Standalone、YouTube、TikTok） | 逐个：发起授权 → 同意 → 回传 → 单选保存 → 列表中确认绑定 → 断开后重连 | 平台配置、权限范围、跨站 cookie/popup 的真实行为未证明；代码与协议已在替身上验证 | ticket 07/08 的替身证据；本报告 6.4 第 6/7 行 | 平台管理员 + 商户运营 |
| 拒权/取消的真实分支 | 同上（真实同意页上的拒绝入口） | 在同意页点拒绝、关闭窗口、撤销授权后重连 | 真实的错误码/文案与恢复路径未在真实平台确认 | ticket 07 的取消/412/406 用例 | 平台管理员 |
| 真实父应用与 iframe | `https://merchant.connexup-dev.net` 父页与 `/social-content-hub` 入口的实际部署 | 父页嵌入 → 发 token → 子页兑换 → popup/iframe 回传 → 父页刷新 | 真实 origin 与部署形态未验证；`postMessage`/hash 机制已由 6.3 的跨源父页替身覆盖（含 iframe 与 popup），但不含部署的父页与真实代发 | ticket 04/07 的 jsdom/proxy 证据；6.3 父页 → iframe 演练 | 父应用负责人 |
| Safari 与第三方 cookie 受限浏览器 | 真实 Safari（以及禁用第三方 cookie 的 Chrome 配置） | 在 Safari 中走 iframe 与独立窗口两条路径，观察会话与 popup | Safari 的 cookie/popup 行为不能由 Chromium 代替；可能影响 iframe 内登录态 | 6.4 第 5 行标为“通过（本地部分）”，Safari 未运行 | 前端 + QA（macOS/iOS 实机） |
| 真实 Pod / imageID | 集群访问与当前线上 Pod 的镜像摘要 | 上线时核对线上实际运行的源码版本与镜像 digest | 无法证明线上运行的是本修订 | 6.2（本地 image ID，无 registry digest） | 运维 |
| 线上 schema 漂移 | 真实数据库只读快照/连接 | 上线前对比线上 schema 与 `schema.prisma`，再执行官方同步 | 本地的旧 schema 是冻结样本，不等于线上实际漂移 | ticket 03（隔离 PG15） | DBA/运维 |
| 在途任务清单与队列历史 | 真实 Temporal namespace 的可见性与在途执行导出 | 上线前导出在途执行，决定是否需要 `COMPAT_WORKFLOW_QUEUES` | 无法确认是否存在 provider 队列上的旧 workflow | ticket 16/17 | 运维 |
| 备份/恢复与停写窗口 | 生产备份策略、恢复演练窗口、停写协调 | 上线前完成一次真实备份-恢复演练并约定停写窗口 | 协调恢复的本地结论（先对账平台）不能代替真实恢复演练 | ticket 17 第 3 节 | 运维/DBA |
| 真实邮件送达 | Resend（或实际邮件服务）凭据与收件人 | 配置后发送测试邮件并确认送达/退信 | 本地仅证明队列与模板路径；投递结果与失败重试未验证 | ticket 15/16/17 的邮件替身 | 运维 |
| 真实 AI / MCP 服务 | `OPENAI_API_KEY`、可用套餐、真实 MCP 端点 | 配置后验证 chat/agent 与 MCP 工具的端到端调用 | 未配置路径（503）已证明；真实调用与限流未证明 | ticket 12 | 运维 + 商户 |
| 可选媒体处理（RunPod/cloudflare） | 两个 RunPod 值与 cloudflare 配置 | 启用后验证上传→处理→轮询→失败收尾 | 关闭路径已证明；开启后的真实处理未验证 | ticket 10/12 | 运维 |

真实 Pod/imageID、线上 schema 漂移、在途任务、队列历史、备份恢复与停写窗口按规格属于**未来上线
核验**，不是本次本地验收的前置条件；上表把它们单列，不声称已验证。

### 6.6 残余风险（沿用 ticket 17 的原话，不淡化）

- `postSocialPending` 接受后 15 秒 heartbeat 窗口内 worker 死亡会被当作“从未开始”而**重发**
  （已实测两次接受）；这是既有设计风险，按规格不另建全局幂等系统。
- 数据库写回完全不可用（`updatePost` + `changeState` 均失败）时行保持 `QUEUE`，
  missing sweep 会**重复发布**；恢复前必须先对账平台。
- comment 超时会把已发布 root 改写成 `ERROR`、comment 留 `QUEUE`（本地状态误报）。
- 旧 `send_email` 的 3 次邮件尝试失败被吞掉，Temporal 无法重试；webhook 投递失败本地不可见。
- 修复前已启动的在途执行在遇到 finalize 超时时仍走旧的“重试”路径（`patched` 为兼容历史保留），
  升级窗口需核对这些执行。
- 本轮 replay 覆盖的 V112 历史**没有带 marker 的 pending-resolution 记录**：新 patch 分支
  （finalize 超时视为未知）在真实旧历史中的走向只能由代码与单元测试保证，尚未有真实历史样本。
- 维护工作流的 `historyLength > 1000` 门在 24 轮门之前不可达（实测约 11 事件/轮、271 事件/首 run）；
  该分支只对其它节奏有意义。
- 维护 activity 执行中杀 worker **未实测**：sweep 为 10 分钟 start-to-close 且无 heartbeat，
  恢复被推迟而非重复，属推理而非实测。
- 冷启动的 502 窗口（评审修订新发现，产品未改）：后端尚在启动时，nginx 的隐式 upstream
  `localhost:3000` 收到连接拒绝，被动健康检查把它置为 `down`（默认 `max_fails=1`、
  `fail_timeout=10s`）；这 10 秒内命中该 worker 的请求返回 `no live upstreams` 502。
  curl 与浏览器均复现（连续 POST 的 1/3 命中，之后恢复 200）。结论只影响后端启动后的前 10 秒，
  未改 nginx 配置；上线时应让就绪探针先通过并留出该窗口，或另行评估 upstream 检查参数。

另外记录、未修复的基线：`oneTimeToken` 的 `updateMany` 只按 root id 不按组织（ticket 09）；
`action=update` 作用于 `QUEUE` 帖只改日期不重启执行（ticket 15）。

### 6.7 交付定级

- 全部**本地**必验项已在本修订上实际通过，包括跨源父页 → iframe → SSO 与 popup → relay 的浏览器流程。
- 因此交付定级为：**代码合并完成、本地验收通过、外部验证待补**。
- 外部待补只剩真实账号/已部署父应用/Safari 与受限 cookie/集群等在本地无法取得的条件（6.5）。
- **不得表述为“全部真实端到端通过”或“可以上线”。** 上线前必须完成 6.5 的核对与
  6.6 的风险确认，并由用户另行决定发布。

### 6.8 未执行的动作（明确声明）

- **没有推送任何分支或 tag**（本分支只在本地；`origin` 未收到本修订）。
- **没有创建 PR**、没有更新 issue 状态到远端。
- **没有部署**、没有 `kubectl` 调用、没有更新集群、没有读取生产 Secret。
- **没有迁移真实数据**：所有数据库都是隔离的合成 PG15。
- **没有发布镜像**：`postiz-ticket18:candidate` 只在本机 Docker daemon，无 registry digest。
- **没有重新启用 Build**（GitHub 的 `Build` 工作流保持停用）。
