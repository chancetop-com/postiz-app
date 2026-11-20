# 07: 通过公开 Connect Link 完成跨组织二步授权

**What to build:** 收件人通过组织 A 的链接选择账号或页面后，绑定只归 A。即使收件人的原标签页正在管理组织 B，也能完成授权并继续使用 B 的原会话。

**Blocked by:** [06 通过公开 Connect Link 完成单步授权](06-public-connect-link.md)

**Status:** claimed

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [公开授权最终组织归属](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [ ] 用 A 签发的二步渠道链接，从匿名、登录 A、正在使用 B 三种起始状态进入，使用单选页面完成保存并走到回调结束。
- [ ] 逐例查询 A 和 B。核对所选账号或页面及 integration ID 只关联 A，其他候选账号未被绑定。B 原标签页刷新后，身份和组织仍为 B。
- [ ] 覆盖二步保存失败、重试及取消，分别核对页面结果与最终绑定数量。成功重试后只保留预期绑定。
- [ ] 覆盖禁用第三方 Cookie 的浏览器以及带原查询参数的返回地址，核对匿名与已登录者各自的去向。
