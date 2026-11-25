# dev 的 Azure 存储目录、媒体域名和凭据如何配置

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: chancetio
Resolved: 2026-11-25
Blocked by: 01

## Question

依照[上传授权约定](01-upload-authority.md)，Postiz 的新文件使用哪个账户、容器和环境目录？媒体库保存哪个公开读取地址？dev ConfigMap 和加密 Secret 分别需要哪些配置？

FBR 的 `file-service` 已使用 `static` 容器。dev、UAT、prod 的既有目录分别为 `static/fbr-dev/product`、`static/fbr-uat/product`、`static/fbr-prod/product`。dev 存储账户为 `fbrdevstorage`，连接字符串存放在 SOPS 加密的 `file-service-config` 清单中。下文约定 Postiz 的 dev 部署。

本票应定下 Postiz 的对象命名空间、读写地址的构成、所需环境变量与归属，以及切到 Azure 后 dev 媒体上传盘的处理方式。

[FBR dev 存储属性](</Users/chancetio/Desktop/Java/fbr-project/backend/file-service/conf/dev/resources/azure.properties>) · [容器和跨域配置](</Users/chancetio/Desktop/Java/fbr-env-project/azure/infra/env/11-storage.tf>) · [FBR UAT 路径](</Users/chancetio/Desktop/Java/fbr-project/backend/file-service/conf/uat/resources/azure.properties>) · [FBR prod 路径](</Users/chancetio/Desktop/Java/fbr-project/backend/file-service/conf/prod/resources/azure.properties>) · [Postiz dev 部署](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/postiz/04-postiz.yml>) · [Postiz 加密 Secret](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/secrets/enc/59-postiz-secret.enc.yml>)

## Answer

dev 复用 FBR 的存储账户 `fbrdevstorage`。环境负责人在账户下新建与 `static` 并列的 `postiz` 容器。路径中的 `merchantId` 使用服务端鉴权得到的当前 Postiz 组织 ID。所有 Postiz 媒体最终以 `dev/<merchantId>/<后端生成的文件名>` 为 Blob 名。浏览器、发布进程和渠道均从账户的 Blob HTTPS 端点直接读文件。

实施时在 `fbr-env-project` 使用下列配置。Postiz 后端和需要写入媒体的任务进程从运行环境读取服务端配置。

