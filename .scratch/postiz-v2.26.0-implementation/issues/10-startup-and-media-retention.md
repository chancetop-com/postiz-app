# 10: 用候选镜像启动旧库并保留媒体

**What to build:** 运维人员可以用候选镜像启动隔离旧库。启动同步成功后前端、API 和 worker 可用，商户的关系数据、排程时间与媒体文件在升级和重启后可继续使用。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [启动与索引核查](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [x] 从候选根源码生成并检查 K8s 构建上下文，构建根镜像和专用镜像。用各自的真实入口对隔离 PostgreSQL 15 旧库副本启动，核对官方同步先于应用启动及专用镜像的 nginx、PM2 三进程运行结果。
- [x] 核对 Post 两个索引及 Notifications、User、Errors 各一个索引的定义和列序，记录样本规模、建索引耗时与锁等待。
- [x] 对照同步前后的原行主键和原列摘要，核对身份、成员、渠道、帖子状态、时区、发布时间和媒体引用。用实际卷读旧文件、上传新文件并在重启后分别读取。
- [x] 重复启动验证同步幂等；用隔离故障样本确认连接或同步失败时非零退出，API 与 worker 不会绕过同步启动。保留实际结构与数据核对结果。

## Answer

2026-11-20 完成。分支 `codex/ticket-10-startup-media`（worktree `ticket-10`），从未推送、未部署、未改集群。
候选镜像在隔离 PostgreSQL 15（15.19）的 v2.25.3（`838843077`）合成旧库上完成官方同步、
nginx/PM2 三进程启动、数据与媒体保留、重复启动幂等及连接/同步失败退出演练：
**74 PASS / 0 FAIL / 1 UNVERIFIED**，逐项结果见
[`rehearsals/10/evidence/summary.txt`](../../rehearsals/10/evidence/summary.txt)。

### 起点与提交

| 项 | 值 |
| --- | --- |
| 执行起点 | `0eee97b6b`（`postiz-v2.26.0-integration` tip） |
| 并入集成分支 | `392987d4` merge ticket 10（含 05/07/09/11/12；频道 UI/凭证与 Temporal 连续性改动）；其后 `5ce284c8` 再并入 ticket 13（仅测试/证据，无产品代码或 schema/启动/媒体路径变化） |
| 构建源提交（干净） | `4e6f889d7a18b42775d0d3816571bfc329834e00`（合并后重新生成 k8s 上下文，含 ticket 13 之前的集成代码） |
| 构建上下文 | `k8s/BUILD_CONTEXT_MANIFEST.json` 的 `sourceCommit` 与上述一致、`worktreeState=clean`、991 个生成文件、sha256 `f8745dfb…`；`prepare-build-context.sh --check` 通过 |
| 镜像 | `postiz-ticket10:4e6f889d7a18`，image ID `sha256:286c8698a69488088e372e413475956245075d4628511624c5d729290adbd3ee`，`linux/arm64` |
| 证据提交 | 本分支 tip（本 Answer 所在提交） |
| 未推送/未部署 | 没有 registry digest；Build/rollout/kubectl 均未执行 |

构建：`./k8s/prepare-build-context.sh` → `./k8s/build-local.sh --tag postiz-ticket10:<sha>`（`k8s/Dockerfile`，Node 22.23.4 / pnpm 10.6.1 / Prisma 6.5.0）。镜像内 Node/pnpm/Prisma 与三个真实入口路径均实测存在；HEALTHCHECK 仍为 `/api/`。`k8s/Dockerfile.runtime` 也做了真实构建尝试，但按下面的“未验证”记录，未用其它镜像替代。

### 旧库、索引与锁等待

旧 schema 用 `git show 838843077:libraries/nestjs-libraries/src/database/prisma/schema.prisma`（sha256 `fc4f5ca7…`）由候选镜像内锁定的 Prisma 6.5.0 CLI `db push` 建立；候选 schema 与它的差异只有 5 条索引。合成样本（`seed-old.sql`，sha256 `1be15a77…`）：Post 200007、Notifications 80003、Errors 50001、User 3、Organization 2、UserOrganization 4、Integration 5、Media 4、Subscription 2、OAuthApp 1；升级前库 139,648,359 字节、281 个索引，升级后 286 个。

首次启动的 DDL（PostgreSQL 日志，含 30 秒受控锁造成的等待）：

| 索引（精确列序） | 启动 DDL 耗时 | 纯净重建耗时（升级样本副本） |
| --- | --- | --- |
| `Errors_createdAt_platform_idx` (`createdAt, platform`) | 121.542 ms | 38.993 ms |
| `Notifications_organizationId_createdAt_deletedAt_idx` (`organizationId, createdAt, deletedAt`) | 91.546 ms | 168.842 ms |
| `Post_publishDate_state_deletedAt_parentPostId_integrationId_idx` (`publishDate, state, deletedAt, parentPostId, integrationId, organizationId, creationMethod`) | 23,985.050 ms | 290.648 ms |
| `Post_organizationId_publishDate_idx` (`organizationId, publishDate`) | 281.299 ms | 164.705 ms |
| `User_providerId_providerName_idx` (`providerId, providerName`) | 6.085 ms | 8.704 ms |

- 启动同步总时长 33,051 ms（12:02:33.414 → 12:03:06.465 UTC）；其中 `Post` 上的受控 `RowExclusiveLock` 使首个 Post 索引等待 **9,713 ms**（日志另有一条 202 ms 等待）。纯净重建在升级样本副本上进行，不混入等待时间。
- 同一副本上用并发写验证建索引期间的写阻塞：`UPDATE` 等待 **775.526 ms** 后成功，`CREATE INDEX` 为 907.958 ms；索引均为普通 btree、非唯一、列序与上表一致。
- Prisma 生成的精确名称包括被截断的 `Post_publishDate_state_deletedAt_parentPostId_integrationId_idx`（63 字符）；五个定义与从候选 schema 新建的参考库逐字一致。

### 数据与媒体保留

同步前后（首次启动、重复启动后）的 28 项数据摘要**完全一致，0 行差异**：各表主键集合、全列 `to_jsonb` 摘要，以及单独的身份/成员/渠道/帖子状态/时区/发布时间/媒体引用摘要。例如：

| 项 | 同步前 = 同步后 |
| --- | --- |
| `pk.posts` | `89265de51e7fa34413b63965bf3c76a8` |
| `digest.table.users` | `51016bf6d46ca10d0cba13f7a27ade93` |
| `digest.table.user_organizations` | `0ab02e0dae8c7d838b0fbc5328d3a8f0` |
| `digest.table.integrations` | `e161122e8a1ae36d28acffeb122b8445` |
| `digest.users.timezone`（整数 + IANA 名） | `be4b9e21fb4192fd24d117b6ba9d3f65` |
| `digest.posts.state_publishdate_parent_deleted` | `902dab0fe74ed9aade4d06ba07a2facc` |
| `digest.posts.media_references` | `8b506aef28da6868b908a68f439701ee` |
| `digest.media.files` | `dbec2c05596b9601780f43495f2fee42` |
| `digest.integrations.credentials`（仅摘要） | `e182b35198230fae3da55e2ec8f9925d` |

结构 `pg_dump --schema-only` 前后差异为 **35 行新增、0 行删除、恰好 5 条 `CREATE INDEX`**，没有表/列/约束变化。`deletedAt` 计数保持（Post 2062、Notifications 793），3 个用户中 2 个有 IANA `timezoneName`。

媒体：创建真实命名卷挂载 `/uploads`，旧文件 `uploads/2025/01/launch.png` 及其缩略图经 nginx 均 200，字节 sha256 `c414cd0e…`；经应用自己的 `LocalStorage` 上传新文件
`http://localhost:5000/uploads/2026/11/20/7f11c91065b55420610811615b2caf611f.png`，nginx 200 且字节一致；`docker restart` 后旧文件、新文件均仍 200 且新文件字节不变，三个 PM2 进程仍 online。

### 幂等与失败退出

| 场景 | 结果 |
| --- | --- |
| 第二次启动 | Prisma 输出 `The database is already in sync`，无 `CREATE INDEX`；数据摘要、五索引定义、schema dump 与首次启动后完全一致；API 200，nginx 前端 200，worker `/health/status` 200，3 进程 online |
| 数据库不可达 | 容器 exit **1**；Prisma `P1001`；entrypoint 打印 `schema sync FAILED` 与 `refusing to start: sh -c nginx && pm2-runtime …`；无 `Backend started successfully`、无 worker 监听；主库数据摘要不变 |
| 同步需要数据丢失确认 | 在升级库副本上加入有行的未管理表；`db push` 要求 `--accept-data-loss`，容器 exit **1**、拒绝启动，API/worker 未启动；结构 diff 0 行、副本数据摘要不变 |

启动顺序在带时间戳的日志中核实：`[startup-sync]` 15 行 → 同步完成 15 行 → worker 213 行 → backend 525 行（首次）；API 在同步完成约 13 秒后开始监听。worker 在 Temporal `main` 队列有实际 poller，并成功注册 `organizationId`/`postId` 搜索属性。

### 发现与边界

1. **Temporal 替代服务的测试属性**：`temporalio/auto-setup` 会注册 `CustomStringField`/`CustomTextField` “for testing”，与 backend 的 `organizationId`/`postId` 相加超过该服务 3 个 Text 的上限，导致 API 不监听（PM2 仍 online、nginx 502）。演练在默认 namespace 就绪后先移除这两个未使用的测试属性，再启动应用，并证明真实启动路径会注册两个业务属性。部署侧 Temporal 已有属性预算；票 12/13 应核对真实 namespace 的属性余量。这是替代环境/配置发现，不是数据库或媒体回归。
2. **启动同步会顺带 generate**：entrypoint 的 `pnpm run prisma-db-push` 在 `db push` 后还执行 Prisma generate（root 脚本未加 `--skip-generate`），写入镜像内的客户端；数据库同步仍在应用命令之前完成。这是既有根脚本行为，不是新增升级脚本。
3. **`k8s/Dockerfile.runtime` 未验证**：`k8s/.dockerignore` 排除 `node_modules`、`apps/backend/dist`、`apps/orchestrator/dist`、`apps/frontend/.next`，准备器也删除/排除这些路径，仓库没有把 Linux 构建产物放入 `k8s/` 的步骤；宿主 `node_modules` 是 macOS 硬链接副本，复制进 Linux 镜像无效。构建尝试 exit 1，日志在 `evidence/70-runtime-image-build.log`，未用其它镜像替代。
4. 未验证：真实部署的 PostgreSQL/Redis/Temporal 版本与 namespace、真实 PVC/Secret、KMS/真实渠道、真实媒体文件；旧 schema 来自 `838843077`，不声称覆盖线上扩展或数据形态；未升级 PostgreSQL 大版本；新文件通过应用 `LocalStorage`（HTTP 上传路由使用的同一实现）写入，不是带认证的 multipart 请求（HTTP 路由归票 13）。

### 合并记录与门

| 项 | 值 |
| --- | --- |
| 合并提交 | `7527f3a355e1c8119128a849619cf1d4bf2d715f`，父提交 `53deb040`（集成分支）与 `13f1bdc5`（ticket 10 分支 tip） |
| 冲突 | 无（`53deb040` 是分支祖先）；`--no-ff` 合入，合并树与 `13f1bdc5` 一致 |
| 祖先校验 | `53deb040`、`13f1bdc5`、`392987d4`、`5ce284c8`、`4e6f889d` 均为合并后 HEAD 祖先 |
| 冲突标记 | 全树无 `<<<<<<<` / `=======` / `>>>>>>>` |
| `pnpm typecheck` | exit 0（frontend `next typegen` + backend + orchestrator） |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | exit 0；**64 files / 695 tests passed** |
| 未推送/未部署 | 无 push、无镜像推送、无 rollout；Build 未启用 |

合并后复核确认：镜像 `postiz-ticket10:4e6f889d7a18`（ID `sha256:286c8698…`）来自干净上下文 `4e6f889d`；PostgreSQL 15.19 上由旧 schema `838843077` 建立 200,007 / 80,003 / 50,001 行样本，五索引使 281→286，锁等待 9.7 s、启动同步 33.1 s、纯净索引重建 290 ms；28/28 摘要同步前后与重启后一致，schema 差异 35/0/5；旧媒体与新媒体重启后仍可读；重复启动幂等；连接失败与需数据丢失确认的同步均 exit 1 且 API/worker 未启动。`k8s/Dockerfile.runtime` 因 `.dockerignore` 排除必需产物仍未验证（限制见上）。

