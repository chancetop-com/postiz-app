# 02: 商户从父应用进入并保持标签页身份

**What to build:** 商户从父应用 iframe 进入 Postiz，即使浏览器阻止第三方 Cookie，也能进入自己的商户共享账户。刷新、组织切换、代入和退出均遵循所在标签页的会话。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** ready-for-agent

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [既有 sessionStorage 契约](../../postiz-v2.26.0-wayfinder/../postiz-stable-merge-implementation/assets/session-storage-adaptation.md)

- [ ] 用隔离父页面和兑换服务运行既有 URL 与消息入口。首次兑换建立商户共享账户和组织，再次兑换复用同一账户。核对无效 code、兑换失败及默认组织选择与定制基线一致。
- [ ] 禁用第三方 Cookie，分别在两个标签页选择不同组织。刷新后从实际请求核对组织和身份，确认其中一页切换组织时另一页保持自己的选择。
- [ ] 核对 `auth`、`showorg` 和 `impersonate` 在响应头、sessionStorage 与后续请求之间的往返，包括跨源响应头可读性与既有 Cookie 兼容读取。用上传记录核对实际归属。
- [ ] 从管理员身份开始、结束代入，分别走普通退出和 401。记录各自页面去向和下一次请求的身份，与现行定制行为对照。
