# 决定源码构建与部署运行时的升级方式

Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: resolved
Assignee: chancetio (agent wayfinder_build_runtime_strategy)
Parent: ../map.md
Blocked by: 01, 02, 06
Created: 2026-11-11
Resolved: 2026-11-11

## Question

如何让实际部署产物包含稳定版的全部更新与保留的定制，同时逐项决定现有 k8s 副本、根目录构建和运行配置的保留方式？

需要决定：
- 以实际部署证据选择支持的构建入口；k8s/build-postiz.sh 已有根源码复制步骤，不能基于“必须手动同步”的错误前提重构。
- k8s 中独有内容与真正复制内容分别如何处理；是否保留目录结构或改变源码来源必须具体决定，而非预先删除副本。
- 新版 Node/pnpm、构建产物、前端环境变量、standalone 输出与 PM2/nginx 启动方式如何适配。
- iframe CSP、跨域响应头、长请求/上传限制、静态媒体路径、日志、探针、存储挂载等哪些是运行契约，哪些是历史配置。
- 各构建入口对数据库初始化/升级的隐式动作如何显式交给数据迁移决策。
- 本仓库与外部环境仓库的改动边界，怎样证明最终镜像使用的是已验证的源代码。

用户已明确线上部署由其最后另行决定。本票仅确定构建和运行兼容方案，禁止以“保留部署能力”为理由实际触发 ACR build/push、kubectl 或生产启动；本地构建验证必须选用不会附带线上动作的入口。

## Comments

- 2026-11-11：[部署配置与镜像来源核查](../assets/deployment-evidence-2026-11-11.md) 已取得用户指定环境仓库的四份清单、ACR digest/tag 与父应用入口。后续以已声明的运行契约规划本地构建；历史实际构建命令与在线 Pod 状态未知，不再要求先接入现网。重点覆盖 Envoy 公网 HTTPRoute、运行时 envFrom 与构建期公开配置的区别、探针 `/api` 与镜像 HEALTHCHECK `/api/health`、新产物对源码的可追溯性。方案尚未在本票决定。
- 2026-11-11：[打包与副本证据](../assets/customization-packaging-evidence.md) 已全量覆盖 804 个 k8s 路径。诊断合并后它们全部仍是 C 的 blob；与稳定版根目录有 351 个不同 blob，不能把干净合并当成副本已升级。
- 默认构建脚本会从硬编码目录重新复制源码，但保留的独有 Dockerfile 仍为 Node22.20；S 要求22.23.4、pnpm10.6.1。`--local` 不复制源码，且两个模式均会部署，不能直接作为本地验证入口。
- 两个 k8s Dockerfile 实际使用 `var/docker/ecosystem.config.cjs`，不是旁边那份不同的 `k8s/ecosystem.config.cjs`；runtime Dockerfile 的输入又被 .dockerignore 排除。需要按真实入口裁定，不能从文件名推测部署行为。
- 根 standalone 配置、构建时公开环境变量、Next 产物及 public 复制、挂载权限和 Node/Volta 差异应纳入所选路径。当前依赖与产物均缺失，构建能力未验证；详见 [本轮基线](../assets/three-way-evidence.md)。

### 2026-11-11 本轮核查与决定依据

- 先认领，再使用 wayfinder、grilling、domain-modeling；按 grilling 的事实调查要求，以两项只读子调查复核构建输入、产物、公开配置、健康路由与运行模式。新增事实见 [构建与运行时升级核查](../assets/build-runtime-upgrade-evidence.md)。没有执行产品合并或运行验证。
- 延用用户已有的真实决定：**“既然没有冲突不就能直接合并吗，我说的行为不变是指原来的整个flow”**。保留完整 flow，兼容上游变化直接纳入，技术适配由代理处理；只有无法保持 flow 的具体取舍才再交用户。这不是代理替用户回答新的 HITL 问题，也没有声称本轮获得新的确认。
- 复核未发现必须改变既定 flow 或环境拓扑的不可避免冲突。选定保留已有 k8s 单镜像/nginx/PM2 形态的兼容路线，不借此要求改造父应用、接入新服务、切换发布平台或重做部署架构。历史真实构建命令未知，不妨碍指定后续明确受支持的构建入口。

## Answer

2026-11-11，依据既有完整 flow 原则解决，并按用户随后明确的官方数据库升级方式更新：**根目录合并结果是唯一产品源码来源；保留 k8s 构建目录与专用配置，以完整、可核对的源码输入构建单镜像，继续 nginx + PM2 三进程，适配锁定上游版本。构建与部署分开；容器启动时按官方方式同步数据库，成功后启动应用。** 这是规划结论，不代表镜像已经构建、旧数据已兼容或可以上线。

### 源码、目录与支持的入口

