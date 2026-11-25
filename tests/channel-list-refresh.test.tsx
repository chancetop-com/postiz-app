// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { LaunchesComponent } from '@gitroom/frontend/components/launches/launches.component';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ extensionId: '', backendUrl: '' }),
}));
vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarWeekProvider: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock('@gitroom/frontend/components/launches/calendar', () => ({
  Calendar: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/filters', () => ({
  Filters: () => null,
}));
vi.mock('@gitroom/frontend/components/onboarding/onboarding', () => ({
  Onboarding: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderButton: () => null,
  useExtensionConnect: () => vi.fn(),
}));
vi.mock('@gitroom/frontend/components/launches/generator/generator', () => ({
  GeneratorComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/check.payment', () => ({
  ChannelsAfterPayment: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/new.post', () => ({
  NewPost: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/menu/menu', () => ({
  Menu: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('refreshes the dashboard on a channel update and shows only bindings returned by the server', async () => {
  const binding = {
    id: 'channel-1',
    name: 'Acme page',
    identifier: 'linkedin',
    type: 'social',
  };
  let finishRefresh: (response: Response) => void;
  const refreshing = new Promise<Response>((resolve) => {
    finishRefresh = resolve;
  });
  let response: Promise<Response> | Response = Response.json({
    integrations: [],
  });
  const request = vi.fn(async (input: string) => {
    if (input !== '/integrations/list')
      throw new Error('Unexpected request: ' + input);
    return response;
  });
  vi.stubGlobal('fetch', request);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LaunchesComponent />
    </SWRConfig>
  );

  await screen.findByText('No channels yet');
  request.mockClear();
  response = refreshing;
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'CHANNEL_UPDATED', provider: 'instagram' },
    })
  );
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(screen.getByText('No channels yet')).toBeTruthy();

  finishRefresh!(Response.json({ integrations: [binding] }));
  await screen.findByText('Acme page');
  expect(screen.queryByText('No channels yet')).toBeNull();
});
