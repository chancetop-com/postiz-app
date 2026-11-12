# 02: 完整合入锁定的 v2.25.3

**What to build:** 维护者获得一个真实包含锁定稳定版完整历史和实际更新、能够编译并继续按流程验收的本地合并候选；每项定制都有明确的保留方案和后续验收归属。

**Blocked by:** 01 — [从根源码生成构建输入，分开本地构建与发布](01-source-build-boundary.md).

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-11

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“版本、范围与合并原则”和“现有基础与需补齐的部分”；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 记录实际执行起点、已有工作和共同基线，在本地 codex 专用分支真实合入 v2.25.3 / a5affe62c74e39c1e7ac960d50d8418b807d532c；最终候选包含执行起点、两个定制提交和目标的祖先关系，不纳入目标之后主线。
- [x] 同时核对历史可达和上游实际源码更新，不能以空的 ours merge、选择性复制、只保留提交历史或旧整文件覆盖完成验收。
- [x] 解决文本、类型及配置冲突，并核对双方改动但自动合并的内容；覆盖已发现的认证导入缺失、文件类型冲突及旧构建副本问题，不把无冲突标记作为兼容证明。
- [x] 兼容更新直接纳入，按已定契约适配定制；只有证明确实必须改变流程或范围时才附具体证据交用户决定，不自行恢复已撤回要求。
- [x] 工具链统一 Node 22.23.4、pnpm 10.6.1、Prisma 6.5.0，修正版本声明与锁文件一致性；在选定工具链下完成 frozen install，生成 Prisma 客户端不连接数据库。
- [x] 从根目录实际完成三应用构建、相应类型检查和覆盖共享库的 lint；准备 Next 生成类型，记录真实命令和覆盖边界，不宣称未检查的其它包通过。
- [x] 修复回归运行入口及缺失配置，执行非零、能断言真实行为的基础用例；不以工具缺失、脚本存在或空测试替代通过。后续票在此入口增加各自的流程验证。
- [x] 为两个定制提交全部 863 个净变更路径建立去向追踪，包含源码、静态资产、文档、独有配置与生成副本；每项注明保留方式和负责验收的实施票，相同副本可归组但不漏路径。
- [x] 记录合并候选修订、实际检查结果和尚待后续票验证的流程；不将本票通过表述为完整本地验收或可上线，不推送或重新启用 Build。

## Answer

2026-11-11，真实合并完成，四道本地门（build / typecheck / lint / test）实际通过，并经 Standards 与 Spec 双轴独立评审后关闭。

### 引用

| 项 | 值 |
| --- | --- |
| 执行起点 | `c527c5d6`（`501e87db` 之上的 spec + 实施票提交）；工作区干净、无 stash |
| 合并基 | `0b554e68` |
| 目标上游 | `a5affe62c74e39c1e7ac960d50d8418b807d532c`（v2.25.3，基后 999 个提交） |
| 定制提交 | `f042c177`、`6fdf7cb5`（后者为行为基准） |
| 合并提交 | `af5bd677`，父提交 `a18025b6`（集成分支）与 `a5affe62`（上游） |
| 祖先校验 | `501e87db`、`f042c177`、`6fdf7cb5`、`0b554e68`、`a5affe62` 全部 `merge-base --is-ancestor` 为真 |

### 冲突消解（14 个未合并路径）

