# AI 披露的 DTO 与 UI 契约

Type: grilling
Status: resolved
Blocked by: 03

## Question

基于 03 的结论，定下四个 provider 的 AI 披露契约：

1. TikTok / TikTok Business 复用现有 `video_made_with_ai` 同时覆盖图片和视频，还是新增 `made_with_ai` / `is_ai_generated` 并迁移？考虑 public API 向后兼容。
2. 前端文案是否从 "Video made with AI" 改为 "Made with AI"；图片与视频是否共用一个勾选。
3. Instagram 两个 provider 的 DTO 字段名与 UI 位置；Story / Carousel 子项是否需要隐藏。
4. UPLOAD（draft）模式下是否隐藏或禁用；平台忽略时 UI 如何表达。
5. 图片与视频字段位置不同（顶层 vs `post_info`），provider 层如何封装避免重复。

## Answer

**定案（2026-11-23）：四个 provider 统一 `is_ai_generated?: boolean`；删除 TikTok 的 `video_made_with_ai`，不做兼容迁移。UI 只有一个 “Made with AI” 勾选；平台没有字段或明确忽略的模式隐藏控件，图片 UPLOAD / draft 照发。**

### 1. DTO 与 public API

- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/tiktok.dto.ts`
  - 删除 `video_made_with_ai`（140 行）及 61–69、136–139 的过时注释；
  - 新增：

    ```ts
    @IsBoolean()
    @IsOptional()
    @JSONSchema({
      description:
        'Labels the post as AI generated. Applies to both video and photo posts. ' +
        'Omit it to leave the post unlabeled; false is treated the same as omitted.',
    })
    is_ai_generated?: boolean;
    ```

- `libraries/nestjs-libraries/src/dtos/posts/providers-settings/instagram.dto.ts`
  - `InstagramDto` 增加同名字段 `is_ai_generated?: boolean`（两个 IG identifier 共用同一个 DTO）。

- 取值约定：**仅 `true` 时发送**；`undefined` 与 `false` 在发送层都等价于「不发」。不引入三态。
- **兼容性后果（用户已确认，不做迁移）**：
  - public API 旧客户端继续发 `video_made_with_ai` **不会 400**（全局 `ValidationPipe` 没有开 `whitelist` / `forbidNonWhitelisted`），但该字段会被 provider 忽略；
  - 部署前已排期、`Post.settings` JSON 里只有旧键的帖子会**失去 AI 标注**，发布本身仍然成功；
  - release note 必须写明这是 **breaking behavior change**，Swagger 中旧字段直接消失。
- `@Rules` 同步改写（这会影响 chat / LLM 行为）：
  - `tiktok.provider.ts:32-33`：`is_ai_generated` 对图片和视频都生效；视频 UPLOAD 没有 `post_info`，图片 UPLOAD 发送顶层字段。
  - `tiktok.business.provider.ts:29-30`：图片 `is_ai_generated` 在顶层，视频在 `post_info`；视频 UPLOAD 整个 `post_info` 被忽略，图片 UPLOAD 顶层字段仍发送。

### 2. 前端

- **文案 key**：新增 `made_with_ai`，文案 `Made with AI`；从所有 locale 文件移除旧 key `video_made_with_ai`。`i18n.lock` 不手改，交给它的同步工具重建。

  | locale | 文案 |
  |---|---|
  | en | Made with AI |
  | zh | 由 AI 制作 |
  | he | נוצר באמצעות בינה מלאכותית |
  | ru | Создано с помощью ИИ |
  | fr | Créé avec l'IA |
  | es | Creado con IA |
  | pt | Criado com IA |
  | de | Mit KI erstellt |
  | it | Creato con l'IA |
  | ja | AIで作成 |
  | ko | AI로 제작됨 |
  | ar | صُنع باستخدام الذكاء الاصطناعي |
  | tr | Yapay zekâ ile oluşturuldu |
  | vi | Được tạo bằng AI |
  | bn | AI দিয়ে তৈরি |
  | ka_ge | AI-ით შექმნილი |

- **TikTok**（`apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider.tsx`）
  - 从 “Video features” 区移除 `video_made_with_ai` 勾选（248–254 行）；
  - 在媒体类型无关的区域放**唯一**一个 `is_ai_generated` 勾选，label 用 `t('made_with_ai', 'Made with AI')`；
  - 可见性：图片和视频都显示；仅 `content_posting_method === 'UPLOAD' && isVideo` 时用 `invisible h-0 overflow-hidden` 隐藏（保持挂载、保留值、provider 不发送）；图片 UPLOAD 保持可见可勾。

- **Instagram**（`apps/frontend/src/components/new-launch/providers/instagram/instagram.collaborators.tsx`，`instagram` 与 `instagram-standalone` 共用）
  - 在 `post_type` 之后、Collaborators 之前加同一个 `Checkbox`，label 同上；
  - Story 时用 `invisible h-0 overflow-hidden` 包裹（**不是**条件卸载），保留已选值；provider 不发送；
  - 不按媒体类型再做门控：单图、单视频 / Reel、Carousel 都显示；Carousel 只有一个勾选，值只作用于父容器。

### 3. 最终支持矩阵（实现者唯一事实来源）

| Provider | 媒体 | 模式 | 发送位置 | 发送条件 | 控件 |
|---|---|---|---|---|---|
| Instagram（两种登录） | 单图 | post | `postPending` 容器 query | `is_ai_generated === true && !isStory` | 显示 |
| Instagram | 单视频 / Reel | post | `postPending` 容器 query | 同上 | 显示 |
| Instagram | Carousel 父容器 | post | `finalizePost` 父容器 query；值随 `pendingData.isAiGenerated` 传过去 | 同上 | 显示（单勾选） |
| Instagram | Carousel 子项 | post | — | **永不发送** | 无独立控件 |
| Instagram | Story（图 / 视频） | story | — | **永不发送** | 隐藏（保留值） |
| TikTok legacy | 视频 | DIRECT_POST | `post_info.is_aigc` | `true` | 显示 |
| TikTok legacy | 视频 | UPLOAD | —（endpoint 无 `post_info`） | 永不发送 | 隐藏（保留值） |
| TikTok legacy | 图片 | DIRECT_POST / MEDIA_UPLOAD | body 顶层 `is_aigc` | `true` | 显示 |
| TikTok Business | 视频 | DIRECT | `post_info.is_ai_generated` | `true` | 显示 |
| TikTok Business | 视频 | UPLOAD / draft | —（`post_info` 整体被忽略） | 永不发送 | 隐藏（保留值） |
| TikTok Business | 图片 | DIRECT / draft | body 顶层 `is_ai_generated` | `true`（该字段只接受 `true`） | 显示 |

### 4. Provider 落点

统一封装方式：**跟随仓库现状，`this.assetBoolean()` + 内联条件 spread**；不新增 per-provider helper，也不改 `SocialAbstract`。

- `tiktok.provider.ts`
  - `buildTikokPostInfoBody()` 视频分支（589–595）：改成 `...( !isPhoto && this.assetBoolean(firstPost.settings.is_ai_generated) ? { is_aigc: true } : {})`；
  - `buildTikokSourceInfoBody()` 图片分支（879–891）：在返回对象顶层加 `...(this.assetBoolean(firstPost.settings.is_ai_generated) ? { is_aigc: true } : {})`；DIRECT_POST 与 MEDIA_UPLOAD 都走这里；
  - 视频 UPLOAD 分支只返回 `source_info`，不加字段。
- `tiktok.business.provider.ts`
  - `buildVideoBody()`（560–619）：把 `is_ai_generated: this.assetBoolean(...)` 改成非 draft 分支内的 `...(this.assetBoolean(firstPost.settings.is_ai_generated) ? { is_ai_generated: true } : {})`；
  - `buildPhotoBody()`（636–695）：在返回对象**顶层**加同样的条件 spread，draft 与 DIRECT 都加。
- `instagram.provider.ts`
  - `postPending()`：
    - `const isAiGenerated = !isStory && this.assetBoolean(firstPost.settings.is_ai_generated);`
    - 单媒体容器 URL 追加 `&is_ai_generated=true`（仅 `media.length === 1` 时；carousel 子项绝不加）；
    - `pendingData` 增加 `isAiGenerated`（carousel 父容器与后续 `checkPostStatus` / `finalizePost` 需要）。
  - `finalizePost()`：carousel 父容器 URL 追加 `&is_ai_generated=true`；`pendingData` 的内联类型（`checkPostStatus` 887–889 与 `finalizePost` 940–947）补 `isAiGenerated?: boolean`。
  - Story 永远不发送；`checkValidity()` **不**新增 Story + AI 的拒绝规则。
  - `handleErrors()` 不动（`INVALID_LOCATION_ID` 映射是 06 的范围）。
- `instagram.standalone.provider.ts`：纯委托，无需改动；AI 随 `postPending` / `finalizePost` 自动生效。

### 5. 明确不做 / 残留风险

- 不做 `video_made_with_ai` → `is_ai_generated` 的迁移代码、alias、启动时数据回填。
- 不给 UPLOAD 图片加「可能不生效」提示；如果 T5/T6 实测发现平台丢弃标签，再把图片 UPLOAD 改成隐藏（与视频一致）。
- 不改 X 的 `made_with_ai`（其他平台不在本轮范围），即使命名不同。
- 不新增 `checkValidity` 硬失败；AI 披露仍然只是标签，不值得让整条发布失败。

### 6. 验收（实现阶段）

1. TikTok legacy 图片：DIRECT_POST 与 UPLOAD 的 body 顶层都只有勾选时出现 `is_aigc: true`；视频 DIRECT_POST 在 `post_info.is_aigc`；视频 UPLOAD 无字段且 UI 隐藏。
2. TikTok Business 图片：DIRECT 与 draft 顶层都只有勾选时出现 `is_ai_generated: true`；视频 DIRECT 在 `post_info.is_ai_generated`，draft 无字段且 UI 隐藏。
3. Instagram：单图 / 单视频 / Reel / Carousel 父容器带 `&is_ai_generated=true`；Carousel 子项不带；Story 不带；`instagram-standalone` 与 `instagram` 行为一致。
4. UI：图片与视频共用一个 “Made with AI”；切到 Story / 视频 UPLOAD 时控件消失但切回后值仍在。
5. research/03 的 T1、T5、T6、T7 作为上线前实测项；T5/T6 失败时只把图片 UPLOAD 改为隐藏，不改本契约其他部分。
