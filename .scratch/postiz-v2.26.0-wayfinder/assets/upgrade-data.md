# v2.26.0 的旧渠道、在途任务与数据库启动

官方 v2.25.3 `a5affe62` 到 v2.26.0 `132859f3` 的升级可以沿用现有配置。默认需要同步五个索引，渠道加密与凭证回填由部署方分别启用。以下核查来自发布说明、两个发行提交的源码差异和定制分支 `83884307` 的既有契约。候选镜像、数据库、Temporal、KMS 及真实渠道均待后续验证。[官方升级说明][release] · [固定提交差异][delta]

## 渠道凭证

| 场景 | 发行代码与部署含义 |
| --- | --- |
| 沿用现有配置 | `ENCRYPTION_PROVIDER` 留空，普通旧值直接读写。启用后，仓库按字段识别 `enc:v1:`，明文、密文可以混存，空 refresh token 保持原状。仅覆盖 `Integration.token`、`refreshToken`。新连接、重连或刷新时写入的非空凭证按当前模式保存。渠道列表查询直接省略两列。[加解密服务][crypto] · [凭证写入][write] · [渠道列表][list] |
| 本地或 KMS 密钥 | `local` 从 `ENCRYPTION_KEY` 解码 32 字节。`aws-kms` 从 `ENCRYPTION_KMS_REGION` 和 `ENCRYPTION_KMS_DATA_KEY` 指定的密文数据密钥取得同样长度的密钥。授权可用 AWS 默认凭证链或显式密钥对，需有 `kms:Decrypt`。服务初始化时取密钥，进程内缓存，用 AES-256-GCM 操作两列。未知 provider 或无法加载指定密钥会阻断初始化。格式正确但内容不同的密钥可能正常启动，读旧密文时才报错。此版仅选用一个数据密钥，需保留本地原密钥或 KMS 密文数据密钥及其解密能力，丢失后相关渠道需重新授权。[密钥配置][env] · [密钥检查及读取][crypto] · [KMS 实现][kms] |
| 分阶段启用 | 先给 backend、所有 orchestrator/worker 部署同一 provider 和密钥，设 `ENCRYPTION_READ_ONLY=true`。此阶段可读已有密文，新写入仍为明文。各进程验证能读取相同样本后，移除该开关再开始写密文。已有密文时，恢复镜像也需支持该格式并持有原密钥。只关闭 provider、换成 v2.25.3 镜像或换一把新密钥都无法恢复这些凭证。[升级说明][release] · [配置判定][crypto] |
| 可选回填 | 手动从 Temporal UI/CLI 在 `main` 启动无参 `encryptTokensWorkflow`。每页按 ID 取至多 500 行，挑两列中仍有非空明文的记录，按原 token 值条件更新，写回取样的 `updatedAt`。并发刷新已改变凭证时跳过该行。逐行异常计入 `failed` 并继续，已加密字段跳过。每 100 页可 Continue-As-New。仅 ID 和计数进入该工作流。未启用加密写入时回填以不可重试错误结束。完成后查剩余明文、失败数，再跑一次应为 `changed=0, failed=0`（静止样本）。[工作流][backfill] · [活动服务][backservice] · [条件更新][backrepo] |

常规刷新也需区分失败原因。上游在 provider 刷新失败后继续处理其他渠道，只有首次设置 `refreshNeeded` 时通知。并发刷新失败可短暂等候并复用同一渠道已轮换且未过期的凭证。仓库在进入批量刷新循环前用 `Promise.all` 解密整批，一条不可解密的记录仍可能阻断该批。旧版已有的 `oneTimeToken` 同根下发也仍按 `rootInternalId` 匹配。前轮已记录其缺少组织条件，单列为已有边界。[批量刷新][batch] · [读取与下发][fanout] · [并发刷新][refresh] · [旧渠道契约][old-channel]

## 在途任务

- 两版上游的 `apps/orchestrator/src/workflows` 仅增加回填定义及其导出，既有发帖、重复执行、邮件和维护工作流定义相同。活动执行已有变化。评论、旧 `postSocial`、新 pending 路径、状态查询、finalize 和刷新在使用传入渠道前解密两列。上游本版仍把明文渠道凭证传过普通工作流，历史中仍可能有明文。两个 `PostActivity` 刷新方法遇解密错误返回 `false`。独立的 `IntegrationsActivity.refreshToken` 没有该捕获。[固定差异][delta] · [工作流导出][exports] · [活动改动][activities] · [上游作者对历史载荷的说明][pr2433]
- `IntegrationsActivity.refreshToken` 在官方 tag 仍缺 `@ActivityMethod()`。合并时保留定制分支的装饰器，同时采用上游解密调用。保留 V112 的 `post-finalize-timeout-unknown` patch 和按 `COMPAT_WORKFLOW_QUEUES` 为已有 provider 队列提供 workflow worker 的能力。上游补偿扫描会在发起任务前重查未删且仍为 `QUEUE` 的帖子。对显式支持 `refreshRepeat` 且 finalize 收到 `RefreshToken` 的渠道，活动内可刷新后再调用一次。结果未知、等待中和已被平台拒绝的情形要分别对账。[上游刷新注册][reg] · [扫描与重试][postact] · [有效帖子条件][state] · [定制维护契约][maintenance] · [定制故障契约][fault]

## 启动与索引