| 路径 | 处理 | 依据 |
| --- | --- | --- |
| `.env.example` | SSO 段与上游 reCAPTCHA / HIDDEN_PROVIDERS / MIGRATE_PROVIDERS 并存 | 两者都是配置文档，不互斥 |
| `api.module.ts` | 保留 `SsoService`，加入上游 `StripeController` | 定制入口与上游支付模块都需要 |
| `auth.service.ts` | 保留定制 `signJwt`，采用上游 `sendEmailSync` | 上游仅方法改名；`signJwt` 是本地方法名 |
| `auth/layout.tsx` | 保留本地 light 主题 class，纳入上游 `MantineWrapper` + `Toaster` | 定制浅色布局 + 兼容上游组件 |
| `chart-social.tsx` | 默认 `mode` 取 `light` | 定制默认浅色 |
| `top.menu.tsx` | 采用上游（Plugs/Integrations 移入 Settings），保留 Agent/Settings `hide: true` | 上游结构变化兼容，隐藏范围不变 |
| `media.component.tsx` | 采用上游移动端工具栏布局；Design Media / ThirdPartyMedia / AiImage / AiVideo 仍注释隐藏 | 隐藏范围不变且获得上游响应式修复 |
| `new-layout/layout.component.tsx` | 合并两侧：`setSentryUser()` + `user === null → /auth/login` | 定制登录跳转与上游 Sentry 上下文都需要 |
| `launches.component.tsx` | 保留 `useRef` 与上游 `CustomVariables`、`channelsOpen`；默认 light | 两侧功能互补 |
| `proxy.ts` | 保留删除 auth cookie 页面门禁（`authCookie`/`url` 已不存在）；保留 15 分钟 host-only `showorg` cookie | 定制会话契约 |
| `media.repository.ts` | `deletedAt: null` 与上游 `status: { not: 'processing' }` 合并 | 两者是不同过滤条件 |
| `CLAUDE.md` | 保留指向 `AGENTS.md` 的符号链接，丢弃上游同名普通文件 | 本地已确立 `AGENTS.md` 为唯一来源 |
| `.gitignore` | 同时忽略生成的构建清单与上游生成的 `apps/frontend/public/g.js` | 两者都是生成物 |
| `pnpm-lock.yaml` | 取上游后由 `pnpm install` 与合并后的 manifest 重算 | 不手工拼接锁文件 |

### 双方改动但自动合并的语义核对

- **`api/routes/auth.controller.ts`：合并丢失了 `getCookieUrlFromDomain` 的导入**（上游第 23 行有，合并结果没有），后端 typecheck 直接失败。已补回。这正是三方证据预警的“无冲突标记不等于兼容”。
- `api/routes/copilot.controller.ts`：两条 503 分支（`OPENAI_API_KEY` 未定义或空）保留，`/chat` 与 `/agent` 都在建 handler 之前返回。
- `main.ts`：`startMcp(app).catch(... Logger.error('MCP startup failed (non-fatal)')` 保留，MCP 失败不阻塞主 API。
- `preview/preview.wrapper.tsx`：`load` 非 2xx 返回 null 且仍渲染 children，不套用主布局登录跳转；已吸收上游 `useSingleEndpoint`、`ToolTip`。
- `layout/layout.context.tsx`：吸收上游 402/406 文案与 `response.clone().json()` 兜底。
- `agents/agent.chat.tsx`：上游把 `message.content` 收窄为 `string`，但保留的 `content.map(...)` 分支因此不可达，产生 9 个类型错误（**上游自身缺陷**，`a5affe62` 同址同码）。改为 `unknown` + `Array.isArray` 防御，行为不变。
- `launches/add.provider.component.tsx` 的六 identifier 白名单、`continue.integration.tsx` 的回传链路自动合并后仍在（流程验收归 07/08/09）。

### 工具链与锁文件

- `engines.node` 已是上游声明的 `22.23.4`；`volta.node` 原为 `20.17.0`，**已改为 `22.23.4`**（版本声明不一致修正）。
- 本机原为 Node 22.22.3，下载并以 `~/.local/share/postiz-toolchain/node-v22.23.4-darwin-arm64` 的 22.23.4 执行全部检查。pnpm 10.6.1，Prisma 6.5.0。
- `pnpm install --frozen-lockfile`：**通过**（"Lockfile is up to date"），`prisma generate` 生成客户端，未连接数据库。

### 四道门（全部在 `7eb5469c` 之后的最终树上重跑）

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 依赖 | `pnpm install --frozen-lockfile --ignore-scripts` | exit 0，lockfile up to date |
| 构建 | `NODE_OPTIONS=--max-old-space-size=4096 pnpm run build` | exit 0；产出 `apps/backend/dist/apps/backend`、`apps/orchestrator/dist/apps/orchestrator`、`apps/frontend/.next/BUILD_ID=i3siKYOKJI98sSB6WKv7Z` |
| 类型 | `pnpm run typecheck` | exit 0，覆盖 frontend（先 `next typegen`）、backend、orchestrator |
| Lint | `pnpm run lint` | exit 0，713 warnings，**0 errors** |
| 回归 | `pnpm run test` | 3 文件 / 14 用例全通过 |

修复的入口问题：根 Jest 配置引用未声明的 `@nx/jest`，`pnpm test` 无法运行；`eslint.config.mjs` 用 FlatCompat 包裹已是 flat 的 `eslint-config-next` 16，抛 "Converting circular structure to JSON"。已改为 vitest + 直接展开 flat config，并把 eslint 从 8.57 升到 9.39.5（`eslint-config-next` 16 的要求）。`react-hooks/rules-of-hooks` 保持 error（AGENTS.md 明确要求），React Compiler 规则组降为 warning 并注明理由——清除它们属于本次升级范围外的全站重构。

