// @vitest-environment jsdom
import 'reflect-metadata';
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormProvider, useForm } from 'react-hook-form';
import type { UseFormReturn } from 'react-hook-form';

/**
 * Tickets 10 + 11: the TikTok settings panel has one media-type-independent
 * "Made with AI" checkbox, and TikTok Business hides its Location control in
 * UPLOAD mode without losing the selected value.
 */

const integrationMock = vi.hoisted(() => ({ current: null as any }));
const mediaMock = vi.hoisted(() => ({ current: [] as any[] }));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.integration', () => ({
  useIntegration: () => ({
    integration: integrationMock.current,
    value: mediaMock.current,
    date: undefined,
    allIntegrations: [],
  }),
}));

import TikTokSettingsProvider from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.provider';
import { getProviderSettingsMeta } from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

const VIDEO_MEDIA = [
  { id: 'media-1', path: 'https://media.test/clip.MP4' },
];
const PHOTO_MEDIA = [
  { id: 'media-1', path: 'https://media.test/photo.jpg' },
];

type RenderOptions = {
  identifier?: 'tiktok' | 'tiktok-business';
  media?: typeof VIDEO_MEDIA;
  method?: 'DIRECT_POST' | 'UPLOAD';
  values?: Record<string, any>;
};

const renderSettings = (options: RenderOptions = {}) => {
  integrationMock.current = { identifier: options.identifier ?? 'tiktok' };
  mediaMock.current = [{ content: '', image: options.media ?? VIDEO_MEDIA }];

  const meta = getProviderSettingsMeta(TikTokSettingsProvider)!;
  const SettingsComponent = meta.SettingsComponent!;
  const formRef: { current?: UseFormReturn<any> } = {};

  const Harness = () => {
    const form = useForm({
      defaultValues: {
        content_posting_method: options.method ?? 'DIRECT_POST',
        ...options.values,
      },
    });
    formRef.current = form;

    return (
      <FormProvider {...form}>
        <SettingsComponent />
      </FormProvider>
    );
  };

  render(<Harness />);
  return formRef.current!;
};

const aiLabel = () => screen.getByText('Made with AI');

const aiControlHidden = () => !!aiLabel().closest('.invisible');

const toggleAi = () =>
  fireEvent.click(aiLabel().previousElementSibling as Element);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TikTok settings — Made with AI', () => {
  it('shows the control for a DIRECT_POST video and records the value', () => {
    const form = renderSettings({ media: VIDEO_MEDIA });

    expect(aiControlHidden()).toBe(false);

    toggleAi();
    expect(form.getValues('is_ai_generated')).toBe(true);

    toggleAi();
    expect(form.getValues('is_ai_generated')).toBe(false);
  });

  it('hides the control for an UPLOAD video but keeps and restores its value', () => {
    const form = renderSettings({ media: VIDEO_MEDIA });
    toggleAi();
    act(() => form.setValue('content_posting_method', 'UPLOAD'));
    expect(aiControlHidden()).toBe(true);
    expect(form.getValues('is_ai_generated')).toBe(true);

    act(() => form.setValue('content_posting_method', 'DIRECT_POST'));
    expect(aiControlHidden()).toBe(false);
    expect(form.getValues('is_ai_generated')).toBe(true);
  });

  it('shows and records the control for a photo UPLOAD', () => {
    const form = renderSettings({ media: PHOTO_MEDIA, method: 'UPLOAD' });

    expect(aiControlHidden()).toBe(false);

    toggleAi();
    expect(form.getValues('is_ai_generated')).toBe(true);
  });

  it('shows the control for a DIRECT_POST photo', () => {
    renderSettings({ media: PHOTO_MEDIA, method: 'DIRECT_POST' });

    expect(aiControlHidden()).toBe(false);
  });

  it('shows a control for an empty composer instead of hiding it', () => {
    renderSettings({ media: [] });

    expect(aiControlHidden()).toBe(false);
  });

  it('places Made with AI below the dropdowns in the lower checkbox section and toggles by label', () => {
    const form = renderSettings({ media: VIDEO_MEDIA });

    const musicLabel = screen.getByText('Auto add music');
    const commentsLabel = screen.getByText('Allow Comments');
    const discloseLabel = screen.getByText('Disclose Video Content');
    const ai = aiLabel();

    expect(
      musicLabel.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      commentsLabel.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      ai.compareDocumentPosition(discloseLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const box = ai.previousElementSibling as HTMLElement;
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.className).toContain('bg-newBgColorInner');
    expect(box.className).not.toContain('bg-btnPrimary');

    fireEvent.click(ai);
    expect(form.getValues('is_ai_generated')).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.className).toContain('bg-btnPrimary');
    expect(box.className).toContain('text-white');
  });
});

describe('TikTok settings — Business location', () => {
  const LOCATION = {
    id: 'loc-1',
    name: 'Test Place',
    address: '1 Test St',
  };

  const locationLabel = () => screen.getByText('Location');
  const locationHidden = () => !!locationLabel().closest('.invisible');

  it('renders a location loaded after mount from the form value', () => {
    const form = renderSettings({ identifier: 'tiktok-business' });

    expect(screen.queryByText('Test Place')).toBeNull();

    act(() => form.setValue('location', LOCATION));

    expect(screen.getByText('Test Place')).toBeTruthy();
    expect(form.getValues('location')).toEqual(LOCATION);
  });

  it('hides Location in video UPLOAD, keeps the value and restores it on DIRECT_POST', () => {
    const form = renderSettings({
      identifier: 'tiktok-business',
      media: VIDEO_MEDIA,
      method: 'UPLOAD',
      values: { location: LOCATION },
    });

    expect(locationLabel()).toBeTruthy();
    expect(locationHidden()).toBe(true);
    expect(screen.getByText('Test Place')).toBeTruthy();
    expect(form.getValues('location')).toEqual(LOCATION);

    act(() => form.setValue('content_posting_method', 'DIRECT_POST'));

    expect(locationHidden()).toBe(false);
    expect(form.getValues('location')).toEqual(LOCATION);
  });

  it('hides Location for a photo UPLOAD too', () => {
    const form = renderSettings({
      identifier: 'tiktok-business',
      media: PHOTO_MEDIA,
      method: 'UPLOAD',
      values: { location: LOCATION },
    });

    expect(locationHidden()).toBe(true);
    expect(form.getValues('location')).toEqual(LOCATION);

    act(() => form.setValue('content_posting_method', 'DIRECT_POST'));

    expect(locationHidden()).toBe(false);
    expect(form.getValues('location')).toEqual(LOCATION);
  });

  it('never renders a Location control for legacy TikTok', () => {
    renderSettings({ identifier: 'tiktok' });

    expect(screen.queryByText('Location')).toBeNull();
  });
});
