// @vitest-environment jsdom
import 'reflect-metadata';
import i18next from '@gitroom/react/translation/i18next';
import React, { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

it('selects the browser-labelled account alongside an official channel and collects its incomplete draft', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ internalPlugs: [] }));
  const browser = {
    id: 'channel-a',
    name: 'Brand · TikTok',
    identifier: 'browser-tiktok',
    browserPublishing: true,
    picture: '/no-picture.jpg',
    editor: 'normal',
  } as Integrations;
  const official = {
    ...browser,
    id: 'channel-b',
    name: 'Official',
    identifier: 'nostr',
    browserPublishing: false,
  };
  useLaunchStore.getState().setAllIntegrations([browser, official]);
  useLaunchStore
    .getState()
    .setGlobalValue([{ id: 'draft', content: '', delay: 0, media: [] }]);
  const form = createRef<{ getAllValues: () => Promise<any[]> }>();
  render(
    <>
      <PicksSocialsComponent list />
      <ShowAllProviders ref={form} />
    </>
  );
  expect(screen.getByText('Browser publishing')).toBeTruthy();
  fireEvent.click(screen.getByText('Brand · TikTok'));
  fireEvent.click(screen.getByText('Official'));
  const values = await form.current!.getAllValues();
  expect(values.map((row) => row.id)).toEqual(['channel-a', 'channel-b']);
  expect(values[0].values[0].content).toBe('');
});

it('shows an original link only on official calendar cards and allows removing a published browser record', async () => {
  const { ListView } = await import(
    '@gitroom/frontend/components/launches/calendar'
  );
  const { CalendarContext } = await import(
    '@gitroom/frontend/components/launches/calendar.context'
  );
  const { DndProvider } = await import('react-dnd');
  const { HTML5Backend } = await import('react-dnd-html5-backend');
  const card = (id: string, providerIdentifier: string) => ({
    id,
    publishDate: new Date().toISOString(),
    content: id,
    state: 'PUBLISHED',
    group: id,
    tags: [],
    settings: '{}',
    releaseURL: 'https://example.test/already-published',
    integration: {
      id,
      providerIdentifier,
      name: id,
      picture: '/no-picture.jpg',
    },
  });
  const renderCard = (post: ReturnType<typeof card>) =>
    render(
      <DndProvider backend={HTML5Backend}>
        <CalendarContext.Provider
          value={
            {
              integrations: [],
              loading: false,
              listPosts: [post],
              listState: 'published',
            } as any
          }
        >
          <ListView />
        </CalendarContext.Provider>
      </DndProvider>
    );
  const open = '[data-tooltip-content="Open Post"]';
  const remove = '[data-tooltip-content="Delete Post"]';
  const browser = renderCard(card('Browser post', 'browser-tiktok'));
  expect(browser.container.querySelector(open)).toBeNull();
  expect(browser.container.querySelector(remove)).toBeTruthy();
  browser.unmount();
  const official = renderCard(card('Official post', 'tiktok'));
  expect(official.container.querySelector(open)).toBeTruthy();
  expect(official.container.querySelector(remove)).toBeTruthy();
});

