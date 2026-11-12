# 决定现有数据与 Temporal 任务的兼容升级路径

Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: chancetio (agent wayfinder_data_temporal_upgrade)
Parent: ../map.md
Blocked by: 02, 06, 07
Created: 2026-11-11
Resolved: 2026-11-11

## Question

从当前基线升级到稳定版时，如何保住已有商户/用户/组织、渠道凭证、媒体、排程和在途 Temporal 任务，并制定可以验证和恢复的迁移路径？

基于实际 schema、发布/迁移说明、workflow/worker 变更和部署证据决定：
- 数据结构差异与升级顺序、旧身份映射不变的证明；provider token/帖子状态的兼容需求。
- 既有排程与在途 workflow 是否可由新 worker 接续，是否需要 drain、兼容 worker 或其它步骤；不能仅以新任务可发布作为通过。
- 根启动链的 prisma db push --accept-data-loss 与 k8s 直接启动的差异如何处理；先明确现状，不运行可能改数据的命令来探测。
- 数据库/媒体备份、测试副本、迁移前后比对和回退边界；应用镜像回退与数据/工作流可回退是不同证据。
- 哪些事项可在本地证明，哪些缺少真实环境信息不能下结论。

产出具体决定与本地/测试副本的验证要求；不操作真实数据。用户已明确线上部署由其最后另行决定，生产迁移与上线时机同样不由本地图或后续代码合并自动触发。

## Comments

### 已明确的官方数据库升级方式

- 2026-11-11，用户最终明确：**“不使用独立脚本了，就按官方的方式走”**。这撤销先前独立升级脚本及升级与应用启动分离的要求；不再交付自建迁移脚本。
- 沿用锁定上游的 schema 和 `pnpm run prisma-db-push`（Prisma 6.5.0 `db push`），按官方容器启动链先同步数据库结构，成功后再启动应用进程。应用容器重启时仍会经过这一流程；不是仅首次安装执行。定制 k8s 镜像也须接入这一顺序，不能继续直接 PM2 启动而跳过同步。
- 使用锁定新版不含 `--accept-data-loss` 的命令，不恢复旧参数，也不改用 reset。同步失败时不得绕过错误继续启动应用；遇到实际数据或约束问题再针对具体差异处理，不因本次选择另建版本化迁移体系。
- 安装阶段 Prisma generate 仅生成客户端，镜像构建不执行数据库同步。执行阶段在隔离测试数据库验证启动前同步、失败阻断、已有数据保留及重复启动；说明实际目标版本、命令和验证结果，不把选择官方机制写成已验证兼容。
- 此决定不授权现在连接或迁移真实数据库，先规划、不部署的边界不变。数据兼容、旧 Temporal 任务接续及恢复边界仍属本票剩余工作，保留当前认领状态。

### 历史核查与交接

