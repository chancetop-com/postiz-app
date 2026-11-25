# 20: 按最终实现校准真实环境操作手册

Status: resolved
Blocked by: 08, 09, 10, 12, 13, 14, 15, 16, 17, 18, 19

**What to build:** 向环境负责人交付可直接照做的 dev 操作手册。验收对象是文档中的配置、操作顺序、示例和完成标志；部署、真实环境验证、平台配置与磁盘回收均由环境负责人执行。

- [x] 对照交付版本校准已有手册，写明后端与 worker 的 Azure 配置、SOPS Secret、组织对象前缀、源站写入及 Blob 源站匿名读取地址。示例不含实际凭据和 SAS。
- [x] 写清两次切换。先记录旧盘身份，保留 PVC、卸载上传卷；用少量代表样例检查网页、公开 API、导入、后台生成和 Blob 源站读回。列出失败时的回退步骤，再说明按实际回收策略核对并回收旧上传盘。
- [x] 给出普通 TikTok 的 URL 前缀、验证文件在 `postiz` 容器的 `dev/<验证文件名>` 位置及完成标志；真实发帖由负责人选择账号和时机。发布行为以本地模拟回归为依据，格式和渠道清单供按需排查。
- [x] 在本地核对变量名、接口、文档链接及命令示例与最终实现。可从工单追溯 35 个渠道的覆盖情况。工单在手册交付时完成。

[父规格](../spec.md) · [dev 操作手册](../dev-runbook.md) · [环境切换约定](02-environment-and-urls.md#answer)

## Answer

[dev 操作手册](../dev-runbook.md) 已按交付版本核对。它列出前端、后端和 worker 的配置归属、服务端 SOPS Secret、最终 Blob 的 2 小时创建 SAS、申请与确认路由，以及公开 API 和生成入口的返回结果。确认后的读路径为 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/<merchantId>/<后端生成的文件名>`。真实环境使用同一 MP4 核对无凭据 HEAD、Range 206 和 SHA-256，并在写授权过期后再次读取。普通 TikTok 的应用、验证前缀、文件位置和验收标志见[渠道交接](../dev-runbook.md#渠道交接)。

- [发布回归索引](../dev-runbook.md#发布回归索引)逐组链接工单 11–19 的结果与对应测试文件。将每行标识与交付版本的 `socialIntegrationList` 核对，35 个注册标识全部覆盖，每个仅列一次。规划矩阵已同步普通 TikTok 两种视频传输分支、LinkedIn GIF 原件和 MeWe 混合视频拒绝的行为。
- 在本地解析手册、03、04 和本票的仓库文件链接与标题锚点。五段命令均通过对应 shell 和 Zsh 语法检查；Kubernetes 查询通过本地命令替身核对参数和 PV 身份传递。对回环 HTTPS 服务运行手册的 curl 示例，使用真实 MP4 核对 OPTIONS、匿名 HEAD、16 字节 Range、流式 SHA-256 和匿名列表被拒；替换原文件后摘要检查失败。
- 运行 `pnpm exec vitest run tests/azure-blob-origin.test.ts tests/azure-youtube-reddit-pinterest.test.ts --maxWorkers=1`，19 项通过，覆盖[源站地址和匿名读回](../../../tests/azure-blob-origin.test.ts)、[按 Range 续传及渠道发送](../../../tests/azure-youtube-reddit-pinterest.test.ts)。这些结果来自本地 HTTPS 服务和模拟渠道。

部署、真实 Blob CORS 与匿名访问、TikTok 应用前缀验证、真实发帖及第二阶段 PVC/PV/Disk 回收均留给环境或渠道负责人。第一次部署保留旧 PVC；手册给出原卷恢复步骤，以及按实际 `Retain` 或 `Delete` 策略回收的完成标志。

回收旧盘前，负责人逐项记录无盘 dev 的各格式预览和匿名读回、分片重试、公开 API、导入、后台生成及发布回归结果。
