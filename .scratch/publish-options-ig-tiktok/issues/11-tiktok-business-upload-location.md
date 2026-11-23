# 11 — TikTok Business UPLOAD 的 Location 门控 + 旧字段收口

**What to build:** TikTok Business 在 `content_posting_method=UPLOAD` 下不再显示 Location 控件；provider 本来就不发送该字段，本票让界面与发送行为一致。同时完成 `video_made_with_ai` 的 contract：从 DTO 和 locale 中删除旧字段/旧 key，确认没有代码引用，旧客户端继续发送该字段时不会 400。

**Blocked by:** 10 — TikTok AI 披露（legacy + Business）

**Status:** resolved

- [x] Business UPLOAD 下 Location 控件隐藏但保留已选值；切回 DIRECT_POST 后恢复。
- [x] Business UPLOAD 的 provider payload 仍不包含 `location_id` / `location_name`。
- [x] 从 TikTok DTO 删除 `video_made_with_ai`；仓库内不再有读取该字段的代码。
- [x] 从所有 locale 删除旧的 `video_made_with_ai` key；`made_with_ai` 保持可用。
- [x] 旧客户端仍发送 `video_made_with_ai` 时请求不被 400，字段被忽略。
- [x] `@Rules` 与 Swagger 不再提及旧字段，Location 描述保持 “仅 DIRECT_POST”。
- [x] 在 settings 组件边界覆盖 Business UPLOAD 的 Location 隐藏与值保留；在 provider 边界覆盖 UPLOAD payload；补 DTO 校验用例。
- [x] 现有测试、typecheck 通过。

## Answer

**Location 门控无需生产改动。** `tiktok.provider.tsx` 的 Location 已在 `directPostOnly`（`clsx(isUploadMode && 'invisible h-0 overflow-hidden')`）内，UPLOAD 时保持挂载、`register('location')` 值不变；用组件测试固定该行为。Legacy TikTok 本来就没有 Location 控件。

**变更文件：**
- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/tiktok.dto.ts` — 删除 `video_made_with_ai` 属性与过时注释；`is_ai_generated` 与 Location 描述不变。
- `libraries/react-shared-libraries/src/translation/locales/<16 locales>/translation.json` — 删除 `video_made_with_ai`，保留 `made_with_ai`。
- `i18n.lock` — 用 `pnpm dlx lingo.dev@0.138.10 lockfile --force` 重建（仅删除旧 key 的 checksum）。
- `tests/tiktok-ai-disclosure.test.ts` — DTO `plainToInstance` + `validate` 接受旧字段（不 400）；生成的 settings schema 不含旧字段；旧字段被两个 provider 忽略且其余 body 正常；Business 视频/图片 DIRECT_POST 发送 location、UPLOAD/draft 不发送（图片 draft 仍发顶层 `is_ai_generated`）。
- `tests/tiktok-ai-settings.test.tsx` — Business 视频/图片 UPLOAD 下 Location 处于 `.invisible` 包裹层、仍挂载并保留值，切回 DIRECT_POST 后恢复可见；legacy 无 Location 控件。
- `tests/i18n-made-with-ai.test.ts` — 16 locales 不再有旧 key、`made_with_ai` 仍在；`i18n.lock` 无旧 key。

**验证（merge 集成 tip 后重跑）：**
- `pnpm vitest run tests/tiktok-ai-disclosure.test.ts tests/tiktok-ai-settings.test.tsx tests/i18n-made-with-ai.test.ts` → 3 files / 53 tests passed。
- `pnpm typecheck` → exit 0（frontend typegen + tsc、backend、orchestrator）。
- `grep -rn video_made_with_ai`（排除 `node_modules`/`dist`/`.scratch`）只剩测试断言。

**Commits：** `b3ef6a37`（实现），`96c207ee`（merge `feat/publish-options-ig-tiktok`，含 ticket 09）。
