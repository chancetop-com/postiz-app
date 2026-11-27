// @vitest-environment jsdom
import 'reflect-metadata';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import i18next from '@gitroom/react/translation/i18next';
import zh from '@gitroom/react/translation/locales/zh/translation.json';
import { FormProvider, useForm } from 'react-hook-form';

/**
 * Ticket 09: one "Made with AI" control in the Instagram settings.
 *
 * It is shared by image and video, hidden (but mounted, with its value kept)
 * on a Story, restored when switching back, and visible for Instagram
 * Standalone. The assertion reads the real form value, not component state.
 */

beforeAll(async () => {
  await i18next.changeLanguage('zh');
});

const integrationRef = vi.hoisted(() => ({
  current: { identifier: 'instagram' } as { identifier: string },
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
  integrationRef.current = { identifier };
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

  render(<Harness />);

  return {
    form: () => form!,
    setPostType: (postType: 'post' | 'story') =>
      act(() => {
        form!.setValue('post_type', postType);
      }),
    clickAi: () => {
      fireEvent.click(screen.getByText(zh.made_with_ai));
    },
  };
};

const hiddenAiControl = () => screen.getByText(zh.made_with_ai).closest('.invisible');

afterEach(() => {
  cleanup();
  integrationRef.current = { identifier: 'instagram' };
});

describe('Instagram "Made with AI" setting', () => {
  it('restores the control and the selected value when switching back from Story', () => {
    const settings = renderSettings({ post_type: 'post' });

    settings.clickAi();
    expect(settings.form().getValues('is_ai_generated')).toBe(true);

    settings.setPostType('story');
    expect(hiddenAiControl()).not.toBeNull();
    expect(settings.form().getValues('is_ai_generated')).toBe(true);

    settings.setPostType('post');
    expect(hiddenAiControl()).toBeNull();
    expect(settings.form().getValues('is_ai_generated')).toBe(true);
  });

  it('shows the control for an Instagram Standalone post', () => {
    const settings = renderSettings(
      { post_type: 'post' },
      'instagram-standalone'
    );

    expect(screen.getAllByText(zh.made_with_ai)).toHaveLength(1);
    expect(hiddenAiControl()).toBeNull();

    settings.clickAi();
    expect(settings.form().getValues('is_ai_generated')).toBe(true);
  });

  it('hides the control on an Instagram Standalone Story too', () => {
    const settings = renderSettings(
      { post_type: 'story', is_ai_generated: true },
      'instagram-standalone'
    );

    expect(hiddenAiControl()).not.toBeNull();
    expect(settings.form().getValues('is_ai_generated')).toBe(true);
  });
});
