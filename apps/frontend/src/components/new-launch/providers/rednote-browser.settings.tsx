'use client';

import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function RednoteBrowserSettings() {
  const { watch, setValue, unregister } = useSettings();
  const t = useT();
  const contentType = watch('contentType');
  const original = watch('original');
  const update = (key: string, value: string | boolean) => {
    if (value === '') unregister(key);
    else setValue(key, value, { shouldDirty: true });
  };
  const text = (key: string, label: string, type = 'text') => (
    <Input
      name={key}
      label={label}
      aria-label={label}
      type={type}
      disableForm
      removeError
      value={watch(key) ?? ''}
      onChange={(event) => update(key, event.target.value)}
    />
  );
  const originalLabel = t(
    'browser_original_declaration',
    'Original declaration'
  );
  const typeLabel = t('browser_content_declaration', 'Content declaration');
  const platformDefault = t('browser_platform_default', 'Use platform default');
  return (
    <div className="flex flex-col gap-4 pb-4">
      {text('title', t('title', 'Title'))}
      {text('location', t('browser_post_location', 'Post location'))}
      <Select
        name="original"
        label={originalLabel}
        aria-label={originalLabel}
        disableForm
        hideErrors
        value={original === undefined ? '' : String(original)}
        onChange={(event) =>
          update(
            'original',
            event.target.value === '' ? '' : event.target.value === 'true'
          )
        }
      >
        <option value="">{platformDefault}</option>
        <option value="true">
          {t('browser_original_on', 'Declare original')}
        </option>
        <option value="false">
          {t('browser_original_off', 'Disable original declaration')}
        </option>
      </Select>
      <Select
        name="contentType"
        label={typeLabel}
        aria-label={typeLabel}
        disableForm
        hideErrors
        value={contentType ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== 'repost') unregister('repostSource');
          if (next !== 'self-shot') unregister(['shootLocation', 'shootDate']);
          update('contentType', next);
        }}
      >
        <option value="">{platformDefault}</option>
        <option value="fiction">{t('browser_fiction', 'Fiction')}</option>
        <option value="ai">
          {t('browser_ai_content', 'AI-generated content')}
        </option>
        <option value="marketing">{t('browser_marketing', 'Marketing')}</option>
        <option value="self-shot">{t('browser_self_shot', 'Self-shot')}</option>
        <option value="repost">{t('browser_repost', 'Repost')}</option>
      </Select>
      {contentType === 'repost' &&
        text('repostSource', t('browser_repost_source', 'Repost source'))}
      {contentType === 'self-shot' && (
        <>
          {text(
            'shootLocation',
            t('browser_shoot_location', 'Shooting location')
          )}
          {text('shootDate', t('browser_shoot_date', 'Shooting date'), 'date')}
        </>
      )}
    </div>
  );
}
