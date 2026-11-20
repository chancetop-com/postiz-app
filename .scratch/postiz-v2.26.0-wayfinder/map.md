# 将 Postiz v2.26.0 合入定制分支的决策图

Labels: wayfinder:map
Status: resolved
Created: 2026-11-20
Resolved: 2026-11-20

## Destination

确定从当前定制版升级至官方 v2.26.0 的合并基准、认证修复取舍与逐流程验收方式，使后续实现者能保留既有行为并核对上游功能。用户已确认本轮交付决策图和上游核查。

## Notes

- 产品基线是 `postiz-stable-merge@838843077adfa0fbffb58ecef82c9324412533aa`。树 `3c922cd90acb22f1f6be07700a15142a036f789d` 与上次审查的 `76e29072` 相同。前一轮以 squash 吸收官方 v2.25.3（`a5affe62c74e39c1e7ac960d50d8418b807d532c`）。
- 本次实施时保留上游提交历史，以官方 v2.25.3 作内容比较基准。用户会在全部实现完成后另行指示何时 squash。
- 按完整业务流程继承 [既有合并规格](../postiz-stable-merge/spec.md)、[定制交接](../postiz-stable-merge/assets/handoff-project-customizations.md)、[sessionStorage 适配](../postiz-stable-merge-implementation/assets/session-storage-adaptation.md) 和[重置令牌修复](../password-reset-token-fix/review.md)。父应用契约、商户共享账户、普通登录、渠道绑定使用 [仓库术语](../../CONTEXT.md)。
- 用户希望优先采用 v2.26.0 已发布的等效重置令牌修复。判断以本版签发和消费代码为准，包含新旧令牌、到期边界、既有登录及有效旧链接的兼容性。
- 历史的 57 个测试文件、542 项通过为升级前证据。候选版本需重新运行并记录结果。已有流程和界面约束继续适用于新版入口。
- 本地图按 [Wayfinding operations](../../docs/agents/issue-tracker.md) 管理。后续按文件序取首张前置条件已满足的未认领票。调研用 research，业务取舍用 grilling 和 domain-modeling。

## Decisions so far

- [锁定官方版本并定位与定制重叠的改动](issues/01-release-delta.md#answer) — 按前一官方 tag 比较增量；8 处文本冲突及新入口的行为交叉点已定位。
- [核实官方版能否替代本地重置令牌修复](issues/02-reset-token.md#answer) — v2.26.0 没有等效修复，继续保留定制版的令牌用途隔离。
- [核实渠道凭证、在途任务与启动数据的升级条件](issues/03-upgrade-data.md#answer) — 按默认配置同步索引并验证既有队列与在途任务；另列自选加密的验收条件。
- [确定新入口与历史业务流程的合并验收](issues/04-flow-acceptance.md#answer) — 邀请与公开链接须核对最终组织归属，既有流程在隔离环境实跑，真实父应用、Safari 和六渠道授权逐项记录。

## Not yet specified

本轮规划已完成，候选版本的运行结果由实施阶段记录。

## Out of scope

本轮产品代码合并、上线、镜像发布及实际数据变更留给后续阶段。
