// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 07: the connect request carries the merchant's application timezone,
 * not the browser's. Pages outside the logged-in layout (the OAuth callback)
 * restore it from the `timezoneName` cache the app writes.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ extensionId: '', backendUrl: '' }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

// the app already stored the merchant's timezone in a previous session
window.localStorage.setItem('timezoneName', 'Asia/Tokyo');

const { ContinueIntegration } = await import(
  '@gitroom/frontend/components/launches/continue.integration'
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the connect request timezone', () => {
  it('sends the stored user timezone offset', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'i1' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.setItem('channel_popup_mode', 'true');
    (window as any).close = vi.fn();

    render(
      <ContinueIntegration
        provider="linkedin"
        searchParams={{ code: 'c', state: 's' }}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as any;
    const body = JSON.parse(init.body);
    // Asia/Tokyo is UTC+9 all year; the browser default is irrelevant here
    expect(body.timezone).toBe('540');
    expect(body.code).toBe('c');
    expect(body.state).toBe('s');
  });
});
