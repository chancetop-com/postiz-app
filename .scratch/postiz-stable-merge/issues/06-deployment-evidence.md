# 取得真实部署入口与外部环境证据

Labels: wayfinder:task
Type: task
Mode: HITL
Status: resolved
Assignee: chancetio
Parent: ../map.md
Blocked by: —
Created: 2026-11-11
Resolved: 2026-11-11

## Question

在用户当前不确定线上入口的情况下，取得足够的部署配置与构建来源证据，让构建、运行兼容和本地验证路线有依据；区分已证实配置和仍未知的运行事实。

本票沿用地图已有的“先规划、不部署”边界：以下运行态信息能只读取到则记录，不能取得则明确留在未来上线交接项，不以现网接入、真实备份恢复或上线完成阻塞当前地图。此范围澄清保留原始取证清单，不把尚未取得的事实标为已验证。

需要取得可只读核对的路径或去敏配置：
- 旧交接指向的 fbr-env-project 及 azure/dev/kube/resource/app/ai/positz 清单的现行版本、真实部署环境和实际 CI/构建命令。
- 当前运行镜像的不可变 digest/来源 commit、是否通过 k8s/build-postiz.sh 构建、是否存在其它同步或发布步骤。
- 应用入口/iframe 父域名、API 反代、SSO 完整验证 URL 的形态、相关配置由构建期还是运行期提供；无需提供 secret 值。
- Postgres/Redis/Temporal 版本、worker/task queue 配置、持久化媒体与健康检查、历史定时任务/在途任务是否存在。
- 数据备份/恢复与测试环境是否可用，以及谁可进行真实 OAuth 验证。

先使用已授权的本地/连接来源只读核查；仍缺资料时给用户最小且明确的清单。不得运行发布脚本、访问 secret 内容、写集群或迁移数据库。

## Comments

- 用户明确答复：目前不确定真实线上构建入口，先列为待核实项。
- 旧交接给出了历史 AKS/ACR 架构，但描述不是现网证明；文档本身不能关闭本票。
- 2026-11-11：先以 `Status: claimed`、`Assignee: chancetio` 领取。用户指定 `/Users/chancetio/Desktop/Java/fbr-env-project` 后，已只读核对现行 checkout 中的四份部署清单和 ACR 元数据。
- 2026-11-11：用户对要求现网入口/备份等资料追问“为什么需要这个”。据地图原有范围纠正取证边界：这些事实主要服务未来上线，不应成为本次规划的新增前置条件；没有把用户的追问解释成这些检查已经通过。用户同时提供父应用 `/social-content-hub` 入口，记录 origin 与路径，不保存租户/商户参数。

## Answer

已取得本轮规划所需的部署配置、镜像元数据和父应用入口，关闭本任务票；完整事实及局限见 [部署配置与镜像来源核查](../assets/deployment-evidence-2026-11-11.md)，原始结构证据见 [去敏清单快照](../assets/deployment-manifests-sanitized-2026-11-11.jsonl)。本结论不表示真实运行环境已验证或可以上线。

- 构建/运行输入以用户指定环境仓库 `79b71db0` 的 `azure/dev/kube/resource/app/ai/positz/` 为依据：ACR 镜像、运行时 ConfigMap/Secret 引用、Envoy 公网 HTTPRoute、nginx 内网 Ingress、探针和持久化路径均已定位。
- 声明的依赖为 PostgreSQL 15、Redis 7-alpine、Temporal latest、ES 7.17.27；不能拿本地 Compose 的版本替代，也不能由可变标签断言实际运行版本。
- ACR `latest` 与 `f042c17` 同指 `sha256:c4797bee9d4f3ab42297732c66001360a148a95dfd07eb50a89f0f67102780bc`；查询没有返回 Postiz 构建记录。实际来源 commit、是否含第二定制提交、是否正被集群使用仍未知，不据此改变定制基准 `6fdf7cb5`。
- 父应用 origin 为用户提供的 `https://merchant.connexup-dev.net`；入口路径 `/social-content-hub`。真实 SSO/OAuth 验证未执行。
- 构建票继续决定源码进入产物的方式及兼容配置；数据票继续决定保守的数据/workflow 兼容路线和本地验证；验收票记录真实环境未验证项。现网 Pod、在途任务及备份恢复实况归入未来上线前核验，不再阻塞本轮。

本轮没有产品代码改动、镜像构建/推送、线上部署、数据迁移或 Secret 读取，未启用 Build 工作流。

