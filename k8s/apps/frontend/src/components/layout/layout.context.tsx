'use client';

import { createContext, ReactNode, useCallback, useContext } from 'react';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { clearOrgInvite } from '@gitroom/frontend/components/auth/org.invite';

const LegacySession = createContext(false);
export const useLegacySession = () => useContext(LegacySession);

type LayoutProps = { children: ReactNode; hasLegacySession?: boolean };

export default function LayoutContext(params: LayoutProps) {
  if (params?.children) {
    return <LayoutContextInner {...params} />;
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

export function clearSessionAuth() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem('auth');
  window.sessionStorage.removeItem('showorg');
  window.sessionStorage.removeItem('impersonate');
  // An invitation is scoped to the identity that received it. Keeping it
  // across logout/401 would attach the next sign-in to the old invitee's org.
  clearOrgInvite();
}

function LayoutContextInner(params: LayoutProps) {
  const returnUrl = useReturnUrl();
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const decision = useDecisionModal();
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
      if (impersonate !== null) {
        if (typeof window !== 'undefined') {
          if (impersonate) {
            window.sessionStorage.setItem('impersonate', impersonate);
          } else {
            // /user/impersonate answers an empty header to stop impersonating.
            window.sessionStorage.removeItem('impersonate');
            // A legacy shared cookie must not win the fallback after reload.
            setCookie('impersonate', '', -10);
          }
        }
      }
      if (logout) {
        clearSessionAuth();
        window.location.href = params.hasLegacySession
          ? '/auth/logout'
          : '/auth/login';
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
        window.location.href = params.hasLegacySession
          ? '/auth/logout'
          : '/auth/login';
      }
      if (response.status === 406) {
        if (
          await deleteDialog(
            "This feature is not available during the trial. You can end the trial now: your plan's first payment is charged today instead of at the end of the trial. Only an admin or the super admin of the organization can end the trial and pay.",
            'End trial and pay now',
            'Trial'
          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      if (response.status === 402) {
        const { message, canManageBillingUi } = await response
          .clone()
          .json()
          .catch(() => ({}));
        if (canManageBillingUi === false) {
          await decision.open({
            title: 'Payment Required',
            onlyApprove: true,
            approveLabel: 'OK',
            description: `${message} Please ask an admin of your organization.`,
          });
          return true;
        }
        if (
          await deleteDialog(message, 'Move to billing', 'Payment Required')
        ) {
          window.open('/billing', '_blank');
          return false;
        }
        return true;
      }
      return true;
    },
    [params.hasLegacySession]
  );
  return (
    <LegacySession.Provider value={!!params.hasLegacySession}>
      <FetchWrapperComponent
        baseUrl={backendUrl}
        afterRequest={afterRequest}
        beforeRequest={async (_url, options) =>
          params.hasLegacySession &&
          isSecured &&
          !options.credentials &&
          typeof window !== 'undefined' &&
          !window.sessionStorage.getItem('auth')
            ? { ...options, credentials: 'include' }
            : options
        }
      >
        {params.children}
      </FetchWrapperComponent>
    </LegacySession.Provider>
  );
}
