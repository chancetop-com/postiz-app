// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Ticket 10: the real media library reads old media and hands it back untouched.
 *
 * The transport is stubbed at `fetch`/`XMLHttpRequest`; the component, SWR
 * hook, shared custom fetch and Uppy uploader under test are the shipped ones.
 * Old rows carry the paths written before the merge, and selecting them must
 * return exactly `{ id, path }` so the post JSON keeps referencing the same
 * files.
 */

const modals = vi.hoisted(() => ({
  openModal: vi.fn(),
  closeCurrent: vi.fn(),
  closeAll: vi.fn(),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => modals,
}));

vi.mock('@uppy/react', () => ({
  Dashboard: () => <div data-testid="uppy-dashboard" />,
  FileInput: () => null,
  ProgressBar: () => null,
}));

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: async () => true,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { SWRConfig } from 'swr';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';

const OLD_IMAGE = {
  id: 'media-old-1',
  name: '2024/12/31/legacy.png',
  path: 'http://localhost:4200/uploads/2024/12/31/legacy.png',
  originalName: 'legacy.png',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  createdAt: '2024-12-31T23:00:00.000Z',
};
const OLD_VIDEO = {
  id: 'media-old-2',
  name: '2025/01/01/legacy.mp4',
  path: 'http://localhost:4200/uploads/2025/01/01/legacy.mp4',
  originalName: 'legacy.mp4',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  createdAt: '2025-01-01T10:00:00.000Z',
};

type Handler = (init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: { key: string; url: string; init?: RequestInit }[];
let xhrResponder: (request: FakeXMLHttpRequest) => {
  status: number;
  body?: unknown;
  text?: string;
  statusText?: string;
};

/**
 * The upload transport: Uppy's XHR plugin is real, only the wire is replaced.
 */
class FakeXMLHttpRequest {
  static last: FakeXMLHttpRequest | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: Document | XMLHttpRequestBodyInit | null = null;
  withCredentials = false;
  responseType = '';
  readyState = 0;
  status = 0;
  statusText = '';
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((event: any) => void) | null } = { onprogress: null };

  open(method: string, url: string) {
    this.method = method.toUpperCase();
    this.url = url;
    this.readyState = 1;
    FakeXMLHttpRequest.last = this;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
    queueMicrotask(() => {
      const result = xhrResponder(this);
      this.readyState = 4;
      this.status = result.status;
      this.statusText = result.statusText || '';
      this.responseText = result.text ?? JSON.stringify(result.body ?? {});
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 1,
        total: 1,
      });
      this.onload?.();
    });
  }

  abort() {
    this.readyState = 4;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const key = (method: string, url: string) => `${method} ${url}`;

const route = (method: string, url: string, handler: Handler) => {
  routes[key(method, `http://api${url}`)] = handler;
};

const mediaPage = (results: any[], pages = 1) => json({ pages, results });

const renderLibrary = (props: Partial<React.ComponentProps<typeof MediaBox>> = {}) => {
  const setMedia = props.setMedia ?? vi.fn();
  const closeModal = props.closeModal ?? vi.fn();
  const utils = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <VariableContextComponent
        storageProvider="local"
        backendUrl="http://api"
        disableImageCompression={true}
        mediaProcessing={false}
        transloadit={[]}
        {...({} as any)}
      >
        <FetchWrapperComponent baseUrl="http://api">
          <MediaBox setMedia={setMedia} closeModal={closeModal} {...props} />
        </FetchWrapperComponent>
      </VariableContextComponent>
    </SWRConfig>
  );
  return { ...utils, setMedia, closeModal };
};

