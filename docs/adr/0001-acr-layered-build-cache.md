# 0001. 使用三层 ACR 缓存镜像与根构建上下文加速 Postiz 构建

Status: accepted

## Decision

将 Postiz 容器构建从“复制源码到 `k8s/` 后单次无缓存全量构建”改为“仓库根目录 `.` 直接作为构建上下文 + 四份拆分 Dockerfile（`Dockerfile.base`、`Dockerfile.deps`、`Dockerfile.runtime-deps` 与唯一应用 `Dockerfile`）”，在 `FBRDevAcr` 上使用三个独立 repository（`ops/postiz-base`、`ops/postiz-deps`、`ops/postiz-runtime-deps`）按内容 hash 缓存基底与依赖层，本地 `build-local.sh` 用本地 Docker tag 复用同一链路且不登录 ACR。同时仅在 `package.json` 中将 `prisma` 一行移入 `dependencies`（供容器启动期 `entrypoint.sh` 执行 `prisma db push`）并在 `runtime-deps` 执行 `pnpm prune --prod`，按 `SENTRY_AUTH_TOKEN` 条件开启前端 Sourcemap 与 Sentry 插件，关闭 NestJS 后端与 orchestrator 的 `.d.ts` 输出但保留 `.js.map`，并退役 `k8s/prepare-build-context.sh`、`k8s/Dockerfile.runtime`、`k8s/ecosystem.config.cjs` 与 `k8s/.dockerignore`。

## Considered Options

- **单份 multi-stage Dockerfile + `ARG` 覆盖基底**：放弃。`az acr build` 默认使用经典 Docker builder 时无法可靠跳过未引用的前置 stage，可能仍重复执行 `pnpm install`；拆分为独立 Dockerfile 可在 ACR 与本地双端确定性跳过依赖安装。
- **单 ACR 缓存 repo 多 tag 混放，或省略 `runtime-deps` 仅做两层缓存**：放弃。`fbr-env-project` 的 `cleanup_acr_repos.sh` 对每个 repository 执行 `acr purge --keep 3 --ago 3d`，多类层混放同一 repo 会互相淘汰；省略 `runtime-deps` 则每次改业务代码仍需重新复制、压缩、推送并由 AKS 重新拉取整层 `node_modules`。
- **立刻迁入 FBR Jenkins Pod 内构建**：延后。Jenkins Pod 仅有 8 GiB 内存且与全套 FBR 构建任务共享，且未装 `rsync`；先在 ACR 侧落地三层缓存可立刻提速，后续接入 Jenkins 时可直接复用同一构建链路、零返工。
- **将 `package.json` 中 18 个误放的上游 `@types/*` 等全部迁出 `dependencies`、后端切 SWC、去掉 `--workspace-concurrency=1`**：放弃。本仓需持续合并上游 `gitroomhq/postiz-app` 版本，批量改依赖表或切换上游未使用的 SWC 会引入高额合并冲突与路径别名/Temporal 风险；`--workspace-concurrency=1` 是上游为防止 4 GB 堆内存并发 OOM 所设，在 2 vCPU Standard ACR 上保持串行更稳妥；Next.js 16 构建已默认运行在 Turbopack 上，无额外切换收益。

## Consequences

- 日常仅改业务代码时，ACR 构建跳过 `apt-get`、`npm i -g`、`pnpm install` 与 `prisma generate`，并直接以 `ops/postiz-runtime-deps:<deps-hash>-<parents-hash>` 为运行时基底，每次仅生成、推送与拉取约 30–40 MB 压缩增量业务层。
- 每次变更依赖锁文件、`schema.prisma` 或缓存层 Dockerfile 时，脚本按内容 hash 自动重建对应的 `ops/postiz-deps` 与 `ops/postiz-runtime-deps` 镜像；支持 `--rebuild-cache` 强制刷新（本地 `build-local.sh` 对 1–3 层缓存附加 `--no-cache`），以及默认拒绝脏工作区、`--allow-dirty` 自动追加 `-dirty` tag 且脏构建不覆盖远端 `:latest`。
- 在 `node-linker=hoisted` 配置下，`Dockerfile.runtime-deps` 使用 `CI=true npm_config_offline=true pnpm prune --prod --ignore-scripts` 避免非 TTY 交互提示和离线可选包阻塞，并在裁剪前后显式保存并恢复 `/app/node_modules/.prisma` 与 `@prisma/engines` 二进制。因有意不改动上游 `package.json` 的 `dependencies` 分类，裁剪可稳定移除纯 `devDependencies`（如 `eslint`、`@nestjs/testing`、`@testing-library/react`、`@temporalio/testing`、`tsup` 等约 1,132 个包），而 `typescript`（经 `@nestjs/cli`）与 `vitest`（经 `@copilotkit/runtime` -> `@copilotkit/channels-core`）仍因上游生产依赖传递引用而保留。
- `tests/startup-sync.test.ts` 与 `k8s/tests/` 需同步迁移为校验拆分后的 Dockerfile 链路与根构建上下文契约，不再依赖 `k8s/` 源码副本和已移除的 `k8s/Dockerfile.runtime`。

运行时依赖标签包含实际父镜像的摘要。本地使用 Docker image ID，ACR 使用 manifest digest。父层强制刷新后即使中断，下次构建也会选择匹配新父层的运行时镜像。应用层使用 BuildKit secret mount 向编译进程提供可选的 Sentry token，ACR 通过仓库中的任务定义执行该步骤。

每次构建固定一份保持仓库根目录布局的源码快照，所有阶段从同一份内容读取 Dockerfile 和缓存输入。干净工作区直接导出提交对象，显式允许脏构建时使用临时 Git 索引捕获工作区文件。本地候选先通过独立临时标签上传，再用注册表摘要设置发布标签。
