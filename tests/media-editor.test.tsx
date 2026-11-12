// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { SWRConfig } from 'swr';

/**
 * Ticket 10: the composer still inserts earned media into a post, and the
 * single-media editor still saves its changes.
 *
 * The post keeps the media paths it already had; a new selection is appended
 * as `{ id, path }`. The four hidden composer tools stay hidden while the
 * library, its Import entry and the single-media field remain usable.
 */

const modals = vi.hoisted(() => ({
  openModal: vi.fn(),
  closeCurrent: vi.fn(),
  closeAll: vi.fn(),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => modals,
}));

vi.mock('@uppy/react', () => ({
  Dashboard: () => null,
  FileInput: () => null,
  ProgressBar: () => null,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import {
  MediaComponent,
  MultiMediaComponent,
} from '@gitroom/frontend/components/media/media.component';
import { MediaComponentInner } from '@gitroom/frontend/components/launches/helpers/media.settings.component';

const OLD_MEDIA = {
  id: 'media-old-1',
  path: 'http://localhost:4200/uploads/2024/12/31/legacy.png',
  name: '2024/12/31/legacy.png',
  originalName: 'legacy.png',
  thumbnail: null,
  alt: 'legacy shot',
  thumbnailTimestamp: null,
  createdAt: '2024-12-31T23:00:00.000Z',
};
const NEW_MEDIA = {
  id: 'media-new-1',
  path: 'http://localhost:4200/uploads/2026/11/11/fresh.png',
  name: '2026/11/11/fresh.png',
  originalName: 'fresh.png',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  createdAt: '2026-11-11T10:00:00.000Z',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let routes: Record<string, (init?: RequestInit) => Response>;
let calls: { key: string; url: string; init?: RequestInit }[];
const key = (method: string, url: string) => `${method} ${url}`;
const route = (method: string, url: string, handler: (init?: RequestInit) => Response) => {
  routes[key(method, `http://api${url}`)] = handler;
};

const Providers = ({ children }: { children: React.ReactNode }) => {
  const form = useForm({ values: {} });
  return (
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
          <FormProvider {...form}>{children}</FormProvider>
        </FetchWrapperComponent>
      </VariableContextComponent>
    </SWRConfig>
  );
};

const renderInProviders = (node: React.ReactNode) =>
  render(<Providers>{node}</Providers>);

const openLastModal = () => {
  const options = modals.openModal.mock.calls.at(-1)![0];
  const children = options.children as (close: () => void) => React.ReactNode;
  return renderInProviders(children(vi.fn()));
};

beforeEach(() => {
  routes = {};
  calls = [];
  modals.openModal.mockClear();
  // the library sizes itself to the viewport; jsdom has no matchMedia
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  window.sessionStorage.clear();
  route('GET', '/media?page=1', () => json({ pages: 1, results: [OLD_MEDIA, NEW_MEDIA] }));
  route('GET', '/third-party', () => json([]));
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

describe('composer media tools', () => {
  it('keeps the hidden tools hidden and still offers Insert Media', () => {
    const { container } = renderInProviders(
      <MultiMediaComponent
        label="Media"
        description=""
        dummy={false}
        allData={[]}
        text="hello"
        name="media"
        value={[{ id: OLD_MEDIA.id, path: OLD_MEDIA.path }]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Insert Media')).toBeTruthy();
    expect(screen.queryByText('Design Media')).toBeNull();
    expect(screen.queryByText('Third Party Media')).toBeNull();
    expect(screen.queryByText('AI Image')).toBeNull();
    expect(screen.queryByText('AI Video')).toBeNull();
    // the existing post media still renders from its stored path
    expect(container.querySelector(`img[src="${OLD_MEDIA.path}"]`)).not.toBeNull();
  });

  it('inserts old and new media into the post without rewriting stored paths', async () => {
    const onChange = vi.fn();
    renderInProviders(
      <MultiMediaComponent
        label="Media"
        description=""
        dummy={false}
        allData={[]}
        text="hello"
        name="media"
        value={[{ id: OLD_MEDIA.id, path: OLD_MEDIA.path }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Insert Media'));
    const library = openLastModal();

    const fresh = await waitFor(() => {
      const found = library.container.querySelector(`img[src="${NEW_MEDIA.path}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.click(fresh);
    fireEvent.click(screen.getByText('Add selected media'));

    // sortable syncs the mounted list under its own field name; the insert
    // arrives under the component's name
    const sync = onChange.mock.calls.find((call) => call[0].target.name === 'upload');
    expect(sync?.[0].target.value[0].path).toBe(OLD_MEDIA.path);
    const inserts = onChange.mock.calls.filter(
      (call) => call[0].target.name === 'media'
    );
    expect(inserts).toHaveLength(1);
    const payload = inserts[0][0].target.value;
    // sortable annotates its list, so only the media identity matters here
    expect(
      payload.map((item: any) => ({ id: item.id, path: item.path }))
    ).toEqual([
      { id: OLD_MEDIA.id, path: OLD_MEDIA.path },
      { id: NEW_MEDIA.id, path: NEW_MEDIA.path },
    ]);

    // reopening the saved post renders both media from the stored paths
    cleanup();
    const reopened = renderInProviders(
      <MultiMediaComponent
        label="Media"
        description=""
        dummy={false}
        allData={[]}
        text="hello"
        name="media"
        value={payload.map((item: any) => ({ id: item.id, path: item.path }))}
        onChange={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(
        reopened.container.querySelectorAll('img').length
      ).toBeGreaterThanOrEqual(2)
    );
    expect(
      reopened.container.querySelector(`img[src="${OLD_MEDIA.path}"]`)
    ).not.toBeNull();
    expect(
      reopened.container.querySelector(`img[src="${NEW_MEDIA.path}"]`)
    ).not.toBeNull();
  });
});

describe('single media field', () => {
  it('selects from the library and keeps the value shape', async () => {
    const onChange = vi.fn();
    const { container } = renderInProviders(
      <MediaComponent
        label="Cover"
        description=""
        name="cover"
        value={{ id: OLD_MEDIA.id, path: OLD_MEDIA.path }}
        onChange={onChange}
      />
    );

    expect(container.querySelector(`img[src="${OLD_MEDIA.path}"]`)).not.toBeNull();
    expect(screen.getByText('Editor')).toBeTruthy();

    fireEvent.click(screen.getByText('Select'));
    const library = openLastModal();
    const fresh = await waitFor(() => {
      const found = library.container.querySelector(`img[src="${NEW_MEDIA.path}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.click(fresh);
    fireEvent.click(screen.getByText('Add selected media'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      target: { name: 'cover', value: { ...NEW_MEDIA } },
    });
  });

  it('saves alt text and thumbnail through the media information API', async () => {
    // an image with no thumbnail yet saves its alt text and keeps the other
    // fields it had
    const updated = { ...OLD_MEDIA, alt: 'new alt text', thumbnail: '' };
    route('POST', '/media/information', (init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        id: OLD_MEDIA.id,
        alt: 'new alt text',
        thumbnail: '',
        thumbnailTimestamp: null,
      });
      return json(updated);
    });

    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderInProviders(
      <MediaComponentInner
        media={OLD_MEDIA}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    const altInput = screen.getByPlaceholderText('Describe the image/video content...');
    fireEvent.change(altInput, { target: { value: 'new alt text' } });
    // the editor keeps the media's existing thumbnail when one is stored
    expect(
      calls.some((call) => call.key === 'POST http://api/media/information')
    ).toBe(false);

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(updated));
    expect(onClose).toHaveBeenCalled();
    expect(
      calls.filter((call) => call.key === 'POST http://api/media/information').length
    ).toBeGreaterThanOrEqual(1);
  });
});
