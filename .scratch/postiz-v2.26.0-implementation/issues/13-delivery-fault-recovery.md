# 13: 核对发送故障与恢复结果

**What to build:** 任务执行中断时，维护者可以区分已发送、平台拒绝、仍在等待和结果未知的帖子，并核对恢复后是否重复发送。

**Blocked by:** [12 让候选 worker 接续在途任务](12-temporal-inflight-continuity.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [任务故障与候选验收条件](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [x] 复用正常接续样本，在补偿扫描期间取消、删除或改期，核对执行前重新读取的帖子状态、原定时间和实际发送次数。
- [x] 在平台替身已接受请求后模拟 worker 中断或本地写回失败。记录数据库状态、Temporal 历史及平台侧接收次数，复核恢复后的调用与写回。
- [x] 覆盖 V112 finalize 超时及 heartbeat 有无细节的样本，检查定制的结果未知标记，区分平台已拒绝、pending 和未知结果。
- [x] 在隔离环境用兼容候选或已演练的数据库、媒体与 Temporal 协调恢复路径复核状态。将可确认的发送、重复调用及仍未知的结果分别记入证据。

## Answer

2026-11-20，在隔离 `postiz-ticket-13` Temporal namespace、专用 PostgreSQL 数据库、Redis DB 13、本地媒体目录和平台/邮件录制替身上，用编译后的候选 orchestrator 完成 7 个故障场景、84 条断言（全部 PASS）。没有修改产品代码：候选已包含 V112 的 `post-finalize-timeout-unknown` patch 与 heartbeat 分类，本票只新增演练与快速回归网。证据在 `.scratch/postiz-v2.26.0-implementation/rehearsals/13/`（`README.md`、`run.mjs`、`lib/`、`results/latest.json`、`evidence/summary.txt`、`evidence/latest.json`、`evidence/classifications.json`、`evidence/call-log.jsonl`）；快速回归网为 `tests/temporal-fault-recovery.test.ts`（10 条，随 `pnpm test` 执行）。

### 引用

| 项 | 值 |
| --- | --- |
| 执行起点 | `2622ec49`（`postiz-v2.26.0-integration`，工作区干净） |
| 票分支 | `codex/ticket-13-fault-recovery` |
| 实现提交 | `413004ea`（演练、证据、`tests/temporal-fault-recovery.test.ts`） |
| 分支同步 | 票分支内 `git merge postiz-v2.26.0-integration`：`Already up to date`（tip 仍为 `2622ec49`） |
| 合并提交 | `18d0c20a`（`--no-ff`，父提交 `2622ec49` 与 `68e0d7c3`） |
| 祖先校验 | `2622ec49`、`413004ea`、`68e0d7c3` 均为 `18d0c20a` 的祖先；合并后无冲突标记 |
| 正常样本 | ticket 12 `evidence/normal-samples.json`（生成 2026-11-20T10:27:52Z；bundle `f2fe43cd…`；回放 16/16；媒体 sha256 `c414cd0e…`） |

### 场景与分类

| 场景 | 数据库/历史/平台事实 | 分类 |
| --- | --- | --- |
| `scan-mutations-during-compensation` | 扫描加载 4 个过期 QUEUE 后，1 个删除、1 个取消（ERROR）、1 个改期；`getPostState` 二次读取让删除/取消不派发、无平台调用、`publishDate` 保持原值；改期行仍为 QUEUE 被派发 V112，实测在新时间后 10.2 s 发送一次；未受干扰行发送一次；四条合计 `postPending`/`finalizePost` 各 2 次，删除/取消 0 次 | complete |
| `finalize-platform-rejected` | `postPending` 接受 1、`finalizePost` 调用 1、平台接受 0/拒绝 1；行 ERROR、无 releaseId；`post.error` 与 Errors 行含 `bad_body`；发出 "Error posting" 通知；未重试 | failed |
| `pending-still-in-progress` | `postPending` 接受 1；`checkPostStatus` 连续返回 pending（快照时已 2 次）；行 QUEUE、execution RUNNING、无 releaseId、无 error/Errors；`finalizePost` 0 | pending |
| `writeback-transient-recovers` | 平台接受并 finalize 1 次；第一次 `updatePost` 本地失败，行暂为 QUEUE；shipped retry 间隔实测 120.0 s，第二次写回 PUBLISHED + finalize releaseId；平台仍只 1 次，无重复 | complete |
| `writeback-permanent-sweep-duplicates` | `updatePost` 与 `changeState` 永久失败后行保持 QUEUE、无 releaseId（与“未发布”不可区分）；随后补偿扫描再次派发并接受第二个平台 id；两次 `postPending`/`finalizePost`，最终行指向第二次结果 | unknown（dup） |
| `worker-death-finalize-no-details` | 两个 finalize 在首次 heartbeat 前被 SIGKILL：一个未到达平台（重试后 1 次接受、scheduled 2、PUBLISHED）；一个已被平台接受（重试后共 2 个不同 finalize id、两个 pid，行指向第二次，首个成为孤儿）。两次 timeout 均为 heartbeat、0 payload | complete + unknown（dup） |
| `worker-death-finalize-with-details` | 平台接受 finalize 后约 15.3 s 收到 `finalizePost: entered` heartbeat，SIGKILL 并重启兼容候选；timeout type=HEARTBEAT、1 payload；`postSocialPending`/`checkPostStatus`/`finalizePost` scheduled 各 1；平台只接受 1 次；行 ERROR、无 releaseId、含完整 timeout failure；通知“couldn't confirm”；media sha256 前后一致；同一 workflow id/run/type | unknown |

### 定制的未知标记

带 details 的 finalize 超时执行 search attributes 记录 `TemporalChangeVersion: post-finalize-timeout-unknown`，证明走了 `patched('post-finalize-timeout-unknown')` 分支：`resolvePending` 不再 sleep 20 s 后重跑 check+finalize，而是 `markUnconfirmed` 并结束。无 details 的 heartbeat 超时仍按“从未开始”重试：平台未接受时是安全的一次重试；平台已接受但 worker 在首个 15 s heartbeat 窗口内死亡时会产生第二次接受。这是既有设计风险，证据单列 `duplicate: true`，未新增全局幂等系统。

### 恢复与重复发送（观察到的限制，不作为通过行为）

- 兼容候选重启后，同一数据库、媒体目录和 Temporal 执行继续；`worker-death-finalize-with-details` 的 workflow id/run/type 不变，媒体摘要不变，平台账目仍为 1 次。
- 本地写回可恢复时，shipped activity retry 完成 `PUBLISHED`/`releaseId`，没有第二次平台调用。
- **带 heartbeat details 的恢复没有重复发送**：timeout 携带 `finalizePost: entered`，工作流标记 ERROR/unconfirmed，重启后不再调度 finalize，平台只接受 1 次。
- **无 details 且平台已接受时重复发送**：worker 在首个 15 s heartbeat 窗口内死亡，重启后按“从未开始”重试 finalize，平台出现 2 个不同 id（`stub-finalized-71560-3`、`stub-finalized-71750-2`），本地指向第二次；首个成为孤儿。这是既有 15 s 窗口风险，证据 `duplicate: true`。
- **写回完全丢失 + 补偿扫描重复发送**：`updatePost` 与 `changeState` 都失败后行保持 QUEUE、无 releaseId，与“未发布”不可区分；扫描再次派发并接受第二个平台 id（`stub-pending-68847-1`、`stub-pending-68847-3`）。恢复必须先核对平台账目，不能仅凭本地行判断未发布。
- 以上重复发送均记录为已观察到的限制/风险，不表示恢复逻辑通过；本票未新增全局幂等系统。
- 平台已拒绝（bad_body）与 pending 均不写入“未知”标记；只有 timeout/无法确认才进入 ERROR + unconfirmed 通知。确认发送、重复调用和仍未知结果分别在 `evidence/classifications.json` 中记为 complete / failed / pending / unknown。

### 门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（frontend / backend / orchestrator） |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **64 文件 / 695 用例全部通过，0 跳过**（合并前 63 文件 / 685 用例；本票新增 1 文件 / 10 条） |
| `run.mjs live` | 7/7 场景、84/84 断言 PASS |
| 正常样本复用 | ticket 12 的 8 个正常场景与 16/16 回放作为对照；媒体载荷 sha256 一致 |

### 未验证

- 真实平台/OAuth/限流与真实邮件投递；本票只到合成 `bluesky` 边界。
- 永久 `updatePost` 失败的 shipped 重试计划（3 次 / 2 分钟）被压缩为一次不可重试失败；到达的分支相同，节奏未实测。
- pending 的完整 30 分钟预算只观察到前两次 check；耗尽后的 `Could not confirm the post status` 分支由结构测试固定，未 live 等待。
- 真实数据库备份/停写窗口下的协调恢复沿用 ticket 17 的既有结论；本票用兼容候选重启与媒体摘要对比复核。
- 多 worker、`EXCLUDE_QUEUE`、发布中途关闭、真实 Pod/imageID 与 UI 对 `TemporalChangeVersion` 的展示未覆盖（交 14/18 与上线核验）。
