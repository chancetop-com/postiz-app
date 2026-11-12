# 10: 旧媒体与新上传贯通编辑流程

**What to build:** 商户能查看旧媒体、上传新媒体，并通过既有 Import、单媒体 Editor、选择与插入完成帖子编辑；指定媒体工具继续隐藏，旧帖子媒体引用保持可用。

**Blocked by:** 05 — [保留组织切换、会话及普通登录流程](05-session-organization-login.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的媒体界面、旧媒体与可选处理契约；同时遵守[共同执行约束](../README.md#执行约束)。最终镜像卷和代理生命周期由 13 验证。

- [x] 使用升级后的合成旧数据和文件，从真实页面读取旧媒体、缩略图及帖子 JSON 引用，保持 ID、URL 与既有路径，不默认搬迁、重新处理或重写引用。
- [x] 新媒体能经真实应用上传、选择、插入帖子并重新打开编辑，断言正确用户/组织、文件及媒体记录；保留现有上传限制、local storage URL 布局和权限模型。
- [x] 媒体库 ThirdPartyMediaLibrary/Import 按原条件显示并可用，单媒体 Editor 能完成编辑；外部导入边界可替身化，内部 API、文件写入及结果读取保持真实。
- [x] 发帖媒体工具区隐藏 Design Media、ThirdPartyMedia、AiImage 和 AiVideo，不解释成全站 AI 或第三方媒体禁用，不误隐藏媒体库 Import 或单媒体 Editor。
- [x] 直接 Next upload route 实际验证身份、响应、限制及失败路径；其旁路请求行为按基线比较，不顺带统一改写认证策略。nginx 上传入口在 13 使用真实镜像验证。
- [x] 可选媒体处理关闭时原上传完成路径可用；启用受控处理替身时验证身份、轮询、完成和失败收尾，不要求开通 OpenAI、RunPod、Deepgram 或增加媒体工具系统依赖。
- [x] 桌面/移动的媒体空态、选择、插入、编辑及删除在隔离样本中有行为证据；成功与失败均检查页面结果、数据及文件，不仅检查组件或 helper。

## Answer

2026-11-11 于 `codex/ticket-10-media-editing`（起点 `c69bbb0c`，完成后合并 `codex/postiz-stable-merge` `896038c3`，合并提交 `8cbce53f`）完成。**本票没有改变产品行为**：02 合入后媒体读取、上传、选择、插入、编辑、删除、Import 与视频 Range 均已符合既定契约，本票把它们变成可执行的回归验证，覆盖组件、上传 helper、写入存储、Nest 上传入口与 Next 静态读取路由的真实实现，只在网络与数据库/外部队列边界设置替身。

### 实际改动的文件

- 新增 `tests/media-library.test.tsx`（8 用例）、`tests/media-editor.test.tsx`（4）、`tests/media-upload-route.test.ts`（5）、`tests/media-upload-server.test.ts`（8）、`tests/media-processing.test.ts`（5）、`tests/media-api-upload.test.ts`（5），共 35 个新用例。无生产代码改动。
- 未修改 `apps/`、`libraries/` 的业务源码；`k8s/apps/**` 未手改，由 `./k8s/prepare-build-context.sh` 重新生成（生成副本内容与提交一致，`git diff` 为空）。

### 验证方式与结果

| 场景 | 入口 | 断言 |
| --- | --- | --- |
| 旧媒体读取 | 真实 `MediaBox` + SWR + 共享 `customFetch`，仅替身 `fetch` | `/media?page=1` 携带会话 `auth`/`showorg`；旧图片按 `media.path` 原样渲染、旧 mp4 走 `VideoFrame`；旧记录选中后回传 `{ id, path }`（原路径、原 ID，无重写） |
| 新上传写入 | 真实 Uppy `XHRUpload`（local provider）+ 真实 `useUppyUploader`，仅替身 `XMLHttpRequest` | POST `http://api/media/upload-server`、`withCredentials`、FormData 含真实文件；请求头正是基线行为 `{auth, showorg}`；成功后重取 `/media` 并把后端返回记录保持选中，插入用后端记录而非前端拼路径 |
| 上传落盘 | 真实 `LocalStorage` + `uploadStreamToStorage` + `MulterStreamEngine` | `FRONTEND_URL/uploads/YYYY/MM/DD/<随机>.<嗅探扩展名>`；字节与源文件一致；图片 >10 MB 与 HTML 伪装均被拒且不留文件；mp4 上限仍为 1 GiB |
| 上传 API | 真实 Nest `MediaController` + 真实 multer 流式引擎（`listen(0)` 真实 HTTP），仅替身 `MediaService` 与 guard 注入的 `request.org` | 201 返回 `{id,name,path,status:'ready'}`，记录组织取自请求 `showorg`，原文件名 `legacy.png`；无文件 → 400 `No file provided`；非媒体内容 → 400 `Unsupported file type.`；>10 MB 图片 → 400 `File is too large.` |
| 写入后可读 | 同一进程内用 Next `GET /api/uploads/[[...path]]` 读取刚上传的 URL | 200、`image/png`、字节一致 |
| 视频 Range | 真实 Next uploads route | 200 全量；`bytes=0-3`、`bytes=4-` → 206 与正确 `Content-Range`/`Content-Length`；超出末尾的 end 被夹紧；起始越界 → 416；`../` 越界 → 404；匿名可读即基线（未加鉴权，未改策略） |
| 媒体记录/权限 | 真实 `MediaRepository`/`MediaService`，以 Prisma model 为边界 | 新建按 `organization.connect.id`；列表按 `organizationId`+`deletedAt:null`+`status != processing`；删除是带 `organizationId` 的软删除；读库不产生 create/update（旧行与路径不被迁移或重处理） |
| Import | 真实 `ThirdPartyMediaLibrary`（`/third-party` 仅 `position==='media-library'` 时出现） | 仅 chat 条目 → 无 Import；有 media-library 条目 → 显示；选中后 `POST /third-party/:id/import` 负载为 `{items:[{url,name}]}`，完成后媒体库重取并显示导入记录 |
| 单媒体 Editor | 真实 `MediaComponent` / `MediaComponentInner` | 旧值仍按原路径渲染；`Select` 走媒体库并只回传 `{...record}`；`Editor` 按钮仍在（Polotno 画布属外部边界，未开启）；编辑 alt/thumbnail → `POST /media/information` 后 `onSelect` 收到更新记录 |
| 发帖工具栏 | 真实 `MultiMediaComponent` | 只有 Insert Media；Design Media / ThirdPartyMedia / AiImage / AiVideo 均不渲染；旧媒体缩略图保留原路径；插入后 onChange 载荷为旧+新 `{id,path}`；用该载荷重新挂载可同时渲染两条媒体 |
| 空态与删除（桌面/移动） | 真实 `MediaBox` | 空态文案、Upload 按钮、`multiple` 文件输入与移动额外上传行；移动“Delete Selected (1)”与桌面悬停删除都调用 `DELETE /media/:id` 并重取列表，另一条旧媒体不受影响 |
| 可选处理关闭 | 真实 `WaitForMediaProcessing` + 共享 fetch（仅替身 `fetch`） | 记录已 `ready` 时不轮询、无提示、原响应不变 |
| 可选处理开启（受控替身） | 同上 | 轮询 `GET /media/:id/status` 携带 `auth`/`showorg`/`impersonate`；`ready` 后写回记录并 `postprocess-complete`；可原样使用的文件处理失败 → 警告并保留原件；只能转换的 `.mov` 失败 → 错误提示并置文件错误；连续 5 次轮询失败后放弃并保留原件 |

命令与结果（Node 22.23.4，pnpm 10.6.1，Prisma 6.5.0）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | 通过（frontend/backend/orchestrator） |
| `pnpm run lint` | 通过：0 errors / 713 warnings（基线约 700，新增测试文件无告警） |
| `pnpm run test`（合并前后各跑两次） | 合并前 319 passed / 36 files；合并后 368 passed / 44 files；两次结果一致，`preview-auth.test.tsx` 未失败 |
| `npx vitest run tests/media-*.test.ts*` | 35 passed |
| `pnpm run build` | 通过（frontend/backend/orchestrator） |
| `./k8s/prepare-build-context.sh --check` | `build context is in sync with 8cbce53f` |

### 明确未改动的边界

- **未修上传头差异**：`libraries/react-shared-libraries/src/helpers/uppy.upload.ts` 的 local XHR 路径仍只发送 `auth`+`showorg`，multipart 路径经共享 fetch 发送三项。规格把“旁路请求头不齐”列为已知基线缺口并明确“不借升级实施已撤回或未约定的修复”，因此只按基线断言（`expect(request.headers).toEqual({auth, showorg})`），不统一改写认证策略。ticket 05 的 `tests/session-upload-headers.test.ts` 继续覆盖同一事实。
- **未加鉴权**：直接 Next uploads route 保持匿名可读，与基线一致。
- 未改动隐藏媒体工具、Import 显示条件、单媒体 Editor 的可见性；未开通任何可选服务。

### 仍未证明 / 交由后续票

- **真实数据库持久化与重启**：本机无 Docker daemon、无本地 PostgreSQL（`nc localhost 5432` 不可达），因此媒体记录只用 Prisma model 边界替身验证组织作用域、软删除与只读语义；真实 schema 同步与重启后文件仍在由 13 的真实镜像/卷验证。
- **nginx 上传入口与真实容器卷**：由 13 验证；本票只覆盖 Next 直接路由。
- **真实桌面/移动视口渲染**：行为走真实 DOM（jsdom 无法计算 Tailwind 媒体查询），断言的是桌面/移动各自的控件与处理分支存在且可用；像素级/视口级证据属 13 的真实镜像运行。
- **Polotno 设计画布**：属外部设计服务边界，本票只验证单媒体 `Editor` 入口仍可见可用（未开通 `plontoKey`），未驱动画布内部。
- **PostgreSQL 旧行在 `status`/`deletedAt` 新默认值下的真实读取**：见 03 的 schema 同步证据；本票按默认值语义断言 `status != processing` 过滤不会隐藏旧行。

证据位置：`tests/media-library.test.tsx`、`tests/media-editor.test.tsx`、`tests/media-upload-route.test.ts`、`tests/media-upload-server.test.ts`、`tests/media-processing.test.ts`、`tests/media-api-upload.test.ts`。
