# 12: 接入 LinkedIn 个人、主页及 Bluesky 的图片规则

Status: resolved
Blocked by: 11

**What to build:** 从媒体库排程到 LinkedIn 或 Bluesky 时，发布前图片处理由同一个开关控制，用户主动选择的 PDF 轮播和视频继续按各自方式发送。

渠道标识：`linkedin`、`linkedin-page`、`bluesky`

- [x] LinkedIn 个人和主页均保留相应发布身份。默认设置下普通 GIF 原样发送，其他可处理图片缩至 6000 × 6000 以内且小图不放大。PNG、JPEG 以同格式重编码，其他格式按既有规则转为 JPEG。
- [x] 关闭时普通图片直接使用合规原件，不合规时说明原因。两种开关状态下显式选取的 LinkedIn PDF 轮播均生成可上传的文档，视频可分段发送。
- [x] Bluesky 默认对 976 KiB 以内的图片发送原件，对超限图片按现有 90% 缩放规则处理。关闭时不生成缩小版本。保留 MP4 流式上传和异步结果。
- [x] 用同一组 Blob 源站 HTTPS 样例从发布入口核对模拟平台收到的格式、尺寸或字节。LinkedIn 共享逻辑的行为断言可在个人和主页间复用。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [发布前图片处理约定](05-publish-image-processing.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

LinkedIn 个人和主页共用发布逻辑，上传及最终帖子分别使用个人或组织的 URN。发布 worker 根据内容识别图片格式。开启处理时保留动画 GIF，其余图片等比缩入 6000 × 6000；关闭时直接发送合规原件，拒绝不支持的格式、达到 36,152,320 像素的原图，以及超过 250 帧的 GIF。显式 PDF 轮播仍上传生成的多页文档。视频使用平台为每段分配的字节范围和上传 URL，将返回的分段 ID 按顺序提交到相同上传会话。[LinkedIn 图片接口](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-01) · [LinkedIn 视频接口](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-01)

Bluesky 开启处理时按 976 KiB 目标缩图，关闭后允许直接发送超过处理目标的合规原件。两种设置均校验平台单图 2,000,000 字节上限，并按最终字节发送 MIME。主帖与回复共用该逻辑。MP4 先 HEAD 获取大小，随后将 Blob GET 响应流直接交给视频服务；扁平及嵌套响应均保留原任务 ID，重复上传返回的已有任务也继续轮询。服务拒绝时保留拒绝原因。[Bluesky 图片发布约定](https://docs.bsky.app/docs/tutorials/creating-a-post)

本地使用同一 Blob 源站样例目录 `https://postiztest.blob.core.windows.net/postiz/dev/org-42/`。从公开发布、状态和完成入口核对模拟平台收到的真实 PNG、JPEG、WebP、双帧 GIF、双页 PDF 和 MP4 字节，以及发送身份、文档标题、分段确认、视频任务状态和帖子标识。测试还覆盖空开关、非空开关、伪装扩展名的图片、像素与动画帧上限和 Bluesky 回复超限。运行 `pnpm exec vitest run tests/linkedin-bluesky-media.test.ts tests/x-publish-image-processing.test.ts --maxWorkers=1`，本票 24 项和共享开关前置票 17 项均通过。该结果覆盖本地模拟平台，不包含 dev Blob 公网验收或真实发帖。
