# 16: 重复任务、邮件与维护任务持续运行

**What to build:** 升级前的重复任务及后台积压继续处理，后续轮次、延迟评论、凭据刷新、邮件与维护工作均由正确 worker 接续，商户无需重建计划。

**Blocked by:** 15 — [旧排程接续执行，新排程使用新版工作流](15-scheduled-post-continuity.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的旧 repeat child、邮件与队列兼容契约；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 通过真实应用操作和隔离 Temporal 运行旧/新重复排程，跨重启验证至少后续轮次及旧 repeat child 继续创建旧版本时的执行，不在首轮结束后删除旧导出。
- [x] 验证延迟评论与 refresh 积压在候选下继续，核对目标账号、时间、外部替身调用次数、业务写回及后续任务状态；不触发真实评论或凭据刷新。
- [x] 保留旧邮件积压 workflow，同时启动并验证新版 email、email-bulk worker；用邮件替身观察送达请求与完成状态，不能仅检查 worker 注册代码。
- [x] 实际运行 autopost、missing sweep、streak 的 patch 与 Continue-As-New 路径，结合 14 的历史 replay，检查缺失任务补偿条件及实际副作用，不将所有旧帖当作待补发。
- [x] 常规 workflow 的 main 队列与新 provider activity-only worker 有实际消费证据；对可能存在的 provider 队列旧 workflow 建立合成历史场景，并保留所需 workflow 注册或兼容 worker。
- [x] 不假定线上不存在 provider 队列 workflow；现网队列与历史事实留给未来上线核验，本地报告明确支持范围和未核实事实。
- [x] 保持 namespace、workflow ID、业务 ID、搜索属性和队列连续性，保留单应用部署形态；不要求全部长期任务 drain，不引入 Worker Versioning 或随机混跑不兼容 worker。
- [x] 保存每类任务从触发/积压到完成或下一轮的证据，真实数据库、Temporal 和外部替身结果一致；将失败注入与恢复需要的新旧类型、patch、payload 清单交给 17。

## Answer

2026-11-12。以隔离 PostgreSQL 15、Redis、本地媒体、真实编译产物（backend + orchestrator）和 `@temporalio/testing` Temporal server 组成可重复演练；平台、评论、凭据刷新与邮件只进入替身。真实时钟场景共用 server，每个时间跳跃场景使用独立 server。完整矩阵 **10 个场景 / 122 条断言全部 PASS，连续两次结果一致**；证据在 `.scratch/postiz-stable-merge-implementation/rehearsals/16/`。

### 交付物与产品改动

| 路径 | 内容 |
| --- | --- |
| `.../rehearsals/16/` | 可运行演练，复用 15 的 DB/Temporal/媒体/HTTP helper；新增评论、重复、刷新、陈旧帖 fixture，邮件/平台/刷新替身 |
| `.../16/README.md` | 架构、命令、场景表、边界、17 的失败注入交接 |
| `.../16/evidence/summary.txt`、`latest.json`、`call-log.jsonl` | 本轮 122 条断言、逐场景观察值、替身调用流水（已去除机器路径） |
| `libraries/.../temporal/worker.queues.ts` | `COMPAT_WORKFLOW_QUEUES` 解析与队列判定；默认空，provider worker 仍为 activity-only |
| `libraries/.../temporal/temporal.module.ts` | 仅对列出的 provider 队列额外注册 workflow bundle；`main` 行为不变，无 Worker Versioning |
| `apps/orchestrator/src/activities/integrations.activity.ts` | 给 `refreshToken` 补 `@ActivityMethod()`；此前只有类方法、未被 Temporal 注册，`refreshTokenWorkflow` 实际无法刷新。规格依据：用户故事 26–27 与“六项渠道/旧渠道凭据”裁定“已有渠道可以刷新凭据、重新授权并继续发布”——未注册时工作流不产生任何刷新调用，该裁定不成立；属基线缺陷修复 |
| `tests/recurring-maintenance-workers.test.ts` | 10 个快速结构断言（刷新注册、兼容队列、双邮件入口、重复版本、patch/CaN、re-anchor） |

### 场景与实测

| 场景 | 实测结果 |
| --- | --- |
| `legacy-repeat-child-continuity` | 既有 V102 执行第一轮经 `postSocial`→`bluesky` 发布；重启 worker 后 24h 轮次创建 **V102** child（`post_<id>_<random>`），同一业务 postId；两轮各发布 1 次，anchor 日期不变；旧导出仍必需 |
| `new-repeat-child-continuity` | 新调度载荷 → V112；第一轮 `postPending`→`checkPostStatus`→`finalizePost`；重启后下一轮仍是 **V112** child；两轮、两次 finalize，anchor 不变 |
| `autopost-continue-as-new` | 首轮真实读取 RSS、创建 1 个 AUTOPOST DRAFT、记录 `lastUrl`、0 平台调用；24 轮后 CaN（首 run 271 events，`continuedAsNew=1`），同 workflow id/type、新 run；同 feed 不重复建草稿 |
| `missing-sweep-continue-as-new` | 24 次 sweep 在 `main` 执行后 CaN（271 events），同 id/type |
| `streak-patch-continue-as-new` | 两个 patch gate 均为真：不发送旧 reminder；24h 时 CaN 到 **streakWorkflowV2**（首 run 37 events），不发结束邮件，`streakSince` 保留 |
| `missing-sweep-compensation` | 5h 陈旧 QUEUE 帖发布 1 次并保留原过去日期；25h repeat anchor 被 poke 为 V112 但内存 re-anchor 到下一 occurrence：DB 仍 QUEUE、日期不变、0 调用；3 天前帖子与 refresh-needed 渠道不 sweep |
| `delayed-comments-both-generations` | 旧 V102 与公开 API 新建 V112 均在约 60s 后发评论；目标为 root releaseId、绑定账号/token，评论行写回 PUBLISHED + releaseId，两个 workflow COMPLETED，恰好 2 次 comment |
| `refresh-token-backlog` | `refresh_<integrationId>` 等到期后执行 1 次已注册的 `refreshToken`（`main`）；DB 写入新 access/refresh token 与到期时间、清 `refreshNeeded`，workflow 继续等待下一到期 |
| `email-both-generations` | 旧 `sendEmailWorkflow` 在 `main` 按 addTo 顺序送达 3 封并保持运行；新 `sendSingleEmailWorkflow` 的 priority 活动在 `email`、bulk 在 `email-bulk`，均 COMPLETED；5 封各 1 次，重启不重发 |
| `provider-queue-workflow-compat` | 合成 V102 以 `taskQueue=bluesky` 启动，默认 provider worker activity-only 时停在 2 events、无活动、未发布；重启加 `COMPAT_WORKFLOW_QUEUES=bluesky` 后同 id/type/queue 完成，1 次 blocking publish，`postSocial` 与 DB 活动都在 `bluesky` |

队列消费汇总（实际 dispatch）：workflow `{"main":15,"bluesky":1}`；activity `{"main":68,"bluesky":33,"email":1,"email-bulk":1}`。常规 workflow 在 `main`；新 provider worker 默认只消费 activity；邮件 workflow 在 `main`、活动分流到 `email`/`email-bulk`。兼容 provider 队列 worker 只在显式配置时注册同一 bundle。

### 连续性与边界

- 保持 namespace（`default`）、workflow id（`post_<postId>` / `refresh_<id>` / `email_*` / 维护固定 id）、业务 postId、`postId`/`organizationId` 搜索属性、队列名与单应用部署；未引入 Worker Versioning，也未让未分流的不兼容 worker 随机共消费。
- 旧 repeat child 的类型由父执行版本决定；V102 链保持 V102，V112 链保持 V112，首轮后不删除旧导出。
- `COMPAT_WORKFLOW_QUEUES` 是运维显式开关，默认空；现网是否真的存在 provider 队列 workflow 未核查，不能假定不存在，也不能默认开启。
- 演练对测试服务器的两项适配仅属于 harness：`T16_DISABLE_STICKY=1` 绕过时间跳跃 server 的虚拟 sticky 超时，`EXCLUDE_QUEUE` 只启动 main/bluesky/email/email-bulk 以免连接 ping 限流；产品 worker 保持默认 sticky。

### 未验证 / 交接

- 未接真实平台、OAuth 有效期、限流或 Resend 送达；替身只证明受控路径与 payload。
- 现网 namespace/队列历史/server 版本、真实 provider 队列 workflow 的存在性仍未核查，需上线前检查后决定是否设置 `COMPAT_WORKFLOW_QUEUES`。
- 时间跳跃下的 streak 场景用替身把“最后发帖时间”对齐虚拟时钟；真实 24h 墙钟结束路径由 15 的 streak-end 场景覆盖。
- 失败注入未覆盖，交 17：平台已接受后 worker 退出、无/有 heartbeat details 的 timeout、发布后 DB/通知/webhook 写回失败、评论超时、refresh 失败、邮件三次重试/队列离线/CaN 非空队列、维护 CaN 边界与 history>1000、provider 队列兼容 worker 缺失/活动类缺失。完整新旧类型、patch、payload 与断言清单见 `rehearsals/16/README.md` 的 “Hand-over to ticket 17”。

### 门槛

`pnpm run typecheck` PASS；`pnpm run lint` 0 errors / 713 warnings；`pnpm run test` 两次均 **459 tests / 52 files** PASS（基线 449/51 未下降，新增 10 个结构测试）；`pnpm run build` PASS；`./k8s/prepare-build-context.sh --check` in sync；演练完整矩阵两次 PASS。
