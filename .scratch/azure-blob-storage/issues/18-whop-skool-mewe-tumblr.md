# 18: 验证 Whop、Skool、MeWe、Tumblr 的附件发布

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 发布进程在无上传盘时仍能读取媒体元数据、发送所需附件并引用平台结果。

渠道标识：`whop`、`skool`、`mewe`、`tumblr`

- [x] Whop 帖子和回复核对附件长度、上传结果与处理完成后的 ID。Skool 核对帖子和回复的文件长度、MIME、流式字节及文件 ID。
- [x] MeWe 核对照片 ID 并保留当前不支持 MP4 的反馈。Tumblr 分别核对纯文字、图片、视频及可选缩略图，读取元数据后仍使用正确内容。
- [x] 按具体接口选择 Blob 源站 地址或文件字节。用模拟平台核对附件字段、适用的错误和异步状态，沿用现有发帖与回复入口。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)


## Answer

在 `tests/azure-community-attachments.test.ts` 中通过渠道的发帖、回复和校验入口调用模拟 HTTPS Blob 源站 与平台。运行 `pnpm exec vitest run tests/azure-community-attachments.test.ts --maxWorkers=1`，18 项通过。

- Whop 主帖与回复先 HEAD 取长度，再向平台给出的上传地址 PUT 原字节和签名请求头。测试让同一个文件 ID 先返回 processing 再返回 ready，并验证论坛附件和回复的 parent_id。平台缺少上传目的地或处理失败时停止发帖。[文件上传接口](https://docs.whop.com/api-reference/files/create-file) · [论坛接口](https://docs.whop.com/api-reference/legacy/forum-posts/create-forum-post)
- Skool 主帖与回复沿用当前文件接口。核对文件记录的长度、MIME，PUT 的流式字节及最终 attachments 字段，回复同时核对 root_id 和 parent_id。缺文件 ID 或上传被拒后停止发帖。此覆盖依据现有适配器和本地模拟，平台的私有接口未在真实账号上验证。
- MeWe 用 multipart 发送照片，时间线请求引用上传返回的照片 ID。Blob 源站 读取失败或平台未返回照片 ID 时终止。含 MP4 的帖子在校验和实际发布时均返回原因，避免混合帖子只发出照片。[MeWe 开发者文档](https://developer.mewe.com/api-docs)
- Tumblr 纯文字使用 JSON，原生图片与视频使用 NPF 用户附件 multipart。测试解析实际请求体，逐字节核对文件，并检查文件标识、MIME、图片尺寸及替代文本。已有视频缩略图用于读取尺寸，未选缩略图时沿用 540 × 405 的默认值。返回结果包含发帖 ID，平台拒绝内容时返回错误。[NPF 用户附件接口](https://github.com/tumblr/docs/blob/master/api.md#user-uploaded-media)

以上均为本地验证，真实社媒发布与 dev 无盘 Pod 环境验收另行执行。
