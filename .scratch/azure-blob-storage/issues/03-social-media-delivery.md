# 发布 Azure 媒体时由社媒拉取还是由 Postiz 上传

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: chancetio
Resolved: 2026-11-25
Blocked by: 02

## Question

当定时发布的附件来自 Azure，渠道同时提供按 URL 抓取和上传文件两种方式时，Postiz 应选择哪一种？仅接受文件字节或只支持抓取的接口如何处理？

## Answer

全部 35 个已注册发布渠道使用同一规则。在适配渠道时，按发布接口、帖子形式和附件类型确定传输方式。接口支持 URL 拉取（包括同时接受 URL 和文件的接口）时，Postiz 直接提交持久的 Blob 源站 HTTPS 地址和平台所需元数据。图集逐项使用适用接口；视频与封面可以使用不同方式。只接受文件的接口由发布进程从 Azure 读取后上传。浏览器写入 Azure 使用单独签发的 SAS。

部署时在 Blob 源站启用单个文件的匿名读取，并按平台要求完成域名归属验证或白名单设置。发帖时无需探测 Blob 源站或查询验证状态来决定传输方式。平台拒绝拉取时，保留原错误并指出需修正的配置或媒体，禁止自动改走文件上传。对于已受理的请求，按原发布标识跟踪状态，重试沿用同一种传输方式。两条路径都须能在没有持久上传盘的 Pod 中运行。

### 实施和验收依据

- 以媒体库登记的上传结果作为发布输入。Instagram 可以直接提交登记的 URL。默认配置下，普通 TikTok 和 TikTok Business 遇到入库后仍为 PNG 的图片时，沿用发布前转 JPEG 的逻辑。供平台拉取的是单独保存的 JPEG，媒体库继续引用入库时的图片。关闭[发布图片处理总开关](05-publish-image-processing.md#answer)时，跳过 JPEG 副本生成，按渠道要求校验现有图片。各渠道的首版范围见[首版要适配和验收哪些发布平台](04-platform-scope.md)。[发布前的图片处理](../../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts) · [Instagram](../../../libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts)
- 普通 TikTok 的图片在所有存储模式下均使用 `PULL_FROM_URL`。视频在 Azure 模式下也使用 `PULL_FROM_URL`，覆盖直接发布和发送到收件箱；本地和 R2 模式的视频继续使用 `FILE_UPLOAD`。`url_ownership_unverified` 作为部署配置错误报告。TikTok Business 沿用其发布接口的媒体 URL 字段。[普通 TikTok](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts) · [TikTok Business](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.business.provider.ts) · [TikTok 媒体传输文档](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- YouTube 的视频上传可作为字节传输用例。验证现有可续传上传能从 Azure 读取视频；对支持拉取的用例，验证对社媒发送的是可访问的 Blob 源站 URL，且发布进程没有为转发而下载完整媒体。验收还应覆盖拉取被明确拒绝，以及已受理但等待结果两种状态。[YouTube 渠道实现](../../../libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts) · [YouTube 视频上传文档](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)

### 所有 URL 拉取渠道的 dev 配置

按[dev 配置](02-environment-and-urls.md#answer)在 `postiz-config` 设置 `AZURE_CONTAINER=postiz`、`AZURE_BASEPATH=dev`。平台接收的公开 URL 形如 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<merchantId>/<文件名>`。从外网匿名访问实际媒体应能直接读取内容并得到正确的 Content-Type。平台要求验证归属时，使用实际发布应用和上述路径完成验证。

### 普通 TikTok 的 dev 配置交接

部署交付版本时，在 `fbr-env-project` 的 [Postiz dev 清单](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/postiz/04-postiz.yml>) 中将 `postiz-config.STORAGE_PROVIDER` 设为 `azure` 并填写上面的容器与路径配置。将 dev 存储连接字符串作为 `AZURE_CONNECTIONURL` 写入 SOPS 加密的 `postiz-secret`。普通 TikTok 复用这套媒体地址。以下一次性操作供用户在部署时使用。

1. 在 TikTok for Developers 打开实际用于发布的应用，进入 **URL properties → Verify properties → URL prefix**，填写 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/`（含末尾斜杠）。
2. 下载 TikTok 提供的验证文件，保留文件名与内容，放到 Azure 的 `postiz` 容器，使其能从 TikTok 指定的公开地址读取。按上述前缀，Blob 名为 `dev/<验证文件名>`。匿名 GET `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<验证文件名>` 返回 200 和原文，全程无跳转。
3. 回 TikTok 点击 **Verify**，确认该媒体前缀显示验证成功。交接时记录 TikTok 中通过验证的完整 Blob URL 前缀。

[TikTok 应用配置](https://developers.tiktok.com/docs/en/getting-started-create-an-app) · [TikTok 媒体传输与前缀规则](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
