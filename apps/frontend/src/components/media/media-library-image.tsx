'use client';

import type { ImgHTMLAttributes } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isTiffPath } from '@gitroom/helpers/utils/media.upload';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

function useTiffPreview(id?: string) {
  const fetch = useFetch();
  return useSWR(
    id ? '/media/' + encodeURIComponent(id) + '/tiff-preview' : null,
    async (url: string): Promise<string> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load the TIFF preview.');
      return (await response.json()).src;
    },
    { revalidateOnFocus: false, errorRetryCount: 1 }
  );
}

export function MediaLibraryImage({
  mediaId,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { mediaId?: string }) {
  const t = useT();
  const needsPreview = Boolean(
    mediaId && typeof src === 'string' && isTiffPath(src)
  );
  const { data: preview, error } = useTiffPreview(
    needsPreview ? mediaId : undefined
  );
  if (
    needsPreview &&
    !preview &&
    error &&
    typeof src === 'string' &&
    /^(https?:\/\/|\/)/i.test(src)
  ) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {t('open_original_tiff', 'Open original TIFF')}
      </a>
    );
  }
  return <img {...props} src={needsPreview ? preview : src} />;
}
