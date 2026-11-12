# 17: 故障下识别未知结果并完成协调恢复

**What to build:** 维护者能在发布或升级失败后区分已完成、失败和结果未知，依据实际证据恢复兼容的应用、数据库、媒体和 Temporal 状态，不把换回旧镜像或重发全部任务当作通用恢复办法。

**Blocked by:** 13 — [候选镜像实际运行三进程与持久化媒体](13-image-runtime.md); 16 — [重复任务、邮件与维护任务持续运行](16-recurring-maintenance-workers.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“Temporal 接续与恢复”及“故障和恢复”；同时遵守[共同执行约束](../README.md#执行约束)。所有演练仅在隔离合成环境进行。

- [x] 对实际候选栈注入平台替身接受后 worker 退出、数据库写回失败、通知失败、pending/finalize 超时和 heartbeat 有/无 details 等故障，保留可重复触发条件。
- [x] 每个场景分别核对平台替身事实、Temporal 历史/重试、数据库及界面状态，记录外部已成功而本地未知等情况，不能仅凭数据库状态判断平台未发布。
- [x] 明确实际重试、重复调用和基线风险，不把未知直接判定为失败并新增无依据补发，不为本票另建全局幂等系统；升级引入的流程破坏须适配或按具体冲突规则处理。
- [x] 选择经过验证的兼容候选作为应用恢复对象，证明其覆盖已产生的新旧 workflow 类型、patch、activity payload 和队列；不直接启动旧镜像并假定其旧同步命令和 worker 全部兼容。
- [x] 分别演练同步失败、尚无新写入、已产生新版执行/数据后的恢复条件，保留每种条件下的结构、记录、文件及 Temporal 关联证据，不以删新表列迁就旧应用。
- [x] 在隔离环境演练数据库、媒体与 Temporal 的协调恢复，恢复后重比主键、原列摘要、媒体文件/引用和执行关联，并验证选定任务能按已定条件接续。
- [x] 恢复前后保留平台替身发布、token 刷新及外部通知账目，证明本地恢复不会撤销这些副作用；未知结果先依据证据处理，不自动重放所有排程。
- [x] 输出已演练步骤、兼容条件、失败和残余风险；实际 Pod/imageID、真实 schema、在途任务、队列、备份及停写窗口仍属未来上线核验，不宣称已证明线上恢复。

## Answer

2026-11-12，在隔离合成栈上完成故障注入、兼容回退覆盖与协调恢复演练：一次性 PostgreSQL 15、Redis、本地媒体目录、`@temporalio/testing` 启动的真实 Temporal 服务，以及**编译后的候选 backend/orchestrator**（与 PM2 启动相同的产物）。平台与邮件只进入录制替身，未触发任何真实发布；身份、凭据和文件全部为合成样本。证据在
`.scratch/postiz-stable-merge-implementation/rehearsals/17/`（`README.md`、`run.mjs`、`lib/`、`results/latest.json`、`evidence/summary.txt`、`evidence/call-log.jsonl`）；快速回归网为 `tests/fault-recovery.test.ts`（16 条，随 `pnpm run test` 执行）。注入点可重复：`work/faults.json` 每次调用时读取，`hang` 会先执行真实替身再永久阻塞（模拟“平台已接受、worker 未回报”），`SIGKILL` 直接杀掉整个进程组。

### 注入的故障、实际行为与可知性

| 故障 | 平台替身实际事实 | Temporal | 本地记录 | 事后可知 | 分类 |
| --- | --- | --- | --- | --- | --- |
| `finalizePost` 已接受后 SIGKILL（有 heartbeat details） | 1 次 `postPending` + 1 次 `finalizePost` | `ACTIVITY_TASK_TIMED_OUT` type=HEARTBEAT，携带 1 条 `finalizePost: entered` | post `ERROR`（未确认），1 次发布 | 是：details 证明变更已开始，历史只有一次发布 | unknown |
| `postComment` 已接受后 SIGKILL（有 details） | root 发布 1 次，comment 接受 1 次 | `postComment` HEARTBEAT 超时，携带 details | root 被改写成 `ERROR`，comment 留在 `QUEUE` 且无 releaseId | 部分：root 已发布可知，comment 结果未知 | unknown |
| `postSocialPending` 已接受后、首次 heartbeat 前 SIGKILL（无 details） | **同一 post 两次被接受**（不同 pid） | HEARTBEAT 超时**无** details → 判为“从未开始” → 重试 | 只有第二次接受的 `PUBLISHED` 记录 | 否：数据库只有一条成功记录 | unknown（真实风险） |
| `checkPostStatus` 2 分钟 start-to-close 超时（无 heartbeat 通道） | 1 次发布，无后续变更 | START_TO_CLOSE 超时 → 有界只读重试 → 最终未确认 | post `ERROR`，`Could not confirm the post status` | 是：发布调用数仍为 1 | unknown |
| 平台接受后 `updatePost` 写回永久失败 | 1 次发布 + 1 次 finalize | 写回 activity 失败，`posted=true/updated=false` | post `ERROR` 含失败原因，无 releaseId | 是：历史证明平台已完成 | unknown |
| `updatePost` 与 `changeState` 同时失败（写回完全不可用） | 同一 post **两次被接受** | 首个工作流完成但行未更新；missing sweep 重新启动执行 | 行保持 `QUEUE` → sweep 再发一次 → `PUBLISHED` | **否**：数据库状态与“从未发布”不可区分 | unknown（真实风险） |
| 成功通知写回失败 | 1 次发布 | 通知 activity 失败后仍继续 | post `PUBLISHED`，无通知行、无邮件 | post 可知；通知丢失不可知 | complete |
| webhook 目标不可达 | 1 次发布 | `sendWebhooks` 内部吞掉异常，工作流完成 | post `PUBLISHED` | webhook 投递不可知；post 可知 | complete |
| token 刷新失败 | 1 次刷新调用 | activity 返回 false，循环退出 | `refreshNeeded=true`、token 不变、用户收到通知 | 是 | failed |
| 邮件三次尝试全失败 | 3 次尝试、0 次投递 | activity 成功返回（异常被吞），无 Temporal 重试 | 无错误行 | 否：本地记录成功 | failed |
| 邮件 worker 离线时启动 per-email 工作流 | worker 恢复后投递 1 次 | activity task 持久等待，仅一个执行 | 1 次投递 | 是 | complete |
| 旧 `send_email` 在第 30 封后 Continue-As-New，队列非空 | 32 封各投递 1 次 | 首 run `CONTINUED_AS_NEW`；后继 run 的启动输入含剩余 2 封 | 同一 workflow id/type | 是 | complete |
| 维护工作流运行中重启 worker，24 轮后 CAN | 过期 post 仅发布 1 次 | 首 run 271 事件、`continuedAsNew=1`，后继同 id/type 并先做一次即时 sweep | 行未变 | 是 | complete |
| 候选 worker 缺少 `refreshToken` 注册 | 不刷新 | activity task 停在 scheduled；执行仍 `RUNNING`；worker 报 “not registered” | channel 未变 | 是 | failed |
| `prisma db push` 指向不可达数据库 | 不适用 | 无执行 | 非零退出；行/列/索引/媒体摘要均不变；换回真实库重跑成功 | 是 | failed |
| 协调恢复（DB+媒体快照回滚） | 回滚不撤销发布/刷新/摘要通知；sweep 再发一次 | 同一执行仍存在、类型/业务 id 不变 | 行与文件与备份完全一致 | **否**：回滚后的行说 `QUEUE`，平台已有发布 | unknown |
| 后端指向不可达 Temporal | 不适用 | 不可达 | 进程存活，`/api/` 始终未就绪；换回真实 Temporal 后同一二进制就绪 | 是（必须探测 API，不能只看进程） | failed |

### 本轮修复：pending 解析器把“未知”当成瞬时只读错误重试

演练发现 `postWorkflowV112` 的 `resolvePending` **没有 `timeout` 分支**：`finalizePost` 的 heartbeat 超时（带 details）会落到 `errorAttempts++`，睡 20 秒后再次执行 `checkPostStatus` + `finalizePost`。历史证据：事件 36 `ACTIVITY_TASK_TIMED_OUT` type=4、携带 1 条 heartbeat payload，随后 `timerStarted/timerFired`，再调度第二次 `finalizePost`；平台被接受两次，post 最终为 `PUBLISHED`。对以 `finalizePost` 完成创建的 provider，这会把“未知”变成重复发布，违反规格“不把未知当失败自动重发”。

修复：在 `resolvePending` 的 catch 中，对 `handle.type === 'timeout' && heartbeats`（仅 finalize 会置位）标记未确认并返回；用 `patched('post-finalize-timeout-unknown')` 保护，使**本次升级前已记录旧命令序列的历史仍按原路径 replay**，不会因命令不一致卡死。check-status 超时仍走原有界只读重试。未新增全局幂等系统，未改动其它 workflow 版本。`tests/fault-recovery.test.ts` 先红后绿覆盖此分支。

仍记录但未修复的基线缺陷：comment 超时会把**已发布的 root** 改写成 `ERROR`，同时 comment 行留在 `QUEUE`；这是上游 `markUnconfirmed` 以 `postsList[0]` 为目标的行为，属本地状态误报，交上线核验与后续修复决定。

### 兼容回退覆盖矩阵

| 已产生对象 | 覆盖证据 |
| --- | --- |
| `postWorkflowV101`–`V112`、`sendEmailWorkflow`、`sendSingleEmailWorkflow`、`digestEmailWorkflow`、`autoPostWorkflow`、`missingPostWorkflow`、`refreshTokenWorkflow`、`streakWorkflow`、`streakWorkflowV2` | 同一候选 bundle 全部导出（测试断言集合） |
| 旧阻塞 `postSocial` 与 新 `postSocialPending`/`checkPostStatus`/`finalizePost` payload | 同一 bundle 在 V102 与 V112 上各执行一次；id/type/queue/business id 不变 |
| patch `missing-post-continue-as-new`、`autopost-continue-as-new`、`reminder`、`streak-last-post` | 结构测试 + 票 16 演练 |
| provider 队列上的旧 workflow，**未**设置 `COMPAT_WORKFLOW_QUEUES` | 停在 `RUNNING`，0 activity、0 发布 |
| provider 队列上的旧 workflow，**设置**该队列 | 同 type/id/queue，完成并可发布一次 |
| 运行中已产生的新执行/数据 | 故障场景与协调恢复都在重启后继续使用同一执行；类型/业务 id 不变 |
| worker 缺少 activity 注册（等价于漏写 `@ActivityMethod()`） | 执行被接管但 activity 停在 scheduled，保持 `RUNNING`、无副作用；worker 日志点名未注册 activity。补注册的候选是必需的，但待处理 activity 要等 start-to-close（10 分钟、最多 3 次）才重派，恢复必须计入该窗口或显式重驱 |

未直接启动旧镜像：旧根启动命令含 `--accept-data-loss`，且旧 worker 不支持新 workflow/patch，因此不作为通用回退对象。

### 三种恢复条件与协调恢复

1. **同步失败**：`prisma db push` 指向不可达库时非零退出；88 张表、1092 列、281 索引、行摘要与媒体摘要均未变化，且没有新执行；换回真实库重跑成功且数据不变。**失败同步不证明结构未变**，因此保留错误与结构快照，不假设未发生部分变化。
2. **尚无新写入**：上述快照重比即该条件；没有新执行可接续，也没有补偿动作。
3. **已产生新版执行/数据**：在静默（停 worker/backend）下同时取 `pg_dump` 与媒体目录副本 → 启动后完成一次真实发布、一次 token 轮换、一条摘要通知 → 再次静默并同时恢复数据库与媒体。恢复后业务摘要与备份完全一致、媒体文件逐字节一致、token 回到旧值；但 Temporal 仍保留同一 `post_<id>` 执行（`COMPLETED`，type/`postId`/`organizationId` 不变）、替身仍记录发布与刷新、摘要邮件工作流仍存在。恢复后的行是 `QUEUE`，与平台事实相反；missing sweep 随即再发一次（共 2 次接受）。因此协调恢复只能恢复本地一致性，必须先核对平台/外部账目，不能把备份当作真相，也不能自动重放排程。

### 未证明与残余风险（交 18 与未来上线核验）

- 真实 Pod/imageID、真实 schema 漂移、在线在途任务清单、队列历史、真实备份方式与一致性点、停写窗口、真实 Temporal Server 版本均未验证；本演练不宣称线上恢复已证明。
- `postSocialPending` 接受后 15 秒 heartbeat 窗口内 worker 死亡会被当作“从未开始”而重发（已实测两次接受）；这是既有设计风险，按规格不另建全局幂等系统。
- 数据库写回完全不可用（`updatePost`+`changeState` 均失败）时行保持 `QUEUE`，missing sweep 会重复发布；恢复前必须先对账平台。
- comment 超时会把已发布 root 改写成 `ERROR`、comment 留 `QUEUE`（本地状态误报）。
- 旧 `send_email` 的 3 次邮件尝试失败被吞掉，Temporal 无法重试；webhook 投递失败本地不可见。
- 维护工作流的 `historyLength > 1000` 门在 24 轮门之前不可达（实测约 11 事件/轮、271 事件/首 run）；该分支只对其它节奏有意义。
- 维护 activity 执行中杀 worker 未实测：sweep 为 10 分钟 start-to-close 且无 heartbeat，恢复被推迟而非重复，属推理而非实测。
- 修复前已启动的在途执行在遇到 finalize 超时时仍走旧的“重试”路径（`patched` 为兼容历史保留），升级窗口需核对这些执行。
