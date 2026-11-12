# Temporal 升级只读证据（2026-11-11）

本文件是 [决定现有数据与 Temporal 任务的兼容升级路径](../issues/08-data-temporal-upgrade.md) 的事实调查与建议输入，不解决该票，不代表已经合并、replay、启动 worker 或完成线上兼容验证。没有连接 Temporal/数据库/集群，没有读取 Secret，没有重启、终止或重建真实任务。核查使用 CodeGraph 定位当前源码，再使用显式 `git show/diff <revision>:<path>` 比较历史版本；缺失的公开上游 Git 对象经只读获取补齐。

- C：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`。
- S：`a5affe62c74e39c1e7ac960d50d8418b807d532c`（已锁定稳定版 v2.25.3 的 commit；本地没有同名 tag）。
- 下文 `C:path:L` / `S:path:L` 是对应 revision 的源码行号；工作区仍为旧代码，不能拿工作区同一行代替 S 证据。
- 源码比较覆盖 orchestrator/temporal 全部变更文件及已定位的 post、autopost、refresh、email、notification、media、clipping 客户端路径。没有凭该比较断言不存在外部创建的 Temporal Schedule 或其它任务。

## 1. 核心结论及边界

可选保守路线是：保留旧 workflow type 与活动契约，让已有执行继续；新发布任务采用 S 的 V112；保留 namespace、workflow ID、搜索属性和队列的连续性。无需为了源码升级默认清空 Temporal、终止旧排程、批量重建任务或升级 Temporal Server。

理由是 S 已保留 V101/V102，且两个文件与 C 的 blob 完全相同。但共享活动、依赖、worker 注册和其它同名 workflow 已有变化，所以“文件没改”不等于整个发布 flow 已验证。实际部署镜像来源未知，C 构造历史只能证明 C→候选兼容，不能替代真实部署版本的历史验证。

无证据表明必须改变已确定的商户使用 flow 才能升级。本文件中的残余重复发布风险是验证与交接项；不是授权新增全局幂等系统、另起新 workflow 版本或修复所有异常分支。只有执行阶段证明候选破坏既定 flow，才做针对性的兼容适配。

## 2. Workflow 的保留与变化

| 范围 | C → S 事实 | 源码依据 |
| --- | --- | --- |
| 旧帖子类型 | `postWorkflowV101`、`postWorkflowV102` 原文件不变，继续导出；新增 V103–V112，未用最新实现覆盖旧名称 | `apps/orchestrator/src/workflows/index.ts` C:1–8 / S:1–21；V101 blob `b8fce6acbcbd9726ea66a09389f051ad25487bd2`，V102 blob `65fea772ca01a0ae2e952d360e1e96e4fc90afaf`，两版本相同 |
| digest / refresh | `digestEmailWorkflow`、`refreshTokenWorkflow` 文件完全不变 | digest blob `db746036f620a5ee7c372b2ef2ea9fbe3aa01594`；refresh blob `dc189ff0833e8eba1deb1e8e3952fdfd391aebc8` |
| autopost | 原同名 workflow 增加 `patched('autopost-continue-as-new')`，24 个 live loop 或 historyLength >1000 时 Continue-As-New，保留 id、immediately=true | S:`apps/orchestrator/src/workflows/autopost.workflow.ts`:20–48；C:14–30 |
| missing sweep | 同名 workflow 用 `patched('missing-post-continue-as-new')`，同样限历史；新 run 立即执行 sweep，维持小时节奏 | S:`apps/orchestrator/src/workflows/missing.post.workflow.ts`:19–35；C:13–23 |
| streak | 旧 `streakWorkflow` 保留，加入 `reminder`、`streak-last-post` patch；满足最近发布时间条件时 Continue-As-New 至新增 `streakWorkflowV2`。V2 检查最近发布时间，最多30次检查后 Continue-As-New | S:`apps/orchestrator/src/workflows/streak.workflow.ts`:19–118 |
| 旧邮件队列 | `sendEmailWorkflow` 函数体保留，包括 `sendEmail` signal、main 活动队列、700ms节流、每30封 Continue-As-New；新邮件不再写入这个 singleton | C:`apps/orchestrator/src/workflows/send.email.workflow.ts`:22–61；S:42–81 |
| 新邮件 | 新增 `sendSingleEmailWorkflow`，top→`email`，bottom→`email-bulk`，一封一个 workflow | S:`apps/orchestrator/src/workflows/send.email.workflow.ts`:21–37 |
| 新媒体能力 | 新增 `generateVideoWorkflow`、`processMediaWorkflow`、`clippingWorkflow`、`clippingClipWorkflow`，均保留在导出文件中 | S:相应 workflow 文件；generate:14，process:39，clipping:114/154 |

旧重复帖子不是“等这一轮完成就全部 drain”。V102 的下一次重复明确 `startChild(postWorkflowV102, ...)`，`parentClosePolicy: 'ABANDON'`，随机后缀 ID，`postNow: true`（C/S:`post.workflow.v1.0.2.ts`:388–407）。V112 也继续自身版本（S:`post.workflow.v1.1.2.ts`:706–725）。旧重复链可以长期继续产生旧类型；不能只因切换新入口，就删掉 V101/V102。

## 3. 发布客户端、身份和信号契约

帖子启动前后只有入口类型改变，核心标识保留：

```ts
// C: libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:709–718
.workflow.start('postWorkflowV102', {
  workflowId: `post_${postId}`,
  taskQueue: 'main',
  workflowIdConflictPolicy: 'TERMINATE_EXISTING',
  args: [{ taskQueue: taskQueue, postId: postId, organizationId: orgId }],
// S: 同文件:972–981，同样字段，类型改为 postWorkflowV112
```

- 业务排程的已查实现是 workflow + durable sleep，不能等同于 Temporal Schedule 对象迁移。post 参数始终为 `{ taskQueue, postId, organizationId, postNow?: boolean }`（V102:51–61；V112:120–130）。
- 根 workflow 在 `main`，provider 队列放在参数中用于发布活动。常规创建从 providerIdentifier / settings.__type 的 `split('-')[0].toLowerCase()` 得到队列。重复 child 没有显式换 taskQueue，继承父队列。
- `organizationId` / `postId` 搜索属性仍为 TEXT；`temporal.search.attribute.ts`:6–14 未改。根 start 设置两者，repeat child 显式设置 postId，不能只查 organizationId 就认定已找到全部重复链。
- 丢失任务补扫：C `PostActivity.searchForMissingThreeHoursPosts` 启动 V102；S:116–147 启动 V112；均 `signalWithStart` + `USE_EXISTING` + `post_${id}` + `poke`。正在运行的同 ID 执行被 signal，不因 type 字符串变为 V112 就被自动换类型。
- `poke` 在 V102:47/74–77、V112:114/147–150 注册；函数内仅将本地 `poked` 设为 true，无其它读取。不能把它描述为强制唤醒 sleep 或重新发布。
- 删除/改期仍先列出 `postId=... AND ExecutionStatus="Running"`，逐项 `terminate()`，吞掉异常，再按状态决定是否启动。C `PostsService`:635–731；S:896–995。改期 S:1409–1445；`action='update'` 不重启。DRAFT 路径会终止已有匹配执行然后返回。
- S 增加对已 PUBLISHED 内容的显式 republish 防护（S `PostsService`:1119–1145，createPost:1157起，changeDate:1418–1420）；这不是给所有副作用提供幂等保证，`changePostStatus`:1384–1406 仍直接换状态再 start。
- autopost ID 仍 `autopost-${id}`，args `{id, immediately:true}`，main；S 新增 `USE_EXISTING` 与 `return await`，启动异常不再跌入终止分支。停用/删除仍 terminate（S `autopost.service.ts`:103–137）。
- refresh ID 仍 `refresh_${id}`，args `{integrationId, organizationId}`，main，`TERMINATE_EXISTING`（C/S `refresh.integration.service.ts`:56–69）。
- digest ID 仍 `digest_email_workflow_${orgId}`，signal `email`，signalArgs 为 Email[]，main，`USE_EXISTING`（`notification.service.ts`:54–79，C→S无差异）。
- 邮件客户端 C `email.service.ts`:44–54 使用 `signalWithStart('sendEmailWorkflow', {workflowId:'send_email', signal:'sendEmail', ...})`；S:49–55 使用 `start('sendSingleEmailWorkflow', {workflowId: 'send_email_'+randomUUID(), args:[email], taskQueue:'main'})`。保留旧队列执行直至积压处理完；代码在空队列上继续等待，不会自动关闭这个旧 singleton。
- 新媒体 ID/参数：`media_${id}` / `{mediaId}`（S media.service.ts:202–212）、`video_${org.id}_${makeId(10)}` / `{organizationId,body}`（588–604）、`clipping_${id}` / `{clippingId}`（S clipping.service.ts:275–285），均 main。

## 4. V103–V112 为什么要保留各自定义

这些版本改变了产生的活动、timer、child 命令；不能把同名旧 workflow 的 body 替换成新版。

| 新版本 | 相对前一版本的关键变化 |
| --- | --- |
| V103 | 无效帖子、refreshNeeded、disabled 分支写 ERROR（新 activity commands）。 |
| V104 | 将无帖子与非 QUEUE 分支分开，修复无帖子时读取首元素。 |
| V105 | 先 `getPost` 查轻量排程信息，sleep 后 `getPostsList` 读发布内容；C V102 在 sleep 前已读完全部内容。 |
| V106 | 新增 pending publish、checkPostStatus、finalizePost；最多90次检查/20秒timer；发布/finalize 的 SDK maximumAttempts=1；区分 posted/updated，防止后续失败重新发布；超时结果不明时标记 ERROR/通知核实。 |
| V107 | comment 和 mutation 30分钟 StartToClose + 3分钟 heartbeat；comment仍3次 SDK尝试。 |
| V108 | heartbeat timeout 放宽到10分钟。 |
| V109 | 移除上述 heartbeat timeout；保留30分钟 StartToClose。 |
| V110 | repeat 的 startTime 改在排程 sleep 之后计时，避免把等待排程时间从重复间隔中扣掉。 |
| V111 | 恢复3分钟 heartbeat；comment SDK尝试改为1；以计时窗口推断“未开始”并重试。 |
| V112 | “未开始”判断改为 heartbeat timeout 且没有 lastHeartbeatDetails。 |

依据：S 各 `apps/orchestrator/src/workflows/post-workflows/post.workflow.v*.ts` 相邻完整 diff；最新代理定义 V112:29–111，错误分类:250–292，发布循环:426–591，repeat计算:623–633。

## 5. 共享 Activity 与 payload 兼容

旧 PostActivity 的全部16个公开活动名称都保留；EmailActivity 的 sendEmail/sendEmailAsync/getUserOrgs/setStreak 保留，新增 getLastPublishDate。新增 getPost、postSocialPending、checkPostStatus、finalizePost 不替换旧名称。

```ts
// S: apps/orchestrator/src/activities/post.activity.ts:260–272
async postSocial(integration: Integration, posts: Post[]) {
  return this.postSocialInternal(integration, posts, false);
}
async postSocialPending(integration: Integration, posts: Post[]) {
  return this.postSocialInternal(integration, posts, true);
}
```

此处保留旧 `postSocial` 阻塞语义，只有新活动允许返回 pending。旧 V101/V102 对 `PostResponse` 的 id/postId/releaseURL/status 消费不能直接换为 pendingData 路径。

- `getPostsList` C返回完整递归Post[]；S:174–196 经 `slimPost`（33–58）移除 error、childrenPost、tags、description/title、订单提交字段、parentPostId、deletedAt、createdAt/updatedAt、comments/errors等。保留旧 workflow 所读的 id/content/settings/image/delay/intervalInDays/publishDate/state/integration 等字段。旧历史内已完成活动结果仍是旧 payload；尚未执行/重试活动会得到新 payload，必须双向样本验证。
- S `reanchorInterval`（post.activity.ts:62–94）只对 intervalInDays 且 QUEUE 的旧锚点起作用；迟到超过2小时则将返回的 publishDate 滚到下一网格时间。它不直接修改数据库。PUBLISHED 的 postNow repeat child 不被重锚。旧 V102 若已记录 getPostsList 结果并处于 sleep，不会重算那次已记录结果。
- updatePost、inAppNotification、changeState、processInternalPlug 的活动结果由返回服务对象变为 await 后 undefined；V101/V102 对这些调用不读取返回值，属于可兼容候选，但仍纳入 replay/活动契约验证。processPlug 的布尔返回仍保留。
- 老 Integration/Post 参数从历史中进入新活动与provider，TypeScript类型不构成旧payload运行时兼容证明。需覆盖旧token/settings/image格式、字段缺省及已存媒体路径，不能只测新建记录。
- 新共享发布活动增加 withHeartbeat、Disconnect→BadBody，PublishedWithError 先保存远端 release 信息再以 BadBody 返回；新增 subscription复查、媒体和内容适配。旧活动签名保留不意味着 provider行为未变。
- C `postSocial` 在远端发出后启动 streak，失败会让整个发布活动失败；S:415–438 对 streak 启动做 best-effort，使用 V2 + USE_EXISTING，减少已发布后重复尝试。S sendWebhooks:509–552 同样 best-effort，并改变实际webhook取数/SSRF约束。这些都不能由纯 workflow replay 验证远端副作用。
- refreshToken 与 refreshTokenWithCause 仍保留；refresh服务增加错误原因记录/通知去重，token写入和provider reConnect仍是活动执行时行为。测试应验证旧凭证续期和失败标记，不重写身份/渠道ID。

## 6. Worker、SDK 与 Server 假设

- C和S的5个直接 Temporal SDK 包锁定值均 **1.15.0**；`package.json` 声明仍 `^1.14.0`。C lock:175–189，S lock:189–203。nestjs-temporal-core 均 **3.2.3**（C lock:460–462；S:477–479），但 peer解析从 Nest10.4.22/reflect-metadata0.1.14 变为 Nest11.2.7/0.2.2，worker打包依赖也变化。不能从版本号相同推出二进制/配置相同。
- 地址、TLS、API key、namespace默认值没有改变：TEMPORAL_ADDRESS 或 localhost:7233；TEMPORAL_NAMESPACE 或 default（C temporal.module.ts:9–18；S:27–39）。没有看到新增 dataConverter/codec 配置；不能推断外部运行环境没有自定义设置。
- C 对 main 和每个未带 `-` 的provider队列都设置 workflowsPath（temporal.module.ts:21–39）；S **只在main设置 workflowsPath**，其它是 activity-only（S:41–79）。按已查客户端和child继承规则，C正常业务workflow都在main；若实际历史存在provider队列上的workflow，新布局将没有对应workflow poller，必须保留那个队列的workflow注册/兼容worker，而不是改写历史队列。真实任务分布未知，不能提前宣布该条件不存在。
- S 新增 `EXCLUDE_QUEUE` 与 `WORKER_CONCURRENCY_DIVIDER`；单worker默认空/1即可保留队列。有限provider并发除以divider、向下取整且至少1；小于worker数的限额不能仅靠divider保证总额，需要排除/固定所属worker。该机制不需要本次主动扩容或改拓扑。
- S main/无上限provider设置 `maxConcurrentActivityTaskExecutions:1000000`，heartbeat throttle 15s；email/email-bulk活动worker分别全队列每秒3/2、每worker并发10（S:68–95；email.queues.ts:7–12）。不能把单次本地功能通过当成容量证明，也不能误把email-bulk中的`-`当成被provider过滤规则自动排除——它们是单独追加的workers。
- `app.module.ts` C:10–16 注册 AutopostService；S:14–22 改为 AutopostActivity并新增 Video/Media/Clipping活动。AutopostActivity的autoPost存在于两版本但C未在此清单注册；S修正注册，不能据C源码声称实际旧环境autopost一定运行成功。
- `main.ts`:15 两版本均 enableShutdownHooks；这只是代码钩子，不证明现有PM2/容器终止宽限足够。活动开始到外部发布完成的终止演练仍需单独做。
- 搜索属性注册模块未改，非TLS时 onModuleInit 会调用 operatorService添加缺失组织/帖子属性；TLS时跳过（temporal.register.ts:9–35）。因此未来启动测试要用隔离namespace/服务；启动不是无副作用探针。属性有名称但类型错误的情况并不由这段代码修复。
- 已知部署清单只有 Temporal `latest`，不是实际Server版本。没有从此次源码变化得到必须升级Server的结论；不把应用升级与Server存储schema升级绑在一起。未来记录实际版本/镜像digest，核对现有功能支持，再决定独立Server维护路径。

## 7. 重复发布、取消与回退风险（事实与推论分开）

1. **已存在的基线风险**：C V102发布/comment活动 maximumAttempts=3，10分钟StartToClose；外层还有5次尝试（V102:19–28、49、135–239）。远端成功但活动完成未写入Temporal、updatePost失败或通知失败，可能触发重复发布。普通启动/改期又使用 TERMINATE_EXISTING。不能声称原系统exactly-once，也不以本轮无限修复既有异常行为为范围。
2. **S的改进**：V106+将主发布/finalize SDK尝试改1，并将成功后后续处理与重发分开；V111+comment也为1。数据库标记/通知仍可能同时失败，结果未知不能自动当作未发。
3. **S残余风险**：V112:271–276在 heartbeat timeout 且 `!lastHeartbeatDetails` 时返回retry；withHeartbeat:42–79只在15s定时器tick发送第一次heartbeat，入口只在本地记录details。因此“没有heartbeat”也可能是已发出远端请求后、第一条heartbeat之前进程退出，或heartbeat未成功到Server；它并不证明从未发布。此为代码推论，未做故障注入。相对C的更激进重试，尚不能据此认定破坏既定完整flow或要求另起V113；保留上游并把该场景列入风险与验证。
4. **terminate不等于撤销远端请求**：已发到社交平台的操作不会因workflow terminate而回滚；新withHeartbeat也没有提供外部HTTP事务撤销。升级方案不得靠“终止后重建全部排程”消除兼容问题。取消与活动停止需分别核验，尤其repeat child为ABANDON。
5. **旧包不是通用回退包**：新V112、新媒体workflow、新邮件queue以及旧同名workflow新增patch/Continue-As-New一旦产生历史，旧C worker未注册新类型或不具备patch逻辑。不能简单将应用镜像回退C就宣称Temporal可恢复。应准备仍支持全部已产生workflow类型/patch/活动payload的候选回退worker；纯历史回退也不能撤销已经发布的社交内容。

## 8. 建议的执行和验证路线（尚未执行）

1. 保留S导出的所有历史workflow类型和旧活动名，接纳S新任务入口。不要将已存在post ID/组织/渠道ID重新编号，不自动把旧工作流转换成最新类型，不批量重建队列。保留旧repeat链及旧email队列。
2. 按用户调整后的 [官方数据库升级方式](../issues/08-data-temporal-upgrade.md#已明确的官方数据库升级方式)，先在隔离副本验证启动前 db push，同步成功后才让候选worker执行会写数据库的活动；不交付独立迁移脚本。保留Temporal现有namespace/历史/搜索属性，不以重建应用数据库替代Temporal持久化保护。
3. 用C构建生成不含真实凭证的fixture历史，使用最终候选bundle离线replay；同名patched workflow覆盖旧分支和新marker；旧V101/V102、repeat child、待发布sleep、延迟comment、token-refresh、插件阶段都需要样本。保存产生fixture的commit/lock/bundle和replay结果，避免只写“replay通过”。
4. Replay通过后，在隔离Temporal、数据库副本/脱敏fixture与stub provider上运行活动/整条flow。验证一次外部调用与正确DB状态、URL、下一次重复日期；读取旧payload和新payload两套数据。Replay不会实际证明provider幂等、token可用、网络响应或媒体可读。
5. 不默认等所有workflow drain：repeat/refresh/autopost/digest可长期存在。未来实际切换宜让进行中的外部发布活动有明确结束/结果核验窗口，并验证shutdown；保留workflow历史由兼容worker恢复。不能把全量workflow drain当成必需前提。
6. 新旧worker不能仅靠“各自导出不同类型”在同一未版本化main队列上安全分流；本仓库未配置Worker Versioning。若实际部署历史出现不兼容分支，应先准备兼容bundle或经验证的队列/版本路由；不默认启用尚未核对Server支持的Worker Versioning。
7. 真实部署来源、实际task queue/type、search attribute类型、运行/待重试活动和真实代表性历史，留给未来用户决定上线前的只读核验。这些未知不阻止完成当前规划/本地代码验收，但不得标成已证明线上接续。

建议的本地用例清单：

- V101/V102 schedule睡眠→重启→准时发布；含旧getPostsList payload、provider token过期续期、延迟评论、内部/全局plug。
- V102 repeat child跨父执行结束继续、postId检索命中、下一轮保持旧type；V112 repeat跨长时间未来排程，检查V110后的间隔修正。
- 相同post改期、改为DRAFT、删除、仅update；分别在timer阶段与外部请求已经发出阶段执行，记录结果未知，不能用新建成功替代。
- missing sweep对已有root只signal、对缺失root启动、重复运行不无依据重建；旧锚点超过/未超过2小时、PUBLISHED repeat child分支。
- autopost旧history→patched Continue-As-New；重复激活保持同执行，关闭后无后续新增post。
- digest保留队列和email信号；旧send_email积压继续处理；新single email的两个活动队列均有poller；streak旧patch路径与V2接续。
- 所有已配置provider队列、main、email/email-bulk均有正确worker；若fixture含provider队列workflow，验证兼容注册而不是只测main。
- 远端已接收但worker退出、发布成功后DB更新失败、notification/webhook失败、heartbeat有/无details、pending check/finalize超时，核对外部调用次数和用户状态。已存在/上游残余风险与本次新回归分开报告。
- schema副本/旧媒体/旧Integration与Post payload在候选活动执行中保持可用；新媒体workflow保持配置门控，不把开通外部服务作为核心升级前置。
- 候选回退bundle识别新旧类型/patch/活动payload；C旧镜像无法接新类型的边界明确记录。

## 9. 官方文档依据与未验证事项

- [Temporal TypeScript Versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)：命令序列变化需要patch或保留旧类型；更名cutover保留两种类型与原地修改含义不同。本仓库已有这两种做法，仍应replay验证。
- [Temporal TypeScript Replay Testing](https://docs.temporal.io/develop/typescript/best-practices/testing-suite#how-to-replay-a-workflow-execution)：可用磁盘history与 `Worker.runReplayHistory` 检测非确定性，也可批量验证；本轮没有调用该API或抓取真实history。
- [Temporal TypeScript Cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation)：普通活动取消依赖heartbeat交付，取消请求与实际活动停止不是同一个时刻；ABANDON允许活动继续。源码实际多用terminate，不能据此承诺HTTP副作用回滚。

尚未验证：实际上线的app/worker/Temporal版本与digest、真实histories及队列分布、Server存储与visibility/search attributes、全部provider的幂等/取消能力、备份恢复、运行时包注册、故障注入、构建与replay结果。上述源码事实仅支持制定兼容路线，不构成上线许可。
