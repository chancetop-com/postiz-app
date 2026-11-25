# Postiz 媒体直传 Azure Blob Storage

Labels: wayfinder:map
Status: resolved
Resolved: 2026-11-25

## Destination

为 Postiz 增加可选的 `azure` 存储方式，明确浏览器直传、媒体登记、所有已注册发布渠道对媒体库图片和视频的处理，以及 dev 移除上传盘后的运行条件。

## Notes

- 后续写入 `fbr-env-project` 时按 [dev 环境仓库待办](issues/02-environment-and-urls.md#dev-环境仓库待办)执行。
- 浏览器先向 Postiz 后端申请临时上传地址，再把文件直接写入 Azure。确认后，持有读取链接的人可以预览文件，发布进程也可以使用该链接。Azure 的媒体处理以 R2 关闭上传后通用转码时的行为为准。网页主上传器按已有开关决定是否压图，Azure 保存上传器实际提交的文件，发布时按各渠道规则准备附件，自动图片处理由默认开启的总开关控制。
- 用户已明确放弃旧本地媒体的迁移和访问兼容。引用旧 `/uploads/` 文件的预览和排程可能失效；首版只验收新写入 Azure 的附件。
- 网页范围包括主上传器，以及目前单独发送文件的缩略图和设计器。缩略图只需返回地址，设计器需要返回媒体记录。公开 API 的 multipart 上传、URL 导入和后台生成媒体有独立调用方，实施时要保留其既有请求与响应，并让新文件进入所选存储。[主上传器](../../apps/frontend/src/components/media/new.uploader.tsx) · [缩略图](../../apps/frontend/src/components/launches/helpers/media.settings.component.tsx) · [设计器](../../apps/frontend/src/components/launches/polonto.tsx) · [公开 API](../../apps/backend/src/public-api/routes/v1/public.integrations.controller.ts)
- FBR 的 AM 媒体库提供了浏览器上传视频的参考。FBR 的社交媒体内部接口另有申请和确认协议，可供比较。部署配置放在 `fbr-env-project`。现有 dev 清单已加载 `postiz-config` 和 `postiz-secret`，Azure 资源以同一环境仓库的 Terraform 为参考。[FBR 浏览器上传](</Users/chancetio/Desktop/Java/fbr-project/frontend/am-console-site-frontend/src/util/media-upload.ts>) · [Postiz dev 清单](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/postiz/04-postiz.yml>)
- 验收应在未挂载上传盘的 dev Pod 中覆盖每种支持的媒体类型、上传中断后重试和持链接预览。用同一组图片和视频对照相同压图配置下的 R2 行为。核对上传器实际提交的内容与各自公开地址读回的内容，并核对各渠道按附件类型生成的发布请求。真实发布验收由用户自行安排。
- Azure 接入并验证完成后，再向用户交付需要其亲自操作的事项。按实际环境列明操作对象、动作和完成标志；若全部已处理，直接说明无需后续操作。

## Decisions so far

- [由 Postiz 还是 FBR 签发并确认上传](issues/01-upload-authority.md#answer) — Postiz 按组织签发并确认上传，浏览器用微软 Azure SDK 直传，同次上传的分片重试与 R2 对齐。
- [dev 的 Azure 存储目录、媒体域名和凭据如何配置](issues/02-environment-and-urls.md#answer) — 复用 `fbrdevstorage` 账户，另建与 `static` 并列的 `postiz` 容器，按 `dev/<merchantId>/<文件名>` 分目录，从 Blob 源站直接读取，Azure 模式卸载媒体上传盘。
- [发布 Azure 媒体时由社媒拉取还是由 Postiz 上传](issues/03-social-media-delivery.md#answer) — 全部 35 个渠道按发布接口和附件类型固定传输方式：支持 URL 拉取就提交 Blob 源站地址，仅支持上传字节时才由 Postiz 上传。域名验证属于部署配置。
- [首版要适配和验收哪些发布平台](issues/04-platform-scope.md#answer) — 覆盖后端全部 35 个发布渠道的代码适配与回归，真实发布验收由用户负责。
- [如何控制各渠道发布前的自动图片处理](issues/05-publish-image-processing.md#answer) — 全部渠道共用一个默认开启的发布开关，关闭时直接使用入库图片。

### 实施工单与 Blob 源站验收

dev 的持久地址为 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<merchantId>/<文件名>`。以 `fccf04dd` 为需求变更前的基准，06、11、14、15、16、18、19 当时已合并，07、10、12、13、17 正在开发。下表可从工单追溯直接使用 Blob 地址或读回字节的本地验收。平台请求使用模拟端，真实账号发布由环境负责人执行。

| 工单 | 按新路径复核的结果 |
| --- | --- |
| [06 公开 API](issues/06-public-api-azure-upload.md#answer) | 从 multipart HTTP 响应中的地址匿名读回同一对象，核对组织、类型、字节与上限。另测源站 URL 编码及去除 SAS。[上传](../../tests/azure-public-api-upload.test.ts) · [源站地址](../../tests/azure-blob-origin.test.ts) |
| [07 主上传器](issues/07-browser-direct-upload.md#answer) | 浏览器直接创建当前商户目录的最终 Blob。并发确认返回同一记录，授权到期后最终地址仍返回原始字节。[直传与确认](../../tests/azure-direct-upload.test.ts) |
| [08 分片重试](issues/08-browser-block-retry.md#answer) | 5 MiB 分界和 503 重试经过真实浏览器验证。两种压图设置分别对照 Azure 与 R2 的实际提交及读回摘要。[分片](../../tests/azure-browser-block-retry.test.ts) · [R2 对照](../../tests/azure-browser-r2-parity.test.ts) |
| [09 封面与设计器](issues/09-thumbnail-designer-upload.md#answer) | 截帧和选取封面返回最终 Blob 地址。设计器返回已确认的媒体记录，失败时编辑内容保留。[编辑器](../../tests/azure-editor-upload.test.ts) |
| [10 导入与生成](issues/10-import-generated-media.md#answer) | URL 导入、后台生成、旁白和头像将组织传至写入点，按返回地址读回文件。[服务端入口](../../tests/azure-generated-media.test.ts) |
| [11 X](issues/11-x-publish-image-processing.md#answer) | 从 Blob 读取普通帖、文章图片和视频，按开关核对发给 X 的格式、字节和分段。[X](../../tests/x-publish-image-processing.test.ts) |
| [12 LinkedIn、Bluesky](issues/12-linkedin-bluesky-media.md#answer) | 核对两种 LinkedIn 身份、图片与 PDF、视频分段，以及 Bluesky 的原图、缩放和视频任务标识。[发布回归](../../tests/linkedin-bluesky-media.test.ts) |
| [13 TikTok](issues/13-tiktok-azure-publish.md#answer) | 照片、视频、封面及组织内 JPEG 副本使用 Blob 地址。检查普通版和 Business 请求、前缀错误及沿用已受理的发布标识。[TikTok](../../tests/tiktok-azure-publish.test.ts) |
| [14 Meta、Google](issues/14-meta-google-media-urls.md#answer) | 两种 Instagram、Facebook、Threads 与 Google Business Profile 的请求包含正确的源站图片、视频或封面字段。[平台请求](../../tests/azure-meta-google-media.test.ts) |
| [15 YouTube、Reddit、Pinterest](issues/15-youtube-reddit-pinterest.md#answer) | 捕获视频续传区间、封面、文件字节与返回的媒体 ID，核对使用 URL 的图片字段。[视频和封面](../../tests/azure-youtube-reddit-pinterest.test.ts) |
| [16 消息与回复](issues/16-messages-embedded-media.md#answer) | Slack、Telegram、Lemmy、Farcaster 与 Nostr 的消息块、签名内容及回复引用持久地址。[消息](../../tests/azure-message-media.test.ts) |
| [17 原生附件](issues/17-discord-mastodon-vk-dribbble.md#answer) | Discord、Mastodon、VK 与 Dribbble 从 Blob 读取附件，核对平台收到的字节、标识和处理状态。[附件](../../tests/azure-channel-attachments.test.ts) |
| [18 社区帖子](issues/18-whop-skool-mewe-tumblr.md#answer) | 核对 Whop、Skool、MeWe、Tumblr 的附件内容、长度、类型、回复及拒绝结果。[社区附件](../../tests/azure-community-attachments.test.ts) |
| [19 文章、邮件、文字](issues/19-articles-email-text.md#answer) | 正文保留源站链接，WordPress 特色图片引用上传返回的 ID，纯文字渠道无需读取附件。[文章与邮件](../../tests/azure-article-email-text.test.ts) |
| [20 dev 交接](issues/20-operator-runbook.md#answer) | 手册列出容器匿名读权限、Blob CORS、TikTok 前缀验证及保留 PVC 和退役磁盘的两次切换。[操作手册](dev-runbook.md) |

网页沿用 FBR 的最终地址直传方式。申请只签发限创建的 SAS，上传完成后校验同一 Blob，再写入现有 `Media` 表。Prisma schema 与 main 一致。[直传实现与验收](issues/07-browser-direct-upload.md#answer)

此前的集成代码 `66087c1c` 使用真实 Chromium 和临时 PostgreSQL 运行了 90 个测试文件，1,096 项全部通过，含 1 GiB 上传边界。前端、后端和发布 worker 的生产构建通过。dev 资源配置、无盘 Pod 验收、渠道实发和旧盘回收由环境负责人按手册执行。

## Not yet specified

平台范围和媒体处理基准已确定。目前没有待定的规划问题。

## Out of scope

- 代用户向社媒真实发帖或核验普通 TikTok 应用后台的域名状态。普通 TikTok 的交付内容为 [dev 环境配置说明](issues/03-social-media-delivery.md#普通-tiktok-的-dev-配置交接)。
- 迁移历史文件、维持旧本地媒体链接、修复引用旧附件的帖子或批量清理数据库记录。
- Azure 入库后通过通用媒体处理任务重新编码图片或转码视频。
