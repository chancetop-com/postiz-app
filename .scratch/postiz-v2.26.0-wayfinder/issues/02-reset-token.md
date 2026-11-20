# 核实官方版能否替代本地重置令牌修复

Type: research
Labels: wayfinder:research
Status: resolved
Assignee: Codex
Resolved: 2026-11-20

## Question

在官方 v2.26.0 tag 中，密码重置签发、重置提交、普通会话及原管理员身份验证分别检查什么？与 v2.25.3 和上游修复提案对比，能否同时阻止新旧重置令牌用作登录并保留既有会话、20 分钟重置期、有效旧链接和 sessionStorage 请求头？按用户约定给出“采用官方做法、整合其兼容部分、或保留本地修复”的依据。

## Answer

保留本地独立签名、20 分钟有效期、历史链接兼容及两处会话校验。同时接入 v2.26.0 的邀请登录逻辑和 `showorg` 响应头。两个官方标签间没有可替换的账号重置修复。

完整证据见[固定版本源码对照](../assets/reset-token.md)。公开资料另存于[研究分支快照](https://github.com/chancetop-com/postiz-app/blob/60e1c8c87e2c48a4b6d6309f500735ebf92aa19f/README.md)。本票以静态取证解决，候选版本的运行验证留待实施阶段。
