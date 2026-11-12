# 14: 候选 worker 能回放旧 Temporal 历史

**What to build:** 维护者可以用可追溯的旧执行历史验证候选 worker 的确定性兼容，确认长期工作流不会因升级丢失所需定义或改变历史命令序列。

**Blocked by:** 02 — [完整合入锁定的 v2.25.3](02-merge-stable-release.md).

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-11

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“Temporal 接续与恢复”和“历史 replay”；同时遵守[共同执行约束](../README.md#执行约束)。历史回放不代替 15–17 的实际活动、副作用与恢复验证。

- [x] 在隔离环境用旧代码及合成身份、凭据生成真实历史 fixture，记录生成时的 commit、lock、workflow bundle 和场景；不读取或提交真实线上 history payload。
- [x] fixture 覆盖 V101/V102、等待/sleep、repeat child、延迟评论、refresh、旧邮件，以及 autopost、missing sweep、streak 等同名 workflow 的 patch 前后历史和 Continue-As-New 边界。
- [x] 候选 bundle 对这些历史实际执行离线 replay 并通过，记录用例数量、历史来源、候选修订和结果；不能用当前新代码自行生成的历史代替旧版兼容证明。
- [x] 保留全部需要的历史 workflow 导出、旧 activity 名称及 payload 契约；旧 repeat child 后续仍可能创建旧版本，不能第一轮完成就删除旧定义。
- [x] 同名 workflow 的 patch 与命令顺序兼容，遇到非确定性失败先提供具体历史位置、原定义与候选变化并进行保持契约的适配，不用删除 fixture 或终止旧执行规避。
- [x] 保留旧 postSocial 阻塞返回契约；新版 pending/finalize 不替换旧调用约定。旧活动的实际请求与返回行为在 15、17 执行验证。
- [x] 提供可重复运行的 replay 入口与覆盖清单，列明 replay 无法证明的队列处理、真实活动和平台副作用范围，交给 15、16、17 使用。

## Answer

2026-11-11，分支 `codex/ticket-14-temporal-replay`（基 `aa38b478`，含合入的集成 tip）。旧代码生成的历史 fixture 全部用候选 bundle 离线 replay 通过：**15 个场景 / 16 份历史 / 16 通过 / 0 失败**；另用故意改坏的 workflow 定义验证了 replay 会以 `DeterminismViolationError` 报错并指出历史位置。无 Worker Versioning、无终止或重建执行、未接触真实 Temporal/数据库/Secret。

### 关键发现（阻塞项，已修）

`apps/orchestrator/.swcrc` 的 `jsc.baseUrl` 是上游作者机器的绝对路径 `/Users/nevodavid/Projects/gitroom`。worker 用 `swc-loader` 打包 workflow，因此在任何其它 checkout 上 `bundleWorkflowCode` 直接失败：

```
Error: failed to read .swcrc file ... failed to canonicalize base url using the path of .swcrc
Path: /Users/nevodavid/Projects/gitroom
```

即旧/新 worker 在非作者机器上都无法产出 workflow bundle，这同时是 15（旧排程接续，需要 worker 真正起来）的前置。最小修复：`baseUrl` 改为相对仓库根（`"../../"`），并补 `@gitroom/orchestrator/*` 映射；`k8s/apps/orchestrator/.swcrc` 由 `./k8s/prepare-build-context.sh --allow-dirty` 重新生成，未手改 `k8s/apps/**`。

### 改动位置

| 路径 | 内容 |
| --- | --- |
| `apps/orchestrator/.swcrc`（+ `k8s/apps/orchestrator/.swcrc`） | 相对 `baseUrl`，新增 `@gitroom/orchestrator/*` |
| `package.json` / `pnpm-lock.yaml`（+ k8s 副本） | devDependency `@temporalio/testing@1.15.0`；脚本 `test:replay` |
| `tests/temporal-continuity.test.ts` | 历史 workflow 导出、旧 activity 名称、`postSocial` 阻塞契约（50 例） |
| `rehearsals/14/legacy/extract.mjs`、`legacy/base/**` | 从 `6fdf7cb5` 逐文件 `git show` 抽取（11 个文件，逐文件 blob sha 记入 `MANIFEST.json`） |
| `rehearsals/14/lib/derive-patched.mjs`、`legacy/patched/**` | 旧源码 + 仅 `patched()`/continue-as-new 门（锚点必须唯一，漂移即报错） |
| `rehearsals/14/lib/*.mjs`、`run.mjs` | 生成器、replay、检测自检、合成数据、场景表 |
| `rehearsals/14/fixtures/**` | 15 个场景 + `provenance.json`（约 1.1 MB，全合成） |
| `rehearsals/14/results/replay-latest.json` | 最后一次 replay 的逐例结果 |
| `rehearsals/14/README.md` | 运行入口、覆盖清单、迁移到 15–17 的边界 |

### provenance（`fixtures/provenance.json`）

| 项 | 值 |
| --- | --- |
| 生成时间 | 2026-11-11T13:15:27Z |
| 旧代码 commit | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43`（产品行为基准 C） |
| 生成时候选修订 | `5fc45bfd`（集成 tip；生成后已合到 `aa38b478`，replay 在 `aa38b478` 上重跑） |
| 锁文件 | `pnpm-lock.yaml` sha256 `caba97c3e0351d85…` |
| 旧 bundle sha256 | base `028e69b6f80804d0…` / patched `6983fd53ff4f9c8f…` |
| Server | `temporal-test-server-sdk-typescript-1.15.0`，65,436,232 B，sha256 `3a9cd757fc118c0c…` |
| SDK | `@temporalio/{worker,testing}` 1.15.0，Node v22.23.4 |
| 搜索属性 | `postId TEXT`、`organizationId TEXT`（经 operator service 注册） |
| 数据 | 全部合成：`.invalid` 邮箱/URL、`org_synthetic_*`、`synthetic-*-token`；无真实 history payload |

`history` 用 protobuf JSON（`History.toObject`，bytes/longs/enums 为字符串）落盘，`History.fromObject` 可无损还原，因此 replay 不需要任何 server。

### replay 结果（16/16）

候选源码入口 `apps/orchestrator/src/workflows/index.ts` 与编译产物入口 `apps/orchestrator/dist/apps/orchestrator/src/workflows/index.js`（worker 运行时 `require.resolve('./workflows')` 的路径）各跑一次，均 16/16 通过；bundle sha256 分别为 `f1cc78050ee2…`（源码）与 `e5fd7c828937…`（dist）。

| 场景 | 历史 | workflow type | 事件数 | 末事件 | 结果 |
| --- | --- | --- | ---: | --- | --- |
| `v101-scheduled-sleep-success` | execution | postWorkflowV101 | 52 | COMPLETED | ✅ |
| `v102-delayed-comment` | execution | postWorkflowV102 | 75 | COMPLETED | ✅ |
| `v102-repeat-child` | parent | postWorkflowV102 | 62 | COMPLETED | ✅ |
| `v102-repeat-child` | repeat-child | postWorkflowV102 | 47 | COMPLETED | ✅ |
| `v102-refresh-token` | execution | postWorkflowV102 | 64 | COMPLETED | ✅ |
| `v102-bad-body` | execution | postWorkflowV102 | 34 | COMPLETED | ✅ |
| `v102-inflight-sleep` | in-flight | postWorkflowV102 | 11 | TIMER_STARTED | ✅ |
| `refresh-token-loop` | execution | refreshTokenWorkflow | 34 | COMPLETED | ✅ |
| `legacy-email-signal-drain` | in-flight | sendEmailWorkflow | 39 | TIMER_STARTED | ✅ |
| `legacy-email-continue-as-new` | continue-as-new-run | sendEmailWorkflow | 335 | CONTINUED_AS_NEW | ✅ |
| `autopost-pre-patch` | in-flight | autoPostWorkflow | 44 | TIMER_STARTED | ✅ |
| `autopost-post-patch-continue-as-new` | continue-as-new-run | autoPostWorkflow | 271 | CONTINUED_AS_NEW | ✅ |
| `missing-pre-patch` | in-flight | missingPostWorkflow | 44 | TIMER_STARTED | ✅ |
| `missing-post-patch-continue-as-new` | continue-as-new-run | missingPostWorkflow | 271 | CONTINUED_AS_NEW | ✅ |
| `streak-pre-patch` | execution | streakWorkflow | 39 | COMPLETED | ✅ |
| `streak-post-patch-v2-handoff` | continue-as-new-run | streakWorkflow | 37 | CONTINUED_AS_NEW | ✅ |

- “in-flight” 是**未完成**历史（执行仍在等待 timer/信号），证明重启后能接着跑；“continue-as-new-run” 是首个 run 的历史，末事件为 Continue-As-New，证明边界命令与参数一致。
- patch 前后：`*-pre-patch` 由 commit C 原样代码生成（无 marker，`patched()` 必须解为 false），`*-post-patch-*` 由“旧代码 + 仅该 patch 门”的派生 bundle 生成；两者都不是候选自身历史，来源与 sha 已记录。
- `streak-post-patch-v2-handoff` 的 CaN 目标 `streakWorkflowV2` 在派生 bundle 里只是一个占位导出（升级后才存在，旧历史不可能指向它），只为让 server 能启动新 run；其历史不采集、不参与回放。
- 检测自检：把 V102 换成立即返回的错误定义，replay 报 `DeterminismViolationError … [TMPRL1100] Nondeterminism error: Complete workflow machine does not handle this event: HistoryEvent(id: 5, ActivityTaskScheduled)`，退出码 1。

### 保留的契约

- `tests/temporal-continuity.test.ts` 断言 `postWorkflowV101…V112`、`autoPostWorkflow`、`missingPostWorkflow`、`streakWorkflow`/`V2`、`refreshTokenWorkflow`、`digestEmailWorkflow`、`sendEmailWorkflow`、`sendSingleEmailWorkflow`、视频/媒体/clipping 全部仍以原名导出；删任何一个都会让 `pnpm run test` 失败。
- 旧 activity 名称仍在 `PostActivity` / `EmailActivity` / `IntegrationsActivity` / `AutopostActivity` 上；`postSocial` 走 `postSocialInternal(..., false)`（阻塞），`postSocialPending` 才是 pending 路径，二者不可互换。
- V102 repeat child 的历史里 `StartChildWorkflowExecutionInitiated` 的 type 仍是 `postWorkflowV102`，证明“旧 repeat 链会继续产生旧版本”，因此旧定义不能在第一轮后删除。新排程入口仍是 V112（未改动 `posts.service.ts`）。

### 门禁（在合入集成 tip `aa38b478` 后重跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | 通过（frontend/backend/orchestrator） |
| `pnpm run lint` | 0 errors / 713 warnings（基线级警告） |
| `pnpm run test` | 14 文件 / 117 测试通过（其中本票 50） |
| `pnpm run build` | exit 0 |
| `node …/run.mjs replay`（源码） | 16/16 |
| `node …/run.mjs replay --dist`（编译产物） | 16/16 |
| `node …/run.mjs check-detection` | 按预期检出非确定性 |
| `./k8s/prepare-build-context.sh --check` | in sync |

### 仍未证明（交 15/16/17）

- 所有 activity 都是替身：`postSocial`/`postComment`/`refreshToken`/`sendEmail`/`searchForMissingThreeHoursPosts` 的真实请求、返回、幂等与失败语义未验证（15、17）。
- 队列路由：fixture 全部在 `main`；现网是否真的存在 provider 队列上的 workflow 未知，activity-only provider worker 与兼容 worker 的取舍需按实际部署核验（15）。
- 进程生命周期：worker 启动/关闭、发布中途退出、`EXCLUDE_QUEUE`/`WORKER_CONCURRENCY_DIVIDER`、email/email-bulk 限速未覆盖（16、17）。
- 新类型自身行为（V112 pending/check/finalize、`streakWorkflowV2`、`sendSingleEmailWorkflow`、媒体类）没有旧历史可回放（16）。
- 搜索属性的真实类型、Temporal Server 版本与存储不在本票范围。
- `rehearsals/14` 的 `generate` 需要一次性下载 test server 二进制（本机已缓存，sha 记入 provenance）；`replay` 完全离线。

### 其它票可能触及的文件

`apps/orchestrator/.swcrc` 与其 k8s 副本（15 的 worker 启动路径）、`package.json` / `pnpm-lock.yaml`（15/16 若加依赖）、`tests/temporal-continuity.test.ts`（15/16 会扩展同一断言面）、`k8s/**`（任何再生都会带上本票的 `.swcrc` 与 devDependency）。
