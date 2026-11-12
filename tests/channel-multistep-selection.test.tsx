// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

/**
 * Ticket 08: the intermediate single-select step.
 *
 * YouTube, Facebook Page and Instagram (Facebook Business) finish OAuth with a
 * list of accounts. The popup asks for exactly one of them and saves it
 * explicitly. Nothing is reported to the opener before that save succeeds, and
 * a failed save keeps the popup open with the platform error.
 */

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ extensionId: '', backendUrl: '' }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';

const events: string[] = [];

const opener = () => {
  const windowOpener = {
    closed: false,
    postMessage: vi.fn((message: unknown) => {
      events.push(`message:${JSON.stringify(message)}`);
    }),
  };
  Object.defineProperty(window, 'opener', {
    value: windowOpener,
    configurable: true,
  });
  return windowOpener;
};

const closeSpy = () => {
  (window as any).close = vi.fn(() => events.push('close'));
  return (window as any).close as ReturnType<typeof vi.fn>;
};

interface Call {
  url: string;
  body: any;
  headers: Record<string, string>;
}

const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

const callback = (pages: any[]) =>
  respond(200, {
    id: 'integration-1',
    inBetweenSteps: true,
    pages,
  });

const youtubePages = [
  { id: 'channel-1', name: 'First channel' },
  { id: 'channel-2', name: 'Second channel' },
];

const facebookPages = [
  {
    id: 'page-1',
    name: 'Shop page',
    picture: { data: { url: 'https://cdn.test/page-1.png' } },
  },
  {
    id: 'page-2',
    name: 'Brand page',
    picture: { data: { url: 'https://cdn.test/page-2.png' } },
  },
];

const instagramPages = [
  {
    id: 'ig-1',
    pageId: 'page-1',
    name: 'Main account',
    picture: { data: { url: 'https://cdn.test/ig-1.png' } },
  },
  {
    id: 'ig-2',
    pageId: 'page-2',
    name: 'Second account',
    picture: { data: { url: 'https://cdn.test/ig-2.png' } },
  },
];

/**
 * Routes the real `fetch` used by `useFetch` by URL, and records every call so
 * a test can tell the candidate callback apart from the save request.
 */
