// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral: false, extensionId: '', backendUrl: '' }),
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn() }),
}));
const request = vi.fn(async () => new Response(null, { status: 402 }));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => request,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

import { AddProviderComponent } from '@gitroom/frontend/components/launches/add.provider.component';

const provider = (
  identifier: string,
  name: string,
  extra: Record<string, unknown> = {}
) => ({ identifier, name, isExternal: false, isWeb3: false, ...extra });

const social = [
  provider('x', 'X'),
  provider('linkedin', 'LinkedIn'),
  provider('linkedin-page', 'LinkedIn Page'),
  provider('devto', 'Dev.to'),
  provider('facebook', 'Facebook Page'),
  provider('instagram', 'Instagram\n(Facebook Business)'),
  provider('instagram-standalone', 'Instagram\n(Standalone)'),
  provider('youtube', 'YouTube'),
  provider('tiktok', 'Tiktok'),
  provider('tiktok-business', 'TikTok'),
  provider('tumblr', 'Tumblr'),
  provider('bluesky', 'Bluesky', { customFields: [] }),
  provider('mastodon', 'Mastodon', { isExternal: true }),
];

const renderAdd = (invite = false) =>
  render(<AddProviderComponent social={social} article={[]} invite={invite} />);

afterEach(() => {
  cleanup();
  request.mockClear();
});

describe('the add-channel entries', () => {
  it.each([false, true])('offers the supported channels (invite=%s)', (invite) => {
    renderAdd(invite);

    for (const label of [
      'LinkedIn', 'Facebook Page', 'Instagram (Facebook Business)',
      'Instagram (Standalone)', 'YouTube', 'Tiktok', 'TikTok Business',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const label of ['X', 'LinkedIn Page', 'Dev.to', 'Tumblr', 'Bluesky', 'Mastodon']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it.each([
    ['Tiktok', 'tiktok'],
    ['TikTok Business', 'tiktok-business'],
  ])('starts the matching connection for %s', (label, identifier) => {
    const { getByText } = renderAdd();
    fireEvent.click(getByText(label));
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`/integrations/social/${identifier}?`)
    );
  });
});
