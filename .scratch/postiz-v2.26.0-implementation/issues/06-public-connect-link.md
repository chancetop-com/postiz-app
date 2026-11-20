# 06: 通过公开 Connect Link 完成单步授权

**What to build:** 组织可经公开 API 或 MCP 为一个平台签发链接。收件人匿名查看同意页，自行决定是否授权。单步授权完成后，绑定出现在签发组织。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [公开授权页和回调的验收决定](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [x] 从公开 API 和 MCP 各自签发链接，两种入口分别覆盖仪表盘六项内、六项外符合上游条件的平台，并按官方平台资格处理不支持的请求。
- [x] 匿名打开链接只展示指定平台、定制 Logo、默认浅色、平台图标、权限说明和继续按钮。只有点击继续才检查组织和配额并跳转到平台替身。
- [x] 走通单步授权，在组织渠道列表查到签发组织的绑定，核对取消后无新增记录；有效期一小时内可以重新发起，到期被拒。
- [x] 核对带已有查询参数的自定义返回地址能保留参数并携带结果。无自定义地址时，匿名者在当前页看到结果，已登录者沿用日历去向。

## Answer

2026-11-20，实现分支以 `--no-ff` 合入 `postiz-v2.26.0-integration`，0 个未合并路径；类型检查与回归全通过。上游 v2.26.0 已自带公开链接的签发、同意页和回调生命周期，本票保留该行为，只把同意页改为定制浅色 + 定制 Logo，并用运行时证据覆盖 API/MCP 签发、匿名同意、单步授权、取消/过期/重试、组织归属和返回地址。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-06-public-connect-link` |
| 实现提交 | `4f425ec8d` |
| 合入前集成分支 | `9a4a57b44`（已含 ticket 03 的邀请/标签页会话改动） |
| 合并提交 | `d736f79a64bb8bb2331998ec9429be5e7c55a264`，父提交 `9a4a57b44` 与 `4f425ec8d` |
| 祖先校验 | `git merge-base --is-ancestor 9a4a57b44 HEAD`、`git merge-base --is-ancestor codex/ticket-06-public-connect-link HEAD` 均为真 |
| 冲突 | 0 个未合并路径（`git ls-files -u` 为空）；无 `<<<<<<<`/`>>>>>>>` 标记；`git diff --check` exit 0 |
| ticket 03 保留 | 合并只触及 6 个路径（同意页 2 个、测试 4 个），`session-org-invite`、`session-org-flow`、`auth-standard-routes` 等邀请/会话用例随全量回归通过 |

### 同意页品牌（本票唯一的生产代码变化）

| 位置 | 变化 |
| --- | --- |
| `apps/frontend/src/components/launches/connect.link.tsx` | 使用定制 `Logo`（`/logo-postiz.png`，32×32）取代上游 `/postiz.svg`；页面改为 `light` + `bg-primary` 的默认浅色卡片与 `text-textColor`，取代固定 `#0B0A0A`/`#1A1919` 深色；移除上游 `LogoTextComponent` 字标 |
| 同上 | 保留平台图标（`PlatformIcon`）、权限说明、签发方之外的返回主机提示和继续按钮；`window.location.assign(url)` 与原先 `location.href` 行为一致且可测试 |
| `apps/frontend/src/app/(app)/integrations/connect/layout.tsx` | `bg-[#0B0A0A]` → `light bg-primary text-textColor` |
| 后端生产代码 | 未改：资格判定、Redis TTL、签发组织状态、继续时的配额检查、返回地址处理均沿用上游 |

### 资格矩阵（合入后实测 `getLinkableSocialsIntegrations()`）

公开 API `POST /public/v1/integrations/connect` 与 MCP `integrationConnectTool` 都调用同一个 `IntegrationService.createConnectLink`，因此资格一致；MCP 把 `HttpException` 转为 `output.errors`。

| 分组 | 平台 | 结果 |
| --- | --- | --- |
| 仪表盘六项内 | `youtube`、`linkedin`、`tiktok`、`facebook`、`instagram`、`instagram-standalone` | 签发链接（API 201） |
| 六项外、符合上游条件（17 个） | `x`、`linkedin-page`、`reddit`、`threads`、`gmb`、`tiktok-business`、`pinterest`、`dribbble`、`discord`、`slack`、`kick`、`twitch`、`mastodon`、`vk`、`whop`、`mewe`、`tumblr` | 签发链接（API 201） |
| `HIDDEN_PROVIDERS` | 任意被列出的 id（例：`tiktok`） | 拒绝：`Integration not allowed`（400） |
| 需要字段/实例 | `bluesky`、`devto`、`medium`、`wordpress`、`nostr`、`lemmy`、`mastodon-custom` | 拒绝：`This integration cannot be connected with a link`（400） |
| Web3 | `wrapcast`、`telegram`、`moltbook` | 同上拒绝 |
| 浏览器扩展 | `skool` | 同上拒绝 |
| 未知标识 | 例：`unknown-platform` | 拒绝：`Integration not allowed`（400） |

实测可链接集合共 23 个平台（六项 + 六项外 17 个），`tests/channel-public-connect-link.test.ts` 对六项、六项外样本、字段/实例/Web3/扩展拒绝、`HIDDEN_PROVIDERS` 和 MCP 入口逐项断言。HTTP 冒烟：`x` → 201、`tiktok` → 201、`devto` → 400；`GET /integrations/public/connect/<token>` 只返回平台信息，未知 token → 404。

### 生命周期与同意页结果

| 场景 | 结果 |
| --- | --- |
| TTL | `SET connectLink:<token> … EX 3600` 已断言；token 为 32 字节随机数的 64 位十六进制 |
| 一小时内重试 | 连续两次 `POST /integrations/public/connect/:token` 返回不同的 provider state URL；链接键未被消费 |
| 到期 | 删除 Redis 链接键后 `GET` 显示 “This link is no longer valid”，服务抛 404 |
| 取消 | 打开同意页后直接关闭，`Integration` 行数不变 |
| 单步完成 | 本地 Mastodon OAuth 替身 → HTTP 回调；新增恰好 1 条 `Integration`，`organizationId` = 签发组织，`providerIdentifier` = `mastodon` |
| 自定义返回地址 | 最终 URL `http://localhost:4999/return?keep=1&lang=en&added=mastodon&msg=Channel%20Updated`：原有 `keep`/`lang` 保留，结果参数追加 |
| 无返回地址、匿名 | 停留在 `/integrations/social/mastodon…` 回调页，页内显示 “Channel Updated” |
| 无返回地址、已登录 | 浏览器前往 `/launches?added=mastodon&msg=Channel%20Updated`，沿用日历去向 |
| 点击前 | 匿名打开只发出 `GET` 读链接；不查组织、不查配额、不写绑定。点击继续后才校验组织/配额并换取平台 URL |
| 配额拒绝 | 模拟计划上限 400 时同意页保留链接可重试（RTL），未产生绑定 |

### 命令与计数

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | exit 0：frontend（先 `next typegen`）、backend、orchestrator |
| 回归（合入后） | `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **60 文件 / 602 用例全通过**（合入前 58/576；+2 文件、+26 用例） |
| 回归（合入前基线） | 同上 | 58 文件 / 576 用例全通过 |
| 本票新增 | `tests/channel-connect-consent.test.tsx` 5 例、`tests/channel-public-connect-link.test.ts` 16 例，另在回调/上游保留套件补 5 条断言 | 21 个新用例 + 5 条断言 |
| 定向 | `pnpm vitest run tests/channel-connect-consent.test.tsx tests/channel-public-connect-link.test.ts tests/channel-connect-callback.test.tsx tests/channel-upstream-retention.test.ts` | 48 用例通过 |
| 运行时脚本 | `node /tmp/ticket06-e2e.mjs` | 19 项检查，0 失败 |
| 冲突/格式 | `git ls-files -u`、`git grep -nE '^(<<<<<<<|>>>>>>>) '`、`git diff --check` | 空、无匹配、exit 0 |

实现者另跑 `pnpm test`（不带 `--maxWorkers=1`）得到 59 文件、571 通过、5 跳过：Prisma 会把运行时 `.env` 的 `NOT_SECURED="true"` 带入测试进程，需用 `NOT_SECURED=` 前缀；并行负载下曾有 3 个无关的时序敏感文件失败，串行重跑全通过，未改断言。合入门禁以本报告中的 60/602 为准。

### 未验证

以下**均未在本票执行，不宣称通过**：

- MCP 的线上传输未走真实 wire；执行的是真实 `IntegrationConnectTool.run()`（Mastra 工具）的进程内调用，覆盖合格与不支持平台。
- 未调用真实 X/TikTok 等 provider OAuth；唯一 OAuth 往返使用本地 Mastodon 替身。真实 provider 差异（TikTok `auth_code`、二步渠道）由既有的 07/08 套件覆盖，本票未重跑。
- 同意页用 Playwright + 系统 Chrome 做无头断言，不是应用内桌面浏览器（该工具报 `[browser.disconnected]`）；DOM/视觉检查相同，未使用 Review 面板。
- 未实际等待一小时墙钟到期；到期用删除 Redis 键模拟，3600 秒 TTL 单独断言。
- 计划渠道上限拒绝用 RTL 模拟 400，未对真实订阅上限执行。

未推送、未部署；未改动实现工作树与 `.scratch/postiz-v2.26.0-wayfinder/`。