it.each(['rednote', 'xiaohongshu'])(
  'edits and clears declarations for a %s channel draft',
  async (platform) => {
    vi.stubGlobal('fetch', async () => Response.json({ internalPlugs: [] }));
    const channel = {
      id: 'regional',
      identifier: 'browser-' + platform,
      name: 'Regional account',
      browserPublishing: true,
      picture: '/no-picture.jpg',
      editor: 'normal',
    } as Integrations;
    useLaunchStore.getState().setAllIntegrations([channel]);
    useLaunchStore
      .getState()
      .setGlobalValue([
        { id: 'draft', content: 'Shared #body', delay: 0, media: [] },
      ]);
    const form = createRef<{ getAllValues: () => Promise<any[]> }>();
    const portal = document.createElement('div');
    portal.id = 'social-settings';
    document.body.appendChild(portal);
    try {
      render(
        <>
          <PicksSocialsComponent list />
          <ShowAllProviders ref={form} />
        </>
      );
      fireEvent.click(screen.getByText('Regional account'));
      if (platform === 'xiaohongshu') {
        await i18next.changeLanguage('zh');
        expect(await screen.findByLabelText('原创声明')).toBeTruthy();
        expect(screen.getByRole('option', { name: '自拍' })).toHaveProperty(
          'value',
          'self-shot'
        );
        expect(i18next.t('browser_needs_review')).toBe('待核对');
        expect(i18next.t('shared_content')).toBe('共享内容');
        expect(i18next.t('post_could_not_be_deleted')).toBe('无法删除帖子');
        await i18next.changeLanguage('en');
        await screen.findByLabelText('Title');
      }
      const change = (label: string, value: string) =>
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      change('Title', 'Regional title');
      change('Post location', 'Gallery');
      change('Original declaration', 'true');
      change('Content declaration', 'self-shot');
      change('Shooting location', 'Studio');
      change('Shooting date', '2024-02-29');
      const draft = async () => (await form.current!.getAllValues())[0];
      expect(await draft()).toMatchObject({
        id: 'regional',
        identifier: 'browser-' + platform,
        values: [{ content: 'Shared #body' }],
        settings: {
          title: 'Regional title',
          location: 'Gallery',
          original: true,
          contentType: 'self-shot',
          shootLocation: 'Studio',
          shootDate: '2024-02-29',
        },
      });
      change('Original declaration', '');
      change('Content declaration', 'repost');
      change('Repost source', 'Agency');
      change('Post location', '');
      expect((await draft()).settings).toEqual({
        title: 'Regional title',
        contentType: 'repost',
        repostSource: 'Agency',
      });
    } finally {
      await i18next.changeLanguage('en');
      portal.remove();
    }
  }
);

it('checks for a definitive receipt when a reviewer opens the calendar form', async () => {
  const { BrowserReviewForm } = await import(
    '@gitroom/frontend/components/launches/browser-review'
  );
  const http = vi.fn(async (url: string, options: RequestInit) => {
    if (
      url === '/browser-publishing/review/late-receipt' &&
      (options.method ?? 'GET') === 'GET'
    ) {
      return Response.json({ status: 'published' });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', http);
  const settled = vi.fn();
  render(<BrowserReviewForm workflowId="late-receipt" onSettled={settled} />);
  expect(await screen.findByText('Publication confirmed')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Record outcome' })).toBeNull();
  expect(http).toHaveBeenCalledTimes(1);
});

it('records an inspected account outcome and optional evidence without posting', async () => {
  const { BrowserReviewForm } = await import(
    '@gitroom/frontend/components/launches/browser-review'
  );
  const http = vi.fn(async (url: string, options: RequestInit) => {
    if (url !== '/browser-publishing/review/manual-decision') {
      return new Response(null, { status: 404 });
    }
    switch (options.method ?? 'GET') {
      case 'GET':
        return Response.json({
          status: 'needs_review',
          reason: 'Check the account',
        });
      case 'PUT':
        return Response.json({ status: 'failed' });
      default:
        return new Response(null, { status: 405 });
    }
  });
  vi.stubGlobal('fetch', http);
  render(
    <BrowserReviewForm workflowId="manual-decision" onSettled={() => {}} />
  );
  fireEvent.click(await screen.findByLabelText('Not published'));
  fireEvent.change(screen.getByLabelText('Note (optional)'), {
    target: { value: 'Checked the account' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
  expect(await screen.findByText('Publication failed')).toBeTruthy();
  const writes = http.mock.calls.filter(
    ([, options]) => (options.method ?? 'GET') !== 'GET'
  );
  expect(
    writes.map(([url, options]) => [
      options.method,
      url,
      JSON.parse(options.body as string),
    ])
  ).toEqual([
    [
      'PUT',
      '/browser-publishing/review/manual-decision',
      { outcome: 'failed', note: 'Checked the account' },
    ],
  ]);
});
