# 17: 验证 Discord、Mastodon、VK、Dribbble 的附件发布

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 让远程媒体在消息、实例帖子和图片作品中使用正确附件，保留每个渠道对附件尺寸、处理状态和发布引用的要求。

渠道标识：`discord`、`mastodon`、`vk`、`dribbble`

- [x] Discord 核对消息与回复附件的文件名、长度和流式字节。Mastodon 使用目标实例返回的媒体 ID 发帖或回复，并跟踪附件处理完成。
- [x] VK 分别核对照片和视频，将平台返回的附件标识带入帖子或评论。Dribbble 校验单张图片尺寸，覆盖合规图片和尺寸超限反馈。
- [x] 根据具体接口核实 URL 拉取能力。仅收文件时从模拟 Blob 源站的 HTTPS 地址读出正确字节；核对模拟平台成功响应及拒绝后的结果。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)


## Answer

在本地 HTTPS 服务模拟公开 Blob 和四个平台，按 `https://fixture.blob.core.windows.net/postiz/dev/org/<文件>` 读取测试图片和一帧 MP4。测试从渠道发送或附件校验入口调用，接收端解析实际 multipart 请求并逐字节核对文件。以下四种原生附件接口都需要文件上传。

| 渠道 | 验证结果 |
| --- | --- |
| Discord | 正文、首条回复与后续回复都按 HEAD 返回的长度发送图片和视频；核对文件名、文件内容及整包 Content-Length。后续回复使用以原消息 ID 标识的讨论串。平台错误 40005 返回附件过大的提示。[消息接口](https://docs.discord.com/developers/resources/message) · [讨论串](https://docs.discord.com/developers/topics/threads) |
| Mastodon | 在目标实例上传文件和替代文字。创建主帖和回复时均按返回的媒体 ID 跟踪 206 到 200，完成后绑定到状态。回复保留回复目标；处理失败显示实例的错误；受理响应缺少媒体 ID 时停止发帖。旧实例若没有 v2 上传路由，可继续用 v1 接收文件。[媒体接口](https://docs.joinmastodon.org/methods/media/) |
| VK | 原图、MP4 分别作为 `photo`、`video_file` 上传。主帖和评论按保存结果里的所有者和媒体 ID 引用两个附件；上传接口返回错误时停止。VK 的 `video.save.link` 表示嵌入外部网站视频，原生视频使用返回的上传地址。[官方 SDK 上传示例](https://github.com/VKCOM/vk-php-sdk#53-uploading-video-files) · [视频参数](https://github.com/VKCOM/vk-api-schema/blob/master/video/methods.json) |
| Dribbble | 400×300 原图通过验证并上传，801×600 或多图返回尺寸或数量提示。当前排程收到 202 后，从 Location 提取作品 ID，轮询该作品直到取得正式链接。测试覆盖处理中 404、临时 503、上传拒绝、响应丢失和缺少跟踪 ID。旧版排程入口保留原返回结构。[创建作品](https://developer.dribbble.com/v2/shots/#create-a-shot) |

验证命令为 `pnpm exec vitest run tests/azure-channel-attachments.test.ts --maxWorkers=1`，15 项通过。测试使用临时证书和回环端口；真实 Azure 访问和社交平台发帖留给环境验收。
