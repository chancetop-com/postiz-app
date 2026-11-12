# 03: 用官方启动同步保留旧数据

**What to build:** 候选应用在每次启动前按官方方式同步数据结构，成功后才提供服务；旧身份、渠道、帖子和媒体仍保持原值与关系，同步失败能够被识别并阻止应用继续启动。

**Blocked by:** 02 — [完整合入锁定的 v2.25.3](02-merge-stable-release.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“官方数据库同步与存量数据”；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 在隔离 PostgreSQL 15 中用旧 schema 和合成数据建立样本，记录同步前主键集合、原列摘要、组织与渠道关系、帖子及媒体引用；敏感值只在受控程序内比较。
- [x] 根镜像和专用单镜像的每次启动、重启均执行新版官方 prisma-db-push，不含 accept-data-loss，不用 reset；同步成功后才启动 API/worker，失败返回非零且不绕过启动阻断。
- [x] 安装和镜像构建只生成 Prisma 客户端，不连接数据库；运行镜像具备同步所需 schema、根脚本、pnpm 与 CLI 依赖，不交付独立升级脚本或新的版本化迁移体系。
- [x] 实际候选容器完成旧库同步、重复启动和连接/约束失败演练；保留失败后的数据与结构证据，不假定失败意味着结构完全未变，不通过删表、删除 trace 或接受数据丢失求成功。
- [x] 用户、组织、成员、角色、disabled、凭据和 ID 保持原值；Integration 的组织、internalId、rootInternalId、token、refreshToken 和有效期保持，不去重、不重建组织、不重绑身份或整表改 root。
- [x] 帖子 ID、渠道、group/parent、publishDate、state、releaseId/releaseURL、settings/image 以及媒体 ID、URL、缩略图和 JSON 引用保持；不批量补发、改期、改状态、搬迁或重新处理媒体。
- [x] 验证 deletedAt 初始为空，以及旧 Media 为 ready、Subscription.provider 为 stripe、Post.creationMethod 为 UNKNOWN、OAuthApp.dynamic 为 false 等新增默认值和可空字段；旧 timezoneName 为空不触发从整数偏移猜测 IANA 时区或改写发布时间。
- [x] 验证新增模型、Mastra 初始化、索引、可空关系和 spans 复合键重复样本的真实结果；行数相同或模型未删除不足以证明保留，不开启 MIGRATE_PROVIDERS。
- [x] 提供可复用的升级后合成样本及前后比较记录，支撑后续 SSO、旧渠道、媒体和排程票；不升级 PostgreSQL 大版本或 Temporal Server，不接触真实运行数据。

## Answer

2026-11-11 完成。官方 `db push` 启动同步已接入根镜像与专用单镜像，失败不可绕过；隔离 PostgreSQL 15 上用旧 schema 与合成数据完成升级、重复启动、连接失败、破坏性变更失败、恢复及 spans 重复样本演练，49 项断言全部通过；四道本地门在合入集成分支后的树上实际通过。未交付独立升级脚本、未建立版本化迁移体系、未开启 `MIGRATE_PROVIDERS`、未接触真实数据库或 Temporal。

### 起点与提交

| 项 | 值 |
| --- | --- |
| 执行起点 | `5fc45bfd`（集成 tip），工作区干净 |
| 并入集成分支 | `3b8d8300` merge `codex/postiz-stable-merge`（含 06、11），无冲突 |
| 实现提交 | `3453e6bc` feat(startup): sync the database schema before the app starts |
| 演练提交 | `eb9dd443` test(startup): rehearse the official sync on isolated PostgreSQL 15 |
| 分支 | `codex/ticket-03-startup-sync`，未推送、未部署、未启用 Build |

### 改动与位置

| 改动 | 位置 | 说明 |
| --- | --- | --- |
| 共享容器启动入口 | `var/docker/entrypoint.sh`（`k8s/var/docker/entrypoint.sh` 为生成副本） | 先执行 `pnpm run prisma-db-push`；成功才 `exec` 应用命令；失败打印 `schema sync FAILED`/`refusing to start` 并以同步的退出码退出，无参数时 exit 2。没有开关、环境变量或重试可跳过同步 |
| 根镜像 | `Dockerfile.dev` | `ENTRYPOINT ["/app/var/docker/entrypoint.sh"]`，`CMD ["sh","-c","nginx && pnpm run pm2"]` |
| 专用单镜像 | `k8s/Dockerfile` | 运行阶段新增 `pnpm@10.6.1`、`package.json`、`libraries/nestjs-libraries/src/database/prisma/schema.prisma`、入口脚本；`ENTRYPOINT` 同上，`CMD nginx && pm2-runtime ecosystem.config.cjs` |
| 打包运行镜像 | `k8s/Dockerfile.runtime` | 同样接入（inactive 变体，未实际运行） |
| 根脚本 | `package.json`、`k8s/package.json` | `prisma-db-push` 由 `pnpm dlx prisma@6.5.0` 改为本地锁定的 `prisma`（devDependency 仍为 6.5.0），运行镜像启动时无需访问 registry；`prisma-generate` 与 `postinstall` 仍只生成客户端 |
| 回归 | `tests/startup-sync.test.ts`（17）、`tests/schema-upgrade-contract.test.ts`（55） | 进程级启动顺序/退出码/拒绝启动/无 `--accept-data-loss`；三个运行镜像入口都不能绕过同步且构建期不应用 schema；保留 48 个旧模型、新增字段默认值与可空性；`MIGRATE_PROVIDERS` 未被启用 |
| 演练 | `.scratch/postiz-stable-merge-implementation/rehearsals/03/` | 旧 schema、合成数据、保留清单、post-checks、Mastra 初始化、恢复 SQL、可复用升级后样本、`evidence/` 原始日志与摘要 |

启动顺序（两镜像一致）：`entrypoint` → `pnpm run prisma-db-push`（Prisma 6.5.0，无 `--accept-data-loss`、无 reset、无 `--force-reset`）→ 成功后 `exec` CMD。根镜像的 `pm2-run` 上游脚本内部还会再同步一次；两次都幂等（由重复启动断言证明），未改动上游脚本。

### 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile`（Node 22.23.4 / pnpm 10.6.1） | exit 0，`prisma generate` 6.5.0，未连接数据库 |
| `pnpm exec vitest run` | 15 文件 / **139** 用例通过（其中本票 72） |
| `pnpm run typecheck` | exit 0（frontend `next typegen` + backend + orchestrator） |
| `pnpm run lint` | exit 0，713 warnings / **0 errors** |
| `pnpm run build` | exit 0（frontend / backend / orchestrator） |
| `./k8s/prepare-build-context.sh --allow-dirty` | 965 生成文件；`--check` 与 `3b8d8300` in sync |
| `./k8s/build-local.sh --tag postiz-ticket03:merged-3b8d8300` | exit 0，image `sha256:08dff642…`，6.28 GB |
| `docker run … sh -c '…'`（镜像内检查） | 入口脚本可执行、`schema.prisma` 存在、`pnpm 10.6.1`、`prisma 6.5.0` 与 linux-arm64 查询引擎可用 |
| `IMAGE=postiz-ticket03:merged-3b8d8300 ./run-rehearsal.sh` | exit 0，**49 PASS / 0 FAIL** |

四道门在并入集成分支后的 HEAD 上重跑；本票新增用例先红后绿（进程级入口测试在实现前失败，schema 契约在实现前失败）。

### 隔离数据库证据

环境：Docker 29.7.2，`postgres:15` = PostgreSQL 15.19（Debian），全部数据合成，容器/网络/卷在演练结束时删除，未使用真实数据或 Secret。证据目录 `rehearsals/03/evidence/`，结论表 `summary.txt`。

| 场景 | 断言 | 结果 | 证据 |
| --- | --- | --- | --- |
| 旧库 → 候选启动 | 先出现同步成功标记，之后才执行应用命令；exit 0 | 通过 | `05-start-1.log` |
| 数据保留（首次启动后） | 主键集合、54 项列摘要/关系全部不变 | 通过（0 行 diff） | `04-baseline-inventory.txt`、`06-after-start-1-inventory.txt`、`06-after-start-1-diff.txt` |
| 重复启动 | 报告 already in sync；无进一步 DDL；数据不变 | 通过 | `08-start-2.log`、`09-schema-stable-diff.txt`（0 行） |
| 连接失败 | 容器 exit **1**，无应用启动，Prisma P1001 保留，数据未动 | 通过 | `10-fail-connection.log`、`11-after-fail-connection-diff.txt` |
| 破坏性变更（含 2 行数据的未管理表） | 无 `--accept-data-loss` 被拒绝，exit **1**，无应用启动，业务数据未动，失败前后结构 diff 为空 | 通过 | `13-fail-constraint.log`、`14-schema-diff-after-failure.txt`（0 行）、`14-legacy-rows-after-failure.txt` |
| 恢复路径 | 备份该表后按文档处理，再启动成功，数据不变 | 通过 | `15-recovery-backup-legacy.sql`、`16-recovery-start.log`、`17-after-recovery-diff.txt` |
| spans 复合键重复 | 同步 exit **1**（P2002），无应用启动，未删除任何 span；**失败前已应用 182 行结构变更** | 通过（记录了部分变更） | `19-spans-sync.log`、`19-schema-diff-after-spans-failure.txt`、`19-after-spans-failure-diff.txt` |
| spans 恢复 + Mastra 初始化 | 按保留规则去重（保留 completed/较新）、按 Prisma 映射名加主键后同步通过；真实 `PostgresStore.init()` 通过 | 通过 | `20-spans-recovery.log`、`20-spans-rows-after-migration.txt`、`21-spans-final-pk.txt`、`22-mastra-init.log` |
| 真实三进程启动 | 先同步再进入 pm2；nginx 在 :5000 应答；检查列上的应用写入为 0 行 diff | 通过 | `23-real-start.log`、`23-real-start-pm2.json`、`24-after-real-start-diff.txt` |

同步后新增字段/模型/索引的实际值（`07-post-checks.txt`）：`Media.status=ready` 4/4、`Media.processingError` 全空、`Subscription.provider=stripe` 2/2、`Post.creationMethod=UNKNOWN` 7/7、`Post.batchId` 全空、`OAuthApp.dynamic=false`、`User.timezoneName` 3/3 为空且旧 timezone 整数（120/-300/60）未改、`User.deletedAt`/`Organization.deletedAt` 全空、`OAuthApp.organizationId` 可空、`Clipping`/`ClippingClip`/`OAuthSelfHostedAuthorization` 已建（0 行）、6 个新索引存在、`mastra_ai_spans` 46 列且主键为 `public_mastra_ai_spans_traceid_spanid_pk`。

可复用样本：`rehearsals/03/upgraded-sample.sql`（196 KB，升级后的合成库，含 schema 与数据，供 04/05/09/10/15 使用）。

### 发现（后续票需知）

1. **spans 重复会阻断启动**：新 schema 给 `mastra_ai_spans` 加了复合主键，重复 `(traceId, spanId)` 使 `db push` 以 `P2002` 失败，容器不启动；同步不会删除 trace。恢复用 `recover-spans.sql`（与 `npx mastra migrate` 同规则）。
2. **Prisma 6.5.0 缺陷**：若主键名不是 schema 映射的 `public_mastra_ai_spans_traceid_spanid_pk`，下一次同步需在同一步里 `RenamePrimaryKey` + 加 25 列，生成非法 SQL（`ERROR: syntax error at or near ","`），此后每次启动都失败。已在演练中确定性复现（先加 Mastra 命名的约束再同步即报错，改用映射名后同步与 Mastra 初始化均通过）；`npx mastra migrate` 用自己的名字，因此必须在下次启动前重命名。该结论已写入 `rehearsals/03/README.md`。
3. **`@@ignore` 不等于 db push 不管理**：`mastra_ai_spans` 被 `db push` 创建/扩列/加主键，只是不进客户端。不能以 `@@ignore` 推断该表不受 DDL 影响。
4. **运行镜像 Node 版本**：`k8s/Dockerfile` 用 `node:22.20-bookworm-slim`，与 `package.json` 的 22.23.4 不一致，每次启动打印 `Unsupported engine` 警告；属 13 的运行镜像范围，本票未改。
5. **HEALTHCHECK 无效**：两个镜像 curl `/api/health`，后端没有该路由（未改动，属 13）。
6. 根镜像启动会同步两次（入口 + 上游 `pm2-run`），均已证明幂等。

### 未证明 / 边界

- 旧 schema 取自定制基线 `6fdf7cb5`（48 模型），不代表真实线上库的实际版本、扩展或数据形态。
- PostgreSQL 15 来自环境声明；未升级数据库大版本，未接触 Temporal Server。
- 平台凭据仅证明字段保留，不能证明真实 OAuth 有效；媒体只验证记录/路径/URL/缩略图与 JSON 引用，未读取实际文件。
- 真实三进程运行、媒体持久化、`/api/health`、队列行为归 13；Temporal 回放归 14；本演练环境无 Redis，队列连接不在证据内。
- 旧 Temporal 历史、生产备份恢复与切换窗口未验证（仍属上线前核验）。

### 偏差

- `prisma-db-push` 改用本地锁定 CLI 而非 `pnpm dlx`：运行镜像必须自带 CLI 依赖且不应在启动时访问 registry；版本仍为 6.5.0，命令仍为 `db push`，无新增参数。
- 保留上游根启动链（`pnpm run pm2` → `pm2-run` 内再次同步），因此根镜像单次启动会同步两次；未为此改上游脚本。
- 演练未启动 Redis：本机 Docker 凭据助手阻塞了新镜像拉取；该限制不影响同步顺序与保留证据，已在 README 记录。合并后镜像构建同样用 `DOCKER_CONFIG` 指向空凭据配置绕过该阻塞（仅本地构建命令，不是仓库改动）。