const api = (routes: {
  callback: (url: string) => Response;
  save?: (url: string, init: any) => Response;
}) => {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    calls.push({
      url,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: (init.headers || {}) as Record<string, string>,
    });
    if (url.includes('social-connect')) {
      return routes.callback(url);
    }
    if (url.includes('/provider/') && routes.save) {
      return routes.save(url, init);
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

const renderContinue = (provider: string) =>
  render(
    <ContinueIntegration
      provider={provider}
      searchParams={{ code: 'code-1', state: 'state-1' }}
    />
  );

const saveCalls = (calls: Call[]) =>
  calls.filter((call) => call.url.includes('/provider/'));

// The save body carries the callback params plus the single picked account.
const savedSelection = (body: any) => {
  const { code, state, timezone, ...selection } = body || {};
  return selection;
};

beforeEach(() => {
  events.length = 0;
  push.mockReset();
  window.sessionStorage.clear();
  window.sessionStorage.setItem('auth', 'jwt-popup');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).close;
});

describe('a failed save keeps the popup on the selection', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
  });

  it('shows the platform error, reports nothing and stays open', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    api({
      callback: () => callback(youtubePages),
      save: () => respond(500, { message: 'Channel has no permission' }),
    });

    const { findByText, getByText, queryByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    fireEvent.click(getByText('Save'));

    expect(await findByText('Channel has no permission')).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    // the choice is still there, so the merchant can pick again and retry
    expect(queryByText('Second channel')).toBeTruthy();
  });

  it('treats a 412 on the save as the same non-binding failure', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    api({
      callback: () => callback(facebookPages),
      save: () => respond(412, { message: 'Precondition failed' }),
    });

    const { findByText, getByText } = renderContinue('facebook');

    fireEvent.click(await findByText('Brand page'));
    fireEvent.click(getByText('Save'));

    expect(await findByText('Precondition failed')).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('recovers when the save request itself throws', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('social-connect')) {
          return callback(instagramPages);
        }
        throw new Error('network down');
      })
    );

    const { findByText, getByText } = renderContinue('instagram');

    fireEvent.click(await findByText('Second account'));
    fireEvent.click(getByText('Save'));

    expect(
      await findByText('Failed to save channel configuration')
    ).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('clears the previous error when the save is retried', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    let attempt = 0;
    api({
      callback: () => callback(youtubePages),
      save: () =>
        ++attempt === 1
          ? respond(500, { message: 'Channel has no permission' })
          : respond(200, { success: true }),
    });

    const { findByText, getByText, queryByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    fireEvent.click(getByText('Save'));
    expect(await findByText('Channel has no permission')).toBeTruthy();

    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(queryByText('Channel has no permission')).toBeNull();
    expect(windowOpener.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('a successful save is the only thing that reports completion', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
  });

  it('reports once with type and provider, then closes, then nothing else', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    const { calls } = api({
      callback: () => callback(youtubePages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(windowOpener.postMessage).toHaveBeenCalledTimes(1);
    expect(windowOpener.postMessage).toHaveBeenCalledWith(
      { type: 'CHANNEL_UPDATED', provider: 'youtube' },
      '*'
    );
    expect(events).toEqual([
      'message:{"type":"CHANNEL_UPDATED","provider":"youtube"}',
      'close',
    ]);
    expect(push).not.toHaveBeenCalled();
    // the save carried the picked channel, not the first candidate
    const save = saveCalls(calls)[0];
    expect(savedSelection(save.body)).toEqual({ id: 'channel-2' });
  });

  it('sends nothing until Save, even after a candidate was picked', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    api({
      callback: () => callback(youtubePages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));

    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('submits one save even when Save is clicked twice', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    const { calls } = api({
      callback: () => callback(youtubePages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    const save = getByText('Save').closest('button')!;
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(saveCalls(calls)).toHaveLength(1);
    expect(windowOpener.postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      provider: 'youtube',
      pages: youtubePages,
      pick: 'Second channel',
      expected: { id: 'channel-2' },
    },
    {
      provider: 'facebook',
      pages: facebookPages,
      pick: 'Brand page',
      expected: { page: 'page-2' },
    },
    {
      provider: 'instagram',
      pages: instagramPages,
      pick: 'Second account',
      expected: { id: 'ig-2', pageId: 'page-2' },
    },
  ])(
    'saves exactly the picked account for $provider',
    async ({ provider, pages, pick, expected }) => {
      opener();
      closeSpy();
      const { calls } = api({
        callback: () => callback(pages),
        save: () => respond(200, { success: true }),
      });

      const { findByText, getByText } = renderContinue(provider);

      fireEvent.click(await findByText(pick));
      fireEvent.click(getByText('Save'));

      await waitFor(() => expect(saveCalls(calls)).toHaveLength(1));
      expect(savedSelection(saveCalls(calls)[0].body)).toEqual(expected);
      expect(saveCalls(calls)[0].url).toBe(
        '/integrations/provider/integration-1/connect'
      );
    }
  );
});

describe('the single-account providers keep their direct save', () => {
  it('does not show a chooser when the provider finished in one step', async () => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
    const windowOpener = opener();
    const close = closeSpy();
    const { calls } = api({
      callback: () => respond(200, { id: 'integration-1' }),
    });

    const { queryByText } = renderContinue('instagram-standalone');

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Configure Your Channel')).toBeNull();
    expect(saveCalls(calls)).toHaveLength(0);
    expect(windowOpener.postMessage).toHaveBeenCalledWith(
      { type: 'CHANNEL_UPDATED', provider: 'instagram-standalone' },
      '*'
    );
  });
});

describe('the chooser follows the candidate list', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
  });

  it('shows the provider empty state for no candidates and reports nothing', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    const { calls } = api({ callback: () => callback([]) });

    const { findByText, queryByText } = renderContinue('youtube');

    expect(
      await findByText(
        "We couldn't find any YouTube channels connected to your account."
      )
    ).toBeTruthy();
    expect(queryByText('Save')).toBeNull();
    expect(saveCalls(calls)).toHaveLength(0);
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('still asks for an explicit save when only one candidate exists', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    const { calls } = api({
      callback: () => callback([{ id: 'channel-only', name: 'Only channel' }]),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('youtube');

    expect(await findByText('Only channel')).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(saveCalls(calls)).toHaveLength(0);

    fireEvent.click(await findByText('Only channel'));
    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(savedSelection(saveCalls(calls)[0].body)).toEqual({
      id: 'channel-only',
    });
  });

  it('closes without pretending to notify when the opener is gone', async () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    const close = closeSpy();
    api({
      callback: () => callback(youtubePages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText, queryByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(events).toEqual(['close']);
    expect(queryByText('Failed to save channel configuration')).toBeNull();
  });

  it('keeps the popup session identity on the save request', async () => {    opener();
    closeSpy();
    window.sessionStorage.setItem('showorg', 'org-42');
    window.sessionStorage.setItem('impersonate', 'user-7');
    const { calls } = api({
      callback: () => callback(youtubePages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('youtube');

    fireEvent.click(await findByText('Second channel'));
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(saveCalls(calls)).toHaveLength(1));
    const save = saveCalls(calls)[0];
    expect(save.headers.auth).toBe('jwt-popup');
    expect(save.headers.showorg).toBe('org-42');
    expect(save.headers.impersonate).toBe('user-7');
  });
});

describe('the two-step provider in an ordinary window', () => {
  it('navigates the current window after the save instead of messaging a popup', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    api({
      callback: () => callback(facebookPages),
      save: () => respond(200, { success: true }),
    });

    const { findByText, getByText } = renderContinue('facebook');

    fireEvent.click(await findByText('Brand page'));
    fireEvent.click(getByText('Save'));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/launches?added=facebook&msg=Channel Added'
      )
    );
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('early callback exits for a two-step provider', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
  });

  it('stops on 402 without a chooser and without reporting completion', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    api({
      callback: () =>
        respond(402, { message: 'Payment required to add a channel' }),
    });

    const { findByText, queryByText } = renderContinue('youtube');

    expect(
      await findByText('Payment required to add a channel')
    ).toBeTruthy();
    expect(queryByText('Configure Your Channel')).toBeNull();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
