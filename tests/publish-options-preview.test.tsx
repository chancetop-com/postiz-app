// @vitest-environment jsdom
import 'reflect-metadata';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ProviderPreviewBridge from '@gitroom/frontend/app/(provider)/provider/[p]/bridge';
import { ProviderPreviewComponent } from '@gitroom/frontend/components/provider-preview/preview.provider.component';

// Other registered providers import the optional Copilot editor.
vi.mock('@copilotkit/react-textarea', () => ({ CopilotTextarea: () => null }));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

afterEach(() => {
  cleanup();
  delete window.__PROVIDER_INIT__;
});

it.each(['tiktok', 'tiktok-business'])('uses seeded WebView video for %s', (provider) => {
  window.__PROVIDER_INIT__ = {
    value: { content_posting_method: 'UPLOAD' },
    posts: [[{ path: 'clip.MP4' }]],
  };
  render(<ProviderPreviewBridge provider={provider} />);
  expect(screen.getByText('Made with AI').closest('.invisible')).not.toBeNull();
});

it('updates disclosure when the attachments change from video to photo', () => {
  const value = { content_posting_method: 'UPLOAD' };
  const { rerender } = render(
    <ProviderPreviewComponent provider="tiktok-business" value={value} posts={[[{ path: 'clip.MP4' }]]} />
  );
  expect(screen.getByText('Made with AI').closest('.invisible')).not.toBeNull();
  rerender(
    <ProviderPreviewComponent provider="tiktok-business" value={value} posts={[[{ path: 'photo.jpg' }]]} />
  );
  expect(screen.getByText('Made with AI').closest('.invisible')).toBeNull();
});

it('shows one set of Instagram controls for a two-photo carousel and clears the location on reset', () => {
  const posts = [[{ path: 'one.jpg' }, { path: 'two.jpg' }]];
  const value = {
    post_type: 'post',
    location: { id: 'page-1', name: 'Coffee Corner' },
  };
  const { rerender } = render(
    <ProviderPreviewComponent
      provider="instagram"
      posts={posts}
      value={value}
    />
  );
  expect(screen.getAllByText('Made with AI')).toHaveLength(1);
  expect(screen.getAllByText('Location')).toHaveLength(1);
  expect(screen.getByText('Coffee Corner')).toBeTruthy();
  rerender(
    <ProviderPreviewComponent
      provider="instagram"
      posts={posts}
      value={{ post_type: 'post' }}
    />
  );
  expect(screen.queryByText('Coffee Corner')).toBeNull();
  expect(screen.getByText('Add location')).toBeTruthy();
});