| 配置位置 | 环境变量 | dev 约定 |
| --- | --- | --- |
| `postiz-config` | `STORAGE_PROVIDER` | `azure` |
| `postiz-config` | `AZURE_CONTAINER` | `postiz` |
| `postiz-config` | `AZURE_BASEPATH` | `dev` |
| `postiz-config` | `DISABLE_PUBLISH_IMAGE_PROCESSING` | 未设置或留空时默认开启自动处理，设为 `"true"` 可关闭。[发布图片处理开关](05-publish-image-processing.md#answer) |
| `postiz-secret`（SOPS 加密） | `AZURE_CONNECTIONURL` | 对应 dev 存储账户的服务端连接字符串 |

以容器 `postiz` 内的 `dev/merchant-123/example.mp4` 为例，持久读取地址为 `https://fbrdevstorage.blob.core.windows.net/postiz/dev/merchant-123/example.mp4`。服务端从连接字符串中的 Blob 端点和配置的容器构造地址。浏览器只在向授权的 Blob 写入时使用短期 SAS，读取已登记媒体无需查询参数或 Postiz 会话。浏览器用限创建的 SAS 直接写入该最终地址。文件一经提交即可匿名读取，写授权到期后仍可读取。确认校验通过后才可登记媒体。

用户明确旧媒体无需迁移或维持访问。实施 Azure 模式并切换 dev 时，可从 `04-postiz.yml` 移除挂载到 `/uploads` 的 `uploads` volumeMount、对应的 volume 和 `postiz-uploads-pvc` 声明（10 GiB）。本地存储专用的路径配置应退出 Azure 的运行依赖。PostgreSQL、Temporal PostgreSQL 和 Temporal Elasticsearch 有独立的数据卷。以后若回到 `local` 并需要持久写入，需为本地上传重新提供卷。

卸载会使仅存在于旧盘的媒体链接失效，依赖它们的已排程帖子可能发布失败。按本次约定保留数据库原有记录；不为这些附件做迁移或修复。部署验收覆盖无上传盘启动、跨域直传、从 Blob 源站匿名读取、URL 导入和后台生成媒体，以及[发布请求使用的 Azure 媒体地址和字节](03-social-media-delivery.md#answer)。

dev 的 `ssd-zrs-wait` 使用 `Retain` 回收策略。移除清单或卸载卷不会释放底层 Azure 磁盘，即便删除 PVC，按该策略创建的磁盘仍需单独回收。实际回收前按绑定 PV 的策略和磁盘标识核对目标。[dev StorageClass](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/01-storage.yml>) · [Kubernetes 持久卷回收](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#retain)

### dev 环境仓库待办

以下事项供 Postiz 支持 Azure 后切换 dev 时使用。账户与凭据按目标环境核对。

- [ ] 在 `04-postiz.yml` 的 `postiz-config.data` 填写上表的存储模式、容器和基础路径。沿用默认图片处理时可省略 `DISABLE_PUBLISH_IMAGE_PROCESSING`。[Postiz dev 清单](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/postiz/04-postiz.yml>)
- [ ] 以 dev 的 `16-file-service-config.enc.yml` 中的 `data.AZURE_CONNECTIONURL` 为来源，按目标文件的 SOPS 规则写入 `59-postiz-secret.enc.yml` 的 `stringData.AZURE_CONNECTIONURL`。Postiz Pod 已通过 `secretRef` 加载该 Secret。仓库只保存加密后的凭据。[FBR 凭据来源](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/secrets/enc/16-file-service-config.enc.yml>) · [Postiz 目标 Secret](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/app/secrets/enc/59-postiz-secret.enc.yml>)
- [ ] 分两次更新同一部署清单。切换时先移除本地模式的 `UPLOAD_DIRECTORY`、`NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY`、`uploads` 挂载及对应 volume。无盘验证通过后再移除 `postiz-uploads-pvc` 声明并回收磁盘。见[停用和删除 dev 上传盘](#停用和删除-dev-上传盘)。
- [ ] 核对账户的 `AllowBlobPublicAccess` 已启用，`postiz` 容器的匿名访问级别为 `blob`。部署后用无凭据的 GET、HEAD 和单段 Range 验证同一文件，核对文件内容、Content-Type、长度和 206 响应。未授权的容器列表请求应被拒绝。[Azure Blob 匿名读取权限](https://learn.microsoft.com/azure/storage/blobs/anonymous-read-access-configure)
- [ ] 在 Blob 服务的 CORS 规则中核对 dev 网页来源 `https://postiz.connexup-dev.net`。来自该来源的 OPTIONS 预检须允许浏览器的 PUT 及 SDK 实际发送的请求头（含 `content-type`、`x-ms-*`）。需从网页跨域读媒体时同时允许 GET、HEAD 和使用的 Range 头。实际走一次 dev 网页直传，核对写入、确认和匿名读回。[现有账户 CORS 清单](</Users/chancetio/Desktop/Java/fbr-env-project/azure/infra/env/11-storage.tf>) · [Azure Storage CORS 规则](https://learn.microsoft.com/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services)
- [ ] 交付普通 TikTok 需要填写的 URL 前缀、验证文件的 Blob 路径及成功标志。应用后台操作和各渠道真实发布验收由用户安排。[普通 TikTok 的 dev 配置交接](03-social-media-delivery.md#普通-tiktok-的-dev-配置交接)

### 停用和删除 dev 上传盘

目标是 `dev/postiz-uploads-pvc`，即旧 `/uploads` 的 10 GiB 磁盘。新媒体写入 Azure 的 `postiz` 容器。PostgreSQL 和 Temporal 的数据卷有各自的 PVC。下面的命令用于切换当天，在同一终端中逐步执行。

1. **先记录旧盘身份。** 用 `kubectl config current-context` 核对 dev 集群。从上传 PVC 读取实际绑定的 PV，再从 PV 读取 Azure 磁盘的完整资源 ID，保存这两个值。核对输出中的 claim 为 `dev/postiz-uploads-pvc`、驱动为 `disk.csi.azure.com`、回收策略为 `Retain`。如果实际策略为 `Delete`，删除 PVC 会触发磁盘回收，应在第 2 步验收通过后才删除 PVC，并跳过手动删除 PV 和磁盘。[dev StorageClass](</Users/chancetio/Desktop/Java/fbr-env-project/azure/dev/kube/resource/01-storage.yml>) · [AKS 磁盘标识](https://learn.microsoft.com/azure/aks/create-volume-azure-disk)

   ```sh
   kubectl config current-context
   upload_pv=$(kubectl -n dev get pvc postiz-uploads-pvc -o jsonpath='{.spec.volumeName}')
   kubectl get pv "$upload_pv" -o custom-columns='CLAIM_NS:.spec.claimRef.namespace,CLAIM:.spec.claimRef.name,POLICY:.spec.persistentVolumeReclaimPolicy,DRIVER:.spec.csi.driver,DISK:.spec.csi.volumeHandle'
   upload_disk_id=$(kubectl get pv "$upload_pv" -o jsonpath='{.spec.csi.volumeHandle}')
   ```

2. **保留 PVC，先验证无盘运行。** 部署支持 Azure 的 Postiz 镜像与上表配置，按清单待办移除上传卷挂载。等待 `kubectl -n dev rollout status deployment/postiz` 成功。列出仍引用上传 PVC 的 Pod，命令成功且输出为空才表明已卸载。按[无盘 dev 验收](../dev-runbook.md#从无盘-dev-验收新媒体)逐项记录全部支持格式、分块中断重试、浏览器直传与匿名读回、公开 API、导入、后台生成和无盘发布回归。检查新文件落在 dev 的 Postiz Blob 前缀下。真实社媒发布由用户安排。

   ```sh
   kubectl -n dev get pods -o go-template='{{range .items}}{{$pod := .metadata.name}}{{range .spec.volumes}}{{with .persistentVolumeClaim}}{{if eq .claimName "postiz-uploads-pvc"}}{{println $pod}}{{end}}{{end}}{{end}}{{end}}'
   ```

3. **移除上传 PVC。** 验收通过后，从 `04-postiz.yml` 移除名为 `postiz-uploads-pvc` 的 PVC 声明并同步部署。若 PVC 仍存在，执行下列命令。对于 `Retain`，核对记录的 PV 进入 `Released`，且仍指向第 1 步记下的磁盘 ID。[Kubernetes 卷回收规则](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#reclaiming)

   ```sh
   kubectl -n dev delete pvc postiz-uploads-pvc --ignore-not-found
   kubectl get pv "$upload_pv" -o custom-columns='PHASE:.status.phase,DISK:.spec.csi.volumeHandle'
   ```

4. **回收保留的 Azure Disk。** 先用下面的只读命令核对资源 ID 和磁盘状态。待 `diskState` 为 `Unattached` 且 `managedBy` 为空，再逐条执行删除命令。永久删除磁盘会清除仅存于旧盘的附件。最后查询同一 PV 和磁盘，分别返回 `NotFound`、`ResourceNotFound` 即完成。[Azure Disk CLI](https://learn.microsoft.com/cli/azure/disk#az-disk-delete)

   ```sh
   az disk show --ids "$upload_disk_id" --query '{id:id,diskState:diskState,managedBy:managedBy}'
   ```

   ```sh
   kubectl delete pv "$upload_pv"
   az disk delete --ids "$upload_disk_id"
   kubectl get pv "$upload_pv"
   az disk show --ids "$upload_disk_id"
   ```
