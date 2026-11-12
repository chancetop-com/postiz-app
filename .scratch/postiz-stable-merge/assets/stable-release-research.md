# Postiz 官方稳定版与完整合并边界

研究日期：2026-11-11（Asia/Shanghai）。范围：官方 Release 元数据、发布说明及 Git 提交图；不做源码审计、构建、迁移、部署或漏洞可利用性判断。

## 结论与证据强度

本轮锁定 **`v2.25.3` → `a5affe62c74e39c1e7ac960d50d8418b807d532c`**。GitHub 官方 `releases/latest` 重定向到该 Release，发布页标记 Latest；公开远端 tag 与本地 commit 对象一致。执行阶段应使用完整 SHA，不能把 `main`、`latest` 或本地过期 tags 当固定目标。[官方最新入口](https://github.com/gitroomhq/postiz-app/releases/latest)；[固定 Release](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3)；[固定 commit](https://github.com/gitroomhq/postiz-app/commit/a5affe62c74e39c1e7ac960d50d8418b807d532c)。

| 项目 | 本轮结果 | 证据与限制 |
| --- | --- | --- |
| 官方仓库 | `gitroomhq/postiz-app` | 上述官方 Release 页面与公开 Git remote |
| 最新稳定 Release | `v2.25.3` | 最新入口重定向、Latest 标记及 Release 列表一致 |
| 发布时间 | `2026-10-24T14:16:43Z`，即北京时间 `2026-10-24 22:16:43` | 官方 HTML 的 `relative-time datetime`；不是 commit 时间 |
| 目标 SHA | `a5affe62c74e39c1e7ac960d50d8418b807d532c` | `git ls-remote` 精确 tag 与本地 `cat-file -t` 验证 |
| `draft` / `prerelease` API 原始字段 | **本轮未直接读取** | 公共 API 返回 HTTP 403，`x-ratelimit-remaining: 0`；不能伪报已取得 JSON 中的 `false` |
| 非草稿、非预发布判定 | 官方 Latest 状态支持该判定 | GitHub 规定草稿和预发布不能设为 latest；这是发布状态与官方规则的推论，不是本轮 API 字段实测 |

最新 HTML 于 `2026-11-11T06:19:44Z` 实际读取，HTTP Date 为 `Wed, 11 Nov 2026 06:19:43 GMT`。GitHub 对 `make_latest` 明确排除 draft 与 prerelease，且公开发布与 draft 有不同可见性；因此本轮可锁定官方公开 Latest 稳定目标，同时保留 API 原始字段未直读的证据限制。[GitHub Releases API 定义](https://docs.github.com/en/rest/releases/releases#create-a-release)。

## 固定 Git 边界

下表均以本地 Git 对象与固定 SHA 计算；本地仓库非 shallow。虽然配置了 `blob:none` 的 promisor remote，但本次提交图遍历成功；缺少文件 blob 不等于缺少这次已遍历的提交祖先。

| 名称 | 固定 SHA | 含义 |
| --- | --- | --- |
| `H` | `501e87dbfb2ca6e44662baec308afa468a922b38` | 当前 `dev` 起点，研究分支也从此处起步 |
| `P` | `6fdf7cb53543fa28a470ad63e7619e8b98bcee43` | 产品行为基准；其后两个提交为 agent/CodeGraph 配置文档 |
| `B` | `0b554e684483932d394e703208fe21648e7acd6f` | `merge-base(H,S)` 与 `merge-base(H,U)` 相同 |
| `S` | `a5affe62c74e39c1e7ac960d50d8418b807d532c` | 官方稳定目标 |
| `U` | `80c3e55dc025c57c00bc4ecc146125125851dc41` | 本轮已知 `refs/upstream/main` 快照，不能自动纳入目标 |

| 提交集合 / 关系 | 结果 |
| --- | --- |
| `B..H` | 4 个 fork 提交 |
| `B..S` | 999 个稳定版侧提交 |
| `S..U` | 94 个稳定版之后的已知 main 提交，范围外 |
| `H...S`（左右独有） | 4 / 999 |
| `H...U`（左右独有） | 4 / 1093 |
| `B` 是 `H`、`S` 的祖先；`S` 是 `U` 的祖先 | 全部成立 |
| `H` 是 `S` 的祖先；`S` 是 `H` 的祖先 | 均不成立，需要真正保留双方历史的合并 |

`B` 最近的可达本地 tag 为 `v2.21.6`，这仅帮助界定发布说明阅读范围，不表示 fork 恰好等于该 tag。`B` 的 commit 时间为 `2026-04-20T12:27:13+07:00`。该信息来自下方 Git 命令，不用 README/package 版本推定上游进度。

```text
                  4 个 fork 提交 ── H
                 /
共同基线 B ──────┤
                 \ 999 个上游提交 ── S (v2.25.3) ── 94 个提交 ── U (已知 main)
```

发布网页曾显示 “88 commits to main since this release”，与固定 `S..U=94` 不同；网页计数是动态显示，其抓取状态未与 `U` 对齐。本报告不把它当 Git 边界证据，也不以此追逐新的 main。

## “全部 commit”如何验收

最终待交付合并结果记为 `M`。必须同时满足：

1. `S` 与原始 fork 起点 `H` 都是 `M` 的祖先；从 `S` 或 `H` 可达、但从 `M` 不可达的提交数都为零。这样稳定目标的完整可达历史与 fork 原始历史才进入结果；文件拷贝、squash 或选择性 cherry-pick 不能替代。
2. 不自动引入 `S..U` 的 94 个提交；可比较 `git rev-list S..U` 与 `git rev-list M` 的交集应为空。若未来另行纳入其中任何提交，必须单独改变范围并记录理由。
3. 历史完整与行为保留分别验收：祖先检查不能证明冲突解决正确，也不能证明使用保留单侧文件内容的策略后功能仍完整。两次定制提交的逐项行为、上游变化、数据库和工作流兼容仍交由后续票验证。

以下仅为未来执行阶段的检查表达式，本轮没有创建产品 merge：

```sh
git merge-base --is-ancestor a5affe62c74e39c1e7ac960d50d8418b807d532c "$mergeTip"
git merge-base --is-ancestor 501e87dbfb2ca6e44662baec308afa468a922b38 "$mergeTip"
git rev-list --count a5affe62c74e39c1e7ac960d50d8418b807d532c --not "$mergeTip"  # 应为 0
git rev-list --count 501e87dbfb2ca6e44662baec308afa468a922b38 --not "$mergeTip"  # 应为 0
```

## 官方发布说明中的升级关注项

只摘录会影响后续合并与验收的明确发布提示，未逐条审计对应源码；发布说明缺少提示不能视为没有破坏性变化。

| 来源 | 官方明确说明 | 后续需验证的范围 |
| --- | --- | --- |
| [v2.25.3](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3) | 修复 `PSA-2026-E9AHFV`、`PSA-2026-YT2HMH`，建议所有用户立即升级 | 保留官方安全修复；不能仅凭此声明当前 fork 存在或不存在相应漏洞 |
| [v2.25.2](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.2) | 安全公告 `PSA-2026-JNXM56`；登录后只跟随本应用内的 returnUrl；invite/showorg cookie 时效与 token 到期对齐 | 与现有 iframe/SSO 和组织选择定制逐项核对 |
| [v2.25.1](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.1) | 安全公告 `PSA-2026-4QX1WG`；重新连接渠道的 refresh token 保留修复 | 渠道连接、重连与权限回归 |
| [v2.25.0 Upgrade notes](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.0#upgrade-notes) | Prisma：Comments 字段变化、新 OAuthSelfHostedAuthorization 表及索引；官方 Docker 启动时推送 schema，其他安装需其 Prisma 步骤。新增可选 captcha/Canva/MCP 变量；该版本没有变更 Temporal workflow 版本 | 数据差异与真实启动入口；可选变量不自动启用。自托管应保持 MCP_SELF_HOSTED_RELAY 未设置 |
| [v2.24.0 Upgrade notes](https://github.com/gitroomhq/postiz-app/releases/tag/v2.24.0#upgrade-notes) | 新 Prisma 模型 Clipping、ClippingClip、mastra_*；要求新 backend 启动前完成 Prisma 步骤。新增 post workflow v1.0.7–v1.1.2 与 clipping/generate.video/process.media；部署 orchestrator 注册，新旧执行按锁定版本运行。重新发布须明确选择；拒绝软删渠道、过去日期、Slack 视频。Meta Graph 升至 v25.0；支付 webhook 转通用路径并保留旧 /stripe | 数据与队列兼容、旧任务处理；HIDDEN_PROVIDERS/MIGRATE_PROVIDERS 与渠道可见性定制核对；新增可选功能变量仅按实际需要评估 |
| [v2.23.0](https://github.com/gitroomhq/postiz-app/releases/tag/v2.23.0) | 流式媒体上传；pending-post workflow v1.0.6 用于中断后的发布状态与防重复；SSRF 防护；登录等 email 查找改为不区分大小写 | 发布、上传、外部地址访问和账号匹配行为 |

较早的 [v2.21.7](https://github.com/gitroomhq/postiz-app/releases/tag/v2.21.7)、[v2.21.8](https://github.com/gitroomhq/postiz-app/releases/tag/v2.21.8)、[v2.21.10](https://github.com/gitroomhq/postiz-app/releases/tag/v2.21.10) 也有立即升级的安全提示；稳定目标的完整历史将覆盖其上游后续链路。这不构成对当前 fork 或未来冲突解决结果的安全认证。[v2.22.1](https://github.com/gitroomhq/postiz-app/releases/tag/v2.22.1) 还列出邀请链接时效及渠道行为修复，应由后续定制矩阵判断具体影响。

## 目标漂移时的重新确认规则

执行前再读官方最新入口/Release 列表，并对固定 tag 做 `ls-remote`：记录检查时间、Release URL、完整 tag SHA；API 恢复后补读 `draft`、`prerelease`、`published_at` 原始字段。若 Latest 指向新版本、tag SHA 改变或发布状态改变，先更新目标决策和相关边界计数，不能静默把现有计划改成当时的 `main`。若本轮固定目标仍适用，实际 merge 用 `S` 的完整 SHA；获取对象后再次确认 `S` 是 commit。

## 命令证据（本轮实际执行结果）

```text
$ git rev-parse HEAD
501e87dbfb2ca6e44662baec308afa468a922b38
$ git branch --show-current
dev
$ git rev-parse --is-shallow-repository
false
$ git rev-parse refs/upstream/main
80c3e55dc025c57c00bc4ecc146125125851dc41

$ git ls-remote --tags https://github.com/gitroomhq/postiz-app.git refs/tags/v2.25.3 'refs/tags/v2.25.3^{}'
a5affe62c74e39c1e7ac960d50d8418b807d532c refs/tags/v2.25.3
$ git cat-file -t a5affe62c74e39c1e7ac960d50d8418b807d532c
commit

$ git merge-base 501e87dbfb2ca6e44662baec308afa468a922b38 a5affe62c74e39c1e7ac960d50d8418b807d532c
0b554e684483932d394e703208fe21648e7acd6f
$ git merge-base 501e87dbfb2ca6e44662baec308afa468a922b38 80c3e55dc025c57c00bc4ecc146125125851dc41
0b554e684483932d394e703208fe21648e7acd6f

$ git rev-list --left-right --count 0b554e684483932d394e703208fe21648e7acd6f...501e87dbfb2ca6e44662baec308afa468a922b38
0 4
$ git rev-list --left-right --count 0b554e684483932d394e703208fe21648e7acd6f...a5affe62c74e39c1e7ac960d50d8418b807d532c
0 999
$ git rev-list --left-right --count a5affe62c74e39c1e7ac960d50d8418b807d532c...80c3e55dc025c57c00bc4ecc146125125851dc41
0 94
$ git rev-list --left-right --count 501e87dbfb2ca6e44662baec308afa468a922b38...a5affe62c74e39c1e7ac960d50d8418b807d532c
4 999
$ git rev-list --left-right --count 501e87dbfb2ca6e44662baec308afa468a922b38...80c3e55dc025c57c00bc4ecc146125125851dc41
4 1093

$ git merge-base --is-ancestor B H     # 此处 B/H/S/U 为上表完整 SHA 的缩写
exit 0
$ git merge-base --is-ancestor B S
exit 0
$ git merge-base --is-ancestor S U
exit 0
$ git merge-base --is-ancestor H S
exit 1
$ git merge-base --is-ancestor S H
exit 1

$ git describe --tags --abbrev=0 0b554e684483932d394e703208fe21648e7acd6f
v2.21.6
$ git log --format='%H %s' 0b554e684483932d394e703208fe21648e7acd6f..501e87dbfb2ca6e44662baec308afa468a922b38
501e87dbfb2ca6e44662baec308afa468a922b38 chore: track codegraph ignore file
2b2a9d21389b358ce22b845ea8555ce1164e8663 docs: move agent instructions to AGENTS.md and add agent skills config
6fdf7cb53543fa28a470ad63e7619e8b98bcee43 feat: SSO integration, channel relay, UI improvements, and documentation
f042c177c1a378edacd54790614bdd9f709a2480 sso
```

HTML/API 读取使用 Python 标准库 `urllib.request.urlopen`，没有读取或输出凭据。官方 HTML 读取结果摘录：

```text
GET https://github.com/gitroomhq/postiz-app/releases/latest
final URL: https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3
observed: 2026-11-11T06:19:44.561661+00:00
HTTP Date: Wed, 11 Nov 2026 06:19:43 GMT
<relative-time ... datetime="2026-10-24T14:16:43Z">

GET https://api.github.com/repos/gitroomhq/postiz-app/releases/latest
HTTP 403: rate limit exceeded
GET https://api.github.com/repos/gitroomhq/postiz-app/releases/latest?verify=20261111
HTTP 403; x-ratelimit-remaining: 0
GET https://api.github.com/repos/gitroomhq/postiz-app/releases?per_page=100
HTTP 403; x-ratelimit-remaining: 0
```

## 研究成果保存

独立临时分支：[research/postiz-stable-release-20261111](https://github.com/chancetop-com/postiz-app/tree/research/postiz-stable-release-20261111)。分支从 `H` 创建，本报告是相对 `H` 唯一新增文件；地图、票据、旧交接资料和产品代码均不纳入本研究提交。提交与远端核验结果记录在本地问题票中；不开 PR、不合并该研究分支。
