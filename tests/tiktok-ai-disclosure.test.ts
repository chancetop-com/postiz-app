import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { targetConstructorToSchema } from 'class-validator-jsonschema';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { TiktokBusinessProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business.provider';

/**
 * Tickets 10 + 11: one `is_ai_generated` setting drives the AI label of both
 * TikTok providers, the platform HTTP boundary shows where it lands, and the
 * deprecated `video_made_with_ai` field is gone from the settings contract.
 *
 * Matrix pinned here:
 * - legacy video DIRECT_POST -> post_info.is_aigc
 * - legacy photo DIRECT_POST / MEDIA_UPLOAD -> top-level is_aigc
 * - legacy video UPLOAD -> nothing
 * - Business video DIRECT_POST -> post_info.is_ai_generated (+ location)
 * - Business video UPLOAD/draft -> neither AI nor location
 * - Business photo DIRECT_POST -> top-level is_ai_generated (+ location)
 * - Business photo UPLOAD/draft -> top-level is_ai_generated, no location
 * Only `true` is sent; `false` and `undefined` are omitted.
 */

type RecordedCall = {
  url: string;
  method: string;
  body: any;
};

let calls: RecordedCall[] = [];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const stubPlatform = (business: boolean) => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      const method = init?.method || 'GET';

      // mediaSize() HEADs remote videos before the init call.
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '2048' },
        });
      }

      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      return json(
        business
          ? { code: 0, data: { share_id: 'share-1' } }
          : { data: { publish_id: 'publish-1' } }
      );
    })
  );
};

const videoPost = (settings: Record<string, any>) => ({
  id: 'post-1',
  message: 'TikTok caption',
  settings,
  media: [{ type: 'video' as const, path: 'https://media.test/clip.mp4' }],
});

const photoPost = (settings: Record<string, any>) => ({
  id: 'post-1',
  message: 'TikTok caption',
  settings,
  media: [{ type: 'image' as const, path: 'https://media.test/photo.jpg' }],
});

const baseSettings = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: true,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
};

const publishLegacy = async (
  post: ReturnType<typeof videoPost> | ReturnType<typeof photoPost>
) => {
  stubPlatform(false);
  const provider = new TiktokProvider();
  const result = await provider.postPending(
    'post-1',
    'legacy-token',
    [post as any],
    { id: 'integration-1' } as any
  );
  expect(result[0].status).toBe('pending');
  expect(calls).toHaveLength(1);
  return calls[0];
};

const publishBusiness = async (
  post: ReturnType<typeof videoPost> | ReturnType<typeof photoPost>
) => {
  stubPlatform(true);
  const provider = new TiktokBusinessProvider();
  const result = await provider.postPending(
    'business-1',
    'business-token',
    [post as any],
    { id: 'integration-1' } as any
  );
  expect(result[0].status).toBe('pending');
  expect(calls).toHaveLength(1);
  return calls[0];
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TikTok legacy AI disclosure', () => {
  it('sends post_info.is_aigc=true for a DIRECT_POST video', async () => {
    const call = await publishLegacy(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: true,
      })
    );

    expect(call.url).toContain('/video/init/');
    expect(call.body.post_info.is_aigc).toBe(true);
    expect(call.body.is_aigc).toBeUndefined();
  });

  it('omits the AI field for a DIRECT_POST video when the value is false or missing', async () => {
    const explicitlyFalse = await publishLegacy(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: false,
      })
    );
    expect(explicitlyFalse.body.post_info).not.toHaveProperty('is_aigc');

    const missing = await publishLegacy(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
      })
    );
    expect(missing.body.post_info).not.toHaveProperty('is_aigc');
  });

  it('never sends an AI field for an UPLOAD video', async () => {
    const call = await publishLegacy(
      videoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
        is_ai_generated: true,
      })
    );

    expect(call.url).toContain('/inbox/video/init/');
    expect(call.body).not.toHaveProperty('post_info');
    expect(call.body).not.toHaveProperty('is_aigc');
  });

  it('sends the top-level is_aigc=true for a DIRECT_POST photo', async () => {
    const call = await publishLegacy(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: true,
      })
    );

    expect(call.url).toContain('/content/init/');
    expect(call.body.post_mode).toBe('DIRECT_POST');
    expect(call.body.is_aigc).toBe(true);
    expect(call.body.post_info).not.toHaveProperty('is_aigc');
  });

  it('sends the top-level is_aigc=true for a MEDIA_UPLOAD photo', async () => {
    const call = await publishLegacy(
      photoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
        is_ai_generated: true,
      })
    );

    expect(call.body.post_mode).toBe('MEDIA_UPLOAD');
    expect(call.body.is_aigc).toBe(true);
  });

  it('omits the top-level is_aigc for a photo when the value is false or missing', async () => {
    const explicitlyFalse = await publishLegacy(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: false,
      })
    );
    expect(explicitlyFalse.body).not.toHaveProperty('is_aigc');

    const missing = await publishLegacy(
      photoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
      })
    );
    expect(missing.body).not.toHaveProperty('is_aigc');
  });

  it('still publishes a pre-rename scheduled post that only has video_made_with_ai', async () => {
    const call = await publishLegacy(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        video_made_with_ai: true,
      })
    );

    expect(call.url).toContain('/video/init/');
    expect(call.body.post_info).not.toHaveProperty('is_aigc');
    expect(call.body).not.toHaveProperty('is_aigc');
    // The unknown legacy field is ignored, the rest of the post still goes out.
    expect(call.body.post_info.title).toBe('TikTok caption');
    expect(call.body.post_info.privacy_level).toBe('PUBLIC_TO_EVERYONE');
  });
});

