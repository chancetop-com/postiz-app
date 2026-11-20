# 14: 验收最终修订并交付双向差异报告

**What to build:** 维护者收到可审阅的本地候选分支、最终提交及对应的运行证据。交付报告分别说明商户升级前后的变化，以及相对官方 v2.26.0 保留的差异。

**Blocked by:** [02 商户从父应用进入并保持标签页身份](02-merchant-session.md)、[03 通过普通登录接受组织邀请](03-organization-invitation.md)、[04 保留新旧找回密码链接和既有登录](04-password-reset-compatibility.md)、[05 从仪表盘完成六种渠道的绑定与重连](05-dashboard-channel-binding.md)、[07 通过公开 Connect Link 完成跨组织二步授权](07-public-connect-organization.md)、[08 按勾选渠道编辑和发布帖子](08-selected-channel-posts.md)、[09 在定制界面和缺少可选服务时完成内容流程](09-custom-content-flows.md)、[10 用候选镜像启动旧库并保留媒体](10-startup-and-media-retention.md)、[11 用历史渠道凭证刷新、重连并发布](11-existing-channel-credentials.md)、[13 核对发送故障与恢复结果](13-delivery-fault-recovery.md)

**Status:** ready-for-agent

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [逐流程验收决定](../../postiz-v2.26.0-wayfinder/issues/04-flow-acceptance.md#answer) · [既有交付标准](../../postiz-v2.26.0-wayfinder/../postiz-stable-merge/issues/09-acceptance-execution-handoff.md#answer)

- [ ] 在同一最终修订从根目录用 pnpm 运行完整测试、前端/API/orchestrator 类型检查、lint 和构建。核对 K8s 上下文、实际镜像和三进程；记录提交、命令、用例数及结果。57 个文件、542 项通过仅作升级前基线。
- [ ] 汇总前置票在最终候选上的验收证据。若后续改动影响既有证据，重新运行对应流程，并记录本地通过、失败和未验项。
- [ ] 对照升级前定制版逐流程说明实际变化与影响；对照官方 tag 附完整差异路径、来源、保留理由与验证结果。核对两端祖先关系，交付最终分支与提交，保留上游历史。
- [ ] 真实父应用、Safari 跨站会话与弹窗、六种渠道各自的真实授权逐项列出结果、缺失条件和影响。已观察到的失败按失败记录，本地设施缺失按本地未验记录。
- [ ] 全部本地必验项实跑通过且仅缺外部条件时，交付状态可写为「代码合并完成、本地验收通过、外部验证待补」。镜像发布、部署、生产数据变更及 squash 由用户另行决定。
