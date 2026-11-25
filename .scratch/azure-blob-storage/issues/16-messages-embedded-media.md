# 16: 验证消息、回复及正文中的媒体地址

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 消息、回复和签名内容引用的图片或视频在上传 SAS 过期后仍可读取。

渠道标识：`slack`、`telegram`、`lemmy`、`wrapcast`、`nostr`

- [x] Slack 的消息与回复使用图片块 URL 并遵循已有视频限制。Telegram 按照片、视频、文档或分组的适用形式发送 Blob 源站 地址。
- [x] Lemmy 使用首图 URL 作为主帖缩略图并保留文字评论。Farcaster 在主帖和回复的 embeds 中使用持久图片 URL。
- [x] Nostr 的签名消息或回复保留可读的图片、视频 URL。用模拟平台核对字段或签名正文，拉取被拒时返回原错误且不改走文件上传。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

在本地 HTTPS 服务上提供 JPEG、MP4 和 PDF 样本，公开读路径使用组织前缀。运行 `pnpm exec vitest run tests/azure-message-media.test.ts --maxWorkers=1`，13 个用例通过。测试使用 OpenSSL 临时证书和本地回环端口。[回归用例](../../../tests/azure-message-media.test.ts)

| 渠道 | 已验证的发送结果与错误 |
| --- | --- |
| Slack | 主帖和线程回复的 `blocks[].image_url` 均保留图片地址。回复带有父消息时间戳。校验拒绝视频，平台返回的 `invalid_blocks` 及下载失败详情可见。 |
| Telegram | 真实 Bot SDK 分别发送 `photo`、`video`、`document` URL，公开读取三种地址得到与样本相同的字节。图文与视频混合的相册回复保留两项媒体的类型和父消息 ID。模拟平台拒绝拉取后仅收到一次照片发送请求，错误保留 Telegram 的原始描述。 |
| Lemmy | 修正了 `.jpeg` 被误拒的问题。主帖只提交首图作为 `custom_thumbnail`，评论提交文字和帖子 ID。实例拒绝 URL 时保留 `blocked_url`。 |
| Farcaster (`wrapcast`) | 真实 Neynar SDK 的主帖与回复请求均含图片 `embeds[].url`，回复引用主帖哈希。视频校验和平台拒绝 embed 的错误均已验证。 |
| Nostr | 对签名消息和回复验签，从正文中的链接匿名读回图片、视频并核对字节。任一中继接受事件即可返回该签名事件自身的 ID 和链接，所有中继拒绝时传播原错误。 |

本票使用模拟平台与持久读路径验证发送。实际 dev Blob 源站 的匿名读取、SAS 到期和真实账号发布属于部署验收。
