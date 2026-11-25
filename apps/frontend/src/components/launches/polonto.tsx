'use client';

import {
  createContext,
  FC,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import 'polotno/polotno.blueprint.css';
import { createStore } from 'polotno/model/store';
import Workspace from 'polotno/canvas/workspace';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import Toolbar from 'polotno/toolbar/toolbar';
import ZoomButtons from 'polotno/toolbar/zoom-buttons';
import { Button } from '@gitroom/react/form/button';
import { PictureGeneratorSection } from '@gitroom/frontend/components/launches/polonto/polonto.picture.generation';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { loadVars } from '@gitroom/react/helpers/variable.context';
import { useMediaUpload } from '@gitroom/react/helpers/use.media.upload';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
const store = createStore({
  get key() {
    return loadVars().plontoKey;
  },
  showCredit: false,
});

// @ts-ignore
const CloseContext = createContext({
  close: {} as any,
  setMedia: {} as any,
});
const ActionControls = ({ store }: any) => {
  const t = useT();
  const close = useContext(CloseContext);
  const [load, setLoad] = useState(false);
  const [error, setError] = useState('');
  const upload = useMediaUpload();
  return (
    <div>
      <Button
        loading={load}
        disabled={load}
        className="outline-none"
        innerClassName="invert outline-none text-black"
        onClick={async () => {
          setLoad(true);
          setError('');
          try {
            const blob: Blob = await store.toBlob();
            const data = await upload(blob, 'media.png', 'media');
            if (!data.id || !data.path)
              throw new Error('Missing saved design.');
            close.setMedia([{ id: data.id, path: data.path }]);
            close.close();
          } catch {
            setError(
              t(
                'could_not_save_design',
                'Could not save the design. Please try again.'
              )
            );
          } finally {
            setLoad(false);
          }
        }}
      >
        {t('use_this_media', 'Use this media')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
const Polonto: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  type?: 'image' | 'video';
  closeModal: () => void;
  width?: number;
  height?: number;
}> = (props) => {
  const { setMedia, type, closeModal } = props;

  const setActivateExitButton = useLaunchStore((e) => e.setActivateExitButton);
  useEffect(() => {
    setActivateExitButton(false);
    return () => {
      setActivateExitButton(true);
    };
  }, []);

  const user = useUser();
  const features = useMemo(() => {
    return [
      ...DEFAULT_SECTIONS,
      ...(user?.tier?.image_generator ? [PictureGeneratorSection] : []),
    ] as any[];
  }, [user?.tier?.image_generator]);
  useEffect(() => {
    store.addPage({
      width: props.width || 540,
      height: props.height || 675,
    });
    return () => {
      store.clear();
    };
  }, []);
  return (
    <div className="bg-white text-black relative z-[400] polonto">
      <CloseContext.Provider
        value={{
          close: () => closeModal(),
          setMedia,
        }}
      >
        <PolotnoContainer
          style={{
            width: '100%',
            height: '700px',
          }}
        >
          <SidePanelWrap>
            <SidePanel store={store} sections={features} />
          </SidePanelWrap>
          <WorkspaceWrap>
            <Toolbar
              store={store}
              components={{
                ActionControls,
              }}
            />
            <Workspace store={store} />
            <ZoomButtons store={store} />
          </WorkspaceWrap>
        </PolotnoContainer>
      </CloseContext.Provider>
    </div>
  );
};
export default Polonto;
