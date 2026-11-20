# 03: 通过普通登录接受组织邀请

**What to build:** 受邀用户打开组织邀请链接，可用密码、标准 OAuth 或当前标签页已有的 Postiz 会话接受邀请；完成后以邀请指定的角色进入该组织。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** ready-for-agent

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [邀请和公开链接的验收决定](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [ ] 从实际签发的邀请链接分别走密码登录、标准 OAuth 登录和仅有 sessionStorage 的已有会话。每种方式都从组织成员记录核对用户、受邀组织、角色及新增数量。
- [ ] 首次加入时，服务端验证邀请，接受邀请的标签页收到 `showorg` 并在下一次请求使用受邀组织。另一个已打开的标签页仍访问原组织。
- [ ] 重复接受同一邀请保持单条成员关系。无效或过期邀请保持原归属，未激活账户继续受激活流程约束。
- [ ] 无邀请时跑通邮箱注册、激活、密码及标准 OAuth 登录，核对原默认组织和 OAuth 的 provider、state、时效校验。兼容上游可选注册归因。
