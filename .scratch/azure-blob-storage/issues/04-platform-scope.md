# 首版要适配和验收哪些发布平台

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: chancetio
Resolved: 2026-11-25
Blocked by: 03

## Question

首版需要在哪些发布平台、账号类型和媒体形式上验收 Azure 图片、视频？哪些发布路径需要改代码，哪些可以沿用现有实现？

## Answer

用户确认首版覆盖 Postiz 当前支持的全部发布平台。以本仓库后端注册的 **35 个发布渠道标识**为代码适配与回归范围，包含同品牌下不同接入方式，也包含界面隐藏或 dev 尚未绑定的渠道。「添加渠道」页目前开放其中七项。实施方按各渠道支持的形式检查正文内嵌图片、封面、附件和纯文本的请求。真实发布验收由用户自行安排，实施交付以代码回归和环境配置说明为准。[后端发布注册表](../../../libraries/nestjs-libraries/src/integrations/integration.manager.ts) · [添加渠道清单](../../../apps/frontend/src/components/launches/allowed.channels.ts)

### 所有渠道共用的要求

- Azure 对齐 R2 关闭通用媒体转码时的行为。网页主上传器沿用现有压图开关（`DISABLE_IMAGE_COMPRESSION`）和 GIF 跳过规则；存入 Azure 的是上传器实际提交的文件。Azure 入库后不启动 RunPod 的图片标准化或视频转码任务。使用 Azure 直传的验收配置与 R2 对照组均关闭外部转码模板。发帖时，各渠道按[发布图片处理总开关](05-publish-image-processing.md#answer)决定是否自动处理图片，继续执行已有的格式和尺寸校验。[浏览器上传器](../../../apps/frontend/src/components/media/new.uploader.tsx) · [后台媒体处理](../../../libraries/nestjs-libraries/src/database/prisma/media/media.service.ts) · [发布前媒体处理](../../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts)
- 发布时，直接引用入库文件的渠道使用其持久的 Blob 源站 HTTPS 地址。需要处理附件的渠道按已有逻辑生成发布版本，再提交该版本的地址或字节。所有渠道按发布接口和附件类型固定使用 URL 或文件上传。支持 URL 拉取的接口直接提交地址，拒绝时返回错误；只接受文件的接口上传字节。具体规则和部署配置见[发布 Azure 媒体时由社媒拉取还是由 Postiz 上传](03-social-media-delivery.md#answer)。各工单的实际请求、拒绝响应和覆盖范围见[发布回归索引](../dev-runbook.md#发布回归索引)。
- 在无上传盘环境，分别以浏览器压图开、关两种配置测试同一张大图，再测试 GIF 和视频。两端以同配置的 R2 为对照核对压图条件、入库格式和尺寸。逐次比对实际上传请求中的文件内容与各自公开地址读回的摘要，确认入库后未触发通用转码。直接使用入库文件的渠道核对 URL 或上传字节，内嵌图片的渠道核对正文引用，会转换图片的渠道核对实际发送的格式与尺寸是否符合现有规则。分段读取的渠道另验 HEAD、Content-Length 与 Range。用模拟的平台响应检查成功和错误分支，按渠道记录代码回归结果。[发布端远程读取](../../../libraries/nestjs-libraries/src/integrations/social.abstract.ts)

### 各渠道的改动与验收

下表列出当前代码、开关默认开启时的回归预期，以及供用户实发时参考的场景。关闭后的预期见[如何控制各渠道发布前的自动图片处理](05-publish-image-processing.md#answer)。

| 发布渠道 | 后端标识 | 发布行为与验收场景 |
| --- | --- | --- |
| [X](../../../libraries/nestjs-libraries/src/integrations/social/x.provider.ts) | `x` | 普通帖图片缩放后转 GIF，文章配图转 JPEG。用同一张 Azure 图片分别验证两种发布结果。MP4 验证原字节分段上传。 |
| [LinkedIn 个人](../../../libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts) | `linkedin` | 普通图片中的 GIF 保留原件，其余图片缩入 6000 × 6000 范围，部分格式转 JPEG。显式 PDF 轮播会重编码图片。分别验证普通图片、用户选择的 PDF 轮播及 MP4 分段上传。 |
| [LinkedIn 主页](../../../libraries/nestjs-libraries/src/integrations/social/linkedin.page.provider.ts) | `linkedin-page` | 复用个人账号的媒体处理。以组织身份验收同样的图片处理、视频上传和轮播。 |
| [Reddit](../../../libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts) | `reddit` | 媒体帖会先上传单图或 MP4，视频另传封面，再用 Reddit 返回的 URL 发帖。分别验证正文链接帖、图片和带封面的视频。 |
| [Instagram 经 Facebook 接入](../../../libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts) | `instagram` | 发布请求使用图片、视频和封面 URL。验证单图、轮播、Reels 和限时动态使用持久的 Blob 源站地址。 |
| [Instagram 独立登录](../../../libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts) | `instagram-standalone` | 复用 Instagram 的发布逻辑，使用另一 Graph 主机。用独立授权账号验收相同的适用形式。 |
| [Facebook 主页](../../../libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts) | `facebook` | 普通帖和限时动态已传图片或视频 URL。分别验证单图、多图、视频和动态。 |
| [Threads](../../../libraries/nestjs-libraries/src/integrations/social/threads.provider.ts) | `threads` | 图片和视频 URL 分别进入相应字段。验证单项、轮播及带媒体的回复。 |
| [YouTube](../../../libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts) | `youtube` | 视频可从 HTTPS 源分段读取并续传。验证 HEAD 长度、Range 返回 206，以及自定义封面上传。 |
| [Google Business Profile](../../../libraries/nestjs-libraries/src/integrations/social/gmb.provider.ts) | `gmb` | 文字帖可附一张图片，通过 sourceUrl 引用。验收原图，并保留渠道对视频及多图的限制。 |
| [普通 TikTok](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts) | `tiktok` | 图片在所有存储模式下均由平台拉取，默认处理将 PNG 转为独立 JPEG。Azure 模式的视频同样固定使用 `PULL_FROM_URL`，直发和收件箱均适用；本地和 R2 视频保留 `FILE_UPLOAD`。核对未验证前缀的错误，以及已受理后的发布 ID。 |
| [TikTok Business](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.business.provider.ts) | `tiktok-business` | 图片、视频及自定义封面已有 URL 字段。输入 PNG 时沿用共享的 JPEG 转换，按 Business 接口验收发布版本。 |
| [Pinterest](../../../libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts) | `pinterest` | 单图、多图和视频封面传 URL；MP4 由发布进程读出并上传，再引用平台媒体 ID。图片、视频分开验收。 |
| [Dribbble](../../../libraries/nestjs-libraries/src/integrations/social/dribbble.provider.ts) | `dribbble` | 先校验单张图片尺寸，再从 URL 读取并上传原图。用符合和超出尺寸要求的样本验证。 |
| [Discord](../../../libraries/nestjs-libraries/src/integrations/social/discord.provider.ts) | `discord` | 正文和回复的附件会读取长度后以 multipart 流上传。验证 Blob 的长度、文件名和字节。 |
| [Slack](../../../libraries/nestjs-libraries/src/integrations/social/slack.provider.ts) | `slack` | 图片 URL 用于消息及回复中的图片块。验收图片展示及已有视频限制。 |
| [Kick](../../../libraries/nestjs-libraries/src/integrations/social/kick.provider.ts) | `kick` | 当前发布消息与回复只包含文字。验收文本回归，图片与视频记为不适用。 |
| [Twitch](../../../libraries/nestjs-libraries/src/integrations/social/twitch.provider.ts) | `twitch` | 当前发送文字聊天、公告与回复。验收文本回归，图片与视频记为不适用。 |
| [Mastodon](../../../libraries/nestjs-libraries/src/integrations/social/mastodon.provider.ts) | `mastodon` | 从 Blob 源站读取附件，以 multipart 上送到目标实例，然后用实例媒体 ID 发布或回复；验证处理完成状态。 |
| [Bluesky](../../../libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts) | `bluesky` | 图片超过现有阈值时会反复缩小再上传。分别验证阈值以内的图片直接上传、超限图片缩小后上传。MP4 另走视频服务，验证流式上传及异步结果。 |
| [Lemmy](../../../libraries/nestjs-libraries/src/integrations/social/lemmy.provider.ts) | `lemmy` | 主帖只用首图 URL 作自定义缩略图，现有评论走文字。按这两种行为验收。 |
| [Farcaster](../../../libraries/nestjs-libraries/src/integrations/social/farcaster.provider.ts) | `wrapcast` | 主帖和回复将图片 URL 放入 embeds。验收持久的 Blob 链接及已有媒体类型限制。 |
| [Telegram](../../../libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts) | `telegram` | 现有 HTTPS 源按照片、视频或文档传给 Bot，也支持分组发送。对支持 URL 的媒体形式固定提交 Blob 源站地址。验收平台拉取成功以及明确拒绝 URL 时的错误提示。 |
| [Nostr](../../../libraries/nestjs-libraries/src/integrations/social/nostr.provider.ts) | `nostr` | 图片、视频 URL 直接写入签名消息或回复。发布后读者仍需能打开同一地址。 |
| [VK](../../../libraries/nestjs-libraries/src/integrations/social/vk.provider.ts) | `vk` | 照片及视频从媒体 URL 读取并上传，然后把平台附件 ID 放入帖子或评论。分别验证两类原文件。 |
| [Medium](../../../libraries/nestjs-libraries/src/integrations/social/medium.provider.ts) | `medium` | 发布文章 Markdown。验证正文中的图片引用，独立附件不适用。 |
| [DEV.to](../../../libraries/nestjs-libraries/src/integrations/social/dev.to.provider.ts) | `devto` | 正文 Markdown 与可选封面字段分别携带图片引用。验证两处原图 URL。 |
| [Hashnode](../../../libraries/nestjs-libraries/src/integrations/social/hashnode.provider.ts) | `hashnode` | 正文为 Markdown，封面另传 URL。验证绝对 Blob 源站地址可直接使用。 |
| [WordPress](../../../libraries/nestjs-libraries/src/integrations/social/wordpress.provider.ts) | `wordpress` | 正文 HTML 内嵌图片 URL；特色图片会先读取原文件并上传到 WordPress 媒体库，再写入其 ID。分别验收。 |
| [Listmonk](../../../libraries/nestjs-libraries/src/integrations/social/listmonk.provider.ts) | `listmonk` | 邮件 HTML 内嵌图片 URL。验证邮件发出后读者仍可取图。 |
| [Moltbook](../../../libraries/nestjs-libraries/src/integrations/social/moltbook.provider.ts) | `moltbook` | 当前帖子和回复只发送文字。验收文本回归，图片与视频记为不适用。 |
| [Whop](../../../libraries/nestjs-libraries/src/integrations/social/whop.provider.ts) | `whop` | 在帖子与回复中先 HEAD 获取附件长度，再 GET 原件上传至 Whop，等待处理并提交附件 ID。 |
| [Skool](../../../libraries/nestjs-libraries/src/integrations/social/skool.provider.ts) | `skool` | 帖子与回复将源文件作为通用附件流式上传，再引用文件 ID。验证 HEAD、MIME 及原字节传输。 |
| [MeWe](../../../libraries/nestjs-libraries/src/integrations/social/mewe.provider.ts) | `mewe` | 从 URL 读取照片并上传，然后用照片 ID 发帖。仅含 MP4 或照片与 MP4 混发时，校验及发布均拒绝整帖并说明视频限制。 |
| [Tumblr](../../../libraries/nestjs-libraries/src/integrations/social/tumblr.provider.ts) | `tumblr` | 有附件时读取媒体元数据并以 multipart 上传，纯文本用 JSON。核对图片、视频和可选缩略图，读取尺寸时应保持原件。 |

普通 TikTok 的照片接口列出 JPEG 和 WebP。默认开启时选用一张入库格式为 PNG 的图片，确认发往普通 TikTok 的请求引用现有发布逻辑生成的 JPEG，媒体库仍可读回该 PNG。部署交付见[普通 TikTok 的 dev 配置交接](03-social-media-delivery.md#普通-tiktok-的-dev-配置交接)。Pinterest 的图片 Pin 与视频 Pin、Telegram 的 URL 与 multipart 传输也应按具体接口验收。[TikTok 传输指南](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) · [Pinterest 发布文档](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/) · [Telegram 文件发送](https://core.telegram.org/bots/api#sending-files)