1. **主验证路径**：合并后的根源码 → 干净的独立 staging → `k8s/Dockerfile` 多阶段源码构建 → 本地镜像验证。准备器从脚本所在仓库定位根目录，明确选定提交，禁止硬编码旧个人目录；未提交改动只能作为显式记录摘要的本地候选，不能冒称某提交的干净构建。
2. **完整输入**：导出完整 tracked `apps/`、`libraries/`，以及根 package/lock/workspace、`.npmrc`、tsconfig 和所需构建配置；覆盖新增 frontend scripts、Nest CLI 配置、public、Prisma schema、实际 `var/docker/nginx.conf`/`ecosystem.config.cjs`。必需文件缺失直接失败，不沿用 `cp ... || true`。排除真实 `.env`、凭据、`.git`、宿主 node_modules、旧 dist/.next 与本地证据资料；按明确白名单注入公开构建配置。
3. **k8s 副本的角色**：保留目录和独有 Dockerfile/ignore/脚本等配置，不批量删除整个目录。根对应源码是生成副本，不接受独立业务修改；执行阶段从最终根源码刷新这些对应项，新增必需输入，按映射去掉已不存在的旧源码，对独有文件逐项保留。主构建仍从根重新生成 staging，不依赖已提交副本的新旧；用路径/内容清单证明二者对应关系。换行差异不构成第二套品牌资产。
4. **入口职责**：将准备、纯本地 build、publish、deploy 分为明确步骤。缺省本地路径不能隐式运行 ACR build/push、registry login、kubectl 或 rollout；当前原脚本两个模式均不作为验证命令。未来发布/部署由用户另行决定，Build 工作流保持禁用。
5. **其它入口**：根 pnpm 命令用于源码编译检查；根 Dockerfile/本地 Compose 保留开发用途及官方启动前数据库同步方式。未被现有脚本采用且输入不成立的 `Dockerfile.runtime`、闲置 PM2 配置及旧镜像 `--local` 不能作为验收捷径；无需为了本次升级另建预构建产物发布链。修正相关说明，避免把备用或历史入口宣称为已验证。

### 工具链、产物与进程

