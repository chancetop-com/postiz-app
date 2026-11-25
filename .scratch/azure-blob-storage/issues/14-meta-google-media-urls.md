# 14: 验证 Meta 与 Google Business Profile 的 Blob 源站 拉取

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 运营者把同一份入库媒体用于 Meta 或 Google Business Profile，发布进程将持久 Blob 源站 地址放入对应的渠道字段。

渠道标识：`instagram`、`instagram-standalone`、`facebook`、`threads`、`gmb`

- [x] Instagram 的 Facebook 接入和独立登录接入按各自 Graph 主机核对单图、轮播、Reels、限时动态及适用封面的 URL。
- [x] Facebook 核对普通帖及动态中的单图、多图、视频。Threads 核对单项、轮播和带媒体回复的图片或视频字段。
- [x] Google Business Profile 的单图文字帖使用 sourceUrl，保留对视频和多图的限制。
- [x] 从模拟平台核对实际出站 URL 和拒绝时返回的错误。纯 URL 拉取无需为转发下载完整文件，失败时不改走字节上传。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

- Instagram 两种接入向各自的 Graph 主机提交原始 Blob 源站 地址。修复了嵌套 URL 的编码问题，文件名中的 `+` 和 `%2B` 能原样到达平台。覆盖单图、Reels 自定义封面、混合轮播、单条及多条限时动态，并核对轮播发布使用平台返回的容器 ID。
- Facebook 普通图片使用 `url` 上传并以照片 ID 关联到帖子，普通视频使用 JSON 的 `file_url`。图片动态沿用照片接口，视频动态把 `file_url` 放入上传请求头，再按原视频 ID 查询处理状态。媒体回复使用 `attachment_url`。Threads 的单项、混合轮播和回复分别使用 `image_url` 或 `video_url`，回复指向上一条评论。
- Google Business Profile 的单图文字帖通过 `mediaFormat: PHOTO`、`sourceUrl` 发出。实际发送前复用渠道校验，视频及多图会返回明确原因，避免截取第一张图片或向平台发送不支持的视频。
- 运行 `pnpm exec vitest run tests/azure-meta-google-media.test.ts tests/instagram-ai-disclosure.test.ts tests/instagram-location.test.ts --maxWorkers=1`，共 70 项通过，其中新增 32 项。模拟平台核对五个注册标识的出站请求、返回的标识及拒绝原因，并检查是否出现额外下载或上传请求。范围为本地模拟平台；dev Blob 源站 对外可达性及真实账号发帖按部署验收安排执行。
