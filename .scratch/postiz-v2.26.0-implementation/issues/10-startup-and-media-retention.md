# 10: 用候选镜像启动旧库并保留媒体

**What to build:** 运维人员可以用候选镜像启动隔离旧库。启动同步成功后前端、API 和 worker 可用，商户的关系数据、排程时间与媒体文件在升级和重启后可继续使用。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** ready-for-agent

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [启动与索引核查](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [ ] 从候选根源码生成并检查 K8s 构建上下文，构建根镜像和专用镜像。用各自的真实入口对隔离 PostgreSQL 15 旧库副本启动，核对官方同步先于应用启动及专用镜像的 nginx、PM2 三进程运行结果。
- [ ] 核对 Post 两个索引及 Notifications、User、Errors 各一个索引的定义和列序，记录样本规模、建索引耗时与锁等待。
- [ ] 对照同步前后的原行主键和原列摘要，核对身份、成员、渠道、帖子状态、时区、发布时间和媒体引用。用实际卷读旧文件、上传新文件并在重启后分别读取。
- [ ] 重复启动验证同步幂等；用隔离故障样本确认连接或同步失败时非零退出，API 与 worker 不会绕过同步启动。保留实际结构与数据核对结果。
