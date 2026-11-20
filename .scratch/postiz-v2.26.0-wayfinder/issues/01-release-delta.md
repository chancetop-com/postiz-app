# 锁定官方版本并定位与定制重叠的改动

Type: research
Labels: wayfinder:research
Status: resolved
Assignee: Codex
Resolved: 2026-11-20

## Question

官方 v2.25.3 到 v2.26.0 的精确边界、改动规模及与当前 fork 定制重叠的产品路径是什么？在上次使用 squash 的历史下，以哪三个版本比较能准确划分上游增量和定制？区分候选文本冲突与业务行为冲突，重点检查邀请登录、公开 Connect Link 和渠道回调等新增入口。

## Answer

官方 v2.26.0 是 `132859f3`，以 v2.25.3 的 `a5affe62` 作内容基线、`83884307` 作定制端。上游增量为 152 个提交、130 个路径。17 个路径与定制重叠，显式基线的试算得到 8 个文本冲突；其他前后端组合仍需按业务流程验收。

完整证据见[固定版本源码对照](../assets/release-delta.md)。公开资料另存于[研究分支快照](https://github.com/chancetop-com/postiz-app/blob/ce12c927428428ad3938258620ca8e10dc9f1a17/README.md)。本票以静态取证解决，候选版本的运行验证留待实施阶段。
