import React from 'react';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '@uppy/react';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { MediaLibraryImage } from '@gitroom/frontend/components/media/media-library-image';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';

// The picker, compression, upload lifecycle and completion callback are the
// dashboard's production code. Only the surrounding page is a test fixture.
function Picker() {
  const [result, setResult] = React.useState<{ id: string; path: string }[] | null>(null);
  const uppy = useUppyUploader({
    allowedFileTypes: 'image/*,video/mp4',
    onStart() {},
    onEnd() {},
    onUploadSuccess: setResult,
  });
  const [submitted, setSubmitted] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!settings.has('capture')) return;
    const record = async (
      file: { data: Blob },
      response: { uploadURL?: string; body?: any }
    ) => {
      const bytes = await file.data.arrayBuffer();
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const digest = Array.from(hash, (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      setSubmitted((previous) => ({
        ...previous,
        [response.body.saved.path]: digest,
      }));
    };
    uppy.on('upload-success', record);
    return () => {
      uppy.off('upload-success', record);
    };
  }, [uppy]);
  return (
    <>
      <Dashboard uppy={uppy} />
      <Toaster />
      {result?.map((media: { id: string; path: string }) => (
        <MediaLibraryImage
          key={media.id}
          data-library-preview
          mediaId={media.id}
          src={media.path}
        />
      ))}
      <output>{JSON.stringify(result)}</output>
      <pre data-submitted>{JSON.stringify(submitted)}</pre>
    </>
  );
}

const settings = new URLSearchParams(location.search);
const storageProvider =
  settings.get('provider') === 'cloudflare' ? 'cloudflare' : 'azure';

createRoot(document.body.appendChild(document.createElement('main'))).render(
  <VariableContextComponent
    {...({} as any)}
    storageProvider={storageProvider}
    disableImageCompression={!settings.has('compress')}
    transloadit={
      storageProvider === 'azure' && !settings.has('no-template')
        ? ['unused-key', 'unused-template']
        : []
    }
    mediaProcessing={settings.has('processing')}
    backendUrl={location.origin}
  >
    <FetchWrapperComponent baseUrl={location.origin}>
      <Picker />
    </FetchWrapperComponent>
  </VariableContextComponent>
);
