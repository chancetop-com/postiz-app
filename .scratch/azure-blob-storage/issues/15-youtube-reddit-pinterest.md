# 15: 验证 YouTube、Reddit、Pinterest 的视频与封面

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 在没有上传盘的发布进程中，同一帖的视频、图片与封面各按适用的平台接口发送。

渠道标识：`youtube`、`reddit`、`pinterest`

- [x] YouTube 用 HTTPS 视频样例核对 HEAD 长度、Range 206 响应及续传上传的字节区间；自定义封面单独发送。
- [x] Reddit 分别核对正文链接帖、单图和带封面的视频。按适用接口提交附件及封面，并使用平台返回的媒体引用组装帖子。
- [x] Pinterest 分别核对单图、多图、视频 Pin 及视频封面的字段。支持拉取时传 Blob 源站 地址，仅收字节的视频接口走上传并引用媒体 ID。
- [x] 使用同一份本地媒体样例核对实际发送的 URL 或字节，覆盖适用的拒绝及续传场景。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

`pnpm exec vitest run tests/azure-youtube-reddit-pinterest.test.ts --maxWorkers=1` 通过 15 个用例。测试移除 `UPLOAD_DIRECTORY`，用本机 HTTPS 服务器接收 fetch、Axios 和 Google SDK 发出的请求；素材为同一个 MP4 和 JPEG，运行时给 MP4 添加合法的空闲数据块以跨过 8 MiB 分片边界。测试运行环境需要 OpenSSL 和回环地址监听权限。

- YouTube 按 HEAD 返回的长度初始化会话。模拟平台在第一个 8 MiB 请求中保存 3 MiB 后返回 503；下次发布活动查原会话的 308 回应，从第 3 MiB 后第一个字节开始读 Blob 源站，平台收到的两段合并后与原 MP4 逐字节一致。自定义封面经 Google SDK 单独发到缩略图接口，视频 ID 与 JPEG 内容均吻合。平台拒绝封面时保留已发布的视频 ID 和链接。修复了将错误 HEAD 的长度当作素材长度、接受 206 中错误 Content-Range 的问题，并验证 200 全量响应同样会被拒绝。
- Reddit 区分正文链接、单图、带封面的视频。链接连同原文直接提交。图片、视频和封面经资产登记和 multipart 上传，逐个比对字节、文件名和 MIME，然后用返回的 Location 填写 `url` 和 `video_poster_url`。模拟异步受理后从已提交列表取回实际帖子 ID；拒绝提交时将原因返回排程。
- Pinterest 单图使用 `image_url`，多图使用顺序一致的 `multiple_image_urls`。视频文件按平台返回的表单一次上传，随后按同一个媒体 ID 查询状态。成功后 Pin 引用 `video_id` 和 Blob 源站 的 `cover_image_url`；处理失败时不创建 Pin。图片链接被拒后不改传文件。修复了两个视频附件绕过图片封面校验的问题。

本票覆盖本地模拟平台通信。真实 Azure Blob 源站 以及用户社媒账号的验收按父规格另行进行。

公开 API、渠道校验及视频预览按 URL 路径最后的文件扩展名识别附件，接受大写扩展名和带锚点的地址。域名、目录和查询参数包含 mp4 时，图片仍按图片校验和发布。Reddit 拉取素材时保留查询串，向平台登记的文件名和 MIME 来自路径中的文件名。
