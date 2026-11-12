# 部署配置与镜像来源核查

核查日期：2026-11-11（Asia/Shanghai）；ACR 查询约在 16:00–16:04 完成。
用途：为构建、运行兼容和本地验证方案提供输入。本文没有证明当前集群状态，也不是上线验收。

## 证据来源与边界

- 用户指定环境仓库：`/Users/chancetio/Desktop/Java/fbr-env-project`。工作区干净，`main` 与本地 `origin/main` 均为 `79b71db0a7ebfe599ffb3da01cc7d1b8bfa8cd2e`。本轮未 fetch，因此这不是远端分支实时最新性的证明。
- 清单目录：`azure/dev/kube/resource/app/ai/positz/`，读取了四个非 Secret YAML 文件。未打开其 `secrets/`，未解密或读取 Secret 值。
- [去敏清单快照](deployment-manifests-sanitized-2026-11-11.jsonl) 保留资源结构、允许输出的配置、Secret 引用名和源文件 SHA-256；数据库连接值及其它未列入白名单的环境变量值不输出。
- 本地构建来源：[已有打包证据](customization-packaging-evidence.md)，并重新只读核对了 `k8s/build-postiz.sh`、`k8s/Dockerfile` 与 GitHub 两条构建工作流。
- Azure CLI 当前账户元数据为 `fbr-dev / Enabled`；成功只读查询 ACR 镜像元数据和构建记录。CLI 更新了本机自身会话缓存，没有更改云资源。
- 无默认 kubeconfig，也无 `KUBECONFIG` 覆盖；未接入集群、启动应用、执行脚本、构建或推送镜像、运行迁移、读取业务数据库或 Temporal payload。Build 工作流未被重新启用。

## 环境仓库确认的配置

下表均为**版本库声明**，不能当成当前 Pod 的有效状态。主应用通过 ConfigMap 和 Secret 两个 `envFrom` 来源注入配置；未读取的 Secret 或集群覆盖可能影响实际值。

| 项目 | 观察结果 | 来源 |
| --- | --- | --- |
| 应用部署 | `dev-ai` namespace；1 副本、`Recreate`；节点选择 `envpool=aiapp` | `04-postiz.yml` Deployment |
| 应用镜像 | `fbrdevacr.azurecr.io/app/postiz:latest`，没有锁定 digest | `04-postiz.yml:76` |
| 配置注入 | 运行时引用 `postiz-config` 和 `postiz-secret` | `04-postiz.yml:79` |
| 应用与 API 地址 | `FRONTEND_URL=https://postiz.connexup-dev.net`；浏览器 API 为同域 `/api`；内部 API 为 `http://localhost:3000` | `04-postiz.yml:11` |
| SSO 验证端点 | `http://auth-service.dev.svc.cluster.local/auth/code/redeem`，是完整端点形态 | `04-postiz.yml:21` |
| 父应用 origin | 用户本轮提供 `https://merchant.connexup-dev.net`，路径 `/social-content-hub`；原 URL 的租户/商户参数未保存 | 用户输入；未执行实际 SSO/OAuth |
| 父域配置缺口 | ConfigMap 未声明 `NEXT_PUBLIC_SSO_PARENT_ORIGINS` / `SSO_PARENT_ORIGINS`；不能据此断言构建产物或整个环境未配置 | `postiz-config` keys |
| 公网路由 | HTTPRoute → `envoy-gateway-system/internal-gateway` 的 `https` listener → `postiz:3000` Service → Pod 5000；超时 300s | `04-postiz.yml:183` |
| 内网路由 | nginx Ingress：`postiz.dev.local` → Postiz；`temporal.dev.local` → Temporal UI；上传限制 500m、读写超时 300s | `04-postiz.yml:146` |
| 应用探针 | readiness 与 liveness 均请求 `:5000/api`，分别延迟 30s/60s；与镜像内 `/api/health` HEALTHCHECK 不同 | `04-postiz.yml:87`、`k8s/Dockerfile` |
| 启动依赖 | initContainers 仅等待 PostgreSQL、Redis、Temporal 的 TCP 端口；没有应用 schema 迁移步骤 | `04-postiz.yml` initContainers |
| 媒体 | `STORAGE_PROVIDER=local`，`/uploads`，10Gi ReadWriteOnce PVC | `04-postiz.yml:15`、`:130` |
| PostgreSQL | Postiz 与 Temporal 两个 Deployment 都引用 `postgres:15`，PVC 分别 10Gi/5Gi | `01-postiz-postgres.yml:26`、`:120` |
| Redis | `redis:7-alpine`；该 Deployment 未声明数据 PVC | `02-postiz-redis.yml:26` |
| Temporal | `temporalio/auto-setup:latest`；连接独立 PostgreSQL，开启 ES；地址 `temporal:7233` | `03-temporal.yml:150` |
| ES 与 UI | `elasticsearch:7.17.27`、10Gi PVC；UI 为 `temporalio/ui:latest` | `03-temporal.yml:58`、`:236` |
| Worker 源码默认值 | 当前 fork 的 namespace 默认 `default`，客户端 queue 为 `main`；worker 注册 `main` 及 provider 派生 queues。不是只有六个界面入口对应的 queue，也不是实际在线 worker 清单 | `libraries/nestjs-libraries/src/temporal/temporal.module.ts:15`；`apps/orchestrator/src/app.module.ts:19` |

四份清单中，数据库、Redis、Temporal 文件最后变更均为 `5d15e6352fb820737a3f6ff5f828152179b9af6d`（2026-03-30）；应用文件最后变更为 `70119a0e5eed8daa451b4bd7dde9717f579bf4dd`（2026-11-04，Revert "update postiz config"）。目录最近提交涉及 Secret，但该提交内容未读取。

