# 14: 验收最终修订并交付双向差异报告

**What to build:** 维护者收到可审阅的本地候选分支、最终提交及对应的运行证据。交付报告分别说明商户升级前后的变化，以及相对官方 v2.26.0 保留的差异。

**Blocked by:** [02 商户从父应用进入并保持标签页身份](02-merchant-session.md)、[03 通过普通登录接受组织邀请](03-organization-invitation.md)、[04 保留新旧找回密码链接和既有登录](04-password-reset-compatibility.md)、[05 从仪表盘完成六种渠道的绑定与重连](05-dashboard-channel-binding.md)、[07 通过公开 Connect Link 完成跨组织二步授权](07-public-connect-organization.md)、[08 按勾选渠道编辑和发布帖子](08-selected-channel-posts.md)、[09 在定制界面和缺少可选服务时完成内容流程](09-custom-content-flows.md)、[10 用候选镜像启动旧库并保留媒体](10-startup-and-media-retention.md)、[11 用历史渠道凭证刷新、重连并发布](11-existing-channel-credentials.md)、[13 核对发送故障与恢复结果](13-delivery-fault-recovery.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [逐流程验收决定](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer) · [既有交付标准](../../postiz-v2.26.0-wayfinder/../postiz-stable-merge/issues/09-acceptance-execution-handoff.md#answer)

- [x] 在同一最终修订从根目录用 pnpm 运行完整测试、前端/API/orchestrator 类型检查、lint 和构建。核对 K8s 上下文、实际镜像和三进程；记录提交、命令、用例数及结果。57 个文件、542 项通过仅作升级前基线。
- [x] 汇总前置票在最终候选上的验收证据。若后续改动影响既有证据，重新运行对应流程，并记录本地通过、失败和未验项。
- [x] 对照升级前定制版逐流程说明实际变化与影响；对照官方 tag 附完整差异路径、来源、保留理由与验证结果。核对两端祖先关系，交付最终分支与提交，保留上游历史。
- [x] 真实父应用、Safari 跨站会话与弹窗、六种渠道各自的真实授权逐项列出结果、缺失条件和影响。已观察到的失败按失败记录，本地设施缺失按本地未验记录。
- [x] 全部本地必验项实跑通过且仅缺外部条件时，交付状态可写为「代码合并完成、本地验收通过、外部验证待补」。镜像发布、部署、生产数据变更及 squash 由用户另行决定。

## Answer

2026-11-20 完成。最终分支 `codex/ticket-14-final-report`；交付提交（最终修订）
`8afa7003aff581b514998e269b02b14763e69941`；构建源提交
`b596737423c73427a7a5bc6aef8de3d46dac9118`；合入集成分支的合并提交 `ed8628db…`
（父提交 `b7c069fc` + `8afa7003`，`--no-ff`，仅文档/证据变化，产品代码 0 差异）。
未推送、未部署、未改集群，未 squash。

### 本地门槛

| 项 | 命令 / 对象 | 结果 |
| --- | --- | --- |
| 完整测试（带隔离 PostgreSQL） | `DATABASE_URL=postgresql://…/postiz-ticket-14-tests pnpm test` | **64 文件 / 695 项通过 / 0 失败 / 0 跳过**，exit 0 |
| 普通测试（无 DB） | `pnpm test` | 63 文件通过 / 1 跳过；682 通过 / 13 跳过，exit 0 |
| 类型检查 | `pnpm typecheck` | 前端 typegen + 前端/后端/orchestrator，exit 0 |
| Lint | `pnpm lint` | **0 errors** / 696 warnings，exit 0 |
| 构建 | `pnpm build` | 首次被 Next 16.4.2 安全公告以 `SecurityFatalError` 中止（exit 1）；重试 **exit 0** |
| 构建上下文 | `./k8s/prepare-build-context.sh --check` | 在最终 HEAD 通过；`sourceCommit=b5967374…`、`worktreeState=clean`、991 个生成文件；manifest sha256 `2225421d…`（该文件被 `.gitignore` 忽略，按仓库策略不强制入库） |
| 候选镜像 | `./k8s/build-local.sh --tag postiz-ticket14:b596737423c7` | image ID `sha256:478e615011abc13679e77023776de196d01c7a503085050c21a6e8842af1a2ee`；local repo digest `postiz-ticket14@sha256:478e6150…`；`linux/arm64`，851,826,238 bytes；无 registry digest（未推送） |
| 镜像三进程与同步 | T10 rehearsal 资产复制为 `rehearsals/14`，同镜像实跑 | nginx **:5000** + PM2 `backend`/`frontend`/`orchestrator` 三进程 online；启动同步先于应用，5 索引、31,141 ms、旧库/媒体保留；**74 PASS / 0 FAIL / 1 UNVERIFIED** |
| 公开链接跨组织复跑 | `verification/14/ticket14-connect-e2e.mjs` | **37/37 checks，0 failed**；匿名/A/B、取消/重试/二步/重定向/三方 Cookie 禁用 |
| 祖先关系 | `git merge-base --is-ancestor` | F `838843077`、U `132859f32`、B `a5affe62` 均为最终 HEAD 祖先；合并提交 `52d6a79a4` 双亲为 F/U；未 squash |

测试门在 `b5967374` 上执行；此后只增加证据、报告和本 Answer，产品源码/构建输入未再变化。
构建首次中止是既有 Next.js 16.4.2 的升级提示（工具自身要求重试），不是代码失败；未改依赖版本。
合并后在 `ed8628db` 上重跑 `pnpm typecheck`（exit 0）、`pnpm lint`（**0 errors / 696 warnings**，
exit 0）与 `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000`
（**64 文件 / 695 通过 / 0 失败 / 0 跳过**，exit 0），结果与 `b5967374` 一致。主检出的 `.env`
含 `NOT_SECURED=true`；命令前加 `NOT_SECURED=` 将其覆盖为未定义，保持既有 Copilot 断言有效。
按指示未重建 Docker 镜像，镜像与运行时证据沿用 `b5967374` 的构建。

### 本地证据矩阵

| 范围 | 结果 | 最终候选上的处理 |
| --- | --- | --- |
| 合并、冲突解决与祖先 | PASS | 真实合并保留 F/U 双亲；无冲突标记；上游 152 个提交全部在历史中。 |
| 构建/类型/lint/测试 | PASS | 上表；无跳过地跑完 695 项（带 DB）。 |
| 启动、旧库、索引、媒体（t10） | PASS | 在最终镜像上**重跑** 74/0/1；未用旧镜像替代。 |
| 商户 SSO / 标签页会话（t02） | PASS | SSO/账户复用逻辑在 t03 合并后未变；t03 的 live 证据覆盖 `showorg` 头优先于 Cookie 的改动；t02 HTTP 套件在 695 项内。 |
| 组织邀请（t03） | PASS | 密码/OAuth/已有会话、重复/过期/未激活和 `showorg` 证据保留；产品代码在最终树。 |
| 找回密码（t04） | PASS | 产品代码在 t04 后未变；历史/现行格式与 20 分钟边界测试全过。 |
| 仪表盘六渠道（t05） | PASS | t05 后仅 `integration.service.ts` 的 refresh 逻辑变化；绑定/重连/relay 路径不调用它。t05 的 7 relay/8 OAuth/4 save 证据仍适用。 |
| 公开 Connect Link（t06） | PASS | consent/链接生命周期文件在 t06 后未变；回调文件被 t05 改动，已由 t07 在最终代码上复跑覆盖。 |
| 公开链接跨组织二步（t07） | PASS | 本轮在最终代码**复跑 37/37**（真实 DB + 浏览器 + A/B 组织）。 |
| 按勾选渠道帖子（t08） | PASS | `posts.service.ts` 在 t08 后未变；真实 PostgreSQL 7 项与 HTTP 端点证据保留。 |
| 定制界面/可选服务（t09） | PASS | 加渠道列表在 t09 后被 t05 改动，t05 的更新证据逐项枚举同六项；其余品牌/媒体/分析/预览/503 路径未变。 |
| 历史渠道凭证（t11） | PASS | t11 的 `refreshTokens` 改动是最终代码；19/19 live + 6/6 真实 DB。 |
| 在途 Temporal（t12） | PASS | t12 后无产品 diff；replay 16/16、live 8/8。 |
| 故障恢复（t13） | PASS | t13 后无产品 diff；7/7、84/84。 |
| 非活动 `k8s/Dockerfile.runtime` | UNVERIFIED（本地，非部署路径） | 缺预构建产物，仓库不生产；`k8s/README.md` 明确其为 inactive 参考物，部署使用 `k8s/Dockerfile`（已实跑）。未替代、未算通过。 |

本地通过 19 项、失败 **0**、本地未验 1 项（inactive runtime image）；外部未验 8 项（下节）。
公开链接复跑的首次尝试因本地未设 `CLOUDFLARE_BUCKET_URL`，页面头像上传被 SSRF 校验拒绝而中止；
把该本地变量指向前端地址后 37/37 通过。这是本地环境条件，不是产品回归，未改产品代码或测试。

### 双向差异报告

| 报告 | 路径 |
| --- | --- |
| 相对升级前定制版（按业务流程） | `.scratch/postiz-v2.26.0-implementation/final-vs-fork.md`（+ `final-vs-fork-paths.tsv`） |
| 相对官方 v2.26.0（完整路径） | `.scratch/postiz-v2.26.0-implementation/final-vs-upstream.md`（+ `final-vs-upstream-paths.tsv` 1,773 行、`upstream-130.tsv`） |

官方 130 个路径全部存在：110 个与 v2.26.0 逐字一致，20 个保留定制差异并逐项给出源/理由/验证。
相对官方版共 1,773 个差异路径（1,707 A / 62 M / 3 D / 1 T），完整附录无路径遗漏；`k8s/` 1,012
个为生成副本，`.scratch/` 598 个为审计材料，产品差异 78 个逐路径说明。

### 外部验证

| 项 | 结果 | 缺失条件 | 影响 |
| --- | --- | --- | --- |
| 真实父应用 | 未验证 | 无真实测试租户/账户，未获准操作父应用 | 父页协议/CSP/真实兑换未核对；本地合成父页 + HTTP/浏览器证据通过 |
| Safari 跨站会话与弹窗 | 未验证 | 无 Safari/设备自动化 | ITP 下 sessionStorage/弹窗未实测；Chromium 3pcd 证据通过 |
| YouTube 真实授权 | 未验证 | 无 Google 客户端/频道 | 本地 OAuth double 与结构测试通过；真实 consent/token 未验证 |
| LinkedIn 真实授权 | 未验证 | 无 LinkedIn 客户端/账号 | 同上 |
| TikTok 真实授权 | 未验证 | 无 TikTok 客户端/账号 | 同上 |
| Facebook Page 真实授权 | 未验证 | 无 Meta 应用/真实主页 | 二步选页/保存用真实 DB + Graph double 验证；真实 Graph 未验证 |
| Instagram（FB Business）真实授权 | 未验证 | 无 Meta 应用/IG 业务账号 | 多步契约通过；真实授权未验证 |
| Instagram Standalone 真实授权 | 未验证 | 无 Meta 应用/IG 账号 | 单步契约通过；真实授权未验证 |

### 最终状态

**代码合并完成、本地验收通过、外部验证待补。** 本地必验项实跑通过，失败 0；仅缺上表外部条件
和非部署路径的 inactive runtime image。该状态不表示可以上线、镜像已发布或全部端到端已验收；
发布、部署、生产数据变更与 squash 仍由用户决定。