describe('TikTok Business AI disclosure', () => {
  it('sends post_info.is_ai_generated=true for a DIRECT_POST video', async () => {
    const call = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: true,
      })
    );

    expect(call.url).toContain('/business/video/publish/');
    expect(call.body.post_info.is_ai_generated).toBe(true);
    expect(call.body.is_ai_generated).toBeUndefined();
  });

  it('omits the AI field for a DIRECT_POST video when the value is false or missing', async () => {
    const explicitlyFalse = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: false,
      })
    );
    expect(explicitlyFalse.body.post_info).not.toHaveProperty(
      'is_ai_generated'
    );

    const missing = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
      })
    );
    expect(missing.body.post_info).not.toHaveProperty('is_ai_generated');
  });

  it('keeps the caption and brand flags for a DIRECT_POST video', async () => {
    const call = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        brand_organic_toggle: true,
        brand_content_toggle: true,
      })
    );

    expect(call.body.post_info.caption).toBe('TikTok caption');
    expect(call.body.post_info.is_brand_organic).toBe(true);
    expect(call.body.post_info.is_branded_content).toBe(true);
  });

  it('sends the top-level is_ai_generated=true for a DIRECT_POST photo', async () => {
    const call = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: true,
      })
    );

    expect(call.url).toContain('/business/photo/publish/');
    expect(call.body.is_ai_generated).toBe(true);
    expect(call.body.post_info).not.toHaveProperty('is_ai_generated');
  });

  it('keeps an optional title on a photo draft without any brand flags', async () => {
    const call = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
        title: 'Draft title',
        brand_organic_toggle: true,
        brand_content_toggle: true,
      })
    );

    expect(call.body.post_info).toEqual({
      title: 'Draft title',
      caption: 'TikTok caption',
      is_draft: true,
    });
  });

  it('keeps the caption and brand flags for a DIRECT_POST photo', async () => {
    const call = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        brand_organic_toggle: true,
        brand_content_toggle: true,
      })
    );

    expect(call.body.post_info.caption).toBe('TikTok caption');
    expect(call.body.post_info.is_brand_organic).toBe(true);
    expect(call.body.post_info.is_branded_content).toBe(true);
  });

  it('omits the top-level is_ai_generated for a photo when the value is false or missing', async () => {
    const explicitlyFalse = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        is_ai_generated: false,
      })
    );
    expect(explicitlyFalse.body).not.toHaveProperty('is_ai_generated');

    const missing = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
      })
    );
    expect(missing.body).not.toHaveProperty('is_ai_generated');
  });

  it('still publishes a pre-rename scheduled post that only has video_made_with_ai', async () => {
    const call = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        video_made_with_ai: true,
      })
    );

    expect(call.url).toContain('/business/video/publish/');
    expect(call.body.post_info).not.toHaveProperty('is_ai_generated');
    expect(call.body).not.toHaveProperty('is_ai_generated');
    // The unknown legacy field is ignored, the rest of the post still goes out.
    expect(call.body.post_info.caption).toBe('TikTok caption');
  });
});

