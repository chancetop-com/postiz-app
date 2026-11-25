# 由 Postiz 还是 FBR 签发并确认上传

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: chancetio
Resolved: 2026-11-25
Blocked by: —

## Question

浏览器统一向 Postiz 申请地址。Postiz 后端是自行签发 Azure SAS（限定对象、权限和有效期的临时授权），还是代表当前组织调用 FBR 的社交媒体内部接口？谁在上传完成时验证对象并返回可持久保存的读取地址？

FBR 现有接口需要服务身份、商户 ID 和素材用途，按商户目录申请和确认对象。选择复用时，需要说明 Postiz 组织如何对应 FBR 商户，包括普通登录创建的组织。选择 Postiz 自签时，需要明确 Postiz 的服务端凭据、组织隔离，以及哪些现有校验要在直传完成时执行。两种选择都应保证确认重试只登记一次，并兼容只需要文件地址的缩略图调用。

[FBR 社交媒体接口](</Users/chancetio/Desktop/Java/fbr-project/frontend/am-console-site/src/main/java/app/amconsolesite/service/MediaStorageService.java>) · [FBR 签发逻辑](</Users/chancetio/Desktop/Java/fbr-project/backend/file-service/src/main/java/app/file/client/AzureClient.java>) · [Postiz 身份术语](../../../CONTEXT.md)

## Answer

用户确认由 Postiz 签发并确认上传，商户 SSO 和普通登录均使用已鉴权的组织 ID 作为 `merchantId`。服务端为最终文件名签发仅能创建该对象的短期 SAS，浏览器可以单次或分块写入该地址。申请期间不创建 Blob。

确认时，Postiz 根据相同的申请字段、上传标识和当前商户重新定位最终文件。它从该对象核验文件类型和字节数，再按用途登记媒体或返回缩略图地址。同一上传标识重试只登记一次。[现有上传校验](../../../libraries/nestjs-libraries/src/upload/custom.upload.validation.ts)

后台生成媒体及公开 API 的原有上传入口可通过 Postiz 的存储实现写入同一 Azure 配置。该方案只依赖 Azure 的服务端授权，无需为这些调用建立 Postiz 与 FBR 的服务间身份。凭据在部署环境中的注入位置、容器和 Blob 源站读取地址归入[dev 的 Azure 存储目录、媒体域名和凭据如何配置](02-environment-and-urls.md)。

### 浏览器使用 Azure SDK 分片上传

用户选择微软官方 `@azure/storage-blob`。主上传器沿用 Uppy 的文件选择、压图和进度界面。Azure 上传逻辑将后端签发的 SAS 交给 `BlockBlobClient`，用 `uploadData` 发送上传器最终提交的文件，通过 `onProgress` 更新进度。SDK 在同一次上传中自动重试发生临时错误的请求。刷新或关闭页面后，与现有 R2 主上传器一样，用户重新选文件上传。[R2 上传配置](../../../libraries/react-shared-libraries/src/helpers/uppy.upload.ts) · [Azure SDK 分片配置](https://learn.microsoft.com/azure/storage/blobs/storage-blobs-tune-upload-download-javascript) · [Azure SDK 重试策略](https://learn.microsoft.com/azure/storage/blobs/storage-retry-policy-javascript)

实施时将 `maxSingleShotSize` 和 `blockSize` 设为 5 MiB，对齐当前 R2 主上传器开始把文件切成多片的大小。用一个大于 5 MiB 的视频验证：让其中一个分片首次收到 503，观察该分片重试、已成功分片没有重传、进度最终完成。确认后比对从 Blob 源站读回的内容与上传内容，重复确认同一上传标识应返回同一媒体记录。若持续失败直到重试耗尽，界面提示失败，未完成的文件不登记。
