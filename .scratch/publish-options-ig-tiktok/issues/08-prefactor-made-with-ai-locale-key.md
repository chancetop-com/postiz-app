# 08 — Prefactor：统一 “Made with AI” 文案 key

**What to build:** 为四个 provider 的 AI 披露准备统一的界面文案 key。所有 locale 增加 `made_with_ai`，保留现有 `video_made_with_ai` 不动；本票不改任何 UI 或 provider，只消除后续两条 AI 票对同一批 locale 文件的共享冲突。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 按已确认的 16 个语言文案，为每个 locale 增加 `made_with_ai` key。
- [x] `video_made_with_ai` 仍保留，现有 TikTok “Video made with AI” 文案和勾选行为不变。
- [x] 使用仓库现有的 i18n 同步工具重建 lock 文件，不手改生成物。
- [x] 现有测试、typecheck 通过；本票不产生用户可见行为变化。

## Answer

改动文件：

- `libraries/react-shared-libraries/src/translation/locales/{en,zh,he,ru,fr,es,pt,de,it,ja,ko,ar,tr,vi,bn,ka_ge}/translation.json` — 每个文件在 `video_made_with_ai` 之后新增一行 `made_with_ai`，文案严格取 ticket 05 确认表（en `Made with AI`、zh `由 AI 制作`、he `נוצר באמצעות בינה מלאכותית`、ru `Создано с помощью ИИ`、fr `Créé avec l'IA`、es `Creado con IA`、pt `Criado com IA`、de `Mit KI erstellt`、it `Creato con l'IA`、ja `AIで作成`、ko `AI로 제작됨`、ar `صُنع باستخدام الذكاء الاصطناعي`、tr `Yapay zekâ ile oluşturuldu`、vi `Được tạo bằng AI`、bn `AI দিয়ে তৈরি`、ka_ge `AI-ით შექმნილი`）。`video_made_with_ai` 未改动。
- `i18n.lock` — 由 Lingo.dev CLI v0 重建，未手改。diff 仅 +2 行：新增 `made_with_ai` checksum，以及工具补回的既有源文案 `channel_popup_blocked`（en 早就有该 key，旧 lock 已漂移；非本票引入）。ka_ge 不在 `i18n.json` 的 targets 里，重建前后 lock 都不含 ka_ge 条目，与仓库现状一致。
- `tests/i18n-made-with-ai.test.ts` — 新增：遍历 16 个 locale，断言 `made_with_ai` 为非空字符串且不等于 key 本身，同时断言 `video_made_with_ai` 仍存在；另断言 en 文案为 `Made with AI`。

命令与结果：

- `pnpm vitest run tests/i18n-made-with-ai.test.ts` — 先红（17 failed，key 不存在），加 locale 后绿：17 passed。
- `cd /Users/chancetio/Desktop/Web/postiz-worktrees/ticket-08 && pnpm dlx lingo.dev@0.138.10 lockfile --force` — 成功 “Lockfile rebuilt”；重复执行 lock 文件 hash 不变（幂等）。
- `pnpm typecheck` — 通过（frontend typegen + frontend/backend/orchestrator tsc 均无错误）。
- `git merge feat/publish-options-ig-tiktok --no-edit` — 集成分支未移动（Already up to date）。

Commit：

- `e0994570` feat(i18n): add shared made_with_ai copy to all locales
- 本 Answer 的文档提交见分支 tip。
