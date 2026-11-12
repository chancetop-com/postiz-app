# 01: 从根源码生成构建输入，分开本地构建与发布

**What to build:** 维护者从当前根源码生成可核对来源的干净构建输入，并通过明确的本地入口准备和构建候选；保留原有构建形态及独有配置，本地操作不会隐式发布镜像或部署。

**Blocked by:** None (can start immediately).

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-11

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“构建、运行与配置”；同时遵守[共同执行约束](../README.md#执行约束)。本票是合并前的必要预整理，最终新版镜像运行验收由 13 完成。

- [x] 执行前记录实际修订、分支与工作区状态，保留已有工作；准备器从自身仓库定位根目录，记录完整提交，未提交候选另有摘要，不依赖调用者恰好位于某个目录。
- [x] 从根源码重新生成独立干净 staging，覆盖全部必需的应用、共享库、包与锁文件、workspace、编译配置、前端脚本及资产、Prisma schema、nginx 和 PM2 配置；缺少任一必需输入时明确非零失败。
- [x] 构建目录中的业务源码作为生成副本刷新，并按映射移除根源码中已不存在的旧项；保留并逐项适配独有 Docker、ignore 和脚本配置，不批量删除整个构建目录，不允许副本独立承载业务修改。
- [x] 输入不包含真实环境文件、凭据、Git 元数据、宿主依赖、旧产物或本地证据资料；输出路径与内容清单能说明每个输入的来源。
- [x] 准备、纯本地 build、publish、deploy 是明确分开的动作；本地默认调用链不执行 registry 登录、远端构建、推送或集群更新，Build 保持禁用。
- [x] 用受控样本从准备入口验证新增、修改、删除源码和必需输入缺失，核对重复准备不会保留旧副本；用可捕获调用的替身验证本地构建命令及失败退出，不触发真实发布动作。
- [x] 记录原入口与新入口的使用方式、输入来源和实际检查结果，明确本票尚未证明 v2.25.3 镜像的三进程或数据生命周期可用。

## Answer

2026-11-11，已实现并通过本票的受控验证。执行环境：Node v22.22.3、pnpm 10.6.1、`codex/postiz-stable-merge`，执行前 HEAD `c527c5d6`，工作区干净、无 stash。本票产出 4 个提交（`149d82ab`、`30c02644`、`7651c7cb` 及文档提交）。

### 交付物

| 动作 | 入口 | 说明 |
| --- | --- | --- |
| 准备 | `k8s/prepare-build-context.sh` | 从根源码重建 `apps/`、`libraries/`、`var/docker/`，输出清单 |
| 纯本地构建 | `k8s/build-local.sh` | 仅 `docker build`，不登录 registry、不推送、不触碰集群 |
| 发布 | `k8s/build-postiz.sh` | 仅 ACR 构建/推送，拒绝过期上下文，不再执行 kubectl |
| 部署 | `k8s/deploy-postiz.sh` | 仅 `kubectl set image` + rollout |

用法与边界记录在 `k8s/README.md`。

### 逐项对应

- **定位与来源**：准备器用 `BASH_SOURCE` 定位 `git rev-parse --show-toplevel`，不依赖调用目录，无硬编码个人路径（原 `build-postiz.sh` 的 `/Users/cyril/workspaces/postiz-app` 已移除）。记录完整 commit、分支、worktree 状态；脏候选须显式 `--allow-dirty` 并单独记录 `worktreeDigest`。
- **完整输入**：`REQUIRED_INPUTS` 18 项含根 package/lock/workspace/`.npmrc`/tsconfig、三应用 `package.json` 与编译配置、frontend `next.config.js`/`tailwind`/`postcss`、Prisma schema、`var/docker/nginx.conf`、`var/docker/ecosystem.config.cjs`。缺失任一 → 退出码 1。
- **生成副本**：删除后重建 `apps`/`libraries`/`var/docker`，因此根源码已删除的路径同步消失、重复准备不留旧副本。补齐原副本缺失的 `apps/commands`、`apps/extension`、`apps/sdk`（frozen lockfile 安装所需）与 `nest-cli.json`、`.swcrc`、frontend public 资产。独有文件 `Dockerfile`、`Dockerfile.runtime`、`.dockerignore`、三个构建脚本、`ecosystem.config.cjs`、`.core-ai/` 逐项保留。`var/` 下的本地研究文档不再进入构建输入。
- **排除项**：`node_modules`、`dist`、`.next`、`.nx`、`coverage`、`.git`、`.env`/`.env.*`、`*.log`、`*.tsbuildinfo` 均不进入。
- **动作拆分**：原 `build-postiz.sh` 的 k8s 部署分支已抽出为 `deploy-postiz.sh`，脚本不再隐含部署；`build-postiz.sh` 在 ACR 构建前用 `--check` 拒绝过期上下文。Build 工作流未修改、未启用。
- **副本对应关系**：`k8s/BUILD_CONTEXT_MANIFEST.json` 记录 commit、分支、worktree 状态、18 项必需输入的 sha256 与 837 个生成路径的 sha256（136 KB，已 gitignore）。

### 实际验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 准备器幂等与来源 | `./k8s/prepare-build-context.sh` | 通过，837 生成文件，commit `7651c7cb` |
| 上下文与根源码一致 | `./k8s/prepare-build-context.sh --check` | 通过（in sync） |
| 受控样本回归 | `./k8s/tests/prepare-build-context.test.sh` | 通过 38 / 失败 0 |

回归用例覆盖：新增/修改/删除源码同步、重复准备清除旧副本、排除项、缺失必需输入退出 1、脏工作区拒绝与 `--allow-dirty`、`--check` 漂移且不写入，以及用 stub 的 `docker`/`az`/`kubectl` 断言本地构建不触发发布、发布不触发部署、部署不触发构建、构建失败退出码传递。

### 未证明

本票只证明构建输入可生成、可核对、动作已分离。没有构建镜像，没有启动容器，因此 v2.25.3 的三进程运行、`/api/` 健康、媒体持久化、数据库启动同步与 Temporal 兼容均未验证，由 13 及后续票承担。
