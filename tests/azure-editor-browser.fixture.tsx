import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormProvider, useForm } from 'react-hook-form';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { ModalManager } from '@gitroom/frontend/components/layout/new-modal';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { MediaComponentInner } from '@gitroom/frontend/components/launches/helpers/media.settings.component';

function EditorPage() {
  const query = new URLSearchParams(location.search);
  const [result, setResult] = useState<unknown>(null);
  const [closed, setClosed] = useState(false);
  const form = useForm();
  return (
    <FormProvider {...form}>
      <ModalManager>
        {query.has('video') ? (
          !closed && (
            <MediaComponentInner
              media={JSON.parse(query.get('video')!)}
              onSelect={setResult}
              onClose={() => setClosed(true)}
            />
          )
        ) : (
          <MediaComponent
            name="cover"
            label="Cover"
            description=""
            width={80}
            height={60}
            onChange={(event) => setResult(event.target.value)}
          />
        )}
        <output>{JSON.stringify(result)}</output>
      </ModalManager>
    </FormProvider>
  );
}

createRoot(document.body.appendChild(document.createElement('main'))).render(
  <VariableContextComponent
    {...({} as any)}
    storageProvider="azure"
    backendUrl={location.origin}
    transloadit={[]}
  >
    <FetchWrapperComponent baseUrl={location.origin}>
      <EditorPage />
    </FetchWrapperComponent>
  </VariableContextComponent>
);