describe('TikTok Business location', () => {
  const location = {
    id: 'loc-1',
    name: 'Test Place',
    address: '1 Test St',
  };

  it('sends location_id and location_name for a DIRECT_POST video', async () => {
    const call = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        location,
      })
    );

    expect(call.body.post_info.location_id).toBe('loc-1');
    expect(call.body.post_info.location_name).toBe('Test Place');
  });

  it('omits location from an UPLOAD video body', async () => {
    const call = await publishBusiness(
      videoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
        is_ai_generated: true,
        location,
      })
    );

    expect(call.url).toContain('/business/video/publish/');
    // Draft video post_info is exactly upload_to_draft.
    expect(call.body.post_info).toEqual({ upload_to_draft: true });
    expect(call.body).not.toHaveProperty('is_ai_generated');
  });

  it('sends location_id and location_name for a DIRECT_POST photo', async () => {
    const call = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'DIRECT_POST',
        location,
      })
    );

    expect(call.body.post_info.location_id).toBe('loc-1');
    expect(call.body.post_info.location_name).toBe('Test Place');
  });

  it('omits location from a photo draft while keeping the top-level AI label', async () => {
    const call = await publishBusiness(
      photoPost({
        ...baseSettings,
        content_posting_method: 'UPLOAD',
        is_ai_generated: true,
        location,
      })
    );

    expect(call.url).toContain('/business/photo/publish/');
    expect(call.body.post_info).toEqual({
      is_draft: true,
      caption: 'TikTok caption',
    });
    expect(call.body.is_ai_generated).toBe(true);
  });
});

describe('TikTokDto is_ai_generated', () => {
  it('documents the AI and location send paths in the settings schema', () => {
    const schema = targetConstructorToSchema(TikTokDto) as {
      properties?: Record<string, any>;
    };
    const properties = schema.properties ?? {};

    expect(properties.is_ai_generated.description).toContain('top-level');
    expect(properties.location.description).toContain('TikTok Business only');
    expect(properties.location.description).toContain('DIRECT_POST');
  });
});

describe('TikTok checkValidity on unsupported AI combinations', () => {
  it('keeps a video UPLOAD with the retained AI setting structurally valid', async () => {
    const items = [[{ path: 'https://media.test/clip.MP4' }]];
    const settings = {
      content_posting_method: 'UPLOAD',
      is_ai_generated: true,
    };

    // checkValidity is structural only: the settings do not influence it, so a
    // value retained from DIRECT_POST must not block the save.
    await expect(
      (new TiktokProvider().checkValidity as any)(items, settings)
    ).resolves.toBe(true);
    await expect(
      (new TiktokBusinessProvider().checkValidity as any)(items, settings)
    ).resolves.toBe(true);
  });
});

describe('TikTok provider rules', () => {
  const rulesOf = (provider: any) =>
    String(Reflect.getMetadata('custom:rules:description', provider));

  it('describes the legacy video/photo paths and UPLOAD semantics', () => {
    const rules = rulesOf(TiktokProvider);

    expect(rules).toContain('is_ai_generated');
    expect(rules).toContain('post_info.is_aigc');
    expect(rules).toMatch(/photo/i);
    expect(rules).toContain('top-level is_aigc');
    expect(rules).not.toContain('video_made_with_ai');
  });

  it('describes the Business video/photo paths and draft semantics', () => {
    const rules = rulesOf(TiktokBusinessProvider);

    expect(rules).toContain('is_ai_generated');
    expect(rules).toContain('post_info.is_ai_generated');
    expect(rules).toContain('top-level is_ai_generated');
    expect(rules).toContain('upload_to_draft');
    expect(rules).toContain('is_draft');
    expect(rules).not.toContain('video_made_with_ai');
  });
});
