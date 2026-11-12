// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

/**
 * Ticket 07: the refresh message is not evidence that a channel connected.
 *
 * 412 and 406 send the same CHANNEL_UPDATED message as a success, so the parent
 * may only re-read the binding list. What the merchant sees is whatever
 * `/integrations/list` returns after that refresh.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ extensionId: '', backendUrl: '' }),
}));

import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { subscribeToChannelUpdates } from '@gitroom/frontend/components/launches/channel.popup';

const ChannelList = () => {
  const { data, mutate } = useIntegrationList();

  useEffect(() => subscribeToChannelUpdates(() => mutate()), [mutate]);

  return (
    <ul>
      {data.map((integration: any) => (
        <li key={integration.id}>{integration.identifier}</li>
      ))}
    </ul>
  );
};

const announce = () =>
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'CHANNEL_UPDATED', provider: 'instagram-standalone' },
    })
  );

const renderList = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChannelList />
    </SWRConfig>
  );

const listings = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('li')).map((li) => li.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a channel list refreshed by the popup message', () => {
  it('shows nothing new when the binding list did not change', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            integrations: [{ id: '1', identifier: 'linkedin' }],
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderList();
    await waitFor(() => expect(listings(container)).toEqual(['linkedin']));

    // a 412/406 popup sends exactly this, with no binding behind it
    announce();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    expect(listings(container)).toEqual(['linkedin']);
  });

  it('shows the channel once the binding result contains it', async () => {
    let integrations = [{ id: '1', identifier: 'linkedin' }];
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ integrations }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderList();
    await waitFor(() => expect(listings(container)).toEqual(['linkedin']));

    integrations = [
      { id: '1', identifier: 'linkedin' },
      { id: '2', identifier: 'instagram-standalone' },
    ];
    announce();

    await waitFor(() =>
      expect(listings(container)).toEqual([
        'linkedin',
        'instagram-standalone',
      ])
    );
  });
});
