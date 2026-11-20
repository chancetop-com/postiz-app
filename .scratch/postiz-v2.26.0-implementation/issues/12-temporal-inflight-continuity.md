# 12: 让候选 worker 接续在途任务

**What to build:** 已有排程、重复任务及延迟评论能在候选 worker 接手后继续执行，积压刷新和邮件仍有人消费。维护者能从历史、数据库和平台账目核对每次执行。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** claimed

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [在途任务与队列兼容](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [ ] 用候选 bundle 回放定制 v2.25.3 的隔离历史及既有更早样本，覆盖 V101/V102、V112 和旧子任务，记录 bundle 及样本版本。
- [ ] 在隔离 Temporal 中由候选 worker 实际接手睡眠排程、重复子任务、延迟评论、积压刷新和邮件。核对旧 activity 注册、载荷、原 namespace、队列（含兼容 provider 队列）、workflow ID 与业务 ID。
- [ ] 验证旧版阻塞返回和 V112 的 pending、check、finalize 均产生预期结果，核对新建任务与仍在执行的旧任务的实际消费记录。
- [ ] 逐项对照帖子时区、发布时间、结果写回及平台替身调用的目标和次数，保存可供故障演练复用的正常样本与账目。