发行说明列出的五个普通索引与 schema 差异一致。Post 新增 `(organizationId, publishDate)` 和 `(publishDate, state, deletedAt, parentPostId, integrationId, organizationId, creationMethod)`，Notifications 新增 `(organizationId, createdAt, deletedAt)`，User 新增 `(providerId, providerName)`，Errors 新增 `(createdAt, platform)`。两版 schema 无其他变更。官方 Docker 启动链在 PM2 应用前运行 `pnpm run prisma-db-push`，独立部署执行同一根脚本。大型 Post 表建索引期间写入会等待，切换窗口应计入实际样本上的建索引时间和锁等待。[官方升级说明][release] · [固定提交差异][delta] · [Prisma schema][schema] · [官方启动脚本][scripts]

## 候选版本验收

1. **先按现网配置启动。** 在隔离 PostgreSQL 15 上，对定制 v2.25.3 合成旧库实跑根镜像及专用镜像入口。构建/安装只生成客户端。启动时使用镜像内锁定 CLI 同步，成功再启 API/worker。连接失败或同步失败须非零退出。保存前后五项索引定义及列序、行主键与原列摘要、组织成员/渠道、帖子/媒体引用和凭证对比。再启动应幂等。失败时检查实际结构及锁等待，沿用原数据保留与恢复口径。[启动同步契约][startup]
2. **保留旧绑定。** 在关闭加密时验证旧 Instagram 单 token/组合格式、Skool 旧 JWT/新格式、定制版六个可添加渠道及另一个历史渠道。跑页面、公开 API、账号/页面选择、刷新、重连、发布。检查组织、渠道 ID、root/page 与有效期，同账号跨组织和多页样本有独立账目。普通失败只通知一次，后续渠道继续。并发刷新复用获胜结果。平台替身只比对凭证语义，证据中不写凭证。[旧渠道契约][old-channel] · [并发刷新][refresh]
3. **实际接续。** 用候选 bundle 回放 v2.25.3 定制历史及既有更早 fixture，然后切换存有睡眠排程、重复子任务、延迟评论和积压刷新的隔离 worker。核对原 namespace、workflow ID/type、队列、搜索属性和业务 ID。旧 V101/V102 阻塞返回、新 V112 pending/check/finalize、兼容队列及邮件/维护任务都需有真实活动消费记录。让扫描期间状态改变、删除及 finalize 带 heartbeat 超时的样本入场，核对数据库、历史和平台替身的调用次数与结果未知标记。[历史回放][replay] · [排程接续][schedule] · [维护任务][maintenance] · [故障恢复][fault]
4. **仅在评估启用加密时扩展矩阵。** 先只读、后写入，分别从 backend 与 worker 读取旧、混合及加密记录。核对数据库两列、列表字段、跨重启解密和平台替身所见凭证，覆盖刷新并发回填、空值、重跑、坏密文/错密钥及恢复原密钥。用同一可解密候选对齐数据库、媒体及 Temporal 快照。用已知外部调用账目识别未知结果。按所选 provider 验证本地密钥或实际隔离 KMS 解密授权。试验全用合成凭证。[加解密服务][crypto] · [回填更新][backrepo] · [旧恢复契约][fault]

[release]: https://github.com/gitroomhq/postiz-app/releases/tag/v2.26.0#upgrade-notes
[delta]: https://github.com/gitroomhq/postiz-app/compare/a5affe62c74e39c1e7ac960d50d8418b807d532c...132859f32d854830ce44b509da87409c3ec10a77
[crypto]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/services/encryption.service.ts#L13-L183
[write]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts#L375-L471
[list]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts#L673-L689
[env]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/.env.example#L58-L82
[kms]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/encryption/aws.kms.provider.ts#L4-L41
[backfill]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/orchestrator/src/workflows/encrypt.tokens.workflow.ts#L4-L45
[backservice]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#L848-L891
[backrepo]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts#L1066-L1132
[batch]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts#L346-L385
[fanout]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts#L442-L486
[refresh]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts#L85-L157
[exports]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/orchestrator/src/workflows/index.ts
[activities]: https://github.com/gitroomhq/postiz-app/commit/132859f32d854830ce44b509da87409c3ec10a77
[pr2433]: https://github.com/gitroomhq/postiz-app/pull/2433
[reg]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/orchestrator/src/activities/integrations.activity.ts#L15-L29
[postact]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/apps/orchestrator/src/activities/post.activity.ts#L116-L324
[state]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts#L89-L100
[schema]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/libraries/nestjs-libraries/src/database/prisma/schema.prisma
[scripts]: https://github.com/gitroomhq/postiz-app/blob/132859f32d854830ce44b509da87409c3ec10a77/package.json#L16-L39
[startup]: ../../postiz-stable-merge-implementation/issues/03-startup-sync-data-retention.md
[old-channel]: ../../postiz-stable-merge-implementation/issues/09-existing-channel-credentials.md
[replay]: ../../postiz-stable-merge-implementation/issues/14-temporal-history-replay.md
[schedule]: ../../postiz-stable-merge-implementation/issues/15-scheduled-post-continuity.md
[maintenance]: ../../postiz-stable-merge-implementation/issues/16-recurring-maintenance-workers.md
[fault]: ../../postiz-stable-merge-implementation/issues/17-fault-recovery.md
