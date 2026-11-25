# 如何控制各渠道发布前的自动图片处理

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: chancetio
Resolved: 2026-11-25
Blocked by: 04

## Question

发布前为适配渠道而进行的图片缩放、重编码和格式转换由什么开关控制？已有部署的默认行为是什么？

## Answer

用户选择一个部署级总开关，统一控制所有发布渠道对图片的自动处理。规划的环境变量 `DISABLE_PUBLISH_IMAGE_PROCESSING` 沿用上传压缩开关的取值规则，由 Postiz 后端和发布 worker 读取，适用于所有存储方式。dev 的配置位置是 `postiz-config`。

| 配置 | 发布行为 |
| --- | --- |
| 未设置或留空 | 默认开启。各渠道按下表中的现有条件自动处理图片。 |
| 任意非空值，建议用 `true` | 关闭自动处理，直接使用媒体库登记的图片及其真实格式。跳过自动缩放、重编码、格式转换和副本写入。继续执行渠道校验，图片不符合要求时提示原因。字符串 `false` 和 `0` 也属于非空值。 |

发布工作流的主帖、后续评论和回复都按同一开关准备图片。上传器压图由 `DISABLE_IMAGE_COMPRESSION` 控制，视频和入库后通用转码各沿用其既定规则。URL 拉取或字节上传照[发布 Azure 媒体时由社媒拉取还是由 Postiz 上传](03-social-media-delivery.md#answer)执行。用户主动选择的 LinkedIn PDF 轮播属于生成文档，按该发帖选项执行。

### 当前 35 个渠道的发布代码

下表以媒体库里实际登记的图片为输入。格式转换、尺寸变化以及同格式重新编码都会改变图片字节。

| 渠道 | 触发与输出 | 文件去向 |
| --- | --- | --- |
| 普通 TikTok、TikTok Business | 两个接入都会触发共享逻辑。对 PNG 使用 Sharp 以质量参数 100 转成 JPEG。其他图片跳过这一步。 | 新 JPEG 另存为存储对象。Azure 模式下，帖子引用同一组织目录内该 JPEG 的 Blob 源站地址，媒体库继续引用入库图片。[共享处理](../../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts) · [普通 TikTok](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts) · [TikTok Business](../../../libraries/nestjs-libraries/src/integrations/social/tiktok.business.provider.ts) |
| X | 普通帖图片按比例调整到宽 1000 像素并转 GIF。文章配图、封面和正文内嵌图调整到同样宽度并转 JPEG。这是目标宽度，小图也可能放大。 | 发布进程把处理后的字节上传给 X。[X 图片上传](../../../libraries/nestjs-libraries/src/integrations/social/x.provider.ts) |
| LinkedIn 个人、LinkedIn 主页 | 普通图片中 GIF 原样上传。其余图片等比缩到 6000 × 6000 的范围内，小图不放大。PNG、JPEG 保留格式但重新编码，其他可处理格式转 JPEG。另有显式 PDF 轮播选项，会将所选图片转成静态 JPEG，再合成一个 PDF。 | 普通图片上传处理后的字节；PDF 轮播上传生成的文档。个人和主页共用实现。[图片与 PDF 处理](../../../libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts) · [主页调用](../../../libraries/nestjs-libraries/src/integrations/social/linkedin.page.provider.ts) |
| Bluesky | 原图不超过 976 KiB 时直接上传。超过时每轮把宽、高缩至上一轮的 90% 并重新编码，达到大小目标或尺寸下限时停止。 | 发布进程把最终图片上传为 Bluesky 的 blob。[Bluesky 图片处理](../../../libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts) |
| 其余 26 个使用图片、附件或正文引用的渠道 | 在各自发布代码中未发现自动改写图片字节的分支。包括 Reddit、Instagram（两种接入）、Facebook、Threads、YouTube、Google Business Profile、Pinterest、Dribbble、Discord、Slack、Mastodon、Lemmy、Farcaster、Telegram、Nostr、VK、Medium、DEV.to、Hashnode、WordPress、Listmonk、Whop、Skool、MeWe、Tumblr。 | 按各自接口传 URL、正文引用或文件。有的会读取尺寸、长度或 MIME，或单独上传封面。[逐渠道发布清单](04-platform-scope.md#answer) |
| Kick、Twitch、Moltbook | 现有帖子和回复发文字，图片处理不适用。 | [逐渠道发布清单](04-platform-scope.md#answer) |

实施时分别验证未设置和留空均执行现有处理，`true`、`false` 和 `0` 三个非空字符串均关闭自动处理。用 PNG、GIF、WebP 和超限图片核对发送的格式与字节、TikTok 转换副本是否写入，以及不兼容图片的错误反馈。各渠道的账号和发布形式见[首版要适配和验收哪些发布平台](04-platform-scope.md#answer)。
