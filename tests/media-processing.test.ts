// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ticket 10: optional media processing keeps its authentication and finishing
 * behaviour, and the original upload completes when it is off.
 *
 * The real `WaitForMediaProcessing` plugin is driven against a minimal Uppy
 * double; the status endpoint goes through the real shared custom fetch with
 * only `fetch` replaced, so the identity headers are the ones the app sends.
 */

import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';
import { WaitForMediaProcessing } from '@gitroom/react/helpers/uppy.upload';

class FakeUppy {
  files = new Map<string, any>();
  events: { name: string; args: any[] }[] = [];
  infos: { message: string; type: string }[] = [];
  postProcessors: ((ids: string[]) => Promise<void>)[] = [];

  addPostProcessor(fn: (ids: string[]) => Promise<void>) {
    this.postProcessors.push(fn);
  }

  removePostProcessor(fn: (ids: string[]) => Promise<void>) {
    this.postProcessors = this.postProcessors.filter((item) => item !== fn);
  }

  getFile(id: string) {
    return this.files.get(id);
  }

  setFileState(id: string, state: any) {
    Object.assign(this.files.get(id), state);
  }

  emit(name: string, ...args: any[]) {
    this.events.push({ name, args });
  }

  info(message: string, type: string) {
    this.infos.push({ message, type });
  }

  cancelAll() {
    this.files.clear();
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const saved = (overrides: Record<string, any> = {}) => ({
  id: 'media-1',
  name: '2026/11/11/fresh.png',
  path: 'http://localhost:4200/uploads/2026/11/11/fresh.png',
  status: 'ready',
  ...overrides,
});

const setup = () => {
  const uppy = new FakeUppy();
  const plugin = new WaitForMediaProcessing(uppy as any, {
    fetch: customFetch({ baseUrl: 'http://api' }),
    processingMessage: 'Processing...',
    fallbackMessage: 'Could not optimize file, the original will be used',
    interval: 1,
    maxWait: 50,
  });
  plugin.install();
  uppy.files.set('file-1', { id: 'file-1', name: 'fresh.png', response: { body: {} } });
  return { uppy, plugin };
};

let calls: { url: string; init?: RequestInit }[];

beforeEach(() => {
  calls = [];
  window.sessionStorage?.setItem('auth', 'jwt-a');
  window.sessionStorage?.setItem('showorg', 'org-a');
  window.sessionStorage?.setItem('impersonate', 'imp-a');
});

afterEach(() => {
  window.sessionStorage?.clear();
  vi.unstubAllGlobals();
});

const stubStatus = (responses: (() => Response)[]) => {
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index++;
      return next();
    })
  );
};

describe('media processing disabled', () => {
  it('finishes the original upload without polling the status route', async () => {
    const { uppy, plugin } = setup();
    uppy.files.get('file-1').response = { body: { saved: saved() } };
    stubStatus([() => json({})]);

    await plugin.process(['file-1']);

    expect(calls).toHaveLength(0);
    expect(uppy.files.get('file-1').response.body.saved.status).toBe('ready');
    expect(uppy.infos).toHaveLength(0);
  });
});

describe('media processing enabled with a controlled stub', () => {
  it('polls with the session identity and finishes on ready', async () => {
    const { uppy, plugin } = setup();
    uppy.files.get('file-1').response = {
      body: { saved: saved({ status: 'processing' }) },
    };
    stubStatus([
      () => json(saved({ status: 'processing' })),
      () => json(saved({ status: 'ready', name: '2026/11/11/fresh.png' })),
    ]);

    await plugin.process(['file-1']);

    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.url).toBe('http://api/media/media-1/status');
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.auth).toBe('jwt-a');
      expect(headers.showorg).toBe('org-a');
      expect(headers.impersonate).toBe('imp-a');
    }

    const file = uppy.files.get('file-1');
    expect(file.response.body.saved.status).toBe('ready');
    expect(
      uppy.events.some((event) => event.name === 'postprocess-complete')
    ).toBe(true);
    expect(uppy.infos).toHaveLength(0);
  });

  it('keeps a usable original when processing fails, with a warning', async () => {
    const { uppy, plugin } = setup();
    uppy.files.get('file-1').response = {
      body: { saved: saved({ status: 'processing' }) },
    };
    stubStatus([
      () =>
        json(
          saved({ status: 'failed', processingError: 'ffmpeg exited with 1' })
        ),
    ]);

    await plugin.process(['file-1']);

    expect(uppy.infos).toEqual([
      { message: 'Could not optimize file, the original will be used', type: 'warning' },
    ]);
    const file = uppy.files.get('file-1');
    expect(file.response.body.saved.name).toBe('2026/11/11/fresh.png');
    expect(
      uppy.events.some((event) => event.name === 'postprocess-complete')
    ).toBe(true);
  });

  it('fails a convert-only file and surfaces the processing error', async () => {
    const { uppy, plugin } = setup();
    uppy.files.get('file-1').response = {
      body: {
        saved: saved({
          status: 'processing',
          name: '2026/11/11/clip.mov',
        }),
      },
    };
    stubStatus([
      () =>
        json({
          ...saved({ status: 'failed', processingError: 'unsupported codec' }),
          name: '2026/11/11/clip.mov',
        }),
    ]);

    await plugin.process(['file-1']);

    expect(uppy.infos).toEqual([
      { message: 'unsupported codec', type: 'error' },
    ]);
    expect(uppy.files.get('file-1').error).toBe('unsupported codec');
  });

  it('gives up on repeated poll failures and keeps the original', async () => {
    const { uppy, plugin } = setup();
    uppy.files.get('file-1').response = {
      body: { saved: saved({ status: 'processing' }) },
    };
    stubStatus([() => json({ message: 'Media not found' }, 404)]);

    await plugin.process(['file-1']);

    expect(calls).toHaveLength(5);
    const file = uppy.files.get('file-1');
    expect(file.response.body.saved.status).toBe('processing');
    expect(uppy.infos[0].type).toBe('warning');
  });
});
