// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 07: the OAuth callback page.
 *
 * In a popup, completion means "tell the opener to refresh, then close". The
 * same message is sent for 200/201, 412 and 406, so it is a refresh request,
 * never proof that the channel was bound. Other failures stay on the page and
 * notify nobody. Ordinary windows navigate in place.
 */

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ extensionId: '', backendUrl: '' }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';
import ChannelCallbackPage from '@gitroom/frontend/app/(app)/integrations/social/[provider]/page';

const events: string[] = [];

const opener = (options: { closed?: boolean } = {}) => {
  const windowOpener = {
    closed: !!options.closed,
    postMessage: vi.fn(() => events.push('message')),
  };
  Object.defineProperty(window, 'opener', {
    value: windowOpener,
    configurable: true,
  });
  return windowOpener;
};

const lostOpener = () => {
  Object.defineProperty(window, 'opener', {
    value: null,
    configurable: true,
  });
};

const closeSpy = () => {
  (window as any).close = vi.fn(() => events.push('close'));
  return (window as any).close as ReturnType<typeof vi.fn>;
};

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const renderContinue = (provider = 'tiktok') =>
  render(
    <ContinueIntegration
      provider={provider}
      searchParams={{ code: 'code-1', state: 'state-1' }}
    />
  );

beforeEach(() => {
  events.length = 0;
  push.mockReset();
  replace.mockReset();
  window.sessionStorage.clear();
  window.sessionStorage.setItem('auth', 'jwt-a');
  opener();
  closeSpy();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).close;
});

describe('the callback inside the popup', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('channel_popup_mode', 'true');
    window.sessionStorage.setItem('auth', 'jwt-a');
  });

  it('refreshes the opener and then closes, without navigating', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));

    renderContinue('instagram-standalone');

    await waitFor(() => expect(close).toHaveBeenCalled());
    // the identifier travels in the message, not the display name
    expect(windowOpener.postMessage).toHaveBeenCalledWith(
      { type: 'CHANNEL_UPDATED', provider: 'instagram-standalone' },
      '*'
    );
    expect(events).toEqual(['message', 'close']);
    expect(push).not.toHaveBeenCalled();
  });

  it('still refreshes on 412 without claiming success', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(412, {}));

    renderContinue();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(windowOpener.postMessage).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(events).toEqual(['message', 'close']);
  });

  it('still refreshes on 406 without claiming success', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(406, { msg: 'Payment required' }));

    renderContinue();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(windowOpener.postMessage).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('notifies nobody for other failures and keeps the popup open', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(500, { message: 'provider exploded' }));

    const { findByText } = renderContinue();

    expect(await findByText('provider exploded')).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('closes even when the opener was lost', async () => {
    lostOpener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));

    renderContinue();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(events).toEqual(['close']);
  });

  it('does not post to an opener that already closed', async () => {
    const windowOpener = opener({ closed: true });
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));

    renderContinue();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
  });

  it('does not notify before a two-step selection is saved', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal(
      'fetch',
      respond(200, {
        id: 'integration-1',
        inBetweenSteps: true,
        pages: [{ id: 'page-1', name: 'My channel' }],
      })
    );

    const { findByText } = renderContinue('youtube');

    expect(await findByText('Configure Your Channel')).toBeTruthy();
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('the callback in an ordinary window', () => {
  it('uses the actual callback page with a tab session and no auth cookie', async () => {
    document.cookie = 'auth=;max-age=0;path=/';
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));
    render(
      await ChannelCallbackPage({
        params: Promise.resolve({ provider: 'tiktok' }),
        searchParams: Promise.resolve({ code: 'code-1', state: 'state-1' }),
      })
    );
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(push.mock.calls[0][0]).toContain('/launches?added=tiktok');
  });

  it('keeps anonymous public callbacks inline even with a stale auth cookie', async () => {
    window.sessionStorage.removeItem('auth');
    document.cookie = 'auth=legacy-jwt;path=/';
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));
    const view = render(
      await ChannelCallbackPage({
        params: Promise.resolve({ provider: 'tiktok' }),
        searchParams: Promise.resolve({ code: 'code-1', state: 'state-1' }),
      })
    );
    expect(await view.findByText('Channel Updated')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    document.cookie = 'auth=;max-age=0;path=/';
  });

  it('navigates the current window after a successful connect', async () => {
    const windowOpener = opener();
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(200, { id: 'integration-1' }));

    renderContinue();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/launches?added=tiktok&msg=Channel Updated'
      )
    );
    expect(windowOpener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('navigates the current window on 412', async () => {
    vi.stubGlobal('fetch', respond(412, {}));

    renderContinue();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/launches?precondition=true')
    );
  });

  it('navigates the current window on 406 with the provider message', async () => {
    const close = closeSpy();
    vi.stubGlobal('fetch', respond(406, { msg: 'Payment required' }));

    renderContinue();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/launches?msg=Payment required')
    );
    expect(close).not.toHaveBeenCalled();
  });

  it('honours a returnURL without leaving a popup behind', async () => {
    vi.stubGlobal('fetch', respond(412, { returnURL: '/oauth/done' }));

    renderContinue();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/oauth/done?precondition=true')
    );
  });
});
