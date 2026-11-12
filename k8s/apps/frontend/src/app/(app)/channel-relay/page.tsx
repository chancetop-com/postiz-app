'use client';

import type { JSX } from 'react';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CHANNEL_SESSION_KEYS,
  markChannelPopup,
} from '@gitroom/frontend/components/launches/channel.popup';

export default function ChannelRelayPage(): JSX.Element | null {
  const searchParams = useSearchParams();

  useEffect(() => {
    const redirect = searchParams.get('redirect');

    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    const auth = hashParams.get('auth');

    // Without a target and a session there is nothing to hand over: stay put.
    if (!redirect || !auth) return;

    // `auth` is always written; showorg/impersonate only when the parent sent
    // them. A missing value therefore leaves whatever the popup already had —
    // the recorded session behaviour, not a cleanup this merge adds.
    hashParams.forEach((value, key) => {
      if (
        value &&
        (CHANNEL_SESSION_KEYS as readonly string[]).includes(key)
      ) {
        window.sessionStorage.setItem(key, value);
      }
    });
    markChannelPopup();

    window.location.href = redirect;
  }, []);

  return null;
}