- 2026-11-11：[源码构建与部署运行时契约](07-build-runtime-strategy.md#answer) 确定主路径为从根源码生成输入的 k8s 多阶段单镜像，Node 22.23.4/pnpm 10.6.1、完整 API 模式及本地隔离验证作为本票输入。原先直接启动 PM2、不加入 db push 的计划已被上方用户最终决定取代；启动前执行官方同步的顺序已经确定。旧 workflow 接续、数据验证与恢复边界仍由本票决定，未运行迁移/replay。

- 2026-11-11：[部署配置与镜像来源核查](../assets/deployment-evidence-2026-11-11.md) 确认清单使用 PostgreSQL 15、Temporal latest 和独立持久卷；实际版本、在线任务与备份恢复实况仍未知。本票应通过源码与本地/隔离样本制定保守兼容路线，明确上线前需核验的假设；不能把未知解释成没有旧任务，也不以取得现网访问作为当前决策前置。未实施真实迁移或 replay。
- 2026-11-11：[SSO 身份与整站鉴权契约](03-sso-auth-contract.md#answer) 已定现有身份/组织行为及新增账户功能边界。数据兼容方案须以此为输入；删除与永久凭据交换接口仍保留，不能把 UI 无入口当成后端无法改变数据的证据。既有 GENERIC 身份与组织归属需只读核查，不能默认重映射。

- 2026-11-11：[构建启动链证据](../assets/customization-packaging-evidence.md) 明确区分 C 与 S：C 根启动的 db push 含 `--accept-data-loss`；S 已移除该参数，但启动时 db push 仍在；k8s 直接 PM2 仍不走同一步骤。删除参数不构成数据兼容验收。
- [身份证据](../assets/customization-auth-evidence.md) 记录稳定版软删除、凭据交换与 SSO 自动开户/组织选择的组合语义。实际旧 GENERIC 用户、组织归属和在途任务分布仍未知；需要结合真实环境证据决定数据保留策略。
- 本轮仅审阅定制及必要依赖上下文，没有完成 schema/Temporal 全量升级方案、replay 或真实数据验证；这些仍属于本票，不因文本合并完成而默认通过。

### 本轮核查与最新决定的应用

- 先认领，再依 wayfinder、grilling、domain-modeling 开展两项事实调查。新增 [数据结构与存量记录核查](../assets/data-schema-upgrade-evidence.md)、[Temporal 升级证据](../assets/temporal-upgrade-evidence.md)、[启动与恢复边界核查](../assets/data-upgrade-startup-recovery-evidence.md)。完整 schema 增量、对应版本源码行号和官方机制说明在这些资产中。
- 调查期间用户要求重新读取其调整的地图。已重新读取地图、构建票、本票与验收票，以最终“**不使用独立脚本了，就按官方的方式走**”为准；撤销本轮证据中曾建议的独立 SQL/升级脚本方案。以下答案不再把它列为交付要求。
- 数据同步方式已有用户明确决定；其它技术适配沿用已确认的“保留原来的整个 flow、兼容的上游更新直接合入”原则。未发现必须重绑商户、重建排程或改变已定产品范围的不可避免冲突；不虚构新的用户确认，也不把静态调查当作运行验收。

## Answer

2026-11-11，按用户最新地图及既有完整 flow 契约解决：**采用官方启动前 db push，保留存量身份、渠道、媒体和帖子记录；旧 Temporal 执行继续使用保留的工作流定义，新任务进入上游新版。通过隔离副本和历史回放验证，真实环境的切换与恢复由未来上线决定另行放行。** 本票完成兼容路线的规划，未执行合并、数据库同步、replay、备份恢复或部署。

### 数据同步与启动顺序

1. 以最终合并后的 schema 为准，沿用 `pnpm run prisma-db-push`：锁定 Prisma 6.5.0，**不含 `--accept-data-loss`，不用 reset**。根入口保留官方启动链，定制 k8s 镜像在启动应用进程前接入同一命令；失败返回非零并阻止 API/worker 启动，不能吞错。每次容器启动/重启均经过同步，不改成一次性安装动作。
2. 安装/镜像构建只生成 Prisma 客户端，不连接数据库。运行镜像包含 schema、根 scripts、pnpm 和官方命令所需 CLI/依赖；本地验证它在最终镜像内确实可执行，不只检查 Dockerfile 文本。具体打包继续遵循 [源码构建与部署运行时契约](07-build-runtime-strategy.md#answer)。
3. **不自建版本化迁移体系，不交付独立升级脚本。** 如需核对新增主键、索引或外键，可以用锁定 CLI 在本地生成检查用 SQL；它只是调查材料，不能暗中替换选定的 db push。遇到真实数据不满足约束或同步拒绝时，先保留数据和失败证据，再就具体差异处理，不用接受数据丢失或删表的方式绕过。
4. 本地演练先在隔离 PostgreSQL 15 上建立旧版 schema 和合成旧数据，记录基线，然后按最终容器的真实启动顺序同步并启动服务。再做第二次启动、失败启动和恢复演练。PG15来自已核实的环境声明，实际线上版本仍待未来核验；不为了本轮升级数据库大版本或 Temporal Server。
5. Prisma schema 由 48 增至 88 个 model，没有删除原 model/字段；主要增量为 Mastra 与可选媒体/OAuth 能力。**这不是数据安全证明**：新增复合主键、索引、可空关系的实际 SQL 与 Mastra 存储 SDK 初始化仍须在隔离库验证。`mastra_ai_spans` 的复合键要覆盖重复样本；不能凭 `@@ignore` 假定它不受 DDL 影响，也不能删除 trace 来求启动成功。

### 存量记录的保留与兼容

| 范围 | 选定处理与验证边界 |
| --- | --- |
| 商户、用户、组织 | 保留既有 ID、GENERIC + merchantId、密码/凭据、组织及成员关系、角色和 disabled；不去重、换命名空间、重建组织或调整组织选择。新增 deletedAt 初始 NULL，既有用户继续复用，按 [SSO 契约](03-sso-auth-contract.md#answer) 覆盖多组织、缺组织及会话场景。 |
| 新增默认值 | 旧 Media 为 ready，Subscription.provider 为 stripe，Post.creationMethod 为 UNKNOWN，OAuthApp.dynamic 为 false；其它相关新增可空值按 schema 处理。验证同步后的实际值，不猜旧帖来源、补造 batch 或把旧静态 OAuth 应用改为动态应用。 |
| 渠道及凭据 | 保留 Integration.id、organizationId、internalId、原 rootInternalId 分组、token/refreshToken 与有效期。新版 root 标识写法不同，但完成绑定的重连仍可使用最终渠道标识；不整表重写 root、不强制全员重授权。针对旧 root 的查找、同账号多页、跨组织、刷新和重新授权建立样本；若确有 flow 回归，做有 provider 依据的兼容读取，不能把任意下划线尾段当成统一身份。 |
| 旧凭据格式 | 保留 Instagram 单 token 的上游 fallback、Skool 旧 JWT 与新格式的兼容读取。保持已有加密/JWT 配置可用，不用随机新密钥解释存量数据；也不依据字符串形状猜测并修复失效 token。真实平台凭据有效性单独记录，模拟通过不等于真实 OAuth 通过。 |
| 帖子与排程 | 保留 id、integrationId、group/parent、publishDate、state、releaseId/releaseURL、settings/image；不按旧时间或缺少 batchId 批量补发、改期、改状态。新 batch 及创建来源用于正常新行为，不猜测回填旧记录。 |
| 媒体 | 保留媒体 ID、文件、URL、帖子 JSON 中的路径/缩略图/引用；不默认重新处理或搬迁。旧路径若被新 reader 拒绝，先针对路径形式适配并验证文件读取，不删媒体或略过图片后宣称发布成功。 |
| 时区 | 不从旧整数偏移猜 IANA 时区，不批量重写 publishDate。验证旧浏览器偏好、新 timezoneName=NULL 和新版时区选择的组合；必要客户端适配维持原排程时间。 |
| 可选能力与其它绑定 | 按既定配置门控保留，不因升级开通新服务、启用 MIGRATE_PROVIDERS 或迁移全部渠道。界面六入口限制不等于可以删除其它存量绑定、队列或数据。 |

数据库中保存的排程记录、Temporal 的执行历史、平台上的实际发布结果需要分别核对：三者任何一个存在，都不能单独证明其余两个一致。

### Temporal 接续路线

1. **保留上游全部历史 workflow 导出及旧 activity 名称。** V101/V102 与旧版本文件完全相同，稳定版保留它们；新启动入口采用 V112，既有执行不批量改名、终止或重建。旧 repeat child 会继续生成原版本，不能以“第一轮结束”作为删除旧定义的时机。
2. 保留 namespace、workflow ID、业务 ID、历史 payload、搜索属性与任务队列连续性。已查常规 workflow 在 main，provider 队列承担发布活动；稳定版将 provider worker 改为 activity-only。**若部署历史存在 provider 队列上的 workflow，就保留对应 workflow 注册/兼容 worker**，不靠改写历史队列解决。这个条件已明确为上线前核验，不能把未知当成不存在。
3. 保留旧 `postSocial` 的阻塞返回契约，新 pending/finalize 路径只供新版活动使用；保留旧邮件积压的 workflow，同时为新 email/email-bulk 活动提供 worker。autopost、missing sweep、streak 的上游 patch/Continue-As-New 路径都纳入回放，不只验证发布 workflow 文件。
4. 默认保持现有单应用部署形态；不引入额外 Worker Versioning、不让两个未分流的新旧 worker 在同一 main 队列上随机领取不兼容任务。直接 SDK 锁定版本前后均为 1.15.0，但 Nest、打包和注册有变化，必须实际启动验证。没有证据要求为本次应用升级同时升级 Temporal Server。
5. **不要求所有长期 workflow drain。** 重复排程、refresh、autopost、digest 可长期存在；未来切换针对进行中的外部发布活动验证退出/接续及结果核验窗口，保留历史让兼容 worker 恢复。具体时间窗口与现网活动清单属于未来上线操作，不在本票猜测。
6. 接纳上游重试、pending、回锚等兼容变化，不顺带改写全部异常分支。基线和新版都存在外部已成功但本地结果未落盘的风险；heartbeat 缺失也不等于未发布。故障注入区分既存问题、上游残余风险和本次回归，仅对证实破坏既定 flow 的问题做必要适配，不借此另建全局幂等系统。

### 必需的本地验证

| 证明目标 | 执行阶段必须留下的证据 |
| --- | --- |
| 官方启动机制 | 旧库→候选启动同步→服务启动，以及重复启动；故意制造无法满足的约束/连接错误时 db push 非零、API/worker 没有绕过启动。根与主 k8s 两条支持路径均覆盖；构建不连接数据库。 |
| 数据保留 | 同步前后表/主键集合、原列值摘要、用户组织成员/渠道关联、token等敏感值在受控程序内相等、帖子状态/日期/release字段、媒体记录与实际文件。新增默认值及可空约束单列，不只比较总行数。 |
| 旧数据读取 | 商户首次/复用、多组织、旧 root 与同账号多页、旧 Instagram/Skool 凭据、旧 Post JSON/媒体路径、旧时区偏好；同时运行候选活动处理旧 payload，避免只测新建记录。 |
| 历史回放 | 用旧代码与合成凭据生成 fixture，保存来源 commit/lock/bundle；候选离线 replay V101/V102、sleep、repeat child、延迟评论、refresh、旧邮件，以及同名 workflow 的 patch 前后历史。回放不实际验证平台副作用。 |
| 整条排程 flow | 隔离 Temporal + DB + 媒体 + stub provider，覆盖等待→重启→发布→写回→重复，改期/DRAFT/删除/update，missing sweep，邮件、autopost及所有需要的队列。记录目标渠道、时间、外部调用次数和最终状态；不能用新任务成功代替旧任务接续。 |
| 故障与恢复 | 平台接受后 worker 退出、DB写回/通知失败、pending/finalize 超时、heartbeat 有/无 details；核对结果未知时的真实行为及已有风险。验证候选回退 worker 对已产生的新旧类型、patch 和 activity payload 的覆盖。 |
| 备份恢复 | 本地样本的数据库与媒体恢复后重新比对，并验证 Temporal/应用状态的关联；不会把“备份文件存在”写成恢复成功。所有运行结果标记通过、失败或未验证。 |

测试使用隔离数据库、Temporal 与媒体位置，平台调用由替身接收，不让旧任务样本触发真实发布。真实 Secret、备份和 history payload 不放入仓库资产；本票没有要求现在取得现网访问。

### 恢复与回退边界

- 未来上线前要有经过恢复验证的应用数据库、媒体及 Temporal 持久化保护，并识别所有写入者。单个数据库的 dump 不能代表其它数据库与文件卷处于同一恢复点；实际版本、备份方式、停写/一致性边界及操作负责人留在上线交接中，不能虚构已具备。
- **不能直接启动旧 C 镜像当作通用回退。** 旧根启动命令含 `--accept-data-loss`，旧 schema 对新版扩展结构可能产生破坏动作；旧 worker 又不识别新 workflow/patch。需要已验证的兼容回退候选，或在隔离环境验证完整协调恢复；不通过 drop 新列/表来“配合旧应用”。
- 数据同步失败不代表数据库必然完全未变；保留错误与结构快照，核查部分变化后再处理。新运行/写入尚未发生时与已产生新类型、凭据、新记录后的恢复是两种条件，不能给出统一“换回镜像即可”的承诺。
- 平台已发布的内容、已经发生的 token 刷新或外部通知不会随数据库/Temporal 回退撤销。恢复旧快照前核对这些外部结果，不能自动重放所有排程或将结果未知视为失败再发。
- 实际 Pod/imageID、真实 schema 漂移、运行队列/history、真实备份恢复及暂停窗口仍未验证，须在用户未来决定上线前核验。这些缺口不阻止地图/本地代码验收，但阻止宣称线上接续与恢复已证明。

本轮仅解决本票。未产生需要另建决策票的业务取舍；已明确的数据/Temporal 例外都归入上述验证和失败处理条件，交 [决定合并验收与执行交接标准](09-acceptance-execution-handoff.md) 汇总。若执行中证实存在无法保持原 flow 的冲突，再以具体旧行为、上游变化与方案交用户评估。