beforeEach(() => {
  routes = {};
  calls = [];
  FakeXMLHttpRequest.last = null;
  xhrResponder = () => ({ status: 500, text: 'no responder' });
  window.sessionStorage.clear();
  modals.openModal.mockClear();
  modals.closeCurrent.mockClear();
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      calls.push({ key: key(method, url), url, init });
      const handler = routes[key(method, url)];
      if (!handler) {
        throw new Error(`unrouted request: ${method} ${url}`);
      }
      return handler(init);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('media library reads old media', () => {
  it('lists the stored rows with their original paths and identity headers', async () => {
    route('GET', '/media?page=1', () => mediaPage([OLD_IMAGE, OLD_VIDEO]));
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');

    const { container } = renderLibrary();

    const image = await waitFor(() => {
      const found = container.querySelector(
        `img[src="${OLD_IMAGE.path}"]`
      ) as HTMLImageElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    expect(image.getAttribute('src')).toBe(OLD_IMAGE.path);

    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(`${OLD_VIDEO.path}#t=0.1`);

    const listCall = calls.find((call) => call.key === 'GET http://api/media?page=1');
    const headers = listCall?.init?.headers as Record<string, string>;
    expect(headers.auth).toBe('jwt-a');
    expect(headers.showorg).toBe('org-a');
  });

  it('returns the selected old record as { id, path } without rewriting it', async () => {
    route('GET', '/media?page=1', () => mediaPage([OLD_IMAGE, OLD_VIDEO]));

    const { container, setMedia } = renderLibrary();

    const tile = await waitFor(() => {
      const found = container.querySelector(`img[src="${OLD_IMAGE.path}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.click(tile);

    fireEvent.click(screen.getByText('Add selected media'));

    expect(setMedia).toHaveBeenCalledTimes(1);
    expect(setMedia).toHaveBeenCalledWith([
      { ...OLD_IMAGE },
    ]);
    expect(modals.closeCurrent).toHaveBeenCalled();
  });
});

describe('media library uploads and deletes', () => {
  it('uploads through the real local uploader and selects the saved record', async () => {
    let serverMedia = [OLD_IMAGE];
    route('GET', '/media?page=1', () => mediaPage(serverMedia));
    window.sessionStorage.setItem('auth', 'jwt-a');
    window.sessionStorage.setItem('showorg', 'org-a');

    const newRecord = {
      id: 'media-new-1',
      name: '2026/11/11/fresh-upload.png',
      path: 'http://localhost:4200/uploads/2026/11/11/fresh-upload.png',
      originalName: 'fresh.png',
      thumbnail: null,
      alt: null,
      thumbnailTimestamp: null,
      createdAt: '2026-11-11T10:00:00.000Z',
    };
    xhrResponder = () => {
      serverMedia = [newRecord, OLD_IMAGE];
      return { status: 200, body: newRecord };
    };

    const { container, setMedia } = renderLibrary();
    await waitFor(() =>
      expect(container.querySelector(`img[src="${OLD_IMAGE.path}"]`)).not.toBeNull()
    );

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])], 'fresh.png', {
      type: 'image/png',
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(FakeXMLHttpRequest.last).not.toBeNull());
    const request = FakeXMLHttpRequest.last!;
    await waitFor(() => expect(request.body).toBeInstanceOf(FormData));
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://api/media/upload-server');
    expect(request.withCredentials).toBe(true);
    // the shipped header builder: the tab's own session values, and the
    // recorded baseline gap (no `impersonate`) is left alone
    expect(request.headers).toEqual({ auth: 'jwt-a', showorg: 'org-a' });
    const sent = (request.body as FormData).get('file') as File;
    expect(sent.name).toBe('fresh.png');

    // the new upload is saved and stays selected, so inserting uses the record
    // the backend returned rather than a client-side path guess
    await waitFor(() =>
      expect(container.querySelector(`img[src="${newRecord.path}"]`)).not.toBeNull()
    );
    fireEvent.click(screen.getByText('Add selected media'));

    expect(setMedia).toHaveBeenCalledWith([newRecord]);
    expect(setMedia.mock.calls[0][0][0].path).toBe(newRecord.path);
  });

  it('deletes a selected media through the API and reloads the page', async () => {    let serverMedia = [OLD_IMAGE, OLD_VIDEO];
    route('GET', '/media?page=1', () => mediaPage(serverMedia));
    route('DELETE', '/media/media-old-1', () => {
      serverMedia = [OLD_VIDEO];
      return json({ id: 'media-old-1', deletedAt: '2026-11-11T00:00:00.000Z' });
    });

    const { container } = renderLibrary();
    const tile = await waitFor(() => {
      const found = container.querySelector(`img[src="${OLD_IMAGE.path}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.click(tile);

    fireEvent.click(screen.getByText('Delete Selected (1)'));

    await waitFor(() =>
      expect(calls.some((call) => call.key === 'DELETE http://api/media/media-old-1')).toBe(true)
    );
    await waitFor(() =>
      expect(container.querySelector(`img[src="${OLD_IMAGE.path}"]`)).toBeNull()
    );
  });

  it('deletes a single media from the hover control on desktop', async () => {
    let serverMedia = [OLD_IMAGE, OLD_VIDEO];
    route('GET', '/media?page=1', () => mediaPage(serverMedia));
    route('DELETE', '/media/media-old-1', () => {
      serverMedia = [OLD_VIDEO];
      return json({ id: 'media-old-1', deletedAt: '2026-11-11T00:00:00.000Z' });
    });

    const { container } = renderLibrary();
    await waitFor(() =>
      expect(container.querySelector(`img[src="${OLD_IMAGE.path}"]`)).not.toBeNull()
    );

    // the desktop per-tile delete control only appears on hover
    const deleteControl = [...container.querySelectorAll('svg')].find((svg) =>
      svg.getAttribute('class')?.includes('group-hover:block')
    );
    expect(deleteControl).toBeTruthy();
    fireEvent.click(deleteControl!);

    await waitFor(() =>
      expect(calls.some((call) => call.key === 'DELETE http://api/media/media-old-1')).toBe(true)
    );
    await waitFor(() =>
      expect(container.querySelector(`img[src="${OLD_IMAGE.path}"]`)).toBeNull()
    );
    // the other old media is untouched
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('shows the empty state with upload and import entry points', async () => {
    route('GET', '/media?page=1', () => mediaPage([]));
    route('GET', '/third-party', () => json([]));

    const { container } = renderLibrary();

    expect(
      await screen.findByText("You don't have any media yet")
    ).toBeTruthy();
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
    expect(
      container.querySelector('input[type="file"][multiple]')
    ).not.toBeNull();
    // phones keep their own upload row in the empty state
    expect(container.querySelector('.forceChange')).not.toBeNull();
  });
});

describe('media library import entry', () => {
  it('keeps the original visibility rule: only media-library third parties', async () => {
    route('GET', '/media?page=1', () => mediaPage([OLD_IMAGE]));

    route('GET', '/third-party', () =>
      json([
        { id: 'tp-chat', position: 'chat', identifier: 'x', title: 'X', name: 'a' },
      ])
    );
    const onlyChat = renderLibrary();
    await waitFor(() =>
      expect(onlyChat.container.querySelector(`img[src="${OLD_IMAGE.path}"]`)).not.toBeNull()
    );
    expect(screen.queryByText('Import')).toBeNull();
    onlyChat.unmount();

    route('GET', '/third-party', () =>
      json([
        { id: 'tp-media', position: 'media-library', identifier: 'instagram', title: 'Instagram', name: 'brand' },
      ])
    );
    renderLibrary();

    // the library offers the entry in both its desktop and phone containers
    await waitFor(() => expect(screen.getAllByText('Import').length).toBeGreaterThan(0));
  });

  it('imports an external item through the real picker and refreshes the library', async () => {
    let serverMedia = [OLD_IMAGE];
    route('GET', '/media?page=1', () => mediaPage(serverMedia));
    route('GET', '/third-party', () =>
      json([
        {
          id: 'tp-media',
          position: 'media-library',
          identifier: 'instagram',
          title: 'Instagram',
          name: 'brand',
        },
      ])
    );
    route('POST', '/third-party/function/tp-media/listMedia', () =>
      json({ pages: 1, results: [{ id: 'ext-1', url: 'https://cdn.example/ext-1.jpg', name: 'ext-1.jpg', type: 'image' }] })
    );
    const imported = {
      ...OLD_IMAGE,
      id: 'media-imported-1',
      name: '2026/11/11/imported.jpg',
      path: 'http://localhost:4200/uploads/2026/11/11/imported.jpg',
      originalName: 'ext-1.jpg',
    };
    route('POST', '/third-party/tp-media/import', (init) => {
      serverMedia = [imported, OLD_IMAGE];
      return json({ imported: [imported], body: JSON.parse(String(init?.body)) });
    });

    const library = renderLibrary();
    await waitFor(() => expect(screen.getAllByText('Import').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Import')[0]);

    expect(modals.openModal).toHaveBeenCalledTimes(1);
    const children = modals.openModal.mock.calls[0][0].children as (close: () => void) => React.ReactNode;
    const picker = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <VariableContextComponent
          storageProvider="local"
          backendUrl="http://api"
          {...({} as any)}
        >
          <FetchWrapperComponent baseUrl="http://api">
            {children(vi.fn())}
          </FetchWrapperComponent>
        </VariableContextComponent>
      </SWRConfig>
    );

    fireEvent.click(await picker.findByText('Instagram: brand'));
    const item = await picker.findByText('ext-1.jpg');
    fireEvent.click(item);
    fireEvent.click(picker.getByText('Import Selected (1)'));

    await waitFor(() =>
      expect(
        calls.some((call) => call.key === 'POST http://api/third-party/tp-media/import')
      ).toBe(true)
    );
    const importCall = calls.find(
      (call) => call.key === 'POST http://api/third-party/tp-media/import'
    );
    expect(JSON.parse(String(importCall?.init?.body))).toEqual({
      items: [{ url: 'https://cdn.example/ext-1.jpg', name: 'ext-1.jpg' }],
    });

    // onImported reloads the real library, so the imported row shows up there
    await waitFor(() =>
      expect(
        library.container.querySelector(`img[src="${imported.path}"]`)
      ).not.toBeNull()
    );
  });
});
