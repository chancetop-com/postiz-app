// @vitest-environment jsdom
import 'reflect-metadata';
import i18next from '@gitroom/react/translation/i18next';
import React, { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

vi.mock('@copilotkit/react-textarea', () => ({ CopilotTextarea: () => null }));
afterEach(() => {
  cleanup();
  useLaunchStore.setState(useLaunchStore.getInitialState());
  vi.unstubAllGlobals();
});

it('collects Instagram and TikTok overrides independently from the channel settings panel', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ internalPlugs: [] }));
  const channels = ['instagram', 'tiktok'].map(
    (platform) =>
      ({
        id: platform,
        name: 'Brand · ' + platform,
        identifier: 'browser-' + platform,
        browserPublishing: true,
        picture: '/no-picture.jpg',
        editor: 'normal',
      } as Integrations)
  );
  const store = useLaunchStore.getState();
  store.setAllIntegrations(channels);
  store.setGlobalValue([
    {
      id: 'post',
      content: 'Channel caption',
      delay: 0,
      media: [
        { id: 'a', path: '/one.jpg?signature=end.mp4' },
        { id: 'b', path: '/two.jpg', alt: 'Shared second image' },
      ] as any,
    },
  ]);
  const form = createRef<{ getAllValues: () => Promise<any[]> }>();
  const view = render(
    <>
      <div id="social-settings" />
      <PicksSocialsComponent list />
      <ShowAllProviders ref={form} />
    </>
  );
  for (const channel of channels)
    fireEvent.click(screen.getByText(channel.name));
  const settings = (id: string) =>
    within(
      view.container.querySelector(
        `#social-settings [data-id="${id}"]`
      )! as HTMLElement
    );
  const ig = settings('instagram'),
    tk = settings('tiktok');
  expect(
    (await form.current!.getAllValues()).map((row) => row.settings)
  ).toEqual([{}, {}]);
  expect(
    (ig.getByLabelText('Alt text for image 2') as HTMLTextAreaElement).value
  ).toBe('Shared second image');
  fireEvent.change(ig.getByLabelText('Title'), {
    target: { value: 'IG title' },
  });
  fireEvent.change(ig.getByLabelText('Collaborators'), {
    target: { value: '@Alice\nBob' },
  });
  fireEvent.change(ig.getByLabelText('Alt text for image 1'), {
    target: { value: 'First image' },
  });
  fireEvent.change(ig.getByLabelText('Alt text for image 2'), {
    target: { value: 'Second image' },
  });
  fireEvent.change(tk.getByLabelText('Title'), {
    target: { value: 'TikTok title' },
  });
  fireEvent.change(tk.getByLabelText('Privacy'), {
    target: { value: 'friends' },
  });
  fireEvent.click(tk.getByLabelText('Your brand'));
  expect(
    (await form.current!.getAllValues()).map((row) => row.settings)
  ).toEqual([
    {
      title: 'IG title',
      collaborators: ['@Alice', 'Bob'],
      altText: ['First image', 'Second image'],
    },
    { title: 'TikTok title', privacy: 'friends', yourBrand: true },
  ]);
});

it('shows localized video options and preserves TikTok wire values', async () => {
  await i18next.changeLanguage('zh');
  try {
    vi.stubGlobal('fetch', async () => Response.json({ internalPlugs: [] }));
    const channel = {
      id: 'tk',
      name: 'Studio',
      identifier: 'browser-tiktok',
      browserPublishing: true,
      picture: '/no-picture.jpg',
      editor: 'normal',
    } as Integrations;
    const store = useLaunchStore.getState();
    store.setAllIntegrations([channel]);
    store.setGlobalValue([
      {
        id: 'post',
        content: 'Video',
        delay: 0,
        media: [
          { id: 'clip', path: '/media/opaque', type: 'video/mp4' },
        ] as any,
      },
    ]);
    const form = createRef<{ getAllValues: () => Promise<any[]> }>();
    render(
      <>
        <div id="social-settings" />
        <PicksSocialsComponent list />
        <ShowAllProviders ref={form} />
      </>
    );
    fireEvent.click(screen.getByText('Studio'));
    expect(await screen.findByLabelText('禁止重复使用视频')).toBeTruthy();
    const privacy = screen.getByLabelText('可见范围');
    const friends = within(privacy).getByRole('option', {
      name: '好友',
    }) as HTMLOptionElement;
    fireEvent.change(privacy, { target: { value: friends.value } });
    expect((await form.current!.getAllValues())[0].settings.privacy).toBe(
      'friends'
    );
  } finally {
    await i18next.changeLanguage('en');
  }
});
