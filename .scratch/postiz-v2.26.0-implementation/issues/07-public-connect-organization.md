# 07: 通过公开 Connect Link 完成跨组织二步授权

**What to build:** 收件人通过组织 A 的链接选择账号或页面后，绑定只归 A。即使收件人的原标签页正在管理组织 B，也能完成授权并继续使用 B 的原会话。

**Blocked by:** [06 通过公开 Connect Link 完成单步授权](06-public-connect-link.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [公开授权最终组织归属](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [x] 用 A 签发的二步渠道链接，从匿名、登录 A、正在使用 B 三种起始状态进入，使用单选页面完成保存并走到回调结束。
- [x] 逐例查询 A 和 B。核对所选账号或页面及 integration ID 只关联 A，其他候选账号未被绑定。B 原标签页刷新后，身份和组织仍为 B。
- [x] 覆盖二步保存失败、重试及取消，分别核对页面结果与最终绑定数量。成功重试后只保留预期绑定。
- [x] 覆盖禁用第三方 Cookie 的浏览器以及带原查询参数的返回地址，核对匿名与已登录者各自的去向。

## Answer

2026-11-20，在真实 Postgres 的隔离栈完成后端 :3107 + 前端 :4307 的二步公开 Connect Link 验收。本票未修改生产代码；新增 8 个回归用例固化既有多步选择、回调与未绑定账号的页面结果，37 项端到端检查全部通过。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-07-public-connect-org` |
| 用例提交 | `c3ed7da72`（`test(connect): pin two-step public links to the issuing organization`） |
| 实现分支 HEAD | `dfef19ddd`（含三次向集成分支前向合并） |
| 集成合并提交 | `af5cdbfbf`，父提交 `1f0a1b42b`（集成分支）与 `dfef19ddd`（实现分支） |
| 合并冲突 | 无；`ort` 自动合并，仅 3 个测试文件 +331/−1 |
| 端到端证据 | `_reports/ticket-07-e2e.json`（37/37）及 `_reports/assets/ticket-07/` 可复现脚本 |
| 运行时 | 数据库 `postiz-ticket-07`、Redis 7 号库、Temporal :7233、后端 :3107、前端 :4307、Playwright Chromium headless shell 1234 |

### 二步授权归属（37/37）

夹具：A = 用户 `7d35df20-c72e-45ff-a71e-de1fc5613d7e` / 组织 `651efadd-cde1-49c5-8630-e44e5ae629bc`；B = 用户 `ff677849-321d-4500-9861-3e973cf81786` / 组织 `d29e1008-6550-4d0b-b456-0161f8531418`（两次独立本地注册，B 不是 A 的成员）。链接由 A 以 `facebook` 签发；候选 `A Page One`（`page-1`）与 `A Page Two`（`page-2`），每次都只选 `page-2`。

| 起始状态 | 回调 / 绑定 | A 行 | B 行 | 最终去向 |
| --- | --- | --- | --- | --- |
| 匿名 | 201，A 中 pending 行，`inBetweenSteps` true→false | 1 条 live `page-2`，无 `page-1` | 0 | 留在 `/integrations/social/facebook…`，页内 “Channel Added”，无标签页身份/Cookie |
| 登录 A | 201，A 中 pending 行 | 1 条 live `page-2` | 0 | `/launches?added=facebook&msg=Channel%20Added`；`/user/self` 仍为用户 A / 组织 A |
| 正在使用 B 的标签页 | 201，pending 行在 A | 1 条 live `page-2` | 0 | 同上日历地址；刷新后 `/user/self` 仍为用户 B / 组织 B，`showorg` = B |

三种状态下回调 integration id 都只解析到 A；未选中的 `page-1` 从未绑定。

### 失败、重试与取消

- **失败**：Graph double 让保存返回空账号；页面显示红色 `Internal server error`，选择器仍在，URL 未离开回调，未导航。pending 行 `cmwopvho2001vcbdu8g3284r3`（`fb-user-1`，`inBetweenSteps=true`）保留，完成绑定 0 条。
- **重试**：同一页面再次 Save，同一行变为 `page-2` / `A Page Two` / `page-token-2` / `inBetweenSteps=false`；恰好 1 条 live 行，无重复。
- **取消**：Save 前关闭选择器，绑定 0 条，pending 行 `cmwopvlpm001xcbdutur0vi43` 保留；重开同一链接并保存后，该行转为唯一 `page-2` 绑定，无重复。

### 返回地址与第三方 Cookie

- 返回地址 `http://127.0.0.1:4407/return?keep=1&lang=en`：匿名与 B 标签页完成后均为 `…?keep=1&lang=en&added=facebook&msg=Channel%20Added`（服务端两次命中），B 仍为空；同意页首先展示返回站点主机。
- Chromium 以 `--test-third-party-cookie-phaseout` 启动：匿名完成留在回调页页内展示；已登录完成到达 `/launches?added=facebook&msg=Channel%20Added`。`context.cookies()` 为空，后端请求无 `Cookie` 头，绑定仍只有 A 的 `page-2`。

### 命令与计数

```
pnpm typecheck                    # exit 0（frontend next typegen + backend + orchestrator）
NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000
                                  # 62 files, 653 passed, 0 failed
NOT_SECURED= pnpm vitest run tests/channel-multistep-selection.test.tsx \
  tests/channel-multistep-binding.test.ts tests/channel-connect-callback.test.tsx \
  tests/channel-connect-timezone.test.tsx
                                  # 4 files, 52 passed
node _reports/assets/ticket-07/ticket07-e2e.mjs   # 37 checks, 0 failed
```

合并后 653 = 合并前 645 + 本票 8 + 集成分支上票 09 的 3（本票分支报告中的 650 是尚未含票 09 三个用例的基数）。新增用例分布在 3 个文件（多步选择 4、回调 3、时区 1）；没有跳过、删除或弱化任何用例。

### 未证明

- 未使用真实 Facebook/Meta 同意页与 Graph API，平台调用全部命中本地 double；Facebook Page 是代表性二步渠道，YouTube/Instagram/LinkedIn 页面未在浏览器中跑，其绑定语义由现有多步套件覆盖。
- 第三方 Cookie 只用 Chromium phase-out 标志验证；连接链接是顶层页面且本应用不保留认证 Cookie，未验证跨站 iframe 嵌入（与票 02 相同的限制）。
- 未使用应用内浏览器，验证通过 Playwright Chromium headless shell 完成。
- Next.js 16.4.2 开发服务器启动时打印升级/安全提示，未处理（本票范围外）。
