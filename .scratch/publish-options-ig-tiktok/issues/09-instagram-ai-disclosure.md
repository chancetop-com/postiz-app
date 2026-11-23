# 09 — Instagram AI 披露

**What to build:** Instagram（Facebook Login 与 Standalone）的发布设置中出现唯一的 “Made with AI” 勾选，并在平台接受的位置发送 AI 标记。单图、单视频/Reel 加在媒体容器上；Carousel 只加在父容器上；Story 隐藏控件、保留已选值、发布时不发送。仅当值为 `true` 时发送，`false` / 未设置一律省略。

**Blocked by:** 08 — Prefactor：统一 “Made with AI” 文案 key

**Status:** resolved

- [x] Instagram DTO 接受可选的 `is_ai_generated` 布尔字段。
- [x] Facebook Login 的单图、单视频/Reel 在容器创建请求中带上 `is_ai_generated=true`。
- [x] Carousel 只在父容器请求中带上该字段；子容器永不携带。
- [x] Story 隐藏 AI 勾选但保留值；provider 不发送该字段。
- [x] Instagram Standalone 与 Facebook Login 一样支持 AI 标记；不引入 Location 行为。
- [x] 设置组件只显示一个 “Made with AI” 勾选，图片与视频共用；文案使用 `made_with_ai`。
- [x] provider 的 `@Rules` 与 Swagger 描述说明 Story 会被忽略、Carousel 只作用于父容器。
- [x] 在 provider 平台 HTTP 边界覆盖上述矩阵，并在 settings 组件边界覆盖显示/隐藏与值保留。
- [x] 现有测试、typecheck 通过。

## Answer

改动文件：

- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/instagram.dto.ts` — 新增可选 `is_ai_generated?: boolean`（`@IsOptional` + `@IsBoolean`），`@JSONSchema` 说明仅作用于单图、单视频/Reel 与 Carousel 父容器，Story 与 Carousel 子项忽略，两种 IG 登录方式都可用。
- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts` — `postPending()` 计算 `isAiGenerated = !isStory && assetBoolean(...)`，仅单媒体容器 URL 追加 `&is_ai_generated=true`；`pendingData` 增加 `isAiGenerated`，`checkPostStatus()` / `finalizePost()` 的内联类型同步；`finalizePost()` 仅在 Carousel 父容器 URL 追加该参数；`checkValidity()` 未改动；`@Rules` 增补 AI 适用范围。
- `libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts` — 仅更新 `@Rules`；发布行为仍由委托自动继承。
- `apps/frontend/src/components/new-launch/providers/instagram/instagram.collaborators.tsx` — Post Type 之后、Collaborators 之前新增唯一 `Checkbox`（`is_ai_generated`，文案 `t('made_with_ai', 'Made with AI')`）；Story 下 wrapper 使用 `invisible h-0 overflow-hidden`，保持挂载与值，不 `disabled`、无说明行。
- `tests/instagram-ai-disclosure.test.ts` — 新增 15 个 node 测试：FB Login 单图/Reel、Carousel 子项与父容器、Story、Standalone、`true` 发送 vs `false`/`undefined` 省略，以及 DTO 的 `plainToInstance` + `validate`。
- `tests/instagram-ai-settings.test.tsx` — 新增 4 个 jsdom 测试：唯一控件、Story 隐藏且挂载/保留值、切回恢复、Standalone 可见可勾。

命令与结果：

- `pnpm vitest run tests/instagram-ai-disclosure.test.ts tests/instagram-ai-settings.test.tsx` — 先红（后端 6 failed、settings 4 failed），实现后绿：2 files / 19 tests passed。
- `pnpm vitest run tests/i18n-made-with-ai.test.ts` — 17 passed（文案 key 回归）。
- `pnpm vitest run tests/channel-credentials.test.ts` — 30 passed / 10 skipped（既有 provider 凭证与发布测试）。
- `pnpm typecheck` — 通过（frontend typegen + frontend/backend/orchestrator tsc 均无错误）。
- `npx eslint ...`（4 个生产文件）— 0 errors；仅 `instagram.provider.ts:1105` 一条既有 unused eslint-disable warning，与本次改动无关。
- `git merge feat/publish-options-ig-tiktok --no-edit` — 集成分支未移动（Already up to date）。

Commit：

- `699e9046` feat(instagram): add made with AI disclosure
- 本 Answer 的文档提交见分支 tip。
