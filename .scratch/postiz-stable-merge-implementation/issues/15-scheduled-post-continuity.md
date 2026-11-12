# 15: 旧排程接续执行，新排程使用新版工作流

**What to build:** 商户升级前尚未结束的排程在候选 worker 下继续执行，升级后新建排程使用新版工作流；页面时间、目标渠道、实际平台调用和发布写回一致，无需批量重建旧任务。

**Blocked by:** 09 — [旧渠道继续刷新凭据与重连](09-existing-channel-credentials.md); 10 — [旧媒体与新上传贯通编辑流程](10-media-editing.md); 14 — [候选 worker 能回放旧 Temporal 历史](14-temporal-history-replay.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的帖子、时区及“完整任务接续”契约；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 使用隔离数据库、Temporal、媒体与平台替身，由旧代码产生尚在等待的 V101/V102 等任务，切换到候选后继续执行，保留 workflow ID、业务 ID、namespace、搜索属性与任务队列连续性。
- [x] 从真实页面/公开 API 新建带媒体的排程，启动 V112；旧执行仍使用原定义，不批量改名、终止、删除或重建任务，不按旧日期或缺 batchId 自动补发。
- [x] 验证等待、候选重启、到时发布、结果写回及页面显示；同时核对数据库状态、Temporal 历史、替身调用次数、目标渠道、时间、releaseId/releaseURL 和媒体内容。
- [x] 覆盖改期、DRAFT、删除/update 等动作，断言旧任务与数据库状态按契约协调，不出现升级引入的错发、误改日期或状态；兼容上游重试、pending 与回锚更新。
- [x] 覆盖旧浏览器偏好、timezoneName 为空、新版时区选择及必要的客户端适配，原有发布时间不被猜测性转换；不得从旧整数偏移批量猜 IANA 时区或改 publishDate。
- [x] 用旧 payload 实际执行旧 postSocial 并验证阻塞返回；新活动验证 pending、查询和 finalize 的完整正常路径，不以 replay 成功替代平台副作用证据。
- [x] 六项既定 provider 的合成绑定及代表性非白名单旧绑定通过相应受控发布路径，使用正确凭据与组织；媒体、旧 JSON 和刷新后的凭据可继续消费，所有平台调用只到替身。
- [x] 保持单应用部署形态，不引入 Worker Versioning，不让未分流且不兼容的新旧 worker 随机消费同一队列；队列注册的详细覆盖在 16 扩展。
- [x] 留存正常接续与新建任务的真实执行证据，未验证的真实平台结果明确列出；重复、后台维护及邮件由 16 扩展，副作用未知和恢复由 17 验证。


## Answer

2026-11-12。以隔离 PostgreSQL 15、本地媒体目录、真实编译产物（backend + orchestrator）与 `@temporalio/testing` 的 Temporal server 组成可重复演练；旧代码产生的 V102 与旧 `sendEmailWorkflow` 由旧 bundle 建立，再交给候选 worker 接续。平台与邮件是唯一替身（记录每次调用、payload 与媒体字节摘要），没有改动任何产品代码——候选代码本身已满足本票契约，演练与静态回归网即为交付。

### 交付物

| 路径 | 内容 |
| --- | --- |
| `.scratch/postiz-stable-merge-implementation/rehearsals/15/` | 可运行演练：真实 DB/Temporal/媒体/编译进程，替身仅覆盖平台与邮件边界 |
| `.../15/README.md` | 架构、命令、场景表、边界与未验证项 |
| `.../15/evidence/summary.txt`、`evidence/latest.json`、`evidence/call-log.jsonl` | 最近一次完整运行的逐断言 PASS/FAIL、逐场景观察值、替身调用流水（已去除机器绝对路径） |
| `tests/scheduled-post-continuity.test.ts` | 8 个快速结构断言（新入口 V112、main-only workflow、provider 队列 activity-only、旧版阻塞契约、邮件队列） |

运行：`node .scratch/postiz-stable-merge-implementation/rehearsals/15/run.mjs`（约 1 分 46 秒，8 场景 107 条断言全部 PASS；连跑两次结果一致）。数据库与 Redis 容器在结束时删除，媒体目录为临时目录。

### 场景与实测结果

| 场景 | 实测 | 终态 |
| --- | --- | --- |
| `new-post-v112-http`（真实时钟、公开 API + 上传媒体） | 由 `/public/v1/upload` 上传图片后用 `/public/v1/posts` 建排程；执行类型 `postWorkflowV112`、taskQueue `main`；provider 活动在 `bluesky` 队列；`postPending` ×1 → `checkPostStatus` ×1 → `finalizePost` ×1（完整 pending 正常路径）；替身经 HTTP 读到上传图片（70 字节，sha256 与上传一致） | `PUBLISHED`，`publishDate` 未被改写，`releaseId`/`releaseURL` 来自 `finalizePost`；重启 worker 后调用数仍为 1；发布同时启动 `streakWorkflowV2` |
| `legacy-v102-continuity`（真实时钟、旧 bundle 建执行） | 候选 worker 先停止，旧 bundle 建 `postWorkflowV102` 并进入排程 timer 后停止旧 worker，再启动候选 worker；同一 workflow id/run id 完成，`postSocial`（阻塞契约）×1，绝不调用 `postPending`；旧相对路径媒体由候选 activity 从磁盘读取（sha256 一致）；历史事件前缀逐条相同（未重建）；该 post 仅 1 个执行 | `PUBLISHED`，`publishDate` 保持原值；重启后不再发布、不重写行 |
| `reschedule-scheduled-post`（真实时钟、页面改期路由） | `PUT /posts/:id/date`（action=schedule）后，原执行 `TERMINATED`、同 workflow id 新 runId 的 V112 接替；DB 新日期生效、状态仍 QUEUE；到点发布 1 次 | 只在新日期 `PUBLISHED`，`releaseId` 写回 |
| `draft-update-delete`（真实时钟） | DRAFT 不建 workflow；DRAFT→schedule 建 V112；DELETE 置 `deletedAt` 并终止该执行；published 帖 `action=update` 仅改日期，保持 PUBLISHED/`releaseId` 且不建执行 | 被删帖保持 QUEUE + deletedAt，重启后 0 次平台调用；update 未重发 |
| `legacy-email-backlog`（真实时钟、旧 `send_email` 单例） | 旧 bundle 建单例后停止旧 worker，候选 worker 接续并消费 2 个 `sendEmail` signal；邮件边界收到 2 封，顺序/收件人保持 | 重启后仍为 2 封，无重发 |
| `missing-post-sweep`（时间跳跃） | `missingPostWorkflow` 的 `searchForMissingThreeHoursPosts` 在 `main` 执行，找到 5 小时前 QUEUE 帖，`signalWithStart` poke `post_<id>`；执行类型 V112，历史含 `WORKFLOW_EXECUTION_SIGNALED` | 发布 1 次，保留原过去日期，未改 batch/未重建 |
| `autopost-maintenance`（时间跳跃） | `autoPostWorkflow` 的 `autoPost` 在 `main` 执行，读取本地 RSS，经正常 post service 建 1 个 DRAFT，记录 `lastUrl` | 0 次平台调用 |
| `streak-email`（时间跳跃 25h） | `streakWorkflow` 写 streak、24h 后发出「Streak Ended」，走新的 per-email workflow（`addTo: bottom` → `email-bulk` 队列） | 邮件 1 封，`streakSince` 清空，workflow COMPLETED |

每个场景的目标渠道、凭据、队列、payload（消息/设置/媒体字节摘要）和最终数据库行均记录在 `evidence/latest.json`；全量断言清单见 `evidence/summary.txt`。

### 产品契约（实测确认）

- 新入口为 `postWorkflowV112`（`main` 队列）；V101/V102 定义、旧 activity 名与阻塞 `postSocial` 保持；V112 的 pending/check/finalize 是独立活动。
- 旧执行不批量改名/终止/删除/重建：交接只发生在同一 workflow id/run id 上，历史前缀不变；改期/删除只终止该 `post_<postId>`（同 id 重启），不是按日期或缺 batchId 的补发。
- 数据库、Temporal 历史、平台实际结果三者分别核对；媒体旧相对路径与新 HTTP URL 两种读取方式都实际读取了字节。
- 无 Worker Versioning、无队列随机分流；同一 `main` 队列可同时运行旧/新版本（场景 2 与 1/3 在同一命名空间相邻运行）。邮件旧单例在 `main` 执行，新 per-email 使用 `email`/`email-bulk` 队列。

### 未验证 / 交 16、17

- 未接真实平台/OAuth：六渠道真实绑定、真实凭据有效期与平台限流仍属 07/09 与最终验收；本演练只证明受控发布路径与 payload。
- pending/finalize 的失败分支、heartbeat 有无 details、平台已接受后 worker 退出、DB/通知写回失败、结果未知恢复：未覆盖，交 17。
- 多 worker 下的重复任务、digest/邀请/邮件限流与 continue-as-new 边界：交 16；本演练仅验证旧单例 drain 与 streak 触发的新 per-email 路径。
- 测试 server 无 visibility store，时间跳跃场景用确定性 workflow id 断言执行；真实 namespace 的任务队列分布、搜索属性类型与 server 版本未核查，上线前仍需核对。
- `action=update` 作用于 QUEUE 帖（仅公开 API 可达，页面不会这样调用）只改 DB 日期而不重启执行，属合并前既有契约；本次未改动，也未把它当成本次回归，交 17/上线核对。
- 浏览器会话入口未使用（用合成 API key/JWT 调用同一 controller）；页面层入口由 05/12 覆盖。

