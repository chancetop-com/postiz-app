'use client';
import 'reflect-metadata';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import dayjs from 'dayjs';
import { FC, useEffect } from 'react';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ManageModal } from '@gitroom/frontend/components/new-launch/manage.modal';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useShallow } from 'zustand/react/shallow';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import {
  fromUtc,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface AddEditModalProps {
  dummy?: boolean;
  date: dayjs.Dayjs;
  integrations: Integrations[];
  allIntegrations?: Integrations[];
  selectedChannels?: string[];
  set?: any;
  focusedChannel?: string;
  addEditSets?: (data: any) => void;
  reopenModal: () => void;
  mutate: () => void;
  padding?: string;
  customClose?: () => void;
  onlyValues?: Array<{
    content: string;
    id?: string;
    image?: Array<{
      id: string;
      path: string;
    }>;
  }>;
}

export const AddEditModal: FC<AddEditModalProps> = (props) => {
  const { setAllIntegrations, setDate, setIsCreateSet, setDummy } =
    useLaunchStore(
      useShallow((state) => ({
        setAllIntegrations: state.setAllIntegrations,
        setDate: state.setDate,
        setIsCreateSet: state.setIsCreateSet,
        setDummy: state.setDummy,
      }))
    );

  const integrations = useLaunchStore((state) => state.integrations);
  useEffect(() => {
    setDummy(!!props.dummy);
    setDate(props.date || newDayjs());
    setAllIntegrations(props.allIntegrations || []);
    setIsCreateSet(!!props.addEditSets);
  }, []);

  useEffect(() => {
    document.querySelector('body')?.classList.add('hideChatbase');
    return () => {
      document.querySelector('body')?.classList.remove('hideChatbase');
    };
  }, []);

  if (!integrations.length) {
    return null;
  }

  return <AddEditModalInner {...props} />;
};

export const AddEditModalInner: FC<AddEditModalProps> = (props) => {
  const existingData = useExistingData();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { addOrRemoveSelectedIntegration, selectedIntegrations, integrations } =
    useLaunchStore(
      useShallow((state) => ({
        integrations: state.integrations,
        selectedIntegrations: state.selectedIntegrations,
        addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      }))
    );

  useEffect(() => {
    if (props?.set?.posts?.length) {
      for (const post of props?.set?.posts) {
        if (post.integration) {
          const integration = integrations.find(
            (i) => i.id === post.integration.id
          );
          if (integration) {
            addOrRemoveSelectedIntegration(integration, post.settings);
          }
        }
      }
    }

    if (existingData.integration) {
      const integration = integrations.find(
        (i) => i.id === existingData.integration
      );
      if (!integration) {
        toaster.show(
          t(
            'we_are_experiencing_some_difficulty_try_to_refresh_the_page',
            'We are experiencing some difficulty, try to refresh the page'
          ),
          'warning'
        );
        modal.closeAll();
        return;
      }
      addOrRemoveSelectedIntegration(integration, existingData.settings);

      // the other channels the post was created with
      for (const sibling of existingData.siblings || []) {
        const siblingIntegration = integrations.find(
          (i) => i.id === sibling.integration
        );
        if (siblingIntegration) {
          addOrRemoveSelectedIntegration(siblingIntegration, sibling.settings);
        }
      }
    }

    if (props?.selectedChannels?.length) {
      for (const channel of props.selectedChannels) {
        const integration = integrations.find((i) => i.id === channel);
        if (integration) {
          addOrRemoveSelectedIntegration(integration, {});
        }
      }
    }
  }, []);

  if (existingData.integration && selectedIntegrations.length === 0) {
    return null;
  }

  return <AddEditModalInnerInner {...props} />;
};

// an existing post, as the values of the editor
const postValues = (
  posts: { id?: string; content: string; delay: number; image?: unknown }[]
) =>
  posts.map((post) => ({
    delay: post.delay,
    content: /<p[\s>]/i.test(post.content)
      ? post.content
      : post.content
          .split('\n')
          .map((line: string) => `<p>${line}</p>`)
          .join(''),
    id: post.id || makeId(10),
    media: post.image as { id: string; path: string }[],
  }));

export const AddEditModalInnerInner: FC<AddEditModalProps> = (props) => {
  const existingData = useExistingData();
  const {
    reset,
    addGlobalValue,
    addInternalValue,
    global,
    setCurrent,
    internal,
    setTags,
    setEditor,
    setRepeater,
    selectedIntegrations,
    setChannelDate,
  } = useLaunchStore(
    useShallow((state) => ({
      reset: state.reset,
      addGlobalValue: state.addGlobalValue,
      addInternalValue: state.addInternalValue,
      setCurrent: state.setCurrent,
      global: state.global,
      internal: state.internal,
      setTags: state.setTags,
      setEditor: state.setEditor,
      setRepeater: state.setRepeater,
      selectedIntegrations: state.selectedIntegrations,
      setChannelDate: state.setChannelDate,
    }))
  );

  useEffect(() => {
    const channels = [existingData, ...(existingData.siblings || [])];
    const defaults = channels.find((channel) => channel.draftEditor)
      ?.draftEditor?.shared;
    if (existingData.integration) {
      if (existingData?.posts?.[0]?.intervalInDays) {
        setRepeater(existingData.posts[0].intervalInDays);
      }
      setTags(
        // @ts-ignore
        existingData?.posts?.[0]?.tags?.map((p: any) => ({
          label: p.tag.name,
          value: p.tag.name,
        })) || []
      );

      for (const channel of channels) {
        if (
          !selectedIntegrations.some(
            (p) => p.integration.id === channel.integration
          )
        )
          continue;
        // A partially saved batch can have an older shared version on an unchecked
        // channel. Keep its effective content until the author elects to replace it.
        if (
          !channel.draftEditor ||
          channel.draftEditor.overridesShared ||
          JSON.stringify(channel.draftEditor.shared) !==
            JSON.stringify(defaults)
        ) {
          addInternalValue(0, channel.integration, postValues(channel.posts));
        }
        if (channel.integration !== existingData.integration) {
          setChannelDate(
            channel.integration,
            fromUtc(channel.posts[0].publishDate)
          );
        }
      }
      setCurrent(existingData.integration);
    } else {
      setEditor('normal');
    }

    if (props.focusedChannel) {
      setCurrent(props.focusedChannel);
    }

    addGlobalValue(
      0,
      defaults
        ? postValues(defaults.map((row) => ({ ...row, id: undefined })))
        : props.onlyValues?.length
        ? props.onlyValues.map((p) => ({
            content: /<p[\s>]/i.test(p.content)
              ? p.content
              : p.content
                  .split('\n')
                  .map((line: string) => `<p>${line}</p>`)
                  .join(''),
            id: makeId(10),
            media: p.image || [],
          }))
        : props.set?.posts?.length
        ? props.set.posts[0].value.map((p: any) => ({
            id: makeId(10),
            content: /<p[\s>]/i.test(p.content)
              ? p.content
              : p.content
                  .split('\n')
                  .map((line: string) => `<p>${line}</p>`)
                  .join(''),
            // @ts-ignore
            media: p.media,
          }))
        : [
            {
              content: '',
              id: makeId(10),
              media: [],
            },
          ]
    );

    return () => {
      reset();
    };
  }, []);

  if (!global.length && !internal.length) {
    return null;
  }

  return (
    <>
      <style>
        {`#support-discord {display: none !important;}`}
      </style>
      <ManageModal {...props} />
    </>
  );
};
