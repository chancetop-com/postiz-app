# 19: 验证文章、邮件与纯文字渠道

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 文章读者和邮件收件人可以通过正文或封面看到入库媒体，纯文字渠道按既有形式发布。

渠道标识：`medium`、`devto`、`hashnode`、`wordpress`、`listmonk`、`kick`、`twitch`、`moltbook`

- [x] Medium 的 Markdown 和 Listmonk 的 HTML 正文保留持久媒体地址。DEV.to、Hashnode 分别核对正文图片与封面字段。
- [x] WordPress 从同一篇文章验证两种附件用途。HTML 正文保留 Blob 源站 地址，特色图片使用 WordPress 要求的传输方式并在发文请求中引用返回的媒体 ID。
- [x] Kick、Twitch、Moltbook 沿用支持的文字帖子、公告或回复，媒体记为不适用。复用已有文本回归，模拟发送不需要下载附件。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

在 `STORAGE_PROVIDER=azure` 下运行 `pnpm exec vitest run tests/azure-article-email-text.test.ts --maxWorkers=1`，15 项通过。文章和邮件从 worker 的 `postSocialPending` 入口开始，经过真实正文处理并记录平台请求。纯文字渠道从真实发布和回复入口发送。HTTPS 素材、平台响应在本地模拟。

| 渠道 | 平台收到的内容 | 拒绝场景 |
| --- | --- | --- |
| Medium | Markdown 正文保留内嵌图片地址，返回文章 ID | 403 进入渠道错误处理，保留平台响应 |
| DEV.to | `article.body_markdown` 内嵌图与 `article.main_image` 封面使用各自的 Blob 源站 地址 | 422 保留校验错误 |
| Hashnode | `publishPost` 的 `contentMarkdown`、`coverImage` 保留两个绝对地址 | HTTP 200 内的 GraphQL 错误传回排程 |
| WordPress | 同一篇文章的正文保留 Blob 源站 图；worker 匿名 GET 另一张封面，把原始 PNG 字节、类型和文件名提交给媒体库，发文时使用返回的 `featured_media` 数字 ID | 媒体库返回 400 时停止发文 |
| Listmonk | HTML 正文保留图片，按返回的活动 ID 启动发送，模拟收件人可按正文地址匿名读回 PNG | 创建活动返回 400 时停止发送 |
| Kick | 文字消息与后续回复保留目标消息 ID | 聊天返回 403 时保留错误 |
| Twitch | 文字聊天、回复以及自选颜色的公告；接受公告的 204 响应 | 403 公告拒绝抛出带平台原因的错误 |
| Moltbook | 文字帖子与带父评论 ID 的回复 | 平台返回失败时保留原因 |

Kick、Twitch、Moltbook 的图片及视频发送不适用，带附件的样例也未触发媒体请求。模拟测试覆盖请求和返回给排程的结果，dev Blob 源站 匿名访问、真实投递和真实发帖仍需环境验收。

Medium 创建文章收到 5xx、连接中断或缺少文章标识时，将结果记为未确认，提示核对已发文章。创建请求只发送一次。
