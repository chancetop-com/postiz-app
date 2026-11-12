'use client';

import { ReactNode, useCallback } from 'react';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
export default function LayoutContext(params: { children: ReactNode }) {
  if (params?.children) {
    // eslint-disable-next-line react/no-children-prop
    return <LayoutContextInner children={params.children} />;
  }
  return <></>;
}
export function setCookie(cname: string, cvalue: string, exdays: number) {
  if (typeof document === 'undefined') {
    return;
  }
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = cname + '=' + cvalue + ';' + expires + ';path=/';
}

function clearSessionAuth() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem('auth');
  window.sessionStorage.removeItem('showorg');
  window.sessionStorage.removeItem('impersonate');
}

function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  const { backendUrl, isGeneral } = useVariables();
  const afterRequest = useCallback(
    async (url: string, options: RequestInit, response: Response) => {
      if (
        typeof window !== 'undefined' &&
        (window.location.href.includes('/p/') ||
          window.location.pathname.startsWith('/provider/'))
      ) {
        return true;
      }
      const headerAuth =
        response?.headers?.get('auth') || response?.headers?.get('Auth');
      const showOrg =
        response?.headers?.get('showorg') || response?.headers?.get('Showorg');
      const impersonate =
        response?.headers?.get('impersonate') ||
        response?.headers?.get('Impersonate');
      const logout =
        response?.headers?.get('logout') || response?.headers?.get('Logout');
      if (headerAuth) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('auth', headerAuth);
        }
      }
      if (showOrg) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('showorg', showOrg);
        }
      }
      if (impersonate) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('impersonate', impersonate);
        }
      }
      if (logout) {
        clearSessionAuth();
        window.location.href = '/auth/login';
        return true;
      }
      const reloadOrOnboarding =
        response?.headers?.get('reload') ||
        response?.headers?.get('onboarding');
      if (reloadOrOnboarding) {
        const getAndClear = returnUrl.getAndClear();
        if (getAndClear) {
          window.location.href = getAndClear;
          return true;
        }
      }
      if (response?.headers?.get('onboarding')) {
        window.location.href = isGeneral
          ? '/launches?onboarding=true'
          : '/analytics?onboarding=true';
        return true;
      }

      if (response?.headers?.get('reload')) {
        window.location.href = isGeneral ? '/launches' : '/analytics';
        return true;
      }

      if (response.status === 401 || response?.headers?.get('logout')) {
        clearSessionAuth();
        window.location.href = '/auth/login';
      }
      if (response.status === 406) {
        if (
          await deleteDialog(
            "This feature is not available during the trial. You can end the trial now: your plan's first payment is charged today instead of at the end of the trial.",
            'End trial and pay now',
            'Trial',

          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      if (response.status === 402) {
        if (
          await deleteDialog(
            (
              await response
                .clone()
                .json()
                .catch(() => ({}))
            ).message,
            'Move to billing',
            'Payment Required'
          )
        ) {
          window.open('/billing', '_blank');
          return false;
        }
        return true;
      }
      return true;
    },
    []
  );
  return (
    <FetchWrapperComponent baseUrl={backendUrl} afterRequest={afterRequest}>
      {params?.children || <></>}
    </FetchWrapperComponent>
  );
}
