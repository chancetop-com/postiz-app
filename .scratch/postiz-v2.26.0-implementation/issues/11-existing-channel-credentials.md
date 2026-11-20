# 11: 用历史渠道凭证刷新、重连并发布

**What to build:** 沿用当前部署配置，商户升级前已有的渠道仍能管理、刷新、重连和发布。平台替身收到的账号、页面和渠道身份与原绑定一致。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [默认配置与可选加密](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [x] 用合成凭证覆盖旧 Instagram 单令牌及组合格式、旧 Skool 格式、仪表盘六项渠道及其他历史渠道。经页面或公开 API 读取、刷新、重连并发布，核对组织、渠道 ID、账号、页面、凭证有效期及平台替身结果。
- [x] 验证批量刷新中某个 provider 失败后其余渠道继续处理，同一渠道首次标记需重连才通知。并发刷新时核对最终采用的有效凭证及后续发布。
- [x] 默认配置下保留存量凭证和部署方式。核对多页面及同账号跨组织样本的实际关联，记录结果时使用合成样本标识。
- [x] 条件验收仅在另行评估加密时执行。API 与所有 worker 用同一密钥先读明文与密文并继续写明文，再验证加密写入、空值、重启、错密钥及恢复。验证并发回填保留已刷新凭证，静止样本重跑零变更、零失败。

## Answer

2026-11-20 合入 `postiz-v2.26.0-integration`。存量渠道可读取、刷新、重连并按各自契约发布；默认明文路径和部署方式未变。无业务取舍需上报。

### 引用

| 项 | 值 |
| --- | --- |
| 执行起点 | `dfe3d9c1`（`postiz-v2.26.0-integration`，工作区干净） |
| 票分支 | `codex/ticket-11-channel-credentials` @ `fc21d700` |
| 合并提交 | `40190719`，父提交 `dfe3d9c1` 与 `fc21d700` |
| 合并方式 | `git merge --no-ff`；无冲突，两个测试文件自动合并，05/07 的窗口选择断言保留 |
| 祖先校验 | `fc21d700`、`dfe3d9c1`、`af5cdbfb`、`0288174a` 均为 HEAD 祖先 |
| 冲突标记 | 无 |

### 批量刷新生产修复

`IntegrationService.refreshTokens()` 原先在 provider 刷新失败时直接置 `refreshNeeded`
并发通知。并发场景下，同一渠道可能已被逐渠道刷新旋转到新凭证，批量路径却仍把
旧行判为失效，造成健康渠道被误标和重复通知。现在失败分支先短等并重读该行的
org/channel/provider 与有效期：若拿到的是不同且未过期的凭证，就采用该并行赢家
继续，不标记、不通知；真正损坏的渠道仍只通知一次。后续发布读取到的是赢家凭证。

### 凭证矩阵（合成标识，不记录凭证值）

| 样本 | 读取 / 列表 | 刷新 | 重连 | 发布 |
| --- | --- | --- | --- | --- |
| Instagram 旧组合格式（`page-token___user-token`） | 真实 provider 拆分 page/user，列表保留 page id 与 user root | 真实 PostgreSQL 页面刷新写入 page 专属令牌，root 不动 | 真实 controller + 真实 PostgreSQL 持久化新 page token、user refresh token 和未来有效期 | 公开 API HTTP → Temporal V112 → provider 替身：page 半用于创建/发布，user 半用于状态检查，post PUBLISHED |
| Skool 旧 JWT | 真实 provider 验签并读 cookie，无需重连 | 无自刷新，100 年种子有效期不进批量 | 不需要 | 公开 API HTTP → worker：替身看到 `skool-legacy-cookie` 和所选 group，post PUBLISHED |
| Tumblr（历史渠道） | 列表含 id/org/profile | 实时 worker：首次发布 401 → 刷新 → 持久化赢家 → 重试 | 既有 controller 路径 | 首次替身调用用旧 access 被拒，第二次用赢家，post PUBLISHED |
| LinkedIn（仪表盘六项） | 列表含 id/org/profile | `main` 队列真实 `refreshTokenWorkflow` 旋转凭证并保存新 refresh token + 有效期 | 真实数据库重连测试覆盖既有 controller 路径 | 未做本平台实时发布 |

其余样本：Instagram 单令牌（期望重连结果）、Facebook Page 与 Instagram（Facebook
Business，期望 `refreshNeeded` + 一次通知）、Instagram Standalone、YouTube
（Google client 边界桩）、TikTok、LinkedIn Page 均完成读取/刷新/列表核对；多页面
共享 `rootInternalId`，两个 page 各存不同 page token 与同一刷新后 user refresh
token；同一 Tumblr 账号在 org A 刷新/发布后，org B 的 access/refresh token 字节
不变。失败刷新保留旧 token/有效期并只通知一次。旧绑定清单共 **11 项**，均不含
凭证值。真实 PostgreSQL 用例 **6/6** 通过；HTTP/Temporal 实时演练 **19/19** 检查
通过（3 个 post PUBLISHED，1 个 LinkedIn Temporal 刷新）。

### 门与计数

| 命令 | 结果 |
| --- | --- |
| `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **62 文件 / 679 用例全部通过**（0 skipped） |
| `pnpm typecheck` | frontend（含 `next typegen`）、backend、orchestrator 全通过 |

计数说明：合并前集成 HEAD 为 661 例；票分支自身 671 例。本票新增 **18** 例
（渠道凭证 +13、列表刷新 +1、上游保留结构 +4），叠加 05/07 已合入的 8 例，合并后
为 679。`671` 是分支总计而非新增数，因此不是合并后的预期总数。首轮并行跑
typecheck 时 `media-api-upload` 因 20s hook 超时误报一次，单独重跑及无并行负载的
全量重跑均 5/5 通过；以上为最终全量结果。

### 加密

**Not evaluated in this round; default plaintext path unchanged.** `ENCRYPTION_PROVIDER`
未设置；测试确认空 provider 原样透传、不写 `enc:v1:` 前缀、列表查询省略两个凭证列、
刷新/重连写入明文合成值。加密写入、空值、重启、错密钥、恢复与并发回填矩阵未运行，
留待另行评估。

### 未证明

- 未执行真实平台账号、同意页、OAuth 回调、浏览器弹窗/两步选页重连或生产凭证交换；重连用真实 controller + 真实 PostgreSQL + provider 替身验证。证明的是代码与契约，不是真实凭证当前有效。
- 实时发布仅证明 Instagram（组合）、Skool（旧 JWT）、Tumblr；LinkedIn、Facebook、Instagram Standalone、YouTube、TikTok、LinkedIn Page 和 Instagram 单令牌样本只有读取/刷新/列表证据。
- YouTube 刷新在 Google client 边界使用 provider 桩，未发出 `googleapis` 网络请求。
- 批量刷新经真实 DB/service 执行，未走实时 CLI 进程；Temporal 使用本地服务器和新建工作流，升级前在途执行回放归 12/14。
