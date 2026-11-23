# 10 — TikTok AI 披露（legacy + Business）

**What to build:** TikTok legacy 与 TikTok Business 统一使用一个 `is_ai_generated` 勾选。legacy 视频 DIRECT_POST 写入 `post_info.is_aigc`，图片 DIRECT_POST / MEDIA_UPLOAD 写入请求体顶层 `is_aigc`；Business 视频 DIRECT_POST 写入 `post_info.is_ai_generated`，图片 DIRECT_POST / draft 写入顶层 `is_ai_generated`。视频 UPLOAD 隐藏 AI 控件且不发送；图片 UPLOAD 显示并发送。仅当值为 `true` 时发送。

**Blocked by:** 08 — Prefactor：统一 “Made with AI” 文案 key

**Status:** resolved

- [x] TikTok DTO 新增可选的 `is_ai_generated`；本票暂时保留 `video_made_with_ai` 以支持 expand-contract。
- [x] TikTok legacy 视频 DIRECT_POST 发送 `post_info.is_aigc=true`；视频 UPLOAD 不发送任何 AI 字段。
- [x] TikTok legacy 图片 DIRECT_POST 与 MEDIA_UPLOAD 发送顶层 `is_aigc=true`。
- [x] TikTok Business 视频 DIRECT_POST 发送 `post_info.is_ai_generated=true`；视频 UPLOAD 的 `post_info` 只保留 `upload_to_draft`，不带 AI。
- [x] TikTok Business 图片 DIRECT_POST 与 draft 发送顶层 `is_ai_generated=true`。
- [x] UI 从 “Video features” 移除旧的 “Video made with AI”，在媒体类型无关的位置放唯一的 `made_with_ai` 勾选。
- [x] 视频 UPLOAD 下 AI 控件隐藏但保留值；图片 UPLOAD 下可见且可勾选。
- [x] 旧排程帖子只带 `video_made_with_ai` 时仍能发布，但失去 AI 标注；这一行为在测试中固定。
- [x] provider 的 `@Rules` 与 Swagger 描述更新为 `is_ai_generated`，并说明图片/视频路径及 UPLOAD 隐藏语义。
- [x] 在 provider 平台 HTTP 边界覆盖 legacy/Business 的视频、图片、DIRECT/UPLOAD 矩阵，并在 settings 组件边界覆盖显示/隐藏与值保留。
- [x] 现有测试、typecheck 通过。

## Answer

在 `ticket/10-tiktok-ai` 分支完成，commit `2b3204143381ed6155451af54a055f68a8e53a01`（merge `feat/publish-options-ig-tiktok`：Already up to date）。

**Changed files**

- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/tiktok.dto.ts`
  - 新增 `is_ai_generated?: boolean`（`@IsOptional()` + `@IsBoolean()` + `@JSONSchema`），描述视频/图片各自的发送位置与 UPLOAD 语义。
  - 保留 `video_made_with_ai`，但标为 deprecated/ignored（ticket 11 删除）；同步修正文件头注释。
- `libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts`
  - 视频 DIRECT_POST：仅 `is_ai_generated === true` 时发 `post_info.is_aigc`；`false`/缺省省略。
  - 图片 DIRECT_POST / MEDIA_UPLOAD：`buildTikokSourceInfoBody()` 顶层条件 spread `is_aigc: true`。
  - 视频 UPLOAD 保持无 AI 字段；不再读取 `video_made_with_ai`。
  - `@Rules` 改为说明 `post_info.is_aigc` vs 顶层 `is_aigc` 与 UPLOAD 语义。
- `libraries/nestjs-libraries/src/integrations/social/tiktok.business.provider.ts`
  - 视频 DIRECT_POST 非 draft 分支条件 spread `post_info.is_ai_generated: true`；draft 分支仍只有 `upload_to_draft`。
  - `buildPhotoBody()` 顶层条件 spread `is_ai_generated: true`（DIRECT 与 draft 都发）。
  - 不再读取 `video_made_with_ai`；`@Rules` 同步改写。
- `apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider.tsx`
  - 从 “Video features” 移除旧 `video_made_with_ai` 勾选。
  - 在 Content posting method 之后、`directPostOnly` 包裹层之前加入唯一的 `t('made_with_ai', 'Made with AI')` 勾选；仅 `UPLOAD` + 视频时用 `invisible h-0 overflow-hidden` 隐藏（保持挂载与值）。
- `tests/tiktok-ai-disclosure.test.ts`（node，19 tests）
  - legacy/Business × 视频/图片 × DIRECT/UPLOAD 的 HTTP body 断言，`true` 发送 vs `false`/缺省省略；旧 `video_made_with_ai` 帖子仍发布且不带 AI 字段；DTO `plainToInstance` + `validate`；`@Rules` 文案。
- `tests/tiktok-ai-settings.test.tsx`（jsdom，7 tests）
  - 唯一 “Made with AI”、旧 label 消失、视频 DIRECT / 图片 DIRECT+UPLOAD / 空媒体可见、视频 UPLOAD 隐藏且切回后值保留、Business 同行为。

**Commands / results**

- `pnpm vitest run tests/tiktok-ai-disclosure.test.ts tests/tiktok-ai-settings.test.tsx` → 2 files, 26 tests passed.
- `pnpm typecheck` → frontend (next typegen + tsc), backend, orchestrator all passed.
- `pnpm vitest run tests/channel-credentials.test.ts tests/i18n-made-with-ai.test.ts` → 2 files, 47 passed / 10 skipped.
- Targeted eslint on the four changed production files → no errors.

**Notes for the merger**

- `video_made_with_ai` intentionally remains in the DTO (deprecated, ignored) until ticket 11; locale key removal is also ticket 11.
- No Instagram, location, locale, or `i18n.lock` changes.
- Integration tip did not move after the branch was created, so no re-run was needed after the merge.
