# 08: 按勾选渠道编辑和发布帖子

**What to build:** 内容编辑从多渠道帖子中勾选部分渠道，可以只对这些帖子保存草稿、立即发布、改期或删除。相同批次和其他组织的帖子仍按各自计划处理。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [多渠道编辑的上游变化](../../postiz-v2.26.0-wayfinder/assets/release-delta.md)

- [x] 在隔离环境建立本组织同批次的多渠道帖子及另一个组织的对照样本，记录每项的渠道、状态和发布时间。
- [x] 从实际编辑入口分别执行保存草稿、立即发布、改期和删除。核对所选项的持久化结果、日历展示及排程变化。
- [x] 逐项验证同批未勾选项及其他组织样本的内容、状态和发布时间，确认未受到操作影响。
- [x] 对涉及发送的操作核对平台替身收到的渠道、次数及时间；删除或改期样本按最新状态对账。

## Answer

2026-11-20，实现分支以 `--no-ff` 合入 `postiz-v2.26.0-integration`，0 个未合并路径；全量回归 62 文件 / 621 用例通过，类型检查 exit 0。合并只新增 1 个测试文件并给 `changeDate` 加 4 行归属校验，未改动邀请、Connect Link 或商户会话路径。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-08-selected-channel-posts` |
| 实现提交 | `2a81a4ceca170c93e7da353643cf74d03c1fb445`（`fix(posts): scope multi-channel operations to the selected posts`） |
| 合入前集成分支 | `32502d8ae`（已含 ticket 02 商户会话、03 邀请、06 公开 Connect Link） |
| 合并提交 | `76c0f92198ae419edd98a5b4ed449f78c9eede38`，父提交 `32502d8ae` 与 `2a81a4cec` |
| 祖先校验 | `32502d8ae`、`2a81a4cec`、`a4318b8a5`（03）、`4f425ec8d` / `d736f79a6`（06）、`7da008887`（02）均 `merge-base --is-ancestor HEAD` 为真 |
| 冲突 | 0 个未合并路径（`git ls-files -u` 为空）；无 `<<<<<<<` / `>>>>>>>` 标记；`git diff --check` exit 0 |
| 03/06/02 保留 | 合并相对 `32502d8ae` 只触及 `posts.service.ts` 与 `tests/selected-channel-posts.test.ts`；邀请、Connect Link、会话/CORS 文件未变，相关用例随全量回归通过 |

### 跨组织 `changeDate` 404（本票唯一生产代码变化）

`PostsService.changeDate` 在按 `(id, organizationId)` 查不到帖子时，原先对 `null` 继续执行重发守卫而抛 `TypeError`（500）。现在先返回 `404 Post not found`，位置在 republish 守卫和日期更新之前；另一组织持有的帖子 id 被明确拒绝，且不产生任何写入或 Temporal 启动。

### 7 用例真实 PostgreSQL 套件

`tests/selected-channel-posts.test.ts` 使用真实 PostgreSQL，驱动已发布的 `PostsService` + `PostsRepository`，以记录型 Temporal 客户端为发布边界。种子：组织 A 三个 `x` 渠道同批次、每渠道一个 group；组织 B 一个渠道并复用同 `batchId` 及 A1 的 group id。A1 为勾选项，A2（QUEUE）/ A3（DRAFT）为未勾选同批。

| 用例 | 实测 |
| --- | --- |
| 保存草稿 | A1 变 `DRAFT` 且内容更新；A2/A3/B1 的 id、状态、内容、发布时间、`deletedAt` 完全一致；不为 A1/A3 启动发布，A2 保留自己的未来执行 |
| 立即发布 | A1 变 `QUEUE`、`publishDate`≈当前、内容更新；恰好一次 `postWorkflowV112`，`workflowId=post_<A1>`、Temporal 队列 `main`、provider 队列 `x`；A2 的启动仍携带原未来时间，A3/B1 无启动 |
| 编辑入口改期 | `createPost type=schedule`：仅 A1 日期/内容/`QUEUE` 变化，A2/A3 不变，仅 A1 启动 |
| 日历改期 | `PUT /posts/:id/date` + `action=update`：仅 A1 日期变化，状态/内容保持，未勾选项不变 |
| 删除 | 按渠道**当前** group 只软删 A1；A2/A3 存活；B1 虽复用相同 group id 仍存活；仅 `post_<A1>` 被终止 |
| 未勾选同伴隔离 | 每项操作后 A2/A3/B1 快照逐字段不变；关闭勾选不影响同批其他帖子 |
| 跨组织拒绝 | `createPost` 拒绝 B 的 value id；`mapTypeToPost` 拒绝 B 的 integration id；`changeDate` 双向 404；`deletePost` 按组织限定；`getPostsByBatch` 排除 B |

### HTTP + Temporal 证据

后端 `:3108`、数据库 `postiz-ticket-08`、Temporal `:7233`；经 `POST /auth/register` 建立 LOCAL 用户并种入合成帖子，走编辑器实际调用的端点：

- `POST /posts type=draft`：`201`；DB 只有 A1 变为草稿并更新，A2/A3/B1 状态与内容不变。
- `POST /posts type=schedule`：`201`；只有 A1 改期，Temporal 出现真实执行 `post_ticket08-http-a1`。
- `PUT /posts/<A1>/date {action:"update"}`：`200`，只有 A1 移动；`PUT /posts/<B1>/date` → `404`；`GET /posts/group/<B group>` → `404`。
- `POST /posts type=now`：`201`；A1 在服务端当前时间入队；Temporal 只列出 1 个新的 `Running` `post_ticket08-http-a1`（旧排程执行 `Terminated`），A2/A3/B1 无执行。
- `DELETE /posts/<A1 当前 group>`：`200`；仅 A1 置 `deletedAt`，只终止其执行；A2/A3/B1 存活。

### 命令与计数

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0（frontend `next typegen` + tsc、backend、orchestrator） |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **62 文件 / 621 用例全部通过**（合入前 61 文件 / 614 用例；本票新增 7 例） |

### 未验证

- 浏览器中真实点击勾选框未执行（browser 工具报 `[browser.disconnected]`）；勾选清单与保存/删除请求由源码与上述 HTTP 调用覆盖，视觉点击路径未走。
- 未接真实平台投递：没有 provider worker/凭据，发布只对账到 Temporal 执行边界（`workflowId`、队列、时间）。
- 未勾选渠道仍会以**未改动**的编辑值被重新提交（上游“编辑仍保存到它们”的设计），其内容/状态/发布时间保持，但行会被重写、group id 会轮换；若要求“完全不写”，需另开客户端分区改造。

本票未推送、未部署，未改动 `.env`、其它 worktree 与 `.scratch/postiz-v2.26.0-wayfinder/`。
