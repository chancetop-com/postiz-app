import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { UploadPurpose } from '@gitroom/helpers/utils/media.upload';
import { useVariables } from './variable.context';
import { uploadAzureMedia, type UploadResult } from './azure.upload';

export function useMediaUpload() {
  const fetch = useFetch();
  const { storageProvider } = useVariables();
  return useCallback(
    async <P extends UploadPurpose>(
      file: Blob,
      name: string,
      purpose: P
    ): Promise<UploadResult<P>> => {
      if (storageProvider === 'azure')
        return uploadAzureMedia(fetch, file, name, purpose);

      const body = new FormData();
      body.append('file', file, name);
      if (purpose === 'thumbnail') body.append('preventSave', 'true');
      const response = await fetch('/media/upload-simple', {
        method: 'POST',
        body,
      });
      if (!response.ok) throw new Error('Could not upload the media.');
      return response.json();
    },
    [fetch, storageProvider]
  );
}
