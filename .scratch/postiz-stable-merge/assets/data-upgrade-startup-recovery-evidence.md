# 数据升级入口与恢复边界核查

核查日期：2026-11-11。供 [决定现有数据与 Temporal 任务的兼容升级路径](../issues/08-data-temporal-upgrade.md) 使用。
本文件记录事实及由事实导出的限制，不代表已生成迁移 SQL、执行升级、备份、恢复或 workflow replay。

## 对照与启动入口

- C：`6fdf7cb53543fa28a470ad63e7619e8b98bcee43`。
- S：`a5affe62c74e39c1e7ac960d50d8418b807d532c`（地图锁定的 v2.25.3 对应 commit；本地没有同名 tag，直接读取 commit）。
- 当前 HEAD：`501e87dbfb2ca6e44662baec308afa468a922b38`。本轮没有 checkout、merge 或修改产品源码；读取缺失的 promisor Git 对象时只补取对应对象。

| 项目 | C | S | 含义 |
| --- | --- | --- | --- |
| 根 `package.json:16–18` | pm2 → pm2-run → prisma-db-push → 应用 PM2 | 相同 | 新版根启动仍有 schema 写入副作用。 |
| 根 `package.json:33–36` | Prisma 6.5.0；db push 带 `--accept-data-loss` | Prisma 仍为 6.5.0；db push 去掉该参数 | 去掉参数会保留部分危险变更的拒绝机制，但不会把启动变成只读，也不会生成可审阅的升级步骤。 |
| 根 `prisma-reset` | db push --force-reset | 仍存在 | 不能作为存量升级或恢复流程。 |
| 根 postinstall | prisma-generate | 相同 | 生成客户端与改变数据库结构是不同动作。 |
| S `Dockerfile.dev:25–28` | — | 安装、构建后以 `nginx && pnpm run pm2` 启动 | 沿用用户最终选定的官方启动前同步顺序。 |
| C `k8s/Dockerfile` | nginx + pm2-runtime，使用 `var/docker/ecosystem.config.cjs` | S 没有本地 k8s 目录 | 主入口不经过根 pm2-run；不能假定它自动更新 schema。详见既有 [打包证据](customization-packaging-evidence.md)。 |

用户随后调整地图，最终选择“**不使用独立脚本了，就按官方的方式走**”。以 [官方数据库升级方式](../issues/08-data-temporal-upgrade.md#已明确的官方数据库升级方式) 为准：撤销独立脚本要求，根入口保留官方启动前 db push；定制 k8s 入口补入相同顺序，失败阻断应用启动。构建只 generate，不连接数据库。下述机制限制用于设计验证，不构成改用自建迁移体系的要求。

## 媒体的静态兼容事实

- C `libraries/nestjs-libraries/src/upload/local.storage.ts:26–90` 与 S 同文件 `newFilePath` 均按年月日目录及随机文件名存储，对外地址仍为 `FRONTEND_URL + '/uploads' + 路径`。未发现需要批量改名、移动旧媒体或重写全部 URL 的结构变化。
- S 增加流式写入、下载验证与安全删除路径处理；这些是新请求处理逻辑，不能由“URL 结构不变”推出所有旧媒体操作已通过。验收仍需覆盖旧文件读取、帖子中的媒体引用、上传、Import/Editor、Range、删除与重启持久性。
- 已核实部署清单采用 local storage 与独立 `/uploads` PVC；[部署证据](deployment-evidence-2026-11-11.md) 不是现网挂载状态或卷备份完成的证明。

## 官方文档限定

1. Prisma 说明 `db push` 不创建迁移文件或迁移历史，也不能细分 schema 与数据变更步骤。用户已选用该官方机制；以测试副本上的实际同步、失败处理和数据比对证明本次兼容，不能宣称该命令自动提供可逆迁移历史。参见 [Prisma：Prototyping your schema](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/prototyping-your-schema)。
2. 如执行阶段需要检查具体 DDL，可将 `migrate diff` 输出 SQL 仅作为调查材料，不替换选定的启动前 db push，也不把独立 SQL/升级脚本列为交付要求。本次查阅的在线 v6 CLI 页面已包含 Prisma 7 参数说明，调查时须以锁定 Prisma 6.5.0 实际 `--help` 核定参数。本轮没有运行 diff CLI 或应用 SQL。参见 [Prisma CLI reference](https://www.prisma.io/docs/orm/v6/reference/prisma-cli-reference)。
3. `pg_dump` 的一致性保证针对单个数据库；角色等全局对象另有范围，不同数据库的快照不自动同步。应用库的 dump 不包含 `/uploads` 文件，也不等于独立 Temporal 数据库的恢复点。参见 [PostgreSQL 15：pg_dump](https://www.postgresql.org/docs/15/app-pgdump.html) 与 [SQL Dump](https://www.postgresql.org/docs/15/backup-dump.html)。

## 对本项目恢复规划的推论

- 数据库结构、业务行、媒体文件、Temporal 运行历史与外部平台发布结果是不同状态；恢复应用数据库或换回旧镜像不能自动恢复其余状态。
- 未来若要形成整体恢复点，需要识别并控制所有相关写入者，采用适合实际 PostgreSQL/Temporal 版本的备份方式，并在隔离环境验证恢复后的关联。不能把分别成功导出的文件称为已证明一致的恢复点。
- 恢复点之后如果已经向平台发布、刷新渠道凭证或接收新数据，直接恢复旧快照可能造成遗失或再次执行。先核对外部结果及本地状态，再决定恢复/补偿；禁止把删除 workflow、重建排程或重试所有任务当作通用恢复方案。
- 本地演练使用合成身份和凭据、隔离数据库/Temporal/媒体路径与受控平台替身。真实备份、平台凭据和 workflow payload 不进入仓库证据文件；如未来使用真实样本，另按届时授权与访问范围处理。

以上只是规划依据，未连接真实数据库、Temporal 或集群，未验证真实备份和恢复。
