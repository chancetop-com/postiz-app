# 05: 从仪表盘完成六种渠道的绑定与重连

**What to build:** 商户可以从仪表盘选择开放的六种渠道，在 iframe 弹窗或独立窗口完成授权、必要的账号选择和重连，随后在原组织看到正确的绑定。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** claimed

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [已确认的渠道入口与回调](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer)

- [ ] 枚举所有仪表盘添加列表，核对精确标识为 `youtube`、`linkedin`、`tiktok`、`facebook`、`instagram` 和 `instagram-standalone`。已有其他渠道仍可管理。
- [ ] 六种渠道分别在禁用第三方 Cookie 的 iframe 与独立窗口运行。核对弹窗 relay 传递当前会话、独立窗口当前页导航，以及返回后的组织和渠道 ID。
- [ ] YouTube、Facebook Page、Instagram（Facebook Business）完成单选并保存后，才通知原窗口刷新和关闭弹窗。其余渠道核对单步回调的实际绑定。
- [ ] 覆盖拒绝、取消、弹窗异常和二步保存失败。把授权结果和刷新后的渠道记录对照，记录能否重试。核对普通 OAuth 和既有扩展渠道各自的重连入口。