新增基础用例（后续票在此基础上扩展）：SSO 兑换端点契约 5 例、商户账户复用/首建 4 例、工具链声明与 `prisma-db-push` 不含 `--accept-data-loss` 5 例。

### 863 路径去向追踪

`assets/customization-path-tracking.tsv`（由 `.scratch/postiz-stable-merge-implementation/scripts/track-customization-paths.mjs` 生成），逐路径给出 area、负责票、去向与说明：

| 去向 | 路径数 | 含义 |
| --- | --- | --- |
| `generated-copy` | 791 | `k8s/` 生成副本，由 `k8s/prepare-build-context.sh` 从根源码刷新 |
| `retained` | 34 | 合并后内容与定制版本一致 |
| `adapted` | 30 | 合并后与定制版、上游版都不同（两侧真实合并），逐条归入 03–13 |
| `absent` | 7 | 上游在 v2.25.3 中删除（posthog、nowpayments、veo3、read.or.fetch、nayer/purchase.crypto 等），非本次丢弃 |
| `upstream-replaced` | 1 | `pnpm-lock.yaml`（由合并后的 manifest 重算） |

合计 863，与 `0b554e68..6fdf7cb5` 的净变更集合一致。

### 双轴评审及处理

评审判定：祖先关系、`proxy` 无 cookie 门禁、默认浅色、Agent/Settings 隐藏、四个媒体工具隐藏、六 identifier 白名单、`signJwt`、缺 OpenAI 503、MCP 非致命均保留正确。提出的问题已全部关闭：

- `--check` 被脏工作区守卫拦死 → `--check` 不再受守卫限制。
- `--context` 可指向任意路径并被 `rm -rf` → 必须解析到仓库内部且不得是仓库根。
- 清单 JSON 手工拼接未转义 → 增加 `json_escape`。
- 生成路径集合在 3 处重复 → 由 `SYNC_DIRS` 派生。
- `deploy-postiz.sh --namespace` 缺参数校验、`build-postiz.sh` 把未知参数当 tag → 均改为 exit 2。
- 同时存在 `vitest.config.ts` 与使用无效选项的 `vitest.config.mts` → 只保留一个正确配置。
- `.gitignore` 缺行尾换行、废弃的 `.eslintignore` → 已修。
- `use.is.visible.tsx` 条件调用 hooks 且移除错误监听（`focus` 而非 `onFocus`）→ 已修。
- 代码审查后重新生成 `k8s/` 副本，`--check` 通过。

### 未证明

本票只到“可编译、可继续验收的合并候选”。镜像未构建未运行，数据库未同步，Temporal 未回放，SSO/六渠道/媒体/排版的端到端流程未验证——分别由 03–17 承担，最终验收归 18。未推送、未建 PR、未部署，Build 仍未启用。

### 复核补充：上游实际源码更新是否真的落地

关闭后对“上游实际源码更新”一项做了穷举复核，不再依赖抽查。取上游改动但**定制提交未触及**的 485 个路径，逐路径比较 `a5affe62` 与 `HEAD` 的 blob：

| 结果 | 路径数 | 说明 |
| --- | --- | --- |
| blob 完全一致 | 474 | 上游更新原样落地 |
| 上游已删除（基线段存在、上游不存在） | 8 | `.github/workflows/pr-docker-build.yml`、`pr-quality.yml`、`nayner.auth.button.tsx`、`purchase.crypto.tsx`、`read.or.fetch.ts`、`nowpayments.ts`、`veo3.ts`、`posthog.tsx` —— 上游删除，故 HEAD 缺失正确 |
| 有意的本地偏离 | 3 | `.gitignore`（+3 行：生成清单与 `public/g.js`）、`CLAUDE.md`（符号链接指向 `AGENTS.md`）、`package.json`（+12/−3：`volta.node` 修正为 22.23.4、新增 `lint`/`typecheck`/`test` 入口） |

合计 485，无未解释偏离。剩余 30 个双方都改过的路径已在正文「863 路径去向追踪」中逐条标注为 `adapted` 并分配负责票。

复核命令：

```bash
comm -23 <(git diff --name-only 0b554e68 a5affe62 | sort) \
         <(git diff --name-only 0b554e68 6fdf7cb5 | sort)
# 对每个路径比较：git rev-parse a5affe62:<path> 与 git rev-parse HEAD:<path>
```
