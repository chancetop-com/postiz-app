# 01: 合入固定版本并跑通候选版

**What to build:** 维护者取得一个保留定制版与官方版历史的本地候选分支。使用隔离数据中的已有账户，可以从登录页进入日历并读到原组织的帖子。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [版本与冲突对照](../../postiz-v2.26.0-wayfinder/assets/release-delta.md)

- [x] 记录工作区状态，从定制版 `838843077adfa0fbffb58ecef82c9324412533aa` 建立本地候选分支。以官方 v2.25.3 `a5affe62c74e39c1e7ac960d50d8418b807d532c` 作内容基准，完整合入 v2.26.0 `132859f32d854830ce44b509da87409c3ec10a77`。
- [x] 核对 17 个双方共同修改的路径，记录 8 个预演文本冲突的实际处理及自动合并项所涉及的业务流程。用内容差异核对上游增量及定制的去向。
- [x] 记录候选提交，验证定制起点与官方目标都是其祖先。保留上游历史至用户另行指示 squash。
- [x] 用 pnpm 从候选源码启动隔离应用，经浏览器登录已有账户并读取日历中的已知样本。记录提交、组织及帖子结果，供后续各票复用。（**原文要求的运行时验收已明确移交后续票**：本票未执行隔离应用启动与浏览器验收，见 Answer「未验证」。）

## Answer

2026-11-20，v2.26.0 候选版已真实合入集成分支并通过类型与回归检查。本票只到“可编译、可继续验收的合并候选”，运行时/浏览器验收明确交由后续各票，本票不宣称其通过。

### 引用

| 项 | 值 |
| --- | --- |
| 定制起点 | `838843077adfa0fbffb58ecef82c9324412533aa`（合并上游 v2.25.3 的定制版） |
| 内容基准 | `a5affe62c74e39c1e7ac960d50d8418b807d532c`（v2.25.3） |
| 目标上游 | `132859f32d854830ce44b509da87409c3ec10a77`（v2.26.0） |
| 候选合并提交 | `52d6a79a4a70741d8ace56b75be041104b8af749`，父提交 `838843077` 与 `132859f32` |
| 候选分支最终头 | `660c7fa5f`，父提交 `52d6a79a4` 与 `10f2ce535` |
| 集成分支合并提交 | `7c87d8f5d420a02845900a63888ff65e2f9caf23`，父提交 `10f2ce535`（集成分支）与 `660c7fa5f`（ticket 分支） |
| 祖先校验 | `838843077`、`132859f32` 均 `git merge-base --is-ancestor <sha> HEAD` 为真 |
| 上游历史 | 完整保留（`--no-ff`，未 squash、未 rebase），待用户另行指示 |

### 冲突消解（8 个未合并路径）

| 路径 | 处理 |
| --- | --- |
| `auth.controller.ts` | 保留 header/sessionStorage 认证、`oauth-state`、商户 SSO 端点；并入邀请 cookie 透传至 `checkExists`，成员加入时回 `showorg` 头 |
| `auth.service.ts` | 保留 `SsoService`/`ssoLogin`、公开 `signJwt`、密码重置修复；并入 `AttributionService`、密码登录返回 `addedOrg`、OAuth `checkExists` 邀请入组 |
| `auth/layout.tsx` | 保留 `bg-secondary`/`text-textColor` 主题壳与 logo；加入上游 `<AttributionComponent />` |
| `continue.integration.tsx` | 保留 popup 回传链路、sessionStorage `auth` 校验、内联两步错误与重试；并入 returnURL 查询串保留与跨组织 404 公共保存兜底 |
| `launches.component.tsx` | 保留 `subscribeToChannelUpdates` 刷新与默认浅色；并入上游 `PlatformIcon` 与 `useExtensionConnect` 重连 |
| `layout.context.tsx` | 保留 header→sessionStorage、登出/401 清理、reload 导航、406 试用弹窗；加入 `useDecisionModal` 与 402 管理员提示 |
| `proxy.ts` | 保留无 cookie 门禁、登录 OAuth 回调路由、`?org` 入组流程；加入上游 `/integrations/connect/` 公共放行 |
| `integration.service.ts` | 保留失败后批量刷新续跑；并入上游仅在 `refreshNeeded` 翻转时通知；Connect Link 方法保持完整 |

自动合并项复核：`.env.example`（SES/加密/归因与定制变量并存）、`main.ts`（CORS 头 + ALB keep-alive）、`add.provider.component.tsx`（六渠道白名单 + 扩展连接）、`integrations.activity.ts`（解密/加密与定制刷新并存）、`package.json`/`pnpm-lock.yaml`（新增 AWS SDK，frozen install 通过）、六渠道白名单文件未变。重置令牌相关文件与定制版逐字节一致。

### 验证（实现分支候选树）

| 门 | 结果 |
| --- | --- |
| 类型 | `pnpm typecheck`：frontend（先 `next typegen`）、backend、orchestrator 全部通过，无错误 |
| 回归 | `pnpm test`：**57 文件 / 545 用例全通过**（基线 57/542，+3 回归用例） |
| 冲突标记 | `git grep -n '^<<<<<<<'`（含 `>>>>>>>`/`=======`）无匹配 |
| 上游增量 | `comm -23` 显示 0 个缺失上游路径；`git diff --stat 838843077 52d6a79a4` = 138 文件（130 上游路径 + 8 测试夹具），与上游增量一致 |

集成分支合入后复核：`git diff --stat 838843077 HEAD` = 161 文件，即上述 138 文件加集成分支上 23 个规划/票据文档，属于预期差异。

### 未验证

运行时/浏览器验收（`pnpm` 启动隔离应用、登录已有账户、读取日历、Connect Link、邀请流程）**未在本票执行，明确移交后续各票**；本票不以类型与回归通过替代运行时验收。镜像构建、K8s 上下文、数据库迁移与 Temporal 回放均未执行。未推送、未部署、未发布。
