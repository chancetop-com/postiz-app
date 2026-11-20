# 12: 让候选 worker 接续在途任务

**What to build:** 已有排程、重复任务及延迟评论能在候选 worker 接手后继续执行，积压刷新和邮件仍有人消费。维护者能从历史、数据库和平台账目核对每次执行。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [在途任务与队列兼容](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [x] 用候选 bundle 回放定制 v2.25.3 的隔离历史及既有更早样本，覆盖 V101/V102、V112 和旧子任务，记录 bundle 及样本版本。
- [x] 在隔离 Temporal 中由候选 worker 实际接手睡眠排程、重复子任务、延迟评论、积压刷新和邮件。核对旧 activity 注册、载荷、原 namespace、队列（含兼容 provider 队列）、workflow ID 与业务 ID。
- [x] 验证旧版阻塞返回和 V112 的 pending、check、finalize 均产生预期结果，核对新建任务与仍在执行的旧任务的实际消费记录。
- [x] 逐项对照帖子时区、发布时间、结果写回及平台替身调用的目标和次数，保存可供故障演练复用的正常样本与账目。

## Answer

2026-11-20，分支 `codex/ticket-12-temporal-continuity`（实现提交 `06229790`，合入集成分支 `40190719`）。候选版本既能回放旧历史，也能在真实隔离 Temporal 中由编译后的候选 worker 接续执行。演练位于 `.scratch/postiz-v2.26.0-implementation/rehearsals/12/`，只替换平台与邮件边界；产品代码未改。

### 回放（bundle 与样本版本）

| 项 | 值 |
| --- | --- |
| 回放入口 | `node .../rehearsals/12/run.mjs replay`（调用既有 ticket-14 harness，未改旧 fixture） |
| 候选 bundle | 源码入口 `apps/orchestrator/src/workflows/index.ts`，sha256 `f2fe43cd155d86272a68e785df5b610d5b09ae1a68eaf226475ddbc8b262a0ee` |
| 历史 | 16 / 16 通过，0 失败 |
| 旧代码 | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43`（定制 v2.25.3 行为基线） |
| fixture 生成 | 2026-11-11T13:15:27Z；旧 bundle `028e69b6…`，patch 派生 bundle `6983fd53…` |
| 回放时候选修订 | `40190719`（ticket-12 工作树，含本票未跟踪演练文件） |

覆盖 V101、V102（含延迟评论、睡眠中、refresh、repeat child）、旧邮件单例及 Continue-As-New、autopost、missing sweep、streak。V112 在 v2.25.3 中没有历史（不可能由旧代码生成），其正常路径由下面的 live 场景实际执行；没有用候选自身生成的历史代替旧版兼容证明。

### 实际接续（隔离 Temporal）

新建专用 namespace `postiz-ticket-12`；数据库 `postiz-ticket-12`、Redis DB 12。每个场景先由旧 bundle 的 worker 建立执行并进入 timer/signal handler，停止旧 worker 后再启动编译后的候选 worker；候选 worker 消费同一 workflow id/run id。8 个场景、94 条断言全部 PASS：

| 场景 | 实测结果 |
| --- | --- |
| `v101-sleep-takeover` | 同一 `post_<postId>`、同一 run/type/queue 完成；`postSocial`（阻塞）×1、`postPending` 0；`publishDate` 不变；`releaseId`/`releaseURL` 写回；媒体 70 B、sha256 `c414cd0e…` 与旧文件一致 |
| `v102-delayed-comment` | 根帖 ×1，`postComment` ×1；实测延迟 61.5 s（存储 delay=1 分钟）；评论使用根帖平台 id；根/评论均写回 PUBLISHED；`postComment` 在 `bluesky` 队列 |
| `v102-repeat-child` | 父 V102 记录 `StartChildWorkflowExecutionInitiated` → V102 子任务 `post_<postId>_<suffix>`；父、子各发布 ×1，均走旧阻塞契约；子任务由候选 worker 消费（证据记录时 status RUNNING，随后清理终止） |
| `v112-pending-finalize` | `postSocialPending` ×1 → `checkPostStatus` ×1 → `finalizePost` ×1，阻塞 `post` 0；`releaseId`/`releaseURL` 来自 finalize；`publishDate` 与组织时区（Asia/Shanghai）均未改写；provider 活动在 `bluesky`，DB 写回在 `main` |
| `refresh-backlog` | 旧 `refresh_<integrationId>` 在到期 timer 后由候选执行 `refreshToken`；旧库中的 `enc:v1:` token/refreshToken 被解密后交给 provider（收到明文 refresh token）；新 token 仍以 `enc:v1:` 写回；`@ActivityMethod()` 保持注册 |
| `legacy-email-drain` | 预先存在的 `send_email` 单例（workflow id `send_email`、type `sendEmailWorkflow`、queue `main`）由候选消费：积压 1 封 + 后来 signal 1 封，共 2 个不同收件人、无重复；`sendEmail` activity 在 `main`，未走新的 per-email workflow |
| `compat-provider-queue` | `COMPAT_WORKFLOW_QUEUES=bluesky` 时 `bluesky` 有 workflow poller（7）且 `main` 有（9），未列出的 `x` 为 0；workflow task queue 为 `bluesky` 的旧 V102 完成并发布 ×1；无 compat 时 provider 队列仍为 activity-only |
| `missing-scan` | `missingPostWorkflow` 首轮扫描：已删除、已 PUBLISHED、扫描加载后被其他 worker 改成 PUBLISHED 的三类帖子均不派发；仍为 QUEUE 的过期帖以 `post_<postId>` signalWithStart V112 并发布 ×1 |

维护扫描的“二次读取”用预加载钩子模拟并发状态变化：仓库首次查询后把标记帖改为 PUBLISHED，activity 的 `getPostState` 读回 PUBLISHED 后跳过；同一 activity 对仍为 QUEUE 的帖子派发 V112。

### 载荷、队列与业务 ID

- 旧 activity 名（`postSocial`、`postComment`、`refreshToken`、`sendEmail`、`searchForMissingThreeHoursPosts` 等）全部仍注册；V101/V102 走阻塞 `postSocial`，V112 走独立的 pending/check/finalize。
- 旧执行保持 workflow id、run id、namespace、`postId`/`organizationId` 搜索属性与 `main` workflow queue；provider 队列只跑活动，除非显式列入 `COMPAT_WORKFLOW_QUEUES`。
- 平台替身逐次记录目标渠道、组织、内部 id、凭据（解密后）、消息、media 字节摘要、时间戳；调用账目在 `evidence/call-log.jsonl`，逐场景正常样本在 `evidence/normal-samples.json`，可供 ticket 13 做故障对照。
- 新排程仍为 `postWorkflowV112`；没有重命名、终止、重建旧执行，没有 Worker Versioning。

### 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（frontend / backend / orchestrator） |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | 62 文件 / 672 用例通过，13 跳过（含本票新增 6 条结构断言） |
| `run.mjs replay` | 16/16 |
| `run.mjs live` | 8/8 场景、94/94 断言 |
| `run.mjs all` | replay + live 均通过 |

### 未验证（交 13/14 与最终验收）

- 未接真实平台/OAuth：六渠道真实发布、真实限流与凭据有效期仍属 11 与最终验收；本票只到平台替身。
- pending/finalize 失败、heartbeat 有/无 details、平台已接受后 worker 退出、DB 写回失败等未知结果交 ticket 13。
- 多 worker 并发、发布中途关闭、`EXCLUDE_QUEUE`/`WORKER_CONCURRENCY_DIVIDER` 未覆盖。
- 重复任务用 `intervalInDays=-1` 加速到期；真实一天间隔与长期重复链未等待。
- 部署环境的真实 Temporal namespace、任务队列分布、搜索属性类型与 server 版本未核查；本票使用自建隔离 namespace。
