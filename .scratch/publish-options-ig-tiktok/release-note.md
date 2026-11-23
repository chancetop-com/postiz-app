# Release note — Instagram and TikTok publish options

This release unifies AI-generated disclosure across Instagram and TikTok, and
adds Facebook Page locations to Instagram (Facebook Login).

## AI disclosure: `is_ai_generated` replaces `video_made_with_ai`

- `is_ai_generated` is now the single AI label field for Instagram and TikTok
  (both TikTok legacy and TikTok Business). Only a `true` value is sent;
  `false` and omitting the field both mean "no AI label".
- The old `video_made_with_ai` field has been removed.
- The field disappears from Swagger, so the public API schema no longer lists
  `video_made_with_ai`.

### This is a breaking behavior change

- API clients that still send `video_made_with_ai` are **not rejected**. The
  request succeeds, but the field is ignored and no AI label is sent.
- Posts that were scheduled **before this deployment** and only carry
  `video_made_with_ai` still publish successfully. They simply lose the AI
  label. There is no data migration: edit and re-save a pending post with
  "Made with AI" turned on if it must carry the label.
- New and edited posts saved with `is_ai_generated` keep the AI label.

## Instagram Location (Facebook Login only)

- Location is available for a single image, a single video / Reel, and the
  parent container of a carousel. Carousel children never receive it.
- Location is not available on a Story, and it is never available with
  Instagram Standalone (Instagram Login). The control is hidden there and any
  previously selected value is kept if you switch back to a supported post type.
- The picker is search-only: it searches Facebook Pages and lists only Pages
  that actually have location data. It shows at most 20 results and does not
  paginate.
- If the search returns nothing or fails, the picker shows `No location found`.
- If the selected Page has no valid location data, publishing fails with a
  readable `bad-body` error asking you to choose another location. The post is
  not retried automatically.

## TikTok AI label placement and UPLOAD caveats

- **TikTok legacy**
  - Video, direct post: sent as `post_info.is_aigc`.
  - Photo, direct post or upload to inbox: sent as the top-level `is_aigc`.
  - Video, upload to inbox: no AI label is sent and the control is hidden.
- **TikTok Business**
  - Video, direct post: sent as `post_info.is_ai_generated` (with the location
    when one is selected).
  - Photo, direct post: sent as the top-level `is_ai_generated`, alongside the
    location.
  - Photo, upload/draft: sent as the top-level `is_ai_generated`; the location
    is not sent and its control is hidden.
  - Video, upload/draft: no AI label and no location are sent; both controls
    are hidden.
- TikTok photo uploads are implemented per the platform's documented top-level
  field. Whether TikTok keeps the label on an inbox/draft photo will be
  confirmed on a real TikTok Business account; if it does not, the control will
  be hidden for that mode in a follow-up change.

## Settings behavior

- Unsupported combinations hide the control instead of disabling it. The value
  is retained, so switching back to a supported mode restores the previous
  choice.
- A visible control always sends its value. Hidden controls are not silently
  dropped from a user's visible choices; they are simply not applicable to that
  mode.