| 范围 | 选定契约 |
| --- | --- |
| Node/pnpm/lock | builder 与 runtime 均按锁定上游 Node 22.23.4；pnpm 10.6.1。修正不一致的工具版本声明（含 Volta），使用最终解决后的 lock 执行 frozen install。旧 basic-ftp deprecated 提示没有需要恢复的功能，不为它带回旧依赖。 |
| 前端 | 采用上游普通 Next 输出，去掉与所选启动方式不匹配的旧 standalone 配置，继续 Next start 4200。保留完整 `.next`（含 `.next/static`）、public、所需 package/config/依赖；明确 PM2 cwd 与实际 hoisted Next 入口，不能假定 frontend 内另有 `.bin`。这属于打包适配，不改变 SSO、品牌或页面 flow，最终差异报告须列明。 |
| API/worker | 保留实际使用的 `var/docker/ecosystem.config.cjs` 及 backend/orchestrator 分立进程；以真实构建产物校验两套 Nest main 路径、Prisma 客户端、Temporal worker 及原生依赖。不得仅因 tsc 配置看似正确就标记通过。 |
| 镜像内容 | 沿用多阶段打包，复制实际生成的完整运行依赖和产物，检查 Prisma/bcrypt/sharp/Temporal 的解析与装载。没有源码证据要求增装 ffmpeg/yt-dlp；可选远端媒体处理保持上游配置门控，不为升级开通新服务。 |
| 端口与模式 | 保持 nginx 5000 → backend 3000 / frontend 4200，避免统一 PORT 变量误改 backend 端口。主配置将 MCP_ONLY 留空或不设置，字符串 `false` 也不能使用；保留上游可选模式代码。MCP 非阻塞、缺可选服务的降级按 [品牌界面与可选服务契约](05-ui-optional-services.md#answer) 适配新版初始化逻辑。 |

### 环境变量、代理、媒体与健康检查

- **构建与运行配置分开记录**：对实际消费的公开构建变量建立白名单，至少核对浏览器 API 地址、父 origin、上传路径、storage 和所启用的其它公开开关。明确 `NEXT_PUBLIC_SSO_PARENT_ORIGINS` 等客户端直读项的编译输入；动态 layout/context 不能替代最终产物验证。用非敏感哨兵区分构建值/运行值，核对浏览器真正使用的值，不输出 secret。
- **保持地址契约**：浏览器 API 同域 `/api`、服务端内部 API `http://localhost:3000`、对外 FRONTEND_URL 与现有部署相符；SSO_SERVER_URL 为服务端完整兑换端点。父 origin 配置使用已知父应用 origin，保持已有两种 SSO 入口规则；`SSO_PARENT_ORIGINS` 不写成服务端已生效限制。没有授权收紧 OAuth relay、额外 origin/source 检查或修改父应用。
- **生成资产**：安装/构建前明确公开配置；如启用上游 GTM 下载，记录 `public/g.js` 的生成结果与摘要。没有相应配置的本地 profile 不新增跟踪服务。commit + lock + 配置能追溯输入，但遇网络生成资产时不能未经验证宣称位级可复现。
- **代理保留**：保留当前前端 iframe CSP、API 的 auth/showorg/impersonate 等转发/响应暴露、Connection 清空、300s 超时、禁 buffering/cache、日志 stdout/stderr 与 `/tmp` pid；同时纳入兼容的新 CORS/Express 逻辑。uploads 自己的 CSP/nosniff 保持原范围，不把前端 header 全站套用，不引入新的父域限制策略。
- **媒体和权限**：保持 local storage 的 `/uploads` 持久化及原 URL 布局、已有上传限制与静态资源路径；以实际镜像用户和挂载卷验证读写，不借升级切换整套 UID/权限模型。验证上传、旧媒体读取、Import/Editor、视频 Range、删除与重启后持久性；经 nginx 的 `/uploads/` 和直连 Next 的 upload route 分别检查。
- **健康检查**：主镜像 HEALTHCHECK 改为实际根路由 `/api/`；保留外部清单 `/api` 的既有契约，验证补斜杠跳转与最终响应。若确需清单微调，只准备最小具体差异供后续使用。根健康成功仅证明 HTTP 入口响应；另行核对 PM2 三进程、常规 API 注册和完整 flow，不宣称数据库、Temporal 或 MCP 已就绪。

### 数据职责和仓库边界

- 用户最终取消独立脚本，完整决定见 [官方数据库升级方式](08-data-temporal-upgrade.md#已明确的官方数据库升级方式)。根镜像沿用上游启动链，定制 k8s 镜像也接入相同数据库生命周期：启动时执行上游 `pnpm run prisma-db-push`，成功才启动应用进程，不再跳过同步。采用锁定新版不含 `--accept-data-loss` 的命令，失败不得被忽略；安装阶段 prisma generate 与数据库同步仍是两件事。
- 多阶段运行镜像须包含官方命令需要的 schema、根 package scripts、pnpm 及相应运行依赖，验证官方 Prisma CLI 的可用性和实际启动路径；不能只复制 dist 后假设同步命令可以执行。保持 nginx/PM2 的既有运行形态，镜像构建阶段不连接数据库。
- 数据兼容验证、旧任务接续和恢复边界继续由 [决定现有数据与 Temporal 任务的兼容升级路径](08-data-temporal-upgrade.md) 决定；官方同步机制及其启动时机已经确定，本票不执行真实或测试数据迁移。
- 本仓库负责源代码、构建输入、镜像和代理/进程配置及验证说明；外部环境仓库继续负责 Secret 引用、ConfigMap、路由、探针、PVC 和资源。保留已知 Envoy 公网/内网 Ingress、单副本 Recreate 等声明，不主动更改拓扑。本轮不编辑外部仓库，不读取 Secret，不访问集群；未来确需调整的配置应列出最小字段和理由，不自动应用。

### 执行阶段的证明与交付

1. **来源证明**：记录最终完整 commit、输入路径/摘要、Dockerfile/lock/公开配置摘要、Node/pnpm、基础镜像 digest、目标架构、生成资产摘要及最终 image ID；未来真正发布时再记录 registry digest。本地没有 registry digest 时如实记录，不以 `latest`/短标签替代来源证明。
2. **构建证明**：从干净输入安装与构建，核对必需脚本和真实产物，检查镜像内文件、Next/Prisma/native 依赖及三进程启动。版本或缺依赖失败照实记录；不能用旧镜像或只过 shell 语法替代。
3. **运行证明**：在隔离本地依赖/测试数据上验证端口、`/api/` 和 `/api`、常规业务 API、公开配置实际值、代理 headers、媒体/PVC 与关键完整 flow；MCP 受控失败不应阻止核心 API。旧数据与 Temporal 的演练条件采用下一票的决定。
4. **报告范围**：把副本生成方式、Node/pnpm、standalone→普通输出、PM2/健康检查、构建期变量、脚本动作拆分等实际变化列入最终双向差异报告，逐项连接定制清单。未执行的项目只能记为未验证。

本轮只解决本票。没有新增独立问题：数据/workflow 仍在既有下一票，统一验收仍在 [决定合并验收与执行交接标准](09-acceptance-execution-handoff.md)；未知真实运行信息继续作为未来上线核验，不变成当前地图的无限前置。原始构建、目录和配置问题已经具体化为上述契约，尚未出现的兼容例外仍留在地图 fog 中。

