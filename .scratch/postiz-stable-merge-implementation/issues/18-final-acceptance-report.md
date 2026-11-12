# 18: 完成最终整体验收与双向差异报告

**What to build:** 维护者收到经过全部本地必验的最终分支和修订，能够看清相对升级前 fork 的具体变化、相对锁定上游的所有保留差异，以及每项定制和验证的实际去向。

**Blocked by:** 06 — [保留品牌、主题与界面入口范围](06-brand-theme-navigation.md); 08 — [完成 YouTube 与 Meta 的多步单选授权](08-channel-oauth-selection.md); 12 — [缺少可选服务时核心操作仍可用](12-optional-services.md); 17 — [故障下识别未知结果并完成协调恢复](17-fault-recovery.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的全部 Testing Decisions 与“最终交付物”，以及[验收交接决定](../../postiz-stable-merge/issues/09-acceptance-execution-handoff.md)的最终 Answer；同时遵守[共同执行约束](../README.md#执行约束)。直接依赖的传递闭包覆盖 01–17。

- [x] 全部前置票实际完成并有证据；锁定执行前 fork、两个定制提交、目标 tag/SHA、最终代码 SHA，单列未提交内容，核对最终祖先关系及上游实际变化，不用提交数或无冲突标记代替。
- [x] 从最终根源码重新生成干净输入并构建最终候选镜像，完成 Node/pnpm/Prisma、frozen lock、三应用构建/类型、根目录 lint 及非零有效回归；记录命令、覆盖、用例数、输入摘要和 image ID，不能沿用中途镜像作为最终证据。
- [x] 在最终候选完成完整本地流程：父页进入、SSO、身份/组织、六入口、popup 会话、授权/单选、回传刷新关闭、媒体、编辑、排程发布、分析和匿名预览；普通登录、重连、管理员代入及既定异常分支同时复验。
- [x] 按完整规格验证桌面/移动、iframe/独立窗口、标签页与第三方 cookie 受限场景；保留品牌、主题和隐藏入口范围，验证无可选服务及 MCP 失败时核心流程，记录实际浏览器和环境，不能以其它引擎冒充 Safari。
- [x] 最终镜像验证三进程、nginx、公开配置与来源、身份/iframe headers、健康入口、原生依赖、上传与媒体持久化；根与专用镜像均完成官方同步成功、失败阻断及重复启动验证。
- [x] 在最终候选完成旧数据保留比较、历史 replay、新旧任务接续、重复/邮件/维护队列和故障/协调恢复；若后续改动影响已有证据，重跑相关场景并更新记录，不以旧修订通过代替。
- [x] 所有本地必验项实际通过后才标记本地验收完成。分别记录升级前基线失败、合并新增失败和缺条件未验证，基线分类不是自动豁免；工具、依赖、测试基础设施缺失及零用例均不能归为外部条件缺口。
- [x] 逐项列明真实父应用和六渠道真实 OAuth 的结果或缺口，覆盖同意页、回调、拒绝/取消、选择、绑定及重连，附所需条件、步骤、影响、证据与待安排执行人。仅外部条件缺失时可交付“代码合并完成、本地验收通过、外部验证待补”，实际失败不得改写为缺条件。
- [x] 按规格约定位置交付基于最终修订的双向改动报告：相对升级前按流程说明原行为、最终行为和用户变化，区分上游更新、继承定制、新增适配、配置/构建/数据变化与仍存在的旧缺口。
- [x] 相对锁定上游的实际 diff 附录覆盖全部差异路径，逐项或有明确映射地归组说明内容、来源、保留原因、用户影响和验证；包含源码、资产、文档、运行配置及生成副本，不遗漏路径或留下无解释的整文件覆盖。
- [x] 两个定制提交的全部 863 个净变更路径映射到最终实现、保留方式、完整流程和实际结果；记录有业务意义的冲突适配，用户批准的偏离附原行为、最终行为及决定来源，隐藏入口与保留后端能力明确区分。
- [x] 交付本地专用分支、最终修订、完整报告及验证记录；明确未部署及未来上线核验条件。不得自行发布镜像、推送、创建 PR、更新集群、迁移真实数据或重新启用 Build，不将本地验收称为全部真实端到端通过或可以上线。

> 完成情况说明：第 3–5 项中依赖**真实父应用、真实六渠道 OAuth 账号与 Safari**的部分属于外部条件，
> 已在报告 6.5 与下方 Answer 中逐项列为“缺条件未验证”，没有用其它引擎或替身冒充；本地可执行的部分
> （组件/HTTP 契约套件、最终镜像、真实 Chrome 桌面与移动冒烟）全部在本修订上实际通过。评审修订补上了
> 此前只在组件/proxy 级的跨源父页 → iframe → SSO 与 popup → relay 浏览器流程（31/31，见 `rehearsals/19/`），
> Safari 与已部署父应用仍属外部条件。

## Answer

2026-11-12，分支 `codex/ticket-18-final-acceptance`（工作树 `~/Desktop/Web/postiz-worktrees/18`，起点 `ccefd6dc`）。
**代码合并完成、本地验收通过、外部验证待补。** 未推送、未创建 PR、未部署、未更新集群、未迁移真实数据、
未读取真实 Secret、未重新启用 Build；候选镜像只存在于本机 Docker daemon。

### 修订与引用

| 项 | 值 |
| --- | --- |
| 执行前 fork / 两个定制提交 / 合并基 / 上游 | `501e87db` / `f042c177`、`6fdf7cb5` / `0b554e68` / `a5affe62`（v2.25.3） |
| 祖先校验 | 五个引用全部是祖先；`S..U` 的 94 个提交一个都没进入；合并提交 `af5bd677` 有两个父 |
| 最终代码修订（镜像与演练来源） | `bfc012c74b240eff6f0071556ee6ec06d434c9e0`，工作区 clean，`contextMatchesHead: true` |
| 证据提交 / 最终交付修订 | `1042a9e7` / 本回答所在提交（分支头） |
| 未提交内容 | 无；交付时工作区干净 |
| 相对上游差异 | 1474 个路径（+349440 / −720），其中 969 个是 `k8s/` 生成副本，手写源码差异 56 个 |

### 本地必验门（本修订实测）

| 命令 | 结果 |
| --- | --- |
| `rm -rf node_modules && pnpm install --frozen-lockfile` | exit 0（Node 22.23.4 / pnpm 10.6.1 / Prisma 6.5.0） |
| `pnpm run typecheck` | exit 0（frontend/backend/orchestrator） |
| `pnpm run lint` | **0 errors / 713 warnings** |
| `pnpm run test`（两次） | **53 files / 475 tests** 两次全过 |
| `pnpm run test:replay` | **16/16** 历史通过 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run build` | exit 0 |
| `./k8s/prepare-build-context.sh --check` | in sync（重新生成后；此前 Next 代码生成导致 `next-env.d.ts` 漂移） |
| `./k8s/tests/prepare-build-context.test.sh` | 48 passed |
| `./k8s/tests/runtime-contract.test.sh` | 54 passed |

### 最终镜像与演练（均在本修订上重跑）

| 项 | 结果 |
| --- | --- |
| 镜像 | `postiz-ticket18:candidate`，`sha256:c77e3edea504ff786974039a79bab74e61e1027d1c548730e92754dba0a69e6a`，4.96GB |
| 构建输入清单 / lockfile | `sha256:8f5b55fe…`（970 个生成文件）/ `caba97c3…` |
| ticket 13 镜像套件 | **85/85**（首次 84/85 只因构建哨兵常量写死，修正 harness 后重跑） |
| ticket 03 启动同步（同一镜像） | **49/49**；另实测无 `DATABASE_URL` 时 entrypoint exit 1 拒绝启动 |
| ticket 15 / 16 / 17 | **107/107**、**122/122**、**108/108** 断言 |
| 真实浏览器冒烟（Google Chrome 桌面 1440×900 + 移动 390×844） | **17/17**：登录页、无会话跳转、`/auth/sso?token` → `/sso?auth_code`、匿名预览回退；零未捕获异常 |
| 父页 → iframe → SSO 与 popup → relay（评审修订新增，同一镜像） | **31/31**：跨源父页嵌入 `/auth/sso?token`，iframe 内 `/sso?auth_code` → `/launches`，0 次 `/auth/login`；popup 的 `auth/showorg/impersonate` 与标记落在弹窗自身 sessionStorage。证据 `rehearsals/19/` |

演练脚本的两处 harness 修正（构建哨兵改读环境变量、`grep -q` 在 `pipefail` 下的 SIGPIPE 等待循环；
16 的完成状态改为有界轮询）逐条记录在报告 6.3.1，未改产品代码、未放宽断言。

### 报告与附录

- 报告：`.scratch/postiz-stable-merge/assets/final-merge-report.md`
- 相对上游的完整差异附录（1512 行数据、1513 行含表头，覆盖全部路径）：`.scratch/postiz-stable-merge/assets/final-diff-file-appendix.tsv`
- 两个定制提交 863 个净路径的逐项去向：`.scratch/postiz-stable-merge/assets/final-customization-appendix.tsv`
  （791 生成副本、30 合并后再适配、27 逐字保留、7 后续再适配、7 因上游删除根源文件而消失、1 上游覆盖）
- 证据与日志：`.scratch/postiz-stable-merge-implementation/rehearsals/{03,13,15,16,17,18,19}/`
  （19 是评审修订的父页/iframe/popup 浏览器演练与门禁重跑日志）

### 外部缺口（缺条件未验证）

真实六渠道 OAuth 同意/回调/拒绝/选择/绑定/重连；真实父应用 `https://merchant.connexup-dev.net`
与 iframe；Safari 与第三方 cookie 受限浏览器；真实 Pod/imageID；线上 schema 漂移；在途任务与队列历史；
备份恢复与停写窗口；真实邮件送达；真实 AI/MCP 与可选媒体处理。逐项条件、步骤、影响与执行人见报告 6.5。
ticket 17 的八项残余风险原样带入报告 6.6，其中两条“未知结果”风险（15 秒心跳窗口内 worker 死亡导致重发；
写回完全失败导致 missing sweep 重发）仍需上线前核对。

### 结论

本地必验全部实际通过（含跨源父页的 iframe/popup 浏览器流程），仅缺真实账号、已部署父应用、
Safari/受限 cookie 与集群等外部条件，按规格交付为
**“代码合并完成、本地验收通过、外部验证待补”**。不得表述为全部真实端到端通过或可以上线；
是否发布与上线由用户另行决定。

## Review fixes

最终两轴评审（standards + spec）的发现全部在本分支 `codex/review-fixes`（基于集成 tip `8452904c`）
逐项处理。下表是每个发现的处置。

### Group A — 工具缺陷（改代码）

| 项 | 发现 | 处置 |
| --- | --- | --- |
| A1 | `prepare-build-context.sh --check` 在检查分支之前 `mkdir -p`，不是只读，与 `k8s/README.md` 矛盾 | **已修**：`--check` 之前不再创建目录；缺失上下文按 DRIFT 报告并 exit 1。新增 2 条断言（缺失目录不创建、退出码 1） |
| A2 | `build-local.sh` / `build-postiz.sh` 自己传 `--allow-dirty`，文档的脏树保护无法通过这些入口到达 | **已修**：两个入口都不再传；脏树以 preparer 的消息失败并要求提交或显式 `--allow-dirty`。测试覆盖 `build-local.sh --prepare` 与 `build-postiz.sh --prepare` 的脏树失败、干净树成功、失败时从不调用 docker |
| A3 | `json_escape` 有两份；`build-local.sh` 的弱化版不转义 `\n`/`\t`/`\r` | **已修**：唯一实现移到 `k8s/lib/json.sh`，preparer 与 build-local 共同 source，弱化副本删除。测试断言转义输出（换行/制表/CR/引号/反斜杠）且 build-local 不再有本地副本 |
| A4 | `package.json` 仍声明整套 Jest，但 runner 是 vitest | **已修**：移除 `jest`、`ts-jest`、`babel-jest`、`jest-environment-jsdom`、`jest-environment-node`、`@types/jest`、`jest-junit` 及 `jest-junit` 配置块，锁文件重算。额外移除未被任何代码引用、且是锁文件里 `jest` 最后来源的 `jest-mock-extended`。**保留并显式声明 `@types/jsdom@20.0.1`**：`libraries/nestjs-libraries/src/openai/extract.content.service.ts` 直接 import `jsdom`，其类型原先只经由 `jest-environment-jsdom` 传递到达，移除后后端 typecheck 立刻失败。锁文件里剩余的 `@jest/*` / `jest-environment-node` 来自 `@postiz/wallets → walletconnect → react-native` 的传递 peer，不是本仓库声明 |

### Group B — 品牌布局

| 项 | 发现 | 处置 |
| --- | --- | --- |
| B1 | 32×32 PNG 只有 `width`/`height`，flex 容器可以把品牌标记压小 | **已修**：加 `minWidth`/`minHeight: 32`（等价于旧 SVG 的 `min-w`/`min-h`）；`tests/layout-navigation.test.tsx` 断言两项；资源仍是 32×32 PNG |

### Group C — 报告准确性

| 项 | 发现 | 处置 |
| --- | --- | --- |
| C1 | 报告写“807 个生成副本 / 56 个手写根路径”，与其处置表不符 | **已修**：按附录重算为 **804 个 `k8s/` 路径**（791 生成副本 + 4 构建树独有文件 + 2 后续适配 + 7 消失）**+ 59 个根路径**；§4.2 标题同步 |
| C2 | 附录写作“1424+ 行”，本票又写“1476 行” | **已修**：实测并统一为 **1512 行数据 / 1513 行含表头**（评审修订新增路径后重新生成） |
| C3 | `k8s/` 部署树写 17 个，实为 19；969+17≠986 而 k8s 总数是 988 | **已修**：补上两个 `k8s/tests/*.sh`，评审修订再加 `lib/json.sh`，现为 **20 个**；969+20=**989**，与附录 `k8s/` 行数一致。970 与 969 的差额是 gitignored 的 `apps/frontend/next-env.d.ts`，已在报告 §3.2 说明两个口径 |
| C4 | 媒体行声称 Range“206/416”，评审未找到 416 断言 | **已核对并改写**：416 断言真实存在（`tests/media-upload-route.test.ts` 的“rejects a range that starts past the file”，断言 416 与 `Content-Range: bytes */N`）；报告改为引用该用例，不留下无出处声明 |
| C5 | 交叉引用指向 §6.5 的内容其实在 §6.6 | **已修**：§2.5(8) 与 §6.4 第 18 行的 6.5→6.6；开头的“交付定级”改指 6.7 |
| C6 | 声称逐字带入 ticket 17 的风险，但漏了“维护 activity 执行中杀 worker 未实测”，并淡化了 `historyLength` 的实测数字 | **已修**：报告 §6.6 恢复该条与“实测约 11 事件/轮、271 事件/首 run”，现为 8 条，标题“不淡化”恢复成立 |
| C7 | 行为改变修复记为 6 处，实为 7 处 | **已修**：报告 §2.3/§5.2 加入 `libraries/react-shared-libraries/src/helpers/use.is.visible.tsx`（hooks 提到 SSR 早退之前；cleanup 现在移除真正注册的 `window` 监听器，而不是 `document` 上从未注册的 `focus`），§5.2 标题改为 7 处 |
| C8 | `refreshTokens()` `return`→`continue` 与 `refreshToken` 缺 `@ActivityMethod()` 两处基线修复未引规格 | **已修**：ticket 09/16 与报告 §5.2 补用户故事 26–27 及“六项渠道/旧渠道凭据”裁定“已有渠道可以刷新凭据、重新授权并继续发布”作为依据 |

### Group D — iframe / popup 验收缺口

**已关闭（本地部分）**。`rehearsals/19/` 用候选镜像 + 隔离 PostgreSQL/Redis + 本地 SSO 替身，在真实 Chrome
桌面 1440×900 与移动 390×844 上：跨源父页 iframe 经 `/auth/sso?token` → `/sso?auth_code` → `/launches`，
全程 **0 次** `/auth/login`；父页打开 `/channel-relay?redirect=…#auth&showorg&impersonate`，三项会话值与
popup 标记落在**弹窗自身** sessionStorage，redirect 后才离开 relay；**31/31 通过**。
矩阵第 5 行从“部分通过”改为“通过（本地部分）”，Safari 与已部署父应用仍列报告 6.5。

演练同时暴露一个与本次定制无关的冷启动现象：后端启动期间 nginx 的隐式 upstream 被被动健康检查置为
down（默认 `fail_timeout=10s`），该窗口内请求得到 502（curl 与浏览器均可复现，之后恢复 200）。
未改产品；已作为残余风险写入报告 §6.6，上线时应在就绪探针通过后留出该窗口。

### 门禁（最终树重跑）

`pnpm install --frozen-lockfile`、`typecheck`、`lint`（0 errors）、`test` ×2（53 files / 475 tests）、
`test:replay`（16/16 histories）、`build`、`prepare-build-context.sh --check`、
`prepare-build-context.test.sh`（48）、`runtime-contract.test.sh`（54）全部通过；
日志在 `rehearsals/19/gate-logs/`。

合入 `codex/postiz-stable-merge`：**Already up to date**（集成分支在本分支起点 `8452904c` 之后没有
新提交，无需解决冲突）。合并提交之后在干净交付树上再跑一次
`./k8s/prepare-build-context.sh --check`，仍为 in sync；两个 k8s 套件仍为 48 / 54。
