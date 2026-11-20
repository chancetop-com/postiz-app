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
        <li
          key={integration.id}
          data-internal-id={integration.internalId}
          data-refresh-needed={String(!!integration.refreshNeeded)}
        >
          {integration.identifier}
        </li>
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

  it('reads the refreshed status from the binding list, never from a credential', async () => {
    let integrations = [
      {
        id: 'integration-1',
        internalId: 'synthetic-linkedin-account',
        identifier: 'linkedin',
        refreshNeeded: true,
      },
      {
        id: 'integration-2',
        internalId: 'synthetic-tumblr-account',
        identifier: 'tumblr',
        refreshNeeded: false,
      },
    ];
    const payloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async () => {
      payloads.push({ integrations });
      return new Response(JSON.stringify({ integrations }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderList();
    await waitFor(() =>
      expect(listings(container)).toEqual(['linkedin', 'tumblr'])
    );

    const items = Array.from(container.querySelectorAll('li'));
    expect(items[0].getAttribute('data-internal-id')).toBe(
      'synthetic-linkedin-account'
    );
    expect(items[0].getAttribute('data-refresh-needed')).toBe('true');
    expect(items[1].getAttribute('data-internal-id')).toBe(
      'synthetic-tumblr-account'
    );
    expect(items[1].getAttribute('data-refresh-needed')).toBe('false');

    // the page render path only receives the list fields it renders; the
    // credential columns the repository omits are not in the payload
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain('synthetic-access');
    expect(serialized).not.toContain('synthetic-refresh');

    integrations = [
      { ...integrations[0], refreshNeeded: false },
      integrations[1],
    ];
    announce();

    await waitFor(() =>
      expect(
        container
          .querySelectorAll('li')[0]
          .getAttribute('data-refresh-needed')
      ).toBe('false')
    );
  });
});
