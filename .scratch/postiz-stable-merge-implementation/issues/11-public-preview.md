# 11: 公开预览保持匿名访问与异常回退

**What to build:** 匿名查看者可以打开有效帖子公开预览，获得新版内容展示；取数失败或内容无效时看到既定回退，不被主布局的登录检查误伤。

**Blocked by:** 02 — [完整合入锁定的 v2.25.3](02-merge-stable-release.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“用户检查与公开预览”；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 从匿名浏览器请求有效公开预览，真实内部取数并显示帖子、媒体及兼容的上游净化、评论和展示行为，保留既定预览品牌与宽度。
- [x] 公开取数 fetch/JSON 异常及非数组内容返回既定 Post not found 回退；将网络、非 2xx、无效 JSON、无效数据形状分别验证，不把取数 catch 宣称为捕获全部渲染错误。
- [x] PreviewWrapper 的用户取数非 2xx 仍返回 null 并渲染 children，不套用主布局明确 null 跳登录的规则。
- [x] 用户接口成功、非 2xx、网络错误和无效 JSON 按预览既有契约核对；匿名公开内容不会因主布局加载或会话检查变成不可访问。
- [x] 使用真实公开请求与浏览器断言可见内容、净化结果及回退，对外部边界或受控故障注入有记录，不将整个内部 API 替换为静态 mock。
- [x] 记录已验证的预览及 Copilot 相关身份边界；不扩大为新增评论管理能力或全站去品牌。

## Answer

2026-11-11 于 `codex/ticket-11-public-preview`（基于 `codex/postiz-stable-merge` `5fc45bfd`，末次合并 `87110037`）完成。本票**没有改变产品行为**：02 合入后预览的可见行为已符合既定契约，本票把该契约变成可执行的回归验证，并把取数边界从页面内联代码提取为可测函数。仓库根为唯一来源，`k8s/apps/**`、`k8s/libraries/**` 由 `prepare-build-context.sh` 重新生成，未手改。

### 变更与位置

| 路径 | 变更 |
| --- | --- |
| `libraries/helpers/src/utils/public.preview.ts` | 新增 `loadPublicPreview(request)`：非 2xx、网络错误、无效 JSON、非数组均返回 `[]`；仅在成功且为数组时返回帖子。 |
| `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx` | 改为调用该函数；`Post not found` 回退、净化 `sanitizePostContent`、评论面板、媒体、`/postiz.svg` 品牌与 `max-w-[1346px]` 宽度结构均未改。 |
| `apps/frontend/src/components/preview/preview.wrapper.tsx` | **未改**。保留 `6fdf7cb5` 的 `if (!res.ok) return null`，且对 `user` 不做 `null → 跳登录`，children 始终渲染。 |
| `apps/frontend/src/components/new-layout/layout.component.tsx` | **未改**。仅作为对照被测试固定：非 2xx → `user===null` → `/auth/login` 且不渲染 children。 |
| `vitest.config.mts` | 允许 `tests/**/*.test.tsx` 并加入 `@vitejs/plugin-react`（组件渲染测试所需）。 |
| `k8s/apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx`、`k8s/libraries/helpers/src/utils/public.preview.ts` | 上述两份的生成副本。 |

新增测试（29 例）：

- `tests/public-preview.test.ts`（13）：取数函数 8 例（成功数组、404、500 仍带数组、网络抛出、非 JSON、对象/null/字符串载荷）＋ 5 例走**真实 socket** 的 `node:http` 受控本地服务（200 数组、404、`text/html` 非 JSON、非数组、端口已关闭）。只把后端换成受控替身，HTTP 请求本身真实。
- `tests/public-preview-route.test.tsx`（10）：在 jsdom 中执行真实的 Next 路由函数（`page.default({params, searchParams})`）并渲染返回值，只替换服务端 → 后端的内部 HTTP 边界。断言请求 `/public/posts/preview-1`、帖子正文/作者/@handle 可见、`Comments` 面板、两张媒体、净化（`<script>`、`javascript:`、`onerror` 消失，`div`→`p` 仍显示文本）、保留 `/postiz.svg` 与 `max-w-[1346px]`；以及 404、网络失败、无效 JSON、非数组、空数组五种情况显示 `Post not found` 且不渲染预览外层。
- `tests/preview-auth.test.tsx`（6）：`PreviewWrapper` 在 `/user/self` 成功、401、网络失败、无效 JSON 四种情况下均渲染 children；非 2xx/失败时子组件的 `useUser()` 为匿名且 `window.location.href` 保持 `/p/preview-1`（不跳转）；主布局在同一 401 下不渲染 children 且跳到 `/auth/login`；外加路由归属断言（`(preview)/p/[id]` 存在、`(site)/p` 不存在）。

### 变异检查（证明测试有效）

在三处逐个注入回退后运行相关测试，均失败，随后原样恢复：

1. `PreviewWrapper` 加 `user === null → window.location.href='/auth/login'; return null`：非 2xx 用例失败。
2. `layout.component.tsx` 去掉 `window.location.href = '/auth/login'`：主布局用例失败。
3. `loadPublicPreview` 去掉 try/catch 与 `!response.ok`：6 例失败（网络、非 JSON、非 2xx 仍带数组等）。

### 命令与结果

工具链 Node 22.23.4 / pnpm 10.6.1，`pnpm install --frozen-lockfile` 后，于合并集成分支后的提交上重跑：

- `pnpm run typecheck` → exit 0（frontend/backend/orchestrator）
- `pnpm run lint` → 0 errors / 713 warnings
- `pnpm run test` → 6 files / 43 tests passed（原有 14 例 + 本票 29 例）
- `pnpm run build` → exit 0
- `./k8s/prepare-build-context.sh` → 966 generated files，随后 `--check` 仅剩 `apps/frontend/public/magic.svg` 的行尾（CRLF/LF）差异，`git diff` 为空，属既有生成器行为，与本票无关。

提交：`ffb15619`（测试与取数提取）、`92eec553`（合并 `codex/postiz-stable-merge`，仅 docs 冲突面）、`8b885c4e`（k8s 生成副本）。

### 身份边界（已核对，未扩大）

- 公开读取与评论走匿名接口：`GET /public/posts/:id`、`GET /public/posts/:id/comments`、`POST /public/posts/:id/comments`（`apps/backend/src/api/routes/public.controller.ts`）；发评论时 `createPublicComment(postId, body, null, ip)` 明确传 `null` 用户，身份来自署名与 IP，非会话。
- 预览的 CopilotKit 使用 `credentials="include"`、`runtimeUrl = backendUrl + '/copilot/chat'`，**不附带** `auth`/`showorg` 头；主布局才从 `sessionStorage` 注入这两者。因此预览不会把 Postiz 会话身份带进 Copilot 请求。
- 匿名访客可看评论线程，但 `canResolve = !!user?.id && user.orgId === organizationId`，无法解决/管理线程；本票未新增任何评论管理能力，也未做全站去品牌（预览保留 `/postiz.svg` 与既有宽度）。

### 仍未验证

- **未跑真实候选容器/浏览器**：本环境无数据库与后端进程，故没有对已构建镜像发起真实匿名浏览器请求。数据层已用真实 HTTP（受控本地服务）、路由层已用真实 Next 路由函数渲染覆盖；真实镜像 + 浏览器断言留给 13、18 一起执行。
- 真实浏览器中预览页 Copilot 请求的 cookie/CORS 归属仅做了代码核对，未实测。
- 页面内 `JSON.parse(p.image)` 等渲染期异常仍是上游既有行为，未被“取数 catch”覆盖，本票不宣称已捕获全部渲染错误。
- `k8s --check` 的 `magic.svg` 行尾差异为既有生成器特性，未在本票处理。
