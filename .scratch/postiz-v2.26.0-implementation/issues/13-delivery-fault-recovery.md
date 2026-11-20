# 13: 核对发送故障与恢复结果

**What to build:** 任务执行中断时，维护者可以区分已发送、平台拒绝、仍在等待和结果未知的帖子，并核对恢复后是否重复发送。

**Blocked by:** [12 让候选 worker 接续在途任务](12-temporal-inflight-continuity.md)

**Status:** ready-for-agent

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [任务故障与候选验收条件](../../postiz-v2.26.0-wayfinder/assets/upgrade-data.md)

- [ ] 复用正常接续样本，在补偿扫描期间取消、删除或改期，核对执行前重新读取的帖子状态、原定时间和实际发送次数。
- [ ] 在平台替身已接受请求后模拟 worker 中断或本地写回失败。记录数据库状态、Temporal 历史及平台侧接收次数，复核恢复后的调用与写回。
- [ ] 覆盖 V112 finalize 超时及 heartbeat 有无细节的样本，检查定制的结果未知标记，区分平台已拒绝、pending 和未知结果。
- [ ] 在隔离环境用兼容候选或已演练的数据库、媒体与 Temporal 协调恢复路径复核状态。将可确认的发送、重复调用及仍未知的结果分别记入证据。
