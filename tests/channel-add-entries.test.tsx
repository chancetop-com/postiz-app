// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

/**
 * Ticket 07: every add-channel entry comes from the same filtered social list,
 * so the desktop modal, the mobile drawer and onboarding all show exactly the
 * agreed identifiers.
 *
 * The payload below mirrors what `GET /integrations` returns from the stable
 * release, including separate identifiers for personal and business accounts.
 */

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

const icons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).map((img) =>
    img.getAttribute('src')
  );

const renderAdd = (props: Record<string, unknown> = {}) =>
  render(
    <AddProviderComponent
      social={social}
      article={[
        { identifier: 'devto', name: 'Dev.to' },
        { identifier: 'medium', name: 'Medium' },
      ]}
      invite={false}
      {...props}
    />
  );

afterEach(() => {
  cleanup();
  request.mockClear();
});

describe('the add-channel entries', () => {
  it('offers exactly the agreed identifiers, in server order', () => {
    const { container } = renderAdd();

    // entry order follows `GET /integrations`, only the set is the contract
    expect(icons(container)).toEqual([
      '/icons/platforms/linkedin.png',
      '/icons/platforms/facebook.png',
      '/icons/platforms/instagram.png',
      '/icons/platforms/instagram-standalone.png',
      '/icons/platforms/youtube.svg',
      '/icons/platforms/tiktok.png',
      '/icons/platforms/tiktok-business.png',
    ]);
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

  it('keeps the two Instagram entries distinguishable', () => {
    const { container } = renderAdd();
    const sources = icons(container);

    expect(sources).toContain('/icons/platforms/instagram.png');
    expect(sources).toContain('/icons/platforms/instagram-standalone.png');
    expect(container.textContent).toContain('Facebook Business');
    expect(container.textContent).toContain('Standalone');
  });

  it('does not render article providers as add entries', () => {
    const { container } = renderAdd();
    expect(container.textContent).not.toContain('Medium');
  });

  it('applies the same identifier list to the invite and mobile variants', () => {
    const desktop = icons(renderAdd().container);
    cleanup();

    const invite = renderAdd({ invite: true });
    expect(icons(invite.container)).toEqual(desktop);
    cleanup();

    // mobile renders the same filtered list, not a second curated one
    const mobile = renderAdd({ isMobile: true });
    expect(icons(mobile.container)).toEqual(desktop);
  });

  it('applies the same identifier list to the onboarding step', () => {
    const desktop = icons(renderAdd().container);
    cleanup();

    const onboarding = renderAdd({ onboarding: true });
    expect(icons(onboarding.container)).toEqual(desktop);
  });
});
