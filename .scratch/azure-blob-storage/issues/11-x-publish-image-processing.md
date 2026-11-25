# 11: 用 X 接通发布前图片处理总开关

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 部署方能统一控制发布前自动处理图片。先用 X 的普通帖和文章验证这一开关，再供其他会改写图片的渠道复用。

渠道标识：`x`

- [x] 后端与发布 worker 按同一规则读取 DISABLE_PUBLISH_IMAGE_PROCESSING，适用于所有存储方式和主帖、后续评论及回复。未设置或空值时开启，非空字符串 true、false 和 0 均关闭。上传压图独立控制。
- [x] 默认设置下，模拟 X 收到的普通帖图片等比调整到宽 1000 像素并转为 GIF。文章配图、封面和内嵌图片按同一宽度转 JPEG。
- [x] 关闭时发送入库原图的实际格式及字节，跳过自动副本写入；原图不符合发布要求时返回具体原因。MP4 继续按原字节分段发送。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [发布前图片处理约定](05-publish-image-processing.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

后端和发布 worker 共用的 `isPublishImageProcessingEnabled()` 按调用时的环境值判断。X 的主帖、评论、回复和文章均在读取原件后应用该规则。未设置和空值时，普通图片等比缩放到宽 1000 后作为 GIF 发送，静态图和动画使用各自的上传类别。文章附件、封面和内嵌图以相同宽度转为 JPEG。非空时，使用原图字节，按实际内容设置 MIME。静态图片和 GIF 动画分别执行 X 的大小限制，格式不支持、文章 GIF、无法识别的图片及平台返回的 400/422 拒绝均有原因。上传压图与 MP4 的分段传输各沿用原有路径。

`pnpm exec vitest run tests/x-publish-image-processing.test.ts --maxWorkers=1` 通过 17 项。测试使用本地 HTTPS 地址样例、内存中的 Blob 源站 响应和本地文件，记录 X SDK 的初始化、分段请求及草稿或回复请求体。覆盖开关未设置、空值、`true`、`false`、`0`，包括扩展名与实际 PNG 不同、原始 WebP、两帧 GIF、超限 PNG、文章三类图片及其媒体 ID、两级回复、分两段发送 MP4，以及本地文件目录没有生成发布副本。真实平台及部署验收由环境交付步骤执行。[X 媒体格式与大小要求](https://docs.x.com/x-api/media/introduction)
