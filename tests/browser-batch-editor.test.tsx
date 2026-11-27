// @vitest-environment jsdom
import 'reflect-metadata';
import React from 'react';
import dayjs from 'dayjs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ModalManagerInner } from '@gitroom/frontend/components/layout/new-modal';
import { DatePickerPanel } from '@gitroom/frontend/components/launches/helpers/date.picker';
import {
  fromUtc,
  setUserTimezone,
} from '@gitroom/frontend/components/layout/set.timezone';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

vi.mock('@copilotkit/react-core', () => ({
  useCopilotAction: () => {},
  useCopilotReadable: () => {},
}));
vi.mock('@copilotkit/react-ui', () => ({ CopilotPopup: () => null }));
vi.mock('@copilotkit/react-textarea', () => ({ CopilotTextarea: () => null }));

const privacyFor = (accountId: string) =>
  within(
    document.querySelector<HTMLElement>(
      `#social-settings [data-id="${accountId}"]`
    )!
  ).getByLabelText('Privacy') as HTMLSelectElement;

function mockEditorApi(
  channels: { id: string; name: string; identifier: string }[]
) {
  const submissions: any[] = [];
  vi.stubGlobal('fetch', async (path: string, options: RequestInit) => {
    const method = options.method ?? 'GET';
    if (method === 'GET' && path === '/settings/shortlink')
      return Response.json({ shortlink: 'NO' });
    if (
      method === 'GET' &&
      path === '/integrations/browser-tiktok/internal-plugs'
    )
      return Response.json({ internalPlugs: [] });
    if (method === 'POST' && path === '/posts/should-shortlink')
      return Response.json({ ask: false });
    if (method === 'POST' && (path === '/posts/valid' || path === '/posts')) {
      const request = JSON.parse(String(options.body));
      const targets: typeof channels = request.posts.map(
        (post: { integration: { id: string } }) => {
          const channel = channels.find(({ id }) => id === post.integration.id);
          if (!channel)
            throw new Error('Unknown test channel: ' + post.integration.id);
          return channel;
        }
      );
      if (path === '/posts/valid') {
        return Response.json(
          targets.map(({ id, name, identifier }) => ({
            id,
            name,
            identifier,
            valid: true,
            errors: true,
            settingsError: '',
            emptyContent: false,
            tooLong: false,
            maximumCharacters: 100000,
          })),
          { status: 201 }
        );
      }
      submissions.push(request);
      return Response.json(
        targets.map(({ id }) => ({
          postId: 'saved-' + id,
          integration: id,
        })),
        { status: 201 }
      );
    }
    return Response.json({ message: 'Unknown editor route' }, { status: 404 });
  });
  return submissions;
}

afterEach(() => {
  cleanup();
  useLaunchStore.setState(useLaunchStore.getInitialState());
  vi.unstubAllGlobals();
});

it('reopens two named TikTok accounts and lets the author change their shared content or customize one', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const date = dayjs().add(1, 'day');
  const clip = { id: 'video', path: '/campaign.mp4' };
  const shared = [{ content: 'Shared copy', delay: 0, image: [clip] }];
  const channels = ['Renamed Studio · TikTok', 'Shop · TikTok'].map(
    (name, i) => ({
      id: 'account-' + i,
      name,
      identifier: 'browser-tiktok',
      browserPublishing: true,
      picture: '/no-picture.jpg',
      editor: 'normal',
    })
  ) as any;
  mockEditorApi(channels);
  const existing = channels.map((channel: any, index: number) => ({
    integration: channel.id,
    group: 'group-' + index,
    settings: index ? { privacy: 'friends' } : {},
    draftEditor: { overridesShared: !!index, shared },
    posts: [
      {
        id: 'post-' + index,
        state: 'DRAFT',
        publishDate: date.toISOString(),
        content: index ? 'Shop copy' : 'Shared copy',
        delay: 0,
        image: [clip],
      },
    ],
  }));
  render(
    <ExistingDataContextProvider
      value={{ ...existing[0], siblings: [existing[1]] }}
    >
      <AddEditModal
        allIntegrations={channels}
        integrations={channels}
        date={date}
        mutate={() => {}}
        reopenModal={() => {}}
      />
    </ExistingDataContextProvider>
  );
  const sharedTab = await screen.findByLabelText('Shared content');
  fireEvent.click(sharedTab);
  await waitFor(() =>
    expect(
      document.querySelector('[contenteditable="true"]')?.textContent
    ).toContain('Shared copy')
  );
  fireEvent.click(screen.getByLabelText('Shop · TikTok'));
  await waitFor(() =>
    expect(
      document.querySelector('[contenteditable="true"]')?.textContent
    ).toContain('Shop copy')
  );
  expect(privacyFor('account-1').value).toBe('friends');
  fireEvent.click(screen.getByLabelText('Renamed Studio · TikTok'));
  fireEvent.click(await screen.findByText('Edit content'));
  await waitFor(() =>
    expect(
      document.querySelector('[contenteditable="true"]')?.textContent
    ).toContain('Shared copy')
  );
});

