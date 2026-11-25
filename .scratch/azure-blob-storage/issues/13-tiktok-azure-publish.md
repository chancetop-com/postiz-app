# 13: 让普通 TikTok 和 TikTok Business 发布 Azure 媒体

Status: resolved
Blocked by: 06, 11

**What to build:** 运营者使用新入库的 Azure 图片和视频排程 TikTok。发布进程准备渠道需要的版本，并沿原发布标识跟踪已受理的内容。

渠道标识：`tiktok`、`tiktok-business`

- [x] 普通 TikTok 的照片和视频，在直接发布及发送到收件箱两种模式下均使用 PULL_FROM_URL。TikTok Business 使用既有图片、视频及可选封面的 URL 字段。
- [x] 默认将入库后仍为 PNG 的文件以质量参数 100 转成组织目录中的独立 JPEG 副本。平台得到副本地址，媒体库仍可读回原 PNG。关闭处理时跳过副本，发送符合平台规则的原图，对不兼容原图给出原因。
- [x] 模拟平台返回 url_ownership_unverified 时保留错误并指出需验证媒体 URL 前缀。拒绝拉取后不回退到文件上传；平台已受理时沿原发布标识查询状态，重试沿用原传输方式。
- [x] 扩展现有 TikTok 模拟请求用例，核对模式、媒体类型及发出的 Blob 源站地址。应用后台验证和真实发帖由环境负责人按手册操作。

用本地 HTTPS 媒体样例和模拟平台请求验收，复用既有 R2 发布路径与回归，只为行为变化或关键覆盖缺口补用例。

[父规格](../spec.md) · [媒体传输规则](03-social-media-delivery.md#answer) · [逐渠道清单](04-platform-scope.md#各渠道的改动与验收)

## Answer

- 普通版在直接发布及收件箱模式下，图片按原顺序进入 `photo_images`，视频通过 `video_url` 拉取。视频初始化前不读取 Blob。Business 两种模式继续使用图片、视频及自定义封面的 URL 字段。dev 公开地址采用 Blob 源站的 `/postiz/dev/<merchantId>/<文件>`。
- 发布活动从集成记录取得组织 ID。平台收到组织目录下独立的质量 100 JPEG，原媒体记录仍能读回相同 PNG 字节。开关未设置和空值覆盖两个接入。开关为 `true`、`false`、`0` 时，WebP 使用原地址；伪装成 WebP 的 PNG 在发送前返回格式原因。大小和尺寸限制也在校验与发布准备阶段执行。可从头部读出尺寸的图片只取前 64 KiB，大图测试覆盖三种 WebP 编码。
- 模拟平台拒绝前缀时返回 `url_ownership_unverified` 并提示验证媒体 URL 前缀。模拟 503、处理中、发布完成及投递收件箱，查询复用平台返回的原标识。另验证 R2 的视频分块字节和本地存储的图片公开地址。
- 运行 `pnpm exec vitest run tests/tiktok-azure-publish.test.ts tests/tiktok-ai-disclosure.test.ts tests/temporal-fault-recovery.test.ts --maxWorkers=1`，三个测试文件共 56 项通过，其中 24 项为本票新增。测试使用模拟 HTTPS 请求和 Blob SDK 写入边界。实际 dev 匿名读取、TikTok 应用前缀验证与真实发帖由环境负责人执行。
