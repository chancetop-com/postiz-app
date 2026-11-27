'use client';

import React, { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface Review {
  status: string;
  reason?: string;
}

function useBrowserReview(path: string, onSettled: () => void) {
  const fetch = useFetch();
  return useSWR<Review>(
    path,
    async () => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Review unavailable');
      return response.json();
    },
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 0,
      onSuccess: (review) => {
        if (review.status !== 'needs_review') onSettled();
      },
    }
  );
}

export function BrowserReviewForm({
  workflowId,
  onSettled,
}: {
  workflowId: string;
  onSettled: () => void;
}) {
  const t = useT();
  const fetch = useFetch();
  const path = '/browser-publishing/review/' + encodeURIComponent(workflowId);
  const { data, error, isValidating, mutate } = useBrowserReview(
    path,
    onSettled
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const decision: Record<string, string> = {};
    fields.forEach((value, key) => {
      if (typeof value === 'string' && value) decision[key] = value;
    });
    setBusy(true);
    setSaveError(false);
    try {
      const response = await fetch(path, {
        method: 'PUT',
        body: JSON.stringify(decision),
      });
      if (!response.ok) throw new Error('Review unavailable');
      await mutate(await response.json(), { revalidate: false });
      onSettled();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <p role="alert">
        {t(
          'browser_review_unavailable',
          'The latest result could not be checked. Reopen the review to try again.'
        )}
      </p>
    );
  if (isValidating || !data)
    return <p>{t('browser_review_checking', 'Checking the latest result…')}</p>;
  if (data.status !== 'needs_review')
    return (
      <p role="status">
        {data.status === 'published'
          ? t('browser_confirmed', 'Publication confirmed')
          : data.status === 'prepared'
          ? t('browser_prepared', 'Prepared without publishing')
          : t('browser_failed', 'Publication failed')}
      </p>
    );
  const input = 'border border-tableBorder rounded-md bg-newBgColorInner p-2';
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {data.reason && <p>{data.reason}</p>}
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <legend>
          {t(
            'browser_account_result',
            'What did you find on the platform account?'
          )}
        </legend>
        <label>
          <input required type="radio" name="outcome" value="published" />{' '}
          {t('published', 'Published')}
        </label>
        <label>
          <input required type="radio" name="outcome" value="failed" />{' '}
          {t('browser_not_published', 'Not published')}
        </label>
        <label className="flex flex-col">
          {t('browser_work_id', 'Work ID (optional)')}
          <input name="releaseId" maxLength={512} className={input} />
        </label>
        <label className="flex flex-col">
          {t('browser_work_url', 'Post URL (optional)')}
          <input name="url" type="url" maxLength={2048} className={input} />
        </label>
        <label className="flex flex-col">
          {t('browser_review_note', 'Note (optional)')}
          <textarea name="note" maxLength={2000} className={input} />
        </label>
      </fieldset>
      {saveError && (
        <p role="alert">
          {t(
            'browser_decision_error',
            'Could not record the outcome. Check your entries and try again.'
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-btnPrimary px-4 py-2 text-white"
      >
        {t('browser_record_outcome', 'Record outcome')}
      </button>
    </form>
  );
}
