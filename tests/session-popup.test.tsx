// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Ticket 05: the channel popup keeps its own dedicated session handoff.
 *
 * The parent window passes auth/showorg/impersonate in the URL hash; the relay
 * page copies them into the popup's sessionStorage and follows the redirect.
 * This is the established per-popup mechanism, not a cross-tab sync.
 */

let search = 'redirect=%2Fintegrations%2Fsocial%2Fx';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

interface StubLocation {
  href: string;
  hash: string;
}

const stubLocation = (hash: string): StubLocation => {
  const location: StubLocation = {
    href: 'http://localhost:4200/channel-relay',
    hash,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).location;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).location = location;
  return location;
};

beforeEach(() => {
  search = 'redirect=%2Fintegrations%2Fsocial%2Fx';
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('channel relay popup session', () => {
  it('copies auth/showorg/impersonate into the popup and follows the redirect', async () => {
    const location = stubLocation(
      '#auth=jwt-a&showorg=org-a&impersonate=imp-a'
    );
    const { default: ChannelRelayPage } = await import(
      '@gitroom/frontend/app/(app)/channel-relay/page'
    );

    render(<ChannelRelayPage />);

    await waitFor(() =>
      expect(location.href).toBe('/integrations/social/x')
    );
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBe('org-a');
    expect(window.sessionStorage.getItem('impersonate')).toBe('imp-a');
    expect(window.sessionStorage.getItem('channel_popup_mode')).toBe('true');
  });

  it('does not invent values that the parent did not pass', async () => {
    const location = stubLocation('#auth=jwt-a');
    const { default: ChannelRelayPage } = await import(
      '@gitroom/frontend/app/(app)/channel-relay/page'
    );

    render(<ChannelRelayPage />);

    await waitFor(() =>
      expect(location.href).toBe('/integrations/social/x')
    );
    expect(window.sessionStorage.getItem('auth')).toBe('jwt-a');
    expect(window.sessionStorage.getItem('showorg')).toBeNull();
    expect(window.sessionStorage.getItem('impersonate')).toBeNull();
  });

  it('stays inert without a redirect target or auth value', async () => {
    search = '';
    const location = stubLocation('#auth=jwt-a');
    const { default: ChannelRelayPage } = await import(
      '@gitroom/frontend/app/(app)/channel-relay/page'
    );

    render(<ChannelRelayPage />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.sessionStorage.getItem('auth')).toBeNull();
    expect(location.href).toBe('http://localhost:4200/channel-relay');
  });
});
