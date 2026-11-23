// @vitest-environment jsdom
import 'reflect-metadata';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { SWRConfig } from 'swr';

/**
 * Ticket 12: one Location control in the Instagram settings.
 *
 * It is search-only, visible for Facebook Login (instagram), absent for
 * Instagram Standalone, and hidden (but mounted, with its value kept) on a
 * Story. The assertion reads the real form value, not component state.
 */

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => request,
}));

const integrationRef = vi.hoisted(() => ({
  current: { identifier: 'instagram', id: 'channel-1' },
}));

vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@gitroom/frontend/components/launches/helpers/use.integration')
    >();
    return {
      ...actual,
      useIntegration: () => ({
        integration: integrationRef.current,
        allIntegrations: [],
        value: [],
        date: undefined,
      }),
    };
  }
);

import InstagramSettingsProvider from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.collaborators';
import { getProviderSettingsMeta } from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

const SettingsComponent = getProviderSettingsMeta(InstagramSettingsProvider)!
  .SettingsComponent!;

const renderSettings = (
  defaultValues: Record<string, unknown>,
  identifier = 'instagram'
) => {
  integrationRef.current = { identifier, id: 'channel-1' };
  let form: ReturnType<typeof useForm> | undefined;

  const Harness = () => {
    const current = useForm({ defaultValues });
    form = current;
    return (
      <FormProvider {...current}>
        <SettingsComponent />
      </FormProvider>
    );
  };

  const view = render(<Harness />, {
    wrapper: ({ children }) => (
      <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
    ),
  });

  return {
    form: () => form!,
    changeChannel: () => {
      integrationRef.current = { ...integrationRef.current, id: 'channel-2' };
      view.rerender(<Harness />);
    },
    setPostType: (postType: 'post' | 'story') =>
      act(() => {
        form!.setValue('post_type', postType);
      }),
  };
};

const hiddenLocation = () => screen.getByText('Location').closest('.invisible');

const savedPlace = {
  id: '102938475610293',
  name: 'Test Place',
  address: '1 Main St, Springfield, IL, USA',
};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (url, init) => {
    const { name, id, data } = JSON.parse(String(init?.body));
    if (
      url !== '/integrations/function' ||
      init?.method !== 'POST' ||
      name !== 'locationSearch' ||
      data.q !== 'coffee'
    ) {
      throw new Error('Unexpected location search request');
    }
    const places: Record<string, { id: string; name: string; address?: string }[]> = {
      'channel-1': [{ id: 'page-1', name: 'Coffee Corner', address: '2 Side St' }],
      'channel-2': [{ id: 'page-2', name: 'Second Cafe' }],
    };
    return Response.json(places[id] ?? []);
  });
});

afterEach(() => {
  cleanup();
  integrationRef.current = { identifier: 'instagram', id: 'channel-1' };
});

describe('Instagram Location setting', () => {
  it('renders a location loaded after mount from the form value', async () => {
    const settings = renderSettings({ post_type: 'post' });

    expect(screen.queryByText('Test Place')).toBeNull();

    act(() => {
      settings.form().setValue('location', savedPlace);
    });

    await waitFor(() => expect(screen.getByText('Test Place')).toBeTruthy());
    expect(screen.getByText('1 Main St, Springfield, IL, USA')).toBeTruthy();
  });

  it('does not render the Location control for Instagram Standalone', () => {
    renderSettings({ post_type: 'post' }, 'instagram-standalone');

    expect(screen.queryByText('Location')).toBeNull();
    expect(screen.queryByText('Add location')).toBeNull();
  });

  it('restores the control and the selected value when switching back from Story', () => {
    const settings = renderSettings({
      post_type: 'post',
      location: savedPlace,
    });

    expect(hiddenLocation()).toBeNull();

    settings.setPostType('story');
    expect(hiddenLocation()).not.toBeNull();
    expect(settings.form().getValues('location')).toEqual(savedPlace);

    settings.setPostType('post');
    expect(hiddenLocation()).toBeNull();
    expect(screen.getByText('Test Place')).toBeTruthy();
    expect(settings.form().getValues('location')).toEqual(savedPlace);
  });

  it('stores the location picked from the search results', async () => {
    const settings = renderSettings({ post_type: 'post' });

    fireEvent.click(screen.getByText('Add location'));
    fireEvent.change(screen.getByPlaceholderText('Search location'), {
      target: { value: 'coffee' },
    });

    await waitFor(
      () => expect(screen.getByText('Coffee Corner')).toBeTruthy(),
      { timeout: 3000 }
    );

    fireEvent.click(screen.getByText('Coffee Corner'));

    expect(settings.form().getValues('location')).toEqual({
      id: 'page-1',
      name: 'Coffee Corner',
      address: '2 Side St',
    });
  });

  it('refreshes the same search when the active channel changes', async () => {
    const settings = renderSettings({ post_type: 'post' });
    fireEvent.click(screen.getByText('Add location'));
    fireEvent.change(screen.getByPlaceholderText('Search location'), {
      target: { value: 'coffee' },
    });
    await screen.findByText('Coffee Corner');

    settings.changeChannel();

    await screen.findByText('Second Cafe');
    expect(screen.queryByText('Coffee Corner')).toBeNull();
  });

  it('shows No location found when the search fails', async () => {
    request.mockRejectedValue(new TypeError('Failed to fetch'));
    renderSettings({ post_type: 'post' });

    fireEvent.click(screen.getByText('Add location'));
    fireEvent.change(screen.getByPlaceholderText('Search location'), {
      target: { value: 'coffee' },
    });

    await waitFor(
      () => expect(screen.getByText('No location found')).toBeTruthy(),
      { timeout: 3000 }
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