与旧交接相比，公网 HTTPRoute 指向的是 Envoy Gateway；不能继续把旧文档中的 Azure AppGw/nginx public ingress 描述当作现行清单。另不能用本地 Compose 的 PostgreSQL 17、Temporal 1.28.1 代表部署环境版本。

## ACR 直接观察

查询 registry `FBRDevAcr` 的 repository `app/postiz`，标签列表返回三项：

| 标签 | digest | lastUpdateTime（UTC） |
| --- | --- | --- |
| `latest` | `sha256:c4797bee9d4f3ab42297732c66001360a148a95dfd07eb50a89f0f67102780bc` | `2026-05-08T09:22:39.1776325Z` |
| `f042c17` | `sha256:c4797bee9d4f3ab42297732c66001360a148a95dfd07eb50a89f0f67102780bc` | `2026-05-08T09:22:37.9899134Z` |
| `0b554e6` | `sha256:d4f50aa000a2f9072fabb4fdc1dc7b98785012e8cf0c2af13234fecf60a5e629` | `2026-04-23T12:01:47.0501501Z` |

- 未看到第二定制提交 `6fdf7cb5` 对应标签。`latest` 与第一定制提交缩写标签同 digest 是来源线索，**不证明**该镜像严格来自第一提交、包含/不包含第二提交，或正在被集群使用。标签可变，打包也可能来自未提交工作区。
- `az acr task list-runs --registry FBRDevAcr --image app/postiz --top 20` 返回 `[]`；只能说明本次查询没有返回 Postiz 构建记录，不能推断它从未用 ACR 构建。
- 没有取得来源 commit 的不可变构建证明，也没有读取镜像内文件或现网 Pod imageID。

可复核的只读查询（执行时仍需已有 Azure 登录）：

```sh
az acr repository show --name FBRDevAcr --image app/postiz:latest --query '{digest:digest,createdTime:createdTime,lastUpdateTime:lastUpdateTime,tags:tags}' --output json
az acr repository show-tags --name FBRDevAcr --repository app/postiz --detail --orderby time_desc --top 10 --query '[].{name:name,digest:digest,createdTime:createdTime,lastUpdateTime:lastUpdateTime}' --output json
az acr task list-runs --registry FBRDevAcr --image app/postiz --top 20 --query '[].{runId:runId,status:status,runType:runType,createTime:createTime,finishTime:finishTime,outputImages:outputImages,sourceTrigger:sourceTrigger}' --output json
```

## 构建来源：已知与未知

- 仓库现有 ACR 脚本的 `POSTIZ_DIR` 固定为 `/Users/cyril/workspaces/postiz-app`，本机不存在该路径。默认分支从该目录复制根源码到 `k8s/` 后构建；`--local` 分支推送已有镜像。两个分支最终都会部署，均未运行。
- 环境清单只消费 ACR 镜像，不声明 Dockerfile、源码 commit 或构建命令。环境仓库的 tracked 文件中没有找到 Jenkinsfile、Azure Pipeline、GitHub/GitLab 工作流或 Argo/Flux 命名入口；这不排除外部流水线或人工操作。
- Postiz 的 `Build` 工作流只是 pnpm build；`Build Containers` 使用根 `Dockerfile.dev` 发布 GHCR，不能据此认定它生产了 ACR 镜像。
- 当前 `k8s/Dockerfile` 只声明 NODE_ENV 构建参数；清单运行时 `envFrom` 不能证明 Next.js 浏览器包中的 `NEXT_PUBLIC_*` 值正确。构建票需要确定注入和验证方案。
- 版本库与 ACR 已足以确定本轮要覆盖的构建/运行契约。实际历史生产命令仍未知，后续方案应保证新产物与验证过的源码可追溯，而不是以未证实的历史命令为依据。

## 交给后续决策的输入

- [决定源码构建与部署运行时的升级方式](../issues/07-build-runtime-strategy.md)：解决根源码与 k8s 副本来源、不可变产物记录、公开环境变量、当前路由/探针/媒体契约以及不会附带部署的本地构建入口。
- [决定现有数据与 Temporal 任务的兼容升级路径](../issues/08-data-temporal-upgrade.md)：以 PostgreSQL 15 的声明和旧 worker 源码为输入，设计本地数据与 workflow 兼容验证。对未知在途任务采用明确保守策略，不把未知当作“没有任务”。
- [决定合并验收与执行交接标准](../issues/09-acceptance-execution-handoff.md)：分别报告源码/本地验证、需要真实账号的端到端验证、未来上线前运行态核验。测试商户及真实 OAuth 验证负责人尚未指定，不能写成已通过。

## 未来上线前才核验的运行事实

下列事实仍未知，保留为未来上线交接项；不以提供现网访问、运行真实迁移或完成上线作为当前地图/代码合并的条件：

1. 目标集群实际 Pod imageID、镜像来源 commit、PostgreSQL/Redis/Temporal 实际版本，以及现行配置与版本库的漂移。
2. 实际 Temporal namespace、worker/queue、在途/定时 workflow 类型与数量；根据后续兼容方案决定是否需要真实 history 的去敏 replay 或其它上线前检查。
3. 实际数据库与媒体备份、恢复验证、独立演练环境的可用性和执行责任人。
4. 若以后验证真实父页和渠道 OAuth，使用测试商户及授权账号，并记录真实结果。本轮仅取得父应用入口，没有实际登录或 OAuth 操作。

这些缺口不撤销数据保留和定制 flow 的要求，也不构成上线就绪声明。