it('submits shared media and per-account drafts using both selected profile IDs', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const channels = ['Studio · TikTok', 'Shop · TikTok'].map((name, index) => ({
    id: 'profile-channel-' + index,
    name,
    identifier: 'browser-tiktok',
    browserPublishing: true,
    picture: '/no-picture.jpg',
    editor: 'normal',
  })) as any;
  const submissions = mockEditorApi(channels);
  const image = [{ id: 'clip', path: '/campaign.mp4' }];
  render(
    <AddEditModal
      allIntegrations={channels}
      integrations={channels}
      date={dayjs().add(1, 'day')}
      onlyValues={[{ content: 'Campaign copy', image }]}
      mutate={() => {}}
      reopenModal={() => {}}
    />
  );
  for (const channel of channels) {
    fireEvent.click(
      await screen.findByTitle(channel.name + ' · Browser publishing')
    );
  }
  fireEvent.click(screen.getByLabelText(channels[1].name));
  fireEvent.change(privacyFor(channels[1].id), {
    target: { value: 'friends' },
  });
  fireEvent.click(await screen.findByText('Edit content'));
  fireEvent.click(
    screen.getAllByRole('button', { name: /save as draft/i }).at(-1)!
  );
  await waitFor(() => expect(submissions).toHaveLength(1));
  expect(submissions[0].posts[0].settings).not.toHaveProperty('privacy');
  expect(submissions[0]).toMatchObject({
    type: 'draft',
    posts: [
      {
        integration: { id: channels[0].id },
        value: [
          {
            content: '<p>Campaign copy</p>',
            image: [{ id: 'clip', path: '/campaign.mp4' }],
          },
        ],
        draftEditor: { overridesShared: false },
      },
      {
        integration: { id: channels[1].id },
        settings: { privacy: 'friends' },
        value: [
          {
            content: '<p>Campaign copy</p>',
            image: [{ id: 'clip', path: '/campaign.mp4' }],
          },
        ],
        draftEditor: {
          overridesShared: true,
          shared: [
            {
              content: '<p>Campaign copy</p>',
              image: [{ id: 'clip', path: '/campaign.mp4' }],
            },
          ],
        },
      },
    ],
  });
});

