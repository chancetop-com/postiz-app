# 核实渠道凭证、在途任务与启动数据的升级条件

Type: research
Labels: wayfinder:research
Status: resolved
Assignee: Codex
Resolved: 2026-11-20

## Question

v2.26.0 的渠道凭证加密、老凭证读取、后台活动与工作流、数据库索引和启动配置具体改变了什么？沿用当前部署配置时需要验证哪些行为，启用上游可选项又应增加哪些用例？用公开 tag 的源码和发布说明交叉核实。

## Answer

沿用当前配置，按官方启动同步五个新增索引，加密和回填按可选能力处理。任务定义的增量很小，活动配线仍需保留定制版刷新注册、既有队列和 V112 超时处理，并在候选版回放。

完整证据见[固定版本源码对照](../assets/upgrade-data.md)。公开资料另存于[研究分支快照](https://github.com/chancetop-com/postiz-app/blob/85159dd535f170d6ba6a6866847746882567815a/README.md)。本票以静态取证解决，候选版本的运行验证留待实施阶段。
