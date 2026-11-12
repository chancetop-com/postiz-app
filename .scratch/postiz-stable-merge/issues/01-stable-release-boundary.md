# 锁定官方稳定版与完整合并边界

Labels: wayfinder:research
Type: research
Mode: AFK
Status: resolved
Assignee: chancetio (agent stable_release_research)
Parent: ../map.md
Blocked by: —
Created: 2026-11-11

## Question

截至本轮查证，官方最新非预发布、非草稿稳定 Release 是哪个 tag/完整 commit SHA？如何用固定引用与 Git 历史明确“全部 commit”的边界，并与交接中的 main 区分？

调查并记录：
- 官方 release 原始来源、发布时间、tag 解析后的 SHA；最新判定不能只依赖本地旧 tags 或 README 版本。
- 当前 fork 起点、共同基线、稳定目标与已知 main 的祖先关系及距离；解释完整合并的可验证条件。
- 目标发生漂移时如何重新确认；执行应使用已核实 SHA，而不是可移动的 latest/main。
- 官方发布说明中直接关系本次升级的已知兼容提示；未做源码审计或运行验证的内容明确保留给后续票。
- 单一研究报告作为资产，独立 research 分支的 commit/远端指针，不开 PR、不合并。

## Comments

- 初步只读观察：官方 releases/latest 指向 v2.25.3；本地对象解析为 a5affe62c74e39c1e7ac960d50d8418b807d532c。这只是研究输入，仍需完成来源核实。

## Answer

- 本轮锁定官方 Latest Release **v2.25.3 / `a5affe62c74e39c1e7ac960d50d8418b807d532c`**，发布时间为 **2026-10-24T14:16:43Z**（北京时间 22:16:43）。官方最新入口、Release HTML 与远端 tag 一致。API 的 `draft`/`prerelease` 原始字段因公开接口限流未直接取得；Latest 状态结合 GitHub 明确排除草稿/预发布的规则支持稳定版判定，报告区分实测与推论。
- `merge-base(dev,S)` 与 `merge-base(dev,U)` 均为 `0b554e684483932d394e703208fe21648e7acd6f`；基线到稳定目标 **999** 个提交，已知 `U=80c3e55dc025c57c00bc4ecc146125125851dc41` 在稳定版后另有 **94** 个提交，范围外。`dev...stable` 左右独有为 **4 / 999**。完整合并要求原始 fork 起点与稳定 SHA 同为结果祖先；祖先关系不替代定制行为验收。
- [研究报告](../assets/stable-release-research.md) 汇集固定引用、命令结果、目标漂移规则与官方升级提示（Prisma/Temporal/认证/渠道及安全发布提示），未审计源码或断言当前 fork 的漏洞状态。
- 已在独立临时 clone 中提交唯一新增研究资产，分支 [research/postiz-stable-release-20261111](https://github.com/chancetop-com/postiz-app/tree/research/postiz-stable-release-20261111)，commit [`0108b5e014d2aab92dfe987fb69fda9816dacb5e`](https://github.com/chancetop-com/postiz-app/commit/0108b5e014d2aab92dfe987fb69fda9816dacb5e)。`git push` 已成功返回新建分支；未开 PR、未合并。报告已逐字同步到当前工作区；当前 HEAD 和索引未改动。
- 时序说明：父代理传达“push 前核实不会部署”的新限制时，push 工具已完成。已立即告知父代理并停止后续远端操作；push 前未检查该分支的工作流触发条件，本研究不能据此保证未触发自动 CI。没有执行任何显式部署命令，自动化影响由父代理继续只读核实。
- 主代理后续只读核查：当前研究基线的 .github/workflows/build.yml 对普通 branch push 运行 pnpm install / pnpm run build；build-containers.yml 的镜像发布仅由 tag push 或 workflow_dispatch 触发，研究分支 push 不满足该条件；codeql.yml 仅匹配 main 的指定源码路径。未创建 tag、未开 PR、未调用 workflow_dispatch 或部署脚本。此结论限定于已核对的仓库内自动化配置，不声称查验了外部环境仓库/集群状态。后续遵守用户“线上部署最后另行决定”的明确约束。

