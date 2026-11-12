# 06: 保留品牌、主题与界面入口范围

**What to build:** 使用者在新版桌面与移动布局中看到既定品牌、主题和菜单范围；已隐藏的账户功能与导航不会因升级重新出现，原有管理员代入仍可使用。

**Blocked by:** 02 — [完整合入锁定的 v2.25.3](02-merge-stable-release.md).

**Status:** resolved

**Source:** [已确认规格](../../postiz-stable-merge/spec.md)的“两项账户功能”和“品牌、界面与可选服务”；同时遵守[共同执行约束](../README.md#执行约束)。

- [x] 主布局沿用既有 PNG 品牌图案及 32×32 显示，适配桌面和移动容器；不扩大为全站去品牌，不根据旧文档删除预览品牌或改变其宽度。
- [x] 无主题 cookie 时默认 light；已有浅/深色、SSO 浅色布局及成功后 light cookie、手动切换深色均按既定契约工作。
- [x] 登录页面保留本地主题 class，同时纳入兼容的 MantineWrapper、Toaster 和字体更新；使用既有组件与主题变量，不引入成套第三方 UI 或废弃颜色变量。
- [x] 桌面和移动导航隐藏 Agent、Settings；接受上游把 Plugs/Integrations 移入 Settings，不重新增加顶级入口，相关源码、路由与重定向保留，渠道自身设置不受影响。
- [x] 普通账户、商户共享账户和管理员的所有桌面/移动账户界面均隐藏删除账户和永久交换登录身份入口；保留其路由/API 行为，管理员代入入口和能力继续存在。
- [x] 对隐藏功能的可达范围作实际页面检查，并在隔离样本上核对未新增后端禁用；永久身份交换与管理员代入不能混称，破坏性接口只使用可丢弃测试样本。
- [x] 在主布局、登录、日历、分析、账单、空媒体及移动导航保留视觉与交互证据；媒体工具的具体隐藏和可用能力由 10 验证，最终跨流程主题行为由 18 复验。

## Answer

2026-11-11，按[决定票 05](../../postiz-stable-merge/issues/05-ui-optional-services.md)的保留契约核对 02 的自动合并结果，并补齐两处升级后重新出现的账户入口；四道本地门（typecheck / lint / test / build）实际通过。未推送、未部署、未重新启用 CI。

### 起点与提交

| 项 | 值 |
| --- | --- |
| 执行起点 | `5fc45bfd`（集成 tip `codex/postiz-stable-merge`，工作区干净） |
| 工作分支 | `codex/ticket-06-brand-theme` |
| 本票提交 | `10d40c6e` 渲染级回归测试；`568332db` 隐藏删除账户与永久换登录身份入口 |
| 合入集成分支 | `dc7254b8`（`git merge codex/postiz-stable-merge`，无冲突，仅带入 02 的文档更新） |
| 工具链 | Node 22.23.4、pnpm 10.6.1、`pnpm install --frozen-lockfile` 通过 |

### 核对结果：02 合并已保留的定制（本票未改动）

| 范围 | 现状与位置 | 依据 |
| --- | --- | --- |
| 主布局 PNG 品牌 32×32 | `apps/frontend/src/components/new-layout/logo.tsx` 仍为 `/logo-postiz.png` + 内联 `width/height:32`；`new-layout/layout.component.tsx` 的 `flex justify-center` 容器同时用于桌面侧栏（`w-[80px]`）与移动抽屉（`mobile:fixed ... mobile:hidden`） | 只在 new-layout 替换，未扩大为全站去品牌 |
| 预览品牌 | `app/(app)/(preview)/p/[id]/page.tsx` 仍为 `SafeImage /postiz.svg 44×44`，`max-w-[1346px]` 未变 | 不按旧文档删预览 Logo/宽度 |
| 默认 light | `app/(app)/layout.tsx` 的 `<body class="... light text-primary !bg-primary">`；`layout/mode.component.tsx` `useCookie('mode','light')` 且按钮仍可切 dark；`chart-social.tsx`、`embedded.billing.tsx`、`launches.component.tsx`、`ui/icons/index.tsx` 均为默认 light | 默认浅色 ≠ 禁用深色 |
| SSO | `app/(app)/sso/layout.tsx` `light min-h-screen bg-white`；`app/(app)/sso/page.tsx` 成功后 `document.cookie='mode=light;path=/;max-age=31536000'` 再 `router.replace(isGeneral?'/launches':'/analytics')` | 成功后 light cookie |
| 登录页 | `app/(app)/auth/layout.tsx` 保留 `bg-primary` / `bg-secondary` / `text-textColor`，并已包在 `MantineWrapper` + `Toaster` 内；字体由 02 合并的 `jakartaSans`（app layout body）提供 | 本地主题 class + 上游 wrapper/字体并存 |
| 导航 | `layout/top.menu.tsx` 中 Agent（`:47`）、Settings（`:192`）`hide: true`；上游已删除 Plugs/Integrations/UGC 顶级项，`(site)/plugs/page.tsx`→`/settings?tab=plugs`、`(site)/third-party/page.tsx`→`/settings?tab=integrations` 重定向保留；`(site)/agents` 路由保留；桌面与移动共用同一个 `TopMenu`，移动抽屉没有新增条目 | 不恢复顶级入口，不删源码/路由 |
| 媒体工具 | `media/media.component.tsx` 的发帖工具栏仍注释隐藏 Design Media / ThirdPartyMedia / AiImage / AiVideo；媒体库三处 `ThirdPartyMediaLibrary` 渲染条件未改；单媒体 Editor 未涉及 | 归 10 验证；本票未改该文件 |

### 本票改动

1. `apps/frontend/src/components/settings/global.settings.tsx`：不再渲染 `<DeleteAccountComponent />`。组件文件、`/user/delete-account` 与上游行为保留。
2. `apps/frontend/src/components/billing/faq.component.tsx`：移除 FREE 账户的“删除账户”FAQ 条目（其中渲染 `DeleteAccountComponent isLink`）；`useFaqList` 改为导出以便渲染断言。
3. `apps/frontend/src/components/layout/impersonate.tsx`：管理员代入栏不再渲染 `<SwitchUser />`（永久交换登录身份）；`SwitchUser`、`/user/switch` 保留并导出。`Currently Impersonating`、停止代入、代入搜索、订阅/团队/账单入口均不变。
4. `vitest.config.ts`：包含 `tests/**/*.test.{ts,tsx}`，测试转换使用 automatic JSX runtime（应用 tsconfig 为 Next 的 `jsx: preserve`）；React 测试按文件 `@vitest-environment jsdom`。
5. `tests/*.tsx` 7 个渲染级套件（见下）。
6. `k8s/apps/frontend/src/**` 三个镜像文件由 `./k8s/prepare-build-context.sh --allow-dirty` 重新生成后提交，未手改 `k8s/apps/**`。`k8s/apps/frontend/public/magic.svg` 的 `--check` 报错是既有行尾基线（root 侧 CRLF、副本侧 LF）；重新生成后 `git add` 归一化回原 blob（内容无变化），随后 `./k8s/prepare-build-context.sh --check` 报告 build context 与根源码同步。

### 验证

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm run typecheck` | 通过（frontend `next typegen` + tsc、backend、orchestrator） |
| Lint | `pnpm run lint` | exit 0，0 errors / 713 warnings（与 02 记录的 713 相同，无新增） |
| 测试 | `pnpm run test` | 10 文件 / 38 tests 全通过 |
| 构建 | `pnpm run build` | exit 0（frontend + backend + orchestrator；`BUILD_EXIT_CODE=0`，合并后最终树重跑仍为 0） |
| 生成副本 | `./k8s/prepare-build-context.sh --check` | 输出 “build context is in sync”，无 DRIFT |

新增断言（`tests/`，React Testing Library 渲染真实组件；外部库只在边界替换）：

| 套件 | 覆盖 |
| --- | --- |
| `theme-brand.test.tsx` (7) | Logo 为 `/logo-postiz.png` 且 32×32、PNG 资产可解析；无 cookie→body `light`、点按切 dark 并写 cookie、已有 dark cookie 生效；空媒体 `NoMediaIcon` 默认浅色图并跟随 dark；`SsoLayout` 为 `light`/`bg-white` |
| `app-shell.test.tsx` (1) | 服务端渲染 app layout：`<body>` 同时含 `font-jakarta` 与 `light`、不含 `dark`，children 在内 |
| `auth-layout.test.tsx` (1) | 登录布局渲染出主题 class 与 `MantineWrapper`/`Toaster`/Logo/Testimonial，无旧硬编码 `bg-black` |
| `sso-light-theme.test.tsx` (4) | URL code → POST `/auth/sso` `{auth_code}` → 写 `mode=light` 并跳 analytics/launches；失败不写 cookie 不回跳；父页 message 仅接受允许 origin |
| `layout-navigation.test.tsx` (5) | 菜单无 Agent/Settings/Plugs/Integrations，保留 Calendar/Analytics/Media；主布局桌面 `w-[80px]` 容器内 32×32 品牌；移动抽屉容器内含同一品牌；展开抽屉后仍无 Agent/Settings |
| `surface-theme.test.tsx` (2) | 分析图表 tooltip 默认 `#fff`、dark cookie 下 `#1e1d1d`；账单 Stripe appearance `colorText` 默认 `#0e0e0e`、dark 下 `#ffffff` |
| `account-surfaces.test.tsx` (4) | Settings 无删除账户入口且其余分区仍在；账单 FAQ 无删除条目；管理员代入搜索仍在；代入中无 `Switch User`/`select user to switch to`，`Currently Impersonating` 仍在 |

### 可达范围与后端边界

- 隐藏仅发生在渲染层：`delete-account.component.tsx`、`impersonate.tsx` 的 `SwitchUser`、`/user/delete-account`、`/user/switch` 后端路由与 service 全部保留，本票没有新增任何服务端禁用或拒绝逻辑。
- 永久身份交换与管理员代入是两个功能：只有 `SwitchUser` 入口被移除；`/user/impersonate` 的临时代入（输入搜索 + 结束代入）保持可操作，并由渲染断言覆盖。
- 断链检查：无悬挂 import；`DeleteAccountComponent` 只剩组件自身定义，`SwitchUser` 只在 `impersonate.tsx` 定义并导出。
- 破坏性接口未调用：本票没有执行 `/user/delete-account` 或 `/user/switch`，也没有接触真实账户数据。

### 未证明与边界

- **日历、分析、账单的整页浏览器走查未执行**：需要 backend + orchestrator + PostgreSQL 的运行栈（13 的交付）。本票改用渲染断言覆盖这些页面共用的主题原语（body `light`、`ModeComponent`、`ChartSocial`、`EmbeddedBilling`、`NoMediaIcon`）以及主布局/登录/移动抽屉的真实 DOM；跨流程主题行为仍由 18 复验。
- 移动布局只在 jsdom 的类名/容器层面确认，未做设备或浏览器截图。
- 媒体工具栏四项隐藏与媒体库 Import / 单媒体 Editor / 上传选择插入的可用性归 10；本票只确认未扩大隐藏范围（该文件未改）。
- 商户共享账户场景未单独登录验证：所有账户界面共用同一 `GlobalSettings`、`FAQ` 与 `Impersonate` 组件，隐藏对该身份同样生效，但没有独立商户会话样本。
- SSO 成功写 cookie 用 mock 的 `/auth/sso` 响应验证，真实兑换与登录后主题持久化仍属 04/05 的验收范围。

### 触及的共享文件（供其它票对照）

- 未改动但本票核对过的共享面：`layout/mode.component.tsx`（02）、`media/media.component.tsx`（10）、`app/(app)/sso/**` 与 `app/(app)/auth/sso/**`（04）、`(preview)/p/[id]/**`（11）。
- 本票改动集中在 `settings/global.settings.tsx`、`billing/faq.component.tsx`、`layout/impersonate.tsx`（02 合并后无其它票声明归属），以及根级 `vitest.config.ts` / `tests/`。11 若在 `tests/` 新增 Preview 套件，注意不要与本票 7 个套件重名。
