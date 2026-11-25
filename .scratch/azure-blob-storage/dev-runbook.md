# Postiz dev 切换 Azure Blob Storage 操作手册

环境负责人分两次修改 `fbr-env-project`。第一次上线支持 Azure 的镜像，卸载上传卷并保留 PVC，在 dev 验证新文件。第二次在验收通过后退役旧盘。下文的 dev 操作均待执行。代码回归使用本地模拟平台；各渠道应用负责人选择真实发帖的账号、样例和时间。

## 记录旧盘和部署版本

1. 保存当前镜像摘要、目标镜像摘要、dev 部署清单版本，以及原来的存储配置、卷和挂载。仅存在于旧盘的文件不在迁移范围内，卸载后引用它们的预览和排程可能失败。
2. 在同一终端执行以下只读查询。先核对集群，再记下上传 PVC 绑定的 PV 名、实际策略和磁盘完整资源 ID。确认 claim 是 `dev/postiz-uploads-pvc`、容量为 10 Gi、驱动是 `disk.csi.azure.com`。后续回收以这组身份为准。[原环境和回收约定](issues/02-environment-and-urls.md#停用和删除-dev-上传盘)

```sh
kubectl config current-context
upload_pv=$(kubectl -n dev get pvc postiz-uploads-pvc -o jsonpath='{.spec.volumeName}')
kubectl get pv "$upload_pv" -o custom-columns='NAMESPACE:.spec.claimRef.namespace,CLAIM:.spec.claimRef.name,CAPACITY:.spec.capacity.storage,POLICY:.spec.persistentVolumeReclaimPolicy,DRIVER:.spec.csi.driver,DISK:.spec.csi.volumeHandle'
upload_disk_id=$(kubectl get pv "$upload_pv" -o jsonpath='{.spec.csi.volumeHandle}')
```

## 第一次部署，保留 PVC

| 位置 | 设置与核对 |
| --- | --- |
| Azure Blob 服务 | 在 `fbrdevstorage` 账户下创建与 `static` 并列的 `postiz` 容器。确认账户允许匿名 Blob 读取（`AllowBlobPublicAccess`），容器匿名访问级别为 `blob`。持链接者能读取单个文件，列举容器需要授权。确认账户允许此版本使用的共享密钥授权，以便后端签发服务 SAS 和确认上传。所有读写都使用该账户的 Blob HTTPS 源站。 |
| Azure Blob CORS | 核对 Blob 服务的 CORS 规则覆盖来源 `https://postiz.connexup-dev.net` 的 PUT，以及预检中出现的 `content-type` 和 `x-ms-*` 请求头。网页跨域读取还需 GET、HEAD 和所用的 Range 请求头；读取响应头时按需暴露 ETag、Content-Range 及 x-ms-request-id。 |
| `04-postiz.yml` 的 `postiz-config` | 设置 `STORAGE_PROVIDER=azure`、`AZURE_CONTAINER=postiz`、`AZURE_BASEPATH=dev`。后端与 orchestrator/发布 worker 均加载这些设置。前端运行进程也要读取 `STORAGE_PROVIDER=azure`，网页上传器才会申请 Azure 授权。 |
| `postiz-secret` | 用 SOPS 读取 dev 的 `16-file-service-config.enc.yml` 中的 `data.AZURE_CONNECTIONURL`，将该账户含 AccountKey 的实际连接字符串按目标文件的 SOPS 规则保存到 `59-postiz-secret.enc.yml` 的 `stringData.AZURE_CONNECTIONURL`。检查 `secretRef` 为后端和写媒体的 worker 提供该值。前端公开运行配置只需要存储模式和压图开关；凭据仅用于服务端，仓库只提交密文。 |
| 两个独立的图片开关 | 前端进程的 `DISABLE_IMAGE_COMPRESSION` 未设置或为空时沿用网页压图，非空时关闭；GIF 和视频保留原字节。后端及 worker 的 `DISABLE_PUBLISH_IMAGE_PROCESSING` 未设置或为空时启用渠道原有的发布前图片处理，设置为 `true`、`false`、`0` 等任何非空字符串都会关闭。 |
| 上传盘 | 清单中保留 `postiz-uploads-pvc` 声明。移除 `UPLOAD_DIRECTORY`、`NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY`、挂载到 `/uploads` 的 volumeMount 和对应的 volume。 |

从 main 部署时，Azure 与 R2 使用相同的 Prisma schema。现有启动脚本仍运行 `pnpm run prisma-db-push`。若曾试部署带 `AzureMediaUpload` 表的中间版本，切换前先结束旧版上传，将需保留的旧申请表归档到 Prisma 管理范围外的数据库 schema，再运行启动同步。中间版本尚未确认的文件需重新选择，已登记的媒体可凭原 ID 和地址继续使用。

由旧版预留文件流程升级时，先完成进行中的上传，页面刷新后重新选择尚未完成的文件。已登记媒体沿用原地址。应用上述配置并部署目标镜像。等待 rollout 成功，以下 Pod 查询也须成功且输出为空。拆分部署时对独立的前端、后端和 worker 分别核对目标版本及配置。[清单及 SOPS 文件位置](issues/02-environment-and-urls.md#dev-环境仓库待办) · [镜像启动脚本](../../var/docker/entrypoint.sh)

```sh
kubectl -n dev rollout status deployment/postiz
kubectl -n dev get pods -o go-template='{{range .items}}{{$pod := .metadata.name}}{{range .spec.volumes}}{{with .persistentVolumeClaim}}{{if eq .claimName "postiz-uploads-pvc"}}{{println $pod}}{{end}}{{end}}{{end}}{{end}}'
```

## 从无盘 dev 验收新媒体

在同一个 dev 组织准备JPEG、PNG、GIF、WebP、AVIF、BMP、TIFF 各一份、一个大于 5 MiB 的 MP4 和一个由负责人控制的公开 HTTPS 图片地址。下面的 Postiz 路径都相对于 dev API 根地址 `https://postiz.connexup-dev.net/api`。

| 从实际入口操作 | 可观察到的完成标志 |
| --- | --- |
| 在网页上传图片和 MP4，观察浏览器 Network | 每个文件先通过 `POST /media/azure/uploads` 取得上传标识与最终 Blob 的 HTTPS SAS（2 小时、`sp=c`）。申请后、提交前，该公开地址应返回 404。5 MiB 以内执行 Put Blob，更大文件执行 Put Block 和 Put Block List。分块创建权限要求 Azure 存储服务版本至少为 `2026-04-06`。核对浏览器实际请求的 `x-ms-version` 及 SAS 的 `sv`。[微软 Put Block](https://learn.microsoft.com/en-us/rest/api/storageservices/put-block) · [微软 Put Block List](https://learn.microsoft.com/en-us/rest/api/storageservices/put-block-list) |
| 上传结束后查看确认和媒体库 | 浏览器向 `POST /media/azure/uploads/:id/confirm` 再次提交会话、文件名、类型、字节数和用途。确认返回的 `path` 应等于上传 URL 去掉查询串后的地址，形如 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<merchantId>/<文件名>`。媒体库出现一条 ready 记录，重复确认得到同一 ID。首次提交成功后用同一 SAS 再次 PUT 应被拒绝。提交成功但未完成确认的文件仍可在该地址匿名读取。 |
| 视频编辑器上传图片或截帧保存封面；设计器导出一张图加入帖子 | 封面确认仅返回 `{ path }` 并关联现有视频；设计器确认返回新媒体记录。两张图都可从各自的 Blob 源站地址读取。 |
| 用现有的组织 API Key 客户端上传，使用 `Authorization` 头 | `POST /public/v1/upload` 用 multipart 的 `file` 字段；`POST /public/v1/upload-from-url` 用 JSON 的 `url` 字段。两者均兼容原有的可选 `adjust`。成功为 201，媒体记录含 `id`、`path` 和 `ready` 状态，路径属于该 API Key 的组织。URL 导入使用受控的公开 HTTPS 源。 |
| 用 dev 已配置的生成能力运行一次真实任务 | 例如提交一个带旁白的幻灯片视频任务，等待 worker 完成，打开该组织媒体库的最终 MP4。生成器的旁白和成片应位于该组织的 Blob 目录。若 dev 只配置了生图，可从网页发起 `POST /media/generate-image-with-prompt`，核对返回的媒体记录及图片，并将单独 worker 视频生成记为待测。 |

逐项记录无上传卷的 dev 验收结果，再安排磁盘退役。

- 在媒体库上传全部八种格式，逐项记录媒体 ID、提交字节与匿名读回的 SHA-256。在 Chrome 打开 TIFF 的缩略图和大图，核对原件的 Content-Type 与摘要。
- 使用大于 5 MiB 的 MP4，在测试浏览器内让一个分块首次请求失败。确认 SDK 只重传该分块，进度走到完成，媒体库只有一条记录，读回摘要相同。另测持续失败时页面报错且没有登记记录。
- 在无上传卷的后端与 worker 环境运行发布回归。按下方渠道索引覆盖拉取 URL、读取字节、视频 Range 续传和封面，记录运行的镜像、结果及失败项。真实社媒发帖由账户负责人安排。
- 将上表的公开 API、第三方导入、封面、设计器和已配置的后台任务结果与上述记录一并保存。有未完成的必测入口时保留旧盘。

遇到偏差时可按入口缩小范围。主上传器支持 JPEG、PNG、GIF、WebP、AVIF、BMP、TIFF 和 MP4。授权与确认按实际提交文件执行图片 10 MiB、MP4 1 GiB 限制；开启网页压图时，应以压图后的文件核对图片摘要。Azure 入库跳过通用转码。精确边界、故障注入及同素材 R2 对照的本地结果见[公开 API](issues/06-public-api-azure-upload.md#answer)、[直传与确认](issues/07-browser-direct-upload.md#answer)、[分块重试及 R2 对照](issues/08-browser-block-retry.md#answer)、[编辑器](issues/09-thumbnail-designer-upload.md#answer)和[导入与生成](issues/10-import-generated-media.md#answer)。

### CORS、匿名读回和摘要

下面的 OPTIONS 可在写入前运行，使用 dev 网页来源与小文件 Put Blob 的代表性请求头，无需登录、SAS 或实际创建对象。Azure 返回 200，响应须允许该来源、PUT 及所列请求头。再从真实网页请求核对 SDK 实际使用的完整头列表以及成功的 PUT 和确认。若只有浏览器失败，检查账户的 **Blob 服务** CORS 规则。

```sh
curl -qfsS -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://postiz.connexup-dev.net' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type,x-ms-blob-content-type,x-ms-blob-type,x-ms-client-request-id,x-ms-version' \
  'https://fbrdevstorage.blob.core.windows.net/postiz/dev/cors-probe/sample.mp4'
```

在 Bash 或 Zsh 中将 `media_url` 设为刚确认的 MP4 的公开地址，将 `sample_mp4` 设为实际选中上传的 MP4 文件路径。以下请求均为匿名请求。HEAD 应直接返回 200、`Content-Type: video/mp4`，且 Content-Length 等于 `wc -c` 的结果。Range GET 应直接返回 206，Content-Length 为 16，Content-Range 为 `bytes 0-15/<完整长度>`。完整 GET 应直接返回 200，摘要与上传文件相同。过了申请时间 2 小时，再用原来的 `media_url` 重跑；读回无需重新签名。

```bash
(
  set -e -o pipefail
  : "${media_url:?请设置确认返回的 MP4 地址}" "${sample_mp4:?请设置原 MP4 文件路径}"
  wc -c < "$sample_mp4"
  curl -qfsSI "$media_url"
  curl -qfsS -D - -o /dev/null -H 'Range: bytes=0-15' "$media_url"
  expected=$(shasum -a 256 < "$sample_mp4")
  actual=$(curl -qfsS -D /dev/stderr "$media_url" | shasum -a 256)
  test "$actual" = "$expected"
  printf 'SHA-256 一致 %s\n' "${actual%% *}"
)
```

同一文件的匿名读取通过后，确认下面的无凭据列表请求得到 4xx（如 403 或 404）。200 表明容器可被匿名列出，应复核 `postiz` 的访问级别。如果单个文件也不能匿名读取，请先核对账户的公共读取设置、容器访问级别、组织目录及已确认的文件地址。

```sh
curl -qsS -o /dev/null -w '%{http_code}\n' \
  'https://fbrdevstorage.blob.core.windows.net/postiz?restype=container&comp=list&maxresults=1'
```

## 渠道交接

**普通 TikTok 的 URL 所有权由实际发布应用的负责人验证。** 在该应用的 **URL properties → Verify properties → URL prefix** 填 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/`，保留末尾斜杠。下载该应用生成的验证文件，按原文件名和原文放到 `postiz` 容器里的 `dev/<验证文件名>`。匿名 GET `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<验证文件名>` 应无跳转直接返回 200 和相同内容，再点击 **Verify**，以该应用显示此前缀已验证为准。若发布返回 `url_ownership_unverified`，核对应用、前缀和验证文件。已受理的请求按原发布 ID 跟踪处理状态。普通版图片和视频在直发和收件箱模式均走 `PULL_FROM_URL`；Business 使用自己的 URL 字段。[普通 TikTok 交接说明](issues/03-social-media-delivery.md#普通-tiktok-的-dev-配置交接)

### 发布回归索引

下表覆盖后端注册的 35 个标识，包括同品牌的不同接入和 dev 未绑定的渠道。编号链接到该工单的实测结果，右栏链接到检查平台实际收到的 URL、字节或文字的本地测试。真实发帖时由负责人记录渠道、形式、平台返回的标识及最后可见的附件；文字渠道验证消息和回复。[后端注册表](../../libraries/nestjs-libraries/src/integrations/integration.manager.ts) · [逐渠道矩阵](issues/04-platform-scope.md#各渠道的改动与验收)

| 工单 | 后端标识 | 实际发布边界 |
| --- | --- | --- |
| [11](issues/11-x-publish-image-processing.md#answer) | `x` | [图片、文章、回复和 MP4 上传字节](../../tests/x-publish-image-processing.test.ts) |
| [12](issues/12-linkedin-bluesky-media.md#answer) | `linkedin`、`linkedin-page`、`bluesky` | [图片、PDF 轮播和视频字节；视频处理状态](../../tests/linkedin-bluesky-media.test.ts) |
| [13](issues/13-tiktok-azure-publish.md#answer) | `tiktok`、`tiktok-business` | [图片及视频拉取、PNG 发布副本、前缀拒绝与发布 ID](../../tests/tiktok-azure-publish.test.ts) |
| [14](issues/14-meta-google-media-urls.md#answer) | `instagram`、`instagram-standalone`、`facebook`、`threads`、`gmb` | [图片、混合轮播、视频、封面或回复中的 URL](../../tests/azure-meta-google-media.test.ts) |
| [15](issues/15-youtube-reddit-pinterest.md#answer) | `youtube`、`reddit`、`pinterest` | [视频 HEAD、Range 和续传；封面、图片链接与上传 ID](../../tests/azure-youtube-reddit-pinterest.test.ts) |
| [16](issues/16-messages-embedded-media.md#answer) | `slack`、`telegram`、`lemmy`、`wrapcast`、`nostr` | [消息、回复、缩略图及签名正文中的 URL](../../tests/azure-message-media.test.ts) |
| [17](issues/17-discord-mastodon-vk-dribbble.md#answer) | `discord`、`mastodon`、`vk`、`dribbble` | [附件字节、平台附件 ID 与处理结果](../../tests/azure-channel-attachments.test.ts) |
| [18](issues/18-whop-skool-mewe-tumblr.md#answer) | `whop`、`skool`、`mewe`、`tumblr` | [原生文件上传、回复、失败处理和视频限制](../../tests/azure-community-attachments.test.ts) |
| [19](issues/19-articles-email-text.md#answer) | `medium`、`devto`、`hashnode`、`wordpress`、`listmonk`、`kick`、`twitch`、`moltbook` | [正文与封面 URL、WordPress 特色图字节和 ID；三个纯文字渠道的帖子与回复](../../tests/azure-article-email-text.test.ts) |

## 回退及第二次部署

**无盘验收失败时保留 PVC、PV 和磁盘。** 记录失败入口、组织、媒体 ID、HTTP 状态和平台错误。需要切回时，保留兼容当前数据库的应用镜像，恢复第一次部署前的 `STORAGE_PROVIDER=local`、两个上传目录设置及原 PVC 的 volume、volumeMount。重新部署，验证本地上传与排程。切回 main 对应的镜像时，Azure 上传功能与 main 的 Prisma schema 相同。保留已写入 Azure 文件的访问配置，按其媒体记录中的原地址验证预览和相关排程。

**无盘验收通过后再退役 10 GiB 上传盘。** 保存镜像摘要、无 Pod 引用的查询结果，以及全部格式、中断重试、公开 API、导入、后台生成和无盘发布回归的 dev 记录。每项记录关联组织、媒体 ID、读回时间、长度和 SHA-256，另列由渠道负责人安排的真实发帖。验收记录对上传 SAS、连接字符串和会话头脱敏。再次核对集群、PV 名、完整磁盘 ID 和实际策略，在第二次环境变更中仅移除 `dev/postiz-uploads-pvc` 声明并同步。以下按策略核对。[逐步核对与回收命令](issues/02-environment-and-urls.md#停用和删除-dev-上传盘)

| 实际回收策略 | 负责人操作与完成标志 |
| --- | --- |
| `Retain` | 上传 PVC 删除后核对原 PV 为 `Released`、CSI volumeHandle 仍是第一步记录的磁盘 ID。查询该磁盘，确认 `diskState=Unattached`、`managedBy` 为空，然后回收该 PV 和磁盘。按原身份查询，PV 返回 `NotFound`，磁盘返回 `ResourceNotFound`。 |
| `Delete` | 等待控制器自动回收。以原 PV 名、磁盘完整 ID 确认两者分别返回 `NotFound`、`ResourceNotFound`；发现残留时先查 PVC/PV 事件和磁盘挂载状态。 |

资源身份不符、仍有 Pod 引用或磁盘仍挂载时停在核对步骤。PostgreSQL 和 Temporal 使用各自的数据卷。旧上传盘退役后，今后若需持久化本地上传，须重新提供上传卷。