it.each([1, 2])(
  'preserves the exact API schedule when editing privacy for %i scheduled accounts',
  async (count) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const instants = ['2038-05-11T10:00:00.750Z', '2038-05-12T00:01:59.375Z'];
    const channels = ['Studio', 'Shop'].slice(0, count).map((name, index) => ({
      id: 'scheduled-' + index,
      name,
      identifier: 'browser-tiktok',
      browserPublishing: true,
      picture: '/no-picture.jpg',
      editor: 'normal',
    })) as any;
    const submissions = mockEditorApi(channels);
    const existing = channels.map((c: any, i: number) => ({
      integration: c.id,
      group: 'g' + i,
      settings: {},
      posts: [
        {
          id: 'p' + i,
          state: 'QUEUE',
          publishDate: instants[i],
          content: 'Stored API copy',
          delay: 0,
          image: [{ id: 'clip', path: '/campaign.mp4' }],
        },
      ],
    }));
    setUserTimezone('America/New_York');
    try {
      render(
        <ExistingDataContextProvider
          value={{ ...existing[0], siblings: existing.slice(1) }}
        >
          <AddEditModal
            allIntegrations={channels}
            integrations={channels}
            date={fromUtc(instants[0])}
            mutate={() => {}}
            reopenModal={() => {}}
          />
          <ModalManagerInner />
        </ExistingDataContextProvider>
      );
      await waitFor(() => expect(privacyFor(channels[0].id)).toBeTruthy());
      fireEvent.change(privacyFor(channels[0].id), {
        target: { value: 'friends' },
      });
      fireEvent.click(
        screen.getAllByRole('button', { name: /^update$/i }).at(-1)!
      );
      if (count === 2)
        fireEvent.click(
          await screen.findByRole('button', {
            name: 'Just update the post details',
          })
        );
      await waitFor(() => expect(submissions).toHaveLength(1));
      expect(submissions[0].date).toBe(instants[0]);
      expect(
        submissions[0].posts.map((p: any) => p.date || submissions[0].date)
      ).toEqual(instants.slice(0, count));
      expect(submissions[0].posts[0].settings.privacy).toBe('friends');
    } finally {
      setUserTimezone(null);
    }
  }
);

it('retains sub-minute precision on a minute picker round trip and applies an intentional change', () => {
  setUserTimezone('Asia/Shanghai');
  try {
    const date = fromUtc('2038-05-11T10:00:00.750Z');
    const changed = vi.fn();
    const ui = render(<DatePickerPanel date={date} onChange={changed} sheet />);
    const minute = ui.container.querySelectorAll('input')[1];
    for (const value of ['00', '12']) {
      fireEvent.focus(minute);
      fireEvent.change(minute, { target: { value } });
      fireEvent.blur(minute);
    }
    expect(changed.mock.calls.map(([d]) => d.toISOString())).toEqual([
      '2038-05-11T10:00:00.750Z',
      '2038-05-11T10:12:00.750Z',
    ]);
  } finally {
    setUserTimezone(null);
  }
});

it.each([
  [
    'first 01:15',
    '2027-11-07T05:15:45.750Z',
    'minute',
    '16',
    '2027-11-07T05:16:45.750Z',
  ],
  [
    'second 01:15',
    '2027-11-07T06:15:45.750Z',
    'minute',
    '16',
    '2027-11-07T06:16:45.750Z',
  ],
  [
    'after the fall transition',
    '2027-11-07T05:15:45.750Z',
    'hour',
    '02',
    '2027-11-07T07:15:45.750Z',
  ],
  [
    'day after the fall transition',
    '2027-11-07T05:15:45.750Z',
    'day',
    '8',
    '2027-11-08T06:15:45.750Z',
  ],
  [
    'skipped spring hour',
    '2027-03-14T06:15:45.750Z',
    'hour',
    '02',
    '2027-03-14T07:15:45.750Z',
  ],
])(
  'edits the New York picker at the %s',
  (_case, before, field, value, after) => {
    setUserTimezone('America/New_York');
    try {
      const changed = vi.fn();
      const ui = render(
        <DatePickerPanel date={fromUtc(before)} onChange={changed} sheet />
      );
      if (field === 'day') {
        fireEvent.click(screen.getByText(value, { selector: 'button' }));
      } else {
        const control =
          ui.container.querySelectorAll('input')[field === 'minute' ? 1 : 0];
        fireEvent.focus(control);
        fireEvent.change(control, { target: { value } });
        fireEvent.blur(control);
      }
      expect(changed.mock.calls.map(([d]) => d.toISOString())).toEqual([after]);
    } finally {
      setUserTimezone(null);
    }
  }
);
