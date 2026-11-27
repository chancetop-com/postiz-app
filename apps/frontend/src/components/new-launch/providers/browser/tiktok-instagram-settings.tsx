'use client';

import { browserMediaRole } from '@gitroom/helpers/utils/browser-publishing';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useEffect, useRef } from 'react';
import { useWatch } from 'react-hook-form';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

const fieldClass =
  'w-full rounded bg-newBgColorInner px-3 py-2 border border-newTableBorder';

export function TikTokInstagramSettings() {
  const { integration, value } = useIntegration();
  const { control, setValue, unregister, getValues } = useSettings();
  const settings = useWatch({ control }) || {};
  const instagram = integration?.identifier === 'browser-instagram';
  const media = value[0]?.image || [];
  const t = useT();
  const video = media.some((item) => browserMediaRole(item) === 'video');
  const altText = settings.altText ?? media.map((item) => item.alt || '');
  const keys = JSON.stringify(media.map((item) => item.id || item.path));
  const previousKeys = useRef(keys);
  const update = (name: string, next?: unknown) =>
    next === undefined
      ? unregister(name)
      : setValue(name, next, { shouldDirty: true });

  useEffect(() => {
    const previous = JSON.parse(previousKeys.current) as string[];
    const current = JSON.parse(keys) as string[];
    previousKeys.current = keys;
    if (video) {
      if (instagram) unregister('altText');
      else unregister('title');
    } else if (current.length && !instagram) {
      unregister('disableReuse');
    }
    const oldText = getValues('altText') as string[] | undefined;
    if (
      !instagram ||
      video ||
      !oldText ||
      !previous.length ||
      JSON.stringify(previous) === keys
    )
      return;
    // Preserve the text of each occurrence when a carousel is reordered, including repeated images.
    const byId = new Map<string, string[]>();
    previous.forEach((id, index) => {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id)!.push(oldText[index] || '');
    });
    const next = current.map((id) => byId.get(id)?.shift() || '');
    if (next.some(Boolean)) setValue('altText', next);
    else unregister('altText');
  }, [instagram, video, keys, getValues, setValue, unregister]);

  const aiKey = instagram ? 'aiGenerated' : 'aigc';
  const toggles = [
    ['noComments', t('browser_turn_off_comments', 'Turn off comments')],
    ...(!instagram
      ? [
          ['yourBrand', t('label_your_brand', 'Your brand')],
          ['brandedContent', t('label_branded_content', 'Branded content')],
        ]
      : []),
    ...(!instagram && video
      ? [
          [
            'disableReuse',
            t('browser_disable_video_reuse', 'Disable video reuse'),
          ],
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      {(instagram || !video) && (
        <label>
          {t('title', 'Title')}
          <input
            className={fieldClass}
            value={settings.title || ''}
            onChange={(e) => update('title', e.target.value || undefined)}
          />
        </label>
      )}
      {!instagram && (
        <label>
          {t('browser_privacy', 'Privacy')}
          <select
            className={fieldClass}
            value={settings.privacy || ''}
            onChange={(e) => update('privacy', e.target.value || undefined)}
          >
            <option value="">
              {t('browser_keep_platform_setting', 'Keep platform setting')}
            </option>
            <option value="public">{t('browser_public', 'Public')}</option>
            <option value="friends">{t('browser_friends', 'Friends')}</option>
            <option value="followers">
              {t('browser_followers', 'Followers')}
            </option>
            <option value="only-me">{t('browser_only_me', 'Only me')}</option>
          </select>
        </label>
      )}
      <label>
        {t('browser_location', 'Location')}
        <input
          className={fieldClass}
          value={settings.location || ''}
          onChange={(e) => update('location', e.target.value || undefined)}
        />
      </label>
      <label>
        {t('browser_ai_content', 'AI-generated content')}
        <select
          className={fieldClass}
          value={String(settings[aiKey] ?? '')}
          onChange={(e) =>
            update(
              aiKey,
              e.target.value === '' ? undefined : e.target.value === 'true'
            )
          }
        >
          <option value="">
            {t('browser_keep_platform_setting', 'Keep platform setting')}
          </option>
          <option value="true">{t('yes', 'Yes')}</option>
          <option value="false">{t('no', 'No')}</option>
        </select>
      </label>
      {toggles.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings[key] === true}
            onChange={(e) => update(key, e.target.checked || undefined)}
          />
          {label}
        </label>
      ))}
      {instagram && (
        <label>
          {t('browser_collaborators', 'Collaborators')}
          <textarea
            className={fieldClass}
            placeholder={t(
              'browser_username_per_line',
              'One username per line'
            )}
            value={settings.collaborators?.join('\n') || ''}
            onChange={(e) =>
              update(
                'collaborators',
                e.target.value ? e.target.value.split('\n') : undefined
              )
            }
          />
        </label>
      )}
      {instagram &&
        !video &&
        media.map((item, index) => (
          <label key={item.id + ':' + index}>
            {t('browser_image_alt', 'Alt text for image {{number}}', {
              number: index + 1,
            })}
            <textarea
              className={fieldClass}
              value={altText[index] || ''}
              onChange={(e) => {
                const next = media.map((_, i) =>
                  i === index ? e.target.value : altText[i] || ''
                );
                update('altText', next.some(Boolean) ? next : undefined);
              }}
            />
          </label>
        ))}
    </div>
  );
}
