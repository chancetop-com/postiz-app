// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Ticket 06: the page of a public connect link.
 *
 * The person opening it may have no Postiz account. The page shows the
 * customized brand mark on the fork's light surface, the single platform the
 * link was issued for and what connecting means. It only asks the API for an
 * auth URL when the person presses continue, so opening the page (or closing
 * it) never checks the plan, never writes a binding and never contacts the
 * platform.
 */

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => api.fetch,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string, options?: any) =>
    (fallback || key).replace(/{{\s*(\w+)\s*}}/g, (_: string, name: string) =>
      String(options?.[name] ?? '')
    ),
}));

import { ConnectLink } from '@gitroom/frontend/components/launches/connect.link';

const details = { identifier: 'tiktok', name: 'TikTok' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const respondWith = (onPost?: (url: string) => Response) => {
  api.fetch.mockImplementation(async (url: string, options: RequestInit = {}) => {
    if (options.method === 'POST') {
      return onPost ? onPost(url) : json({ url: 'https://platform.example/oauth' });
    }
    return json(details);
  });
};

beforeEach(() => {
  api.fetch.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the anonymous consent page', () => {
  it('shows the customized logo, light theme, platform icon, permissions and continue', async () => {
    respondWith();

    const view = render(<ConnectLink token="token-1" />);

    expect(
      await view.findByText('Postiz wants to connect to your TikTok')
    ).toBeTruthy();

    const logo = screen.getByAltText('Logo') as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/logo-postiz.png');

    // the fork's light surface, not upstream's fixed dark canvas
    expect(view.container.querySelector('.light')).toBeTruthy();
    expect(view.container.querySelector('img[src="/postiz.svg"]')).toBeNull();

    // the platform the link was issued for
    expect(
      view.container.querySelector('img[src="/icons/platforms/tiktok.png"]')
    ).toBeTruthy();

    // what continuing means
    expect(
      screen.getByText('Only continue if you trust whoever sent you this link')
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Postiz will automate your TikTok account: it can schedule and publish posts/
      )
    ).toBeTruthy();

    expect(
      screen.getByRole('button', { name: 'Continue to TikTok' })
    ).toBeTruthy();
  });

  it('does not check the organisation or the plan before continue is pressed', async () => {
    respondWith();

    const view = render(<ConnectLink token="token-2" />);

    await view.findByText('Postiz wants to connect to your TikTok');
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch.mock.calls[0][0]).toBe(
      '/integrations/public/connect/token-2'
    );
    expect(api.fetch.mock.calls[0][1]).toBeUndefined();
  });

  it('only asks for the provider URL after continue and then leaves for the platform', async () => {
    respondWith();
    const assign = vi.fn();
    vi.stubGlobal('location', { href: 'http://localhost/', assign });

    const view = render(<ConnectLink token="token-3" />);

    fireEvent.click(
      await view.findByRole('button', { name: 'Continue to TikTok' })
    );

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://platform.example/oauth')
    );
    expect(api.fetch.mock.calls[1][0]).toBe(
      '/integrations/public/connect/token-3'
    );
    expect(api.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });

  it('keeps the link usable for another attempt when the plan refuses the connect', async () => {
    const limit =
      'This Postiz workspace reached the channel limit of its plan, it has to be upgraded before another channel can be added';
    respondWith(() => json({ message: limit }, 400));
    const assign = vi.fn();
    vi.stubGlobal('location', { href: 'http://localhost/', assign });

    const view = render(<ConnectLink token="token-4" />);

    fireEvent.click(
      await view.findByRole('button', { name: 'Continue to TikTok' })
    );
    expect(await view.findByText(limit)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();

    respondWith();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to TikTok' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://platform.example/oauth')
    );
  });

  it('shows the expired message for a token that is no longer accepted', async () => {
    api.fetch.mockResolvedValue(json({ message: 'expired' }, 404));

    const view = render(<ConnectLink token="expired-token" />);

    expect(await view.findByText('This link is no longer valid')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Continue to/ })
    ).toBeNull();
  });
});
