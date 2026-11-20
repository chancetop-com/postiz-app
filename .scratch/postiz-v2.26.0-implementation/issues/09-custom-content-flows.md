# 09: 在定制界面和缺少可选服务时完成内容流程

**What to build:** 商户能在既有品牌和功能范围内，从日历进入媒体库，完成编辑、上传和排程并查看分析。收件人可匿名查看有效的公开预览。

**Blocked by:** [01 合入固定版本并跑通候选版](01-merge-and-run-candidate.md)

**Status:** resolved

**Assignee:** chancetio (agent implement-spec)

**Claimed:** 2026-11-20

**Source:** [升级规格](../../postiz-v2.26.0-wayfinder/spec.md) · [继承的界面及可选服务契约](../../postiz-v2.26.0-wayfinder/../postiz-stable-merge/spec.md)

- [x] 在桌面和移动布局核对主布局 Logo、默认浅色、SSO 浅色及手动深色切换。检查 Agent、Settings、删除账户、永久交换登录身份与指定媒体工具的隐藏范围，管理员仍可使用原代入入口。
- [x] 用实际页面完成媒体导入、单媒体编辑、上传、选择和插入，从日历排程并打开分析。核对上游平台图标、普通成员和管理员的账单权限反馈。
- [x] 在匿名窗口打开有效预览，并对不存在或无效内容核对既有回退结果。
- [x] 在缺少可选 AI/媒体服务的隔离配置下跑通上述核心路径。已鉴权且有权限的 AI 请求收到既有 503；让 MCP 启动失败时，记录日志且主 API 仍可响应。

## Answer

2026-11-20，在隔离栈用 Playwright（系统 Chrome，无头）实际操作页面。本票未发现需要修改生产代码的行为差异；新增 3 个账单反馈用例，其余结论来自现有实现和既有回归。

### 引用

| 项 | 值 |
| --- | --- |
| 实现分支 | `codex/ticket-09-custom-content-flows` |
| 用例提交 | `2a9971a83`（`test(content): pin billing feedback for members and admins`） |
| 集成合并提交 | `2aeaadc3a`，父提交 `822d62358`（集成分支）与 `c695988c2`（实现分支） |
| 运行时数据库 | PostgreSQL `postiz-ticket-09`（容器 `postiz-postgres`） |
| Redis | `redis://localhost:6379/9` |
| 后端 / 前端 | `http://localhost:3109` / `http://localhost:4309` |
| 运行时账号 | 合成管理员 `alice@ticket09.invalid`、普通成员 `bob@ticket09.invalid`；合成组织、X/Instagram 渠道、帖子与媒体 |
| 截图 | `../_reports/ticket-09-*.png`（desktop-calendar、mobile-drawer、member-402、admin-402、media-library、media-import-done、media-inserted、media-settings、channel-analytics、add-channel、public-preview、post-editor、rescheduled） |

### 界面、品牌与隐藏范围

| 检查 | 实际结果 |
| --- | --- |
| 桌面主布局 | `body` 默认 `light`；Logo 为 `/logo-postiz.png`，`width/height/minWidth/minHeight = 32px`；桌面栏含 Calendar、Analytics、Media |
| 手动主题切换 | 点击头部切换后 `body` 变为 `dark`，再次点击回到 `light`；未写 dark cookie 时初始为 light |
| 移动布局 | 390×844 下点击 `Open menu` 打开抽屉，Logo 可见且同为 32×32 PNG；抽屉只含 Calendar、Analytics、Media |
| SSO | `/sso` 渲染 `div.light.bg-white`，无 dark class |
| 导航隐藏项 | 桌面与移动抽屉中均无 Agent、Settings；直接代码/路由保留（既有 `layout-navigation` 回归） |
| 删除账户 | Settings 页无删除账户入口（`account-surfaces` 回归）；代码与 API 保留 |
| 永久交换身份 | 管理员代入栏保留 `Write the user details` 与结束代入控件；`Switch User`/永久交换入口不渲染（`account-surfaces` 回归） |
| 管理员代入 | 真实页面头部渲染 `Write the user details` 输入框 |
| 媒体工具范围 | 发帖媒体区保留 `Insert Media`；`Design Media`、`AI Image`、`AI Video` 不渲染（浏览器与 `media-editor` 回归一致） |

### 媒体、日历与分析

