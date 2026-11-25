# 06: 通过公开 API 将附件写入 Azure

Status: resolved
Blocked by: None (can start immediately)

**What to build:** 公开 API 客户端沿用原有 multipart 请求，把图片或视频写入当前组织的 Azure 目录，取得可以直接预览的媒体记录。以 R2 现有存储接口和调用链为起点。

- [x] 选择 azure 后，服务端从已认证的请求取得组织并生成对象键。后端和写媒体的任务进程共用同一套组织目录与 Blob 源站地址规则。local 和 cloudflare 仍可使用原有调用方式。
- [x] 从公开 API 入口上传样例，保持既有鉴权、请求字段、响应形状、类型校验与流式大小限制。记录归属请求组织，持久 HTTPS 地址由存储账户的 Blob 端点、容器和对象键组成。
- [x] 在本地使用 HTTPS Blob 测试服务，按返回地址匿名读回实际上传的字节和 Content-Type。Azure 模式可在无上传盘时运行，入库后直接提供文件，不触发外部转码。

以现有 R2 行为和测试为参照，在本地验证 Azure 的差异。真实环境配置与验证由环境负责人按手册执行。

[父规格](../spec.md) · [存储与源站约定](02-environment-and-urls.md#answer)

## Answer

公开 API 的 `POST /public/v1/upload` 沿用 API Key 鉴权和 multipart 的 `file`、`adjust` 字段。Multer 从鉴权中间件设置的 `req.org.id` 取得组织，用实际文件类型的扩展名及服务器生成的 UUID 构造对象键。SDK 向 Blob 暂存分块，全部通过大小检查后提交。媒体记录保存 Blob 源站的 HTTPS 读取地址。即使设置了 RunPod 环境变量，Azure 入库也直接返回 ready。

dev 使用 `AZURE_CONTAINER=postiz` 和 `AZURE_BASEPATH=dev`，持久地址形如 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<merchantId>/<文件名>`。省略或留空基础路径时，`<merchantId>/` 目录直接位于容器下。服务器与写媒体任务通过同一个 Blob 客户端构造上传和读取路径。持久地址只保留 HTTPS 源和编码后的路径，凭据和 SAS 查询参数仅供授权请求使用。流、文件和简单上传均使用服务端鉴权得到的组织 ID 作为 `merchantId`。

本地 Nest HTTP 测试使用实际的公开控制器、鉴权中间件、服务、仓储和 Azure SDK。外部依赖由内存数据模型和回环 HTTPS Blob 服务提供。

- JPEG、PNG、GIF、WebP、AVIF、BMP、TIFF 和 MP4 按内容识别类型，匿名读取媒体记录的 Blob 地址得到原始字节及正确的 Content-Type。伪造的表单组织字段不能改变归属。
- 精确 10 MiB 图片和 1 GiB 视频可提交，各自多一个字节时被拒绝。超限时没有已提交对象或媒体登记。错误 API Key 和非媒体字节同样被拒绝。
- 未设置上传盘目录时，`tests/azure-blob-origin.test.ts` 用省略、留空、`dev` 和 `/qa/east/` 四种前缀分别写入和匿名读回同一 PNG。4 项源站回归覆盖由账户名推导 dev 地址、自定义 HTTPS 端口和路径、清除 SAS、拒绝 HTTP，以及编码空格、保留字符和中文。空键为 MCP 提供容器地址。
- 公开 API 与原有上传回归 25 项通过，其中包括实际传输 1 GiB 和 1 GiB 加一个字节的视频。可用 `AZURE_UPLOAD_LARGE_VIDEO_TEST=1 pnpm exec vitest run tests/azure-blob-origin.test.ts tests/azure-public-api-upload.test.ts tests/media-api-upload.test.ts tests/media-upload-server.test.ts --maxWorkers=1` 重跑全部 29 项。默认运行跳过大视频用例。

dev 存储账户的授权和容器的匿名 Blob 读取权限由环境负责人按第 20 票实测。
