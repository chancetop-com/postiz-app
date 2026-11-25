# 08: 支持分片重试并对齐 R2 上传行为

Status: resolved
Blocked by: 07

**What to build:** 上传较大视频时在当前会话内恢复临时失败的分片。图片沿用 R2 主上传器的压图规则，确认后的 Blob 源站 内容与本次提交一致。

- [x] Azure SDK 的单次上传阈值与分片大小均为 5 MiB。用大于 5 MiB 的 MP4 在本地令一个分片首次返回 503，已成功分片不重传，进度能完成，读回摘要与提交文件一致。
- [x] 持续失败直到 SDK 耗尽重试时，界面提示失败且不登记。刷新或关闭页面后可重新选文件上传。
- [x] 沿用现有白名单和逐类型上限，覆盖 JPEG、PNG、GIF、WebP、AVIF、BMP、TIFF 和 MP4。复用现有格式及大小边界用例，图片上限为 10 MiB，视频为 1 GiB。
- [x] 以关闭通用转码的 R2 实现和现有测试为基准，用大图、GIF 和视频覆盖两种压图设置。核对实际提交文件的格式、尺寸或摘要及 Azure 读回结果。GIF 保留动画。

以现有 R2 行为和测试为参照，在本地验证 Azure 的差异。真实环境配置与验证由环境负责人按手册执行。

[父规格](../spec.md) · [上传授权与重试](01-upload-authority.md#answer)

## Answer

主上传器与服务端共用 Azure 媒体类型及大小限制。修复了文件选择器提前拒绝 AVIF、BMP、TIFF 和精确 1 GiB 视频的问题。开启压图时允许先选择较大的原图，授权与确认均按压图后实际提交的字节执行限制。

- 在 Chromium 同时选择 5 MiB 和 6 MiB 的真实 MP4。前一个文件只发一次 Put Blob，后一个按 5 MiB 和 1 MiB 暂存分块。让尾块第一次返回 503，回环 Blob 服务仅收到该块相同 ID 的第二次请求。两个已成功的 5 MiB 请求各出现一次；Uppy 显示 91%（10 / 11 MiB）后达到 100%。按两条媒体记录的地址匿名读回，SHA-256 均与所选文件相同。
- 5 MiB 加 1 字节的 MP4 已走分块。令尾块持续返回 503，SDK 总共发送该块 4 次。界面显示失败，未提交块列表，通过真实 Nest 接口查询的 PostgreSQL 媒体库未增加记录。重新加载页面、再选择同一文件后成功，读回摘要一致。
- 文件输入覆盖 JPEG、PNG、GIF、WebP、AVIF、BMP、TIFF 和 MP4。关闭压图时，精确 10 MiB 的图片可确认、读回，超一个字节在选择器显示上限。精确 1 GiB 的视频通过浏览器选择和实际授权，超一个字节在选择时被拒绝。公开 API 回归另实际流式发送 1 GiB 和 1 GiB 加一个字节的请求，分别收到 201 和 400。
- 使用相同的大 PNG、两帧 GIF 及含视频轨道的 MP4，在 Azure 和 R2 的主上传器分别运行两种压图设置，两端均关闭上传后转码模板。1600 × 1200 PNG 在开启压图时成为 1000 × 750 JPEG，关闭时保留原始 PNG。GIF 的两帧和每帧 100 ms 时长保留，GIF 与 MP4 均与原件逐字节一致。全部 12 次上传均在浏览器对 Uppy 实际提交的数据取 SHA-256，与媒体记录的匿名 HTTP 读回摘要逐项核对，两个后端的结果也一致。

本地测试使用实际的 Chromium、Nest、PostgreSQL、Azure 和 AWS SDK，以回环 HTTPS 服务模拟 Blob、R2 S3 接口和 R2 CDN。将 `AZURE_CONFIRM_TEST_DATABASE_URL` 指向已应用 Prisma schema 的测试库，并设置 `AZURE_UPLOAD_TEST_CHROMIUM` 为 Chromium 可执行文件。运行 `pnpm exec vitest run tests/azure-browser-block-retry.test.ts tests/azure-browser-r2-parity.test.ts --maxWorkers=1` 复测本票 7 项；另设 `AZURE_UPLOAD_LARGE_VIDEO_TEST=1` 可用 `tests/azure-public-api-upload.test.ts` 复测公开 API 的 1 GiB 边界。真实 dev 浏览器跨域与匿名读回由部署手册覆盖。