| 流程 | 实际结果 |
| --- | --- |
| 媒体导入入口 | 存在 `media-library` 位置的 ReelFarm 第三方时，媒体库显示 `Import`；不满足位置条件时不显示（既有 `media-library` 回归） |
| 媒体导入 | 打开 `Import` → 选择 ReelFarm → 受控 `listMedia` 替身 → 选中 1 项 → `Import Selected (1)`；浏览器发出 `POST /third-party/:id/import` 200，并出现成功提示。外部服务使用浏览器边界替身，不是真实 ReelFarm |
| 上传 | `input[type=file]` 选择合成 1×1 PNG；`POST /media/upload-server` 201，Uppy 报告 1 成功 0 失败；数据库新增 `Media`（`originalName=synthetic-upload-t09.png`，`status=ready`），`/uploads/...` 可读 200 |
| 单媒体编辑 | 发帖编辑器插入媒体后打开 `Media Settings`，填写 Alt Text 并 `Save Changes`；`POST /media/information` 201，数据库 `Media.alt` 变为 `ticket 09 synthetic alt` |
| 选择与插入 | 从日历打开既有帖子 → `Insert Media` → 选中媒体 → `Add selected media`；编辑器中出现所选媒体，媒体库关闭 |
| 日历排程 | 打开日历中的合成帖子，日期从 `22/11/2026 07:56` 改为 `25/11/2026 07:56`，点击 `Update`；浏览器 `POST /posts` 201，数据库该帖子仍为 `QUEUE` 且 `publishDate=2026-11-25 07:56:13` |
| 分析页 | `/analytics` 列出 `Acme on X` 与 `Acme on Instagram`；平台图标为 `/icons/platforms/x.png`、`/icons/platforms/instagram.png`；7/30 天切换分别请求 `GET /analytics/int_t09_instagram?date=7|30`，受控数据渲染图表 |
| 上游平台图标 | 日历 `Add Channel` 列出六项：`facebook.png`、`instagram.png`、`instagram-standalone.png`、`linkedin.png`、`tiktok.png`、`youtube.svg`；不出现 `tiktok-business`、`linkedin-page`、`tumblr` 等隐藏项 |
| 账单反馈（普通成员） | 受控 402（`canManageBillingUi=false`）弹出 `Payment Required`，文案为原消息 + `Please ask an admin of your organization.`，无 `Move to billing` |
| 账单反馈（管理员） | 受控 402（`canManageBillingUi=true`）弹出 `Payment Required` 与 `Move to billing` |

说明：运行时按票面 `.env` 启动后端时 `NOT_SECURED=true`，主 CORS 不会发送 `Access-Control-Allow-Credentials`，Uppy 的带凭据上传被浏览器预检拒绝。为验证真实上传路径，上传阶段以空的 `NOT_SECURED` 重启后端（生产分支），其余检查仍在该隔离栈完成。该差异是本地运行配置，不是代码缺陷。

### 公开预览

| 场景 | 实际结果 |
| --- | --- |
| 有效内容（匿名） | `/p/<postId>` 无需会话渲染发布日期、渠道、正文与媒体；响应 200，Logo 存在 |
| 不存在内容 | `/p/does-not-exist-t09` 渲染既有 `Post not found` 回退，无预览主体 |
| 失败类型 | 既有 `public-preview-route`/`public-preview` 回归覆盖 404、网络失败、非 JSON、非数组、空数组，均走同一回退 |

### 缺少可选服务

| 场景 | 实际结果 |
| --- | --- |
| 核心路径 | 未配置 `OPENAI_API_KEY`/`RUNPOD_*`/`DEEPGRAM_*`；SSO、日历、媒体上传/编辑/插入、排程、分析、匿名预览均可用（上表） |
| 已鉴权 AI 请求 | `POST /copilot/chat` 携带管理员 `auth`/`showorg` → `503 {"error":"AI not configured"}` |
| 未鉴权 AI 请求 | 401 先于 AI 配置检查（`optional-services-copilot` 回归） |
| MCP 启动失败 | 以无效 `NEXT_PUBLIC_BACKEND_URL` 在 `:3110` 启动真实 `main.ts`：日志出现 `ERROR MCP startup failed (non-fatal)` + `TypeError: Invalid URL`（`start.mcp.ts:115`）；主 API 已监听 `:3110`，`/api/` 返回 HTTP 404（可响应），随后正常关闭该进程 |
| 回归 | `optional-services-mcp` 证明失败被记录一次、不阻塞 listen、不重试/不吞掉既有 unhandledRejection 日志 |

### 新增用例

| 文件 | 覆盖 | 用例数 |
| --- | --- | --- |
| `tests/account-surfaces.test.tsx` | 普通成员 402 只提示联系管理员；管理员 402 保留 `Move to billing` 并打开 `/billing` | +2 |
| `tests/optional-services-copilot.test.ts` | 402 响应中 `canManageBillingUi` 对 `USER` 为 false、对 `ADMIN` 为 true | +1 |

### 合入门禁（合入集成分支前）

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | frontend（含 `next typegen`）、backend、orchestrator 全部通过，exit 0 |
| 回归 | `NOT_SECURED= pnpm test --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000` | **58 文件 / 579 用例全部通过**，exit 0，191.83s |

### 合入后复核（集成分支 `2aeaadc3a`）

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | exit 0（frontend typegen + frontend + backend + orchestrator） |
| 回归 | 同上 | **62 文件 / 645 用例全部通过**，exit 0，353.38s；较合并前 62 文件 / 642 用例恰为本票新增 3 例 |

冲突仅本票状态头（集成分支 `claimed` 对实现分支 `resolved`），按实现分支解决；`tests/` 两处改动自动合并，无冲突标记。

### 未验证

- ReelFarm 导入、X/Instagram 分析数据与渠道头像使用受控替身，未调用真实外部服务；真实 provider 权限差异不在本票范围。
- 未使用真实父应用 iframe、Safari 第三方 Cookie 或真实平台 OAuth；这些属于其他票/外部条件。
- 未在 `NOT_SECURED=true` 的 CORS 配置下完成浏览器上传（上传阶段改用生产默认 CORS 分支）；API 侧上传与本地存储由既有 `media-*` 回归覆盖。
- `next dev` 提示 Next.js 16.4.2 安全公告建议升级，不属于本票范围，未处理。

未推送、未部署；未改动主检出目录。
