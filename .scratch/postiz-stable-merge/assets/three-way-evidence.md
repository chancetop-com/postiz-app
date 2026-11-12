# 定制清单、三方比较与现状验证证据

Date: 2026-11-11（Asia/Shanghai）
Scope: 「取得逐项定制清单与三方合并证据」的调查结果；不是保留方案、冲突解决方案或合并验收通过声明。

## 固定输入与调查方法

| 引用 | 完整 commit |
| --- | --- |
| B：共同基线 | `0b554e684483932d394e703208fe21648e7acd6f` |
| F：首个定制提交 | `f042c177c1a378edacd54790614bdd9f709a2480` |
| C：最终定制行为基准 | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` |
| H：当前 dev 起点 | `501e87dbfb2ca6e44662baec308afa468a922b38` |
| S：已锁定稳定版 v2.25.3 | `a5affe62c74e39c1e7ac960d50d8418b807d532c` |

- 分别审阅 B→F、F→C 的变更，再按 B→C 最终状态归并；没有要求 F 独立可构建。H 比 C 多出的两个提交是 agent/CodeGraph 配置，产品文件相同。
- 当前源码先经 CodeGraph 定位；历史差异用固定 Git 引用读取。文档和配置不靠符号索引推断。
- 本地仓库是部分克隆；读取 S 的部分正文最初因缺少对象而失败。随后在独立临时 clone 中通过公开 upstream 补齐 S 的文件对象，再完成源码比较。没有把缺少对象当作文件不存在。
- 隔离目录：`/private/tmp/postiz-wayfinder-three-way-n90eeeum/repo`。该目录共享读取原仓库对象，但有独立索引、工作树和新增对象；其 origin 只用于读取官方仓库。未向任何远端 push。
- 从 H 执行诊断性 `git merge --no-commit --no-ff S`，保留未解决状态。另用 `git merge-tree --write-tree --messages C S` 对照产品基准，区分 H 后续配置造成的额外冲突。没有提交合并、解决冲突、运行部署脚本或连接真实服务。
- `merge-base(H,S)=B`；`rev-list --left-right --count H...S` 为 `4 / 999`。本轮沿用已解决研究票锁定的 S，没有重新解释“最新”。

## 全量覆盖及证据入口

两个提交分别触及 **357 / 509** 个路径，去重后的 **863** 个路径全部仍在 B→C 净变更中，没有整文件层面的撤回遗漏。其构成为 **59 个非 k8s 路径 + 804 个 k8s 路径**。

| 资产 | 覆盖及用途 |
| --- | --- |
| [逐文件清单](customization-file-inventory.tsv) | 863 行；每行记录两个提交的状态、最终净变更、上游同路径变更、未合并 stage、blob ID、k8s 对照及对应审阅报告。用于查漏和后续逐项追踪；哈希相等不代表运行验收通过。 |
| [身份、鉴权与共享服务证据](customization-auth-evidence.md) | 17 个非 k8s 路径；SSO、认证控制器、共享请求、上传、容错和小型类型修正。 |
| [前端行为证据](customization-frontend-evidence.md) | 25 个前端路径；SSO 页面、渠道弹窗、可见入口、主题、品牌、预览及类型修正。 |
| [构建、副本、配置和文档证据](customization-packaging-evidence.md) | 17 个非 k8s 路径与全部 804 个 k8s 路径；相同源码按 blob 去重，差异和独有文件单独审阅。 |
| [机器摘要](three-way-summary.json) | 固定 SHA、数量、同路径重叠、自动合并集合与副本统计。 |
| [试合并日志](diagnostic-merge.log)、[未合并 stages](diagnostic-unmerged-stages.tsv)、[冲突分类](diagnostic-conflicts.tsv) | H→S 的实际 Git 结果；日志的“fix conflicts”是 Git 提示，不是本轮执行步骤。 |
| [产品基准对照日志](diagnostic-product-only-merge-tree.log) | C→S 恰好出现相同的 12 个内容冲突文件，没有 CLAUDE 文件类型冲突。 |

## 文本冲突与语义冲突

定制路径中有 **29 个**也被上游修改，其中 **12 个文件发生内容冲突，17 个自动完成文本合并**。自动合并不等于行为兼容。

| 内容冲突文件 | 后续需判断的兼容面 |
| --- | --- |
| `.env.example` | 保留 SSO 配置并接入稳定版新增配置，不把示例当真实环境。 |
| `apps/backend/src/api/api.module.ts` | 定制 SSO provider 与上游模块/控制器注册。 |
| `apps/backend/src/services/auth/auth.service.ts` | 商户自动开户、组织选择与新版认证规则。 |
| `apps/frontend/src/app/(app)/auth/layout.tsx` | 默认主题、登录页结构。 |
| `apps/frontend/src/components/analytics/chart-social.tsx` | 默认浅色与上游图表逻辑。 |
| `apps/frontend/src/components/launches/launches.component.tsx` | popup 回传刷新与上游渠道/日历状态。 |
| `apps/frontend/src/components/layout/top.menu.tsx` | 原隐藏入口与新增导航。 |
| `apps/frontend/src/components/media/media.component.tsx` | 被隐藏的创建入口与新版媒体能力。 |
| `apps/frontend/src/components/new-layout/layout.component.tsx` | 客户端登录校验、Copilot 会话与新版布局。 |
| `apps/frontend/src/proxy.ts` | 去除 cookie 门禁的定制与上游代理规则。 |
| `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts` | 原类型修正与新版媒体查询/数据结构。 |
| `pnpm-lock.yaml` | 原单项元数据变更与稳定版依赖图。 |

H 还包含 **1 个文件类型冲突**：本地 `CLAUDE.md` 为指向 `AGENTS.md` 的符号链接，上游为普通文件，Git 生成两个未合并路径来容纳它们。因此 H 的索引合计 **14 个未合并路径**，不能误称 14 个产品内容冲突。此项来自定制之后的配置提交，需纳入执行交接。

已确认的自动合并遗漏：`auth.controller.ts` 的 stage-0 结果引用 `getCookieUrlFromDomain`，但没有该函数的导入或定义。定制删除了原导入，上游新增的 OAuth state cookie 路径重新使用它。这是具体的源码完整性问题；本轮未运行成功的 TypeScript 编译，不将其描述成实测编译报错。

更多语义差异由上述领域报告逐项记录：包括 state cookie 与 sessionStorage 请求方式、删除用户后的商户重新进入、组织选择、popup 失败分支、精确渠道 identifier、新增可选服务依赖等。它们的保留/改写决定仍属于相应 HITL 票。

## k8s 副本为什么必须单独决策

- C 中 804 个文件：797 个与当前根目录对应文件 blob 相同，2 个不同，5 个没有根目录对应文件。两个差异是 `.dockerignore` 与 `apps/frontend/public/magic.svg`；后者只是换行符差异，不是另一个品牌图。
- S 没有 k8s 对应变更。诊断合并后的全部 804 个 k8s 文件仍为 C 的原始 blob；完整上游历史进入 Git 不会自动更新这份新增副本。
- 直接对照 S 的根目录，804 个中有 432 个 blob 相同、351 个不同、21 个在 S 根目录不存在（含 5 个独有文件）。详细分类见清单及构建报告。这不是“351 个未解决文本冲突”，而是跨目录副本差异。
- 复制脚本会刷新它列出的根源码目录，但有硬编码源路径，而且独有 Dockerfile 并不随根 Dockerfile 自动更新；仍需依据真实构建入口决定处理方法。

## 当前可运行性基线

检查均从主工作区根目录执行，基线为 H（产品等同 C）。Node **22.22.3**、pnpm **10.6.1** 可用；根目录及 k8s 均无 node_modules。本轮未安装依赖、启动服务或操作数据库。

| 命令 | 实际结果 | 能说明什么 |
| --- | --- | --- |
| `pnpm run build` | exit 1；`next: command not found` / `spawn ENOENT` | 构建未能启动；不能认定现状可构建，也不能归为合并新增失败。 |
| `pnpm test --runInBand` | exit 1；`jest: command not found` | 测试未运行，没有测试通过证据。 |
| `pnpm exec tsc --noEmit -p apps/backend/tsconfig.build.json --incremental false` | exit 254；`tsc` 不存在 | 类型检查未运行。 |
| `pnpm exec eslint apps/backend/src/services/auth/sso.service.ts` | exit 254；`eslint` 不存在 | 仅从根目录尝试代表性目标；lint 未运行，也没有用缺失的 `pnpm lint` script 冒充现成检查。 |
| 分别对 `k8s/build-postiz.sh`、`var/docker/docker-build.sh`、`var/docker/docker-create.sh` 执行 `bash -n` | 各 exit 0 | 仅 shell 语法解析通过；没有执行脚本中的 build/push/deploy。 |
| `node --check doc/sso-test/mock-sso-server.js` | exit 0 | 仅 mock 服务 JS 语法通过，未启动服务或验证 SSO。 |
| `node --check var/docker/ecosystem.config.cjs` | exit 0 | 仅 PM2 配置 JS 语法通过，未启动应用。 |

原始输出：[应用检查结果](baseline-checks/results.json)、[静态解析结果](baseline-checks/static-results.json)；同目录保留各命令日志。

命令入口已核实：根 `build` 串联三个应用；前端是 Next 构建，后端/编排器是 Nest 构建。根没有 lint/typecheck script，可从根目录显式调用本地工具。`jest.config.ts` 和 preset 依赖 `@nx/jest`，但 C/S 根清单均未直接声明它；C 没有跟踪的 `*.test.*` / `*.spec.*` 文件。这些是后续准备测试环境时需确认的问题，不能以脚本存在证明有可执行覆盖。

环境差异也不能混淆：C 的 Node engines 接受当前 22.22.3，S 则固定 **22.23.4**；两者仍带有旧 Volta 20.17.0。未来稳定版构建需先确定一致工具链。本轮没有对未解决的诊断合并树做产品构建或运行验证。

## 后续票的具体输入与边界

| 决策票 | 本轮交付给它的事实 |
| --- | --- |
| [决定 SSO 身份与整站鉴权的兼容契约](../issues/03-sso-auth-contract.md) | 自动开户与文档开户接口差异；GENERIC 身份复用；组织/删除用户场景；新 state cookie 与认证 header 的交互；未导入函数的自动合并遗漏。 |
| [决定 OAuth 弹窗回传与六平台限制的保留方式](../issues/04-channel-oauth-contract.md) | popup 并非所有分支都代表成功；精确六 identifier 对新渠道的效果；回传来源与中转参数边界。 |
| [决定品牌界面与可选服务降级的保留契约](../issues/05-ui-optional-services.md) | 实际被注释的入口还包含 ThirdPartyMedia；仍可见的 Editor/可选能力；上游新增入口和服务。 |
| [决定源码构建与部署运行时的升级方式](../issues/07-build-runtime-strategy.md) | 副本不会随 merge 更新；独有 Dockerfile、Node pin、构建 context 与启动链差异。 |
| [决定现有数据与 Temporal 任务的兼容升级路径](../issues/08-data-temporal-upgrade.md) | C 根启动链含接受数据丢失参数，而 S 已移除该参数；k8s 跳过同一 schema 步骤。真实数据、在途任务仍待其前置票和专门分析。 |
| [决定合并验收与执行交接标准](../issues/09-acceptance-execution-handoff.md) | 863 路径追踪、真实冲突数、自动合并语义检查、配置类型冲突及明确未验证的应用基线。 |

没有新增产品需求或替用户选择保留策略。上述明确差异都落在现有票的问题范围内，因此本轮将证据指针追加到它们，保留其 open 状态和原依赖关系。地图中的隐性语义冲突与真实环境兼容例外仍有未可指定部分，不虚报已清空。
