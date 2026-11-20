'use client';

import { FC, ReactNode, useCallback, useState } from 'react';
import useSWR from 'swr';
import { HttpStatusCode } from 'axios';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PlatformIcon } from '@gitroom/frontend/components/ui/platform.icon.component';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';

interface ConnectLinkDetails {
  identifier: string;
  name: string;
  redirectTo?: string;
}

const useConnectLink = (token: string) => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<ConnectLinkDetails> => {
    const response = await fetch(`/integrations/public/connect/${token}`);
    if (!response.ok) {
      throw new Error('Connection link not found');
    }
    return response.json();
  }, [token, fetch]);
  return useSWR(`connect-link-${token}`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
};

// The fork's default surface: the light theme of the main layout, with the
// customized PNG mark instead of the upstream fixed dark page and Postiz logo.
const Wrapper: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="light flex flex-1 min-h-screen w-full items-center justify-center flex-col bg-primary text-textColor relative overflow-hidden p-[20px]">
    <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
      <div className="absolute top-[10%] left-[5%] w-[300px] h-[300px] bg-[#612BD3] rounded-full blur-[120px]" />
      <div className="absolute bottom-[10%] right-[5%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
    </div>
    {children}
  </div>
);

const Card: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="relative z-10 w-full max-w-[500px] mx-auto">
    <div className="bg-secondary border border-tableBorder rounded-[16px] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
      {children}
    </div>
  </div>
);

const Row: FC<{ icon: ReactNode; children: ReactNode }> = ({
  icon,
  children,
}) => (
  <div className="flex gap-[12px] items-start">
    <svg
      className="w-[20px] h-[20px] shrink-0 mt-[1px] text-[#612BD3]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon}
    </svg>
    <div className="flex-1">{children}</div>
  </div>
);

const BrandRow: FC<{ identifier: string }> = ({ identifier }) => (
  <div className="flex items-center justify-center gap-[16px] border-b border-tableBorder bg-primary/50 px-[24px] py-[26px]">
    <div className="w-[64px] h-[64px] rounded-[16px] border border-tableBorder bg-secondary shadow-sm flex items-center justify-center overflow-hidden">
      <div className="-mt-[20px]">
        <Logo />
      </div>
    </div>
    <svg
      className="w-[20px] h-[20px] text-gray"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
    <div className="w-[64px] h-[64px] rounded-[16px] border border-tableBorder bg-secondary shadow-sm flex items-center justify-center">
      <PlatformIcon
        identifier={identifier}
        size={40}
        iconClassName="w-[40px] h-[40px] rounded-[10px]"
        channel=""
      />
    </div>
  </div>
);

export const ConnectLink: FC<{ token: string }> = ({ token }) => {
  const t = useT();
  const fetch = useFetch();
  const { data, error, isLoading, mutate } = useConnectLink(token);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failedMessage, setFailedMessage] = useState('');

  const connect = useCallback(async () => {
    setSubmitting(true);
    setFailed(false);
    setFailedMessage('');
    try {
      const response = await fetch(`/integrations/public/connect/${token}`, {
        method: 'POST',
      });
      const { url, message } = await response.json();
      if (!response.ok || !url) {
        // a refused connection says why (e.g. the plan has no channels left)
        if (response.status === HttpStatusCode.BadRequest) {
          setFailedMessage(message);
        }
        throw new Error('Could not connect to the platform');
      }
      window.location.assign(url);
    } catch {
      setFailed(true);
      setSubmitting(false);
      // an expired link shows the expired screen instead
      mutate();
    }
  }, [token, fetch, mutate]);

  if (isLoading) {
    return (
      <Wrapper>
        <div className="relative z-10 flex justify-center">
          <div className="w-[48px] h-[48px] border-[3px] border-[#612BD3] border-t-transparent rounded-full animate-spin" />
        </div>
      </Wrapper>
    );
  }

  if (error || !data) {
    return (
      <Wrapper>
        <Card>
          <div className="px-[32px] py-[40px] text-center">
            <div className="flex justify-center mb-[20px]">
              <Logo />
            </div>
            <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="w-[40px] h-[40px] text-red-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="text-[28px] font-semibold mb-[12px]">
              {t('connect_link_expired', 'This link is no longer valid')}
            </div>
            <div className="text-[16px] text-gray max-w-[400px] mx-auto">
              {t(
                'connect_link_expired_description',
                'Connection links work for one hour. Ask whoever sent it to you for a new one.'
              )}
            </div>
          </div>
        </Card>
      </Wrapper>
    );
  }

  // i18next escapes interpolated values for HTML, React already does
  const values = {
    platform: data.name,
    site: data.redirectTo,
    interpolation: { escapeValue: false },
  };

  return (
    <Wrapper>
      <Card>
        <BrandRow identifier={data.identifier} />

        <div className="p-[32px] flex flex-col gap-[24px]">
          <h1 className="text-[24px] leading-[32px] font-semibold text-center text-textColor">
            {t(
              'connect_link_title',
              'Postiz wants to connect to your {{platform}}',
              values
            )}
          </h1>

          <div className="border border-tableBorder rounded-[12px] p-[16px] flex flex-col gap-[14px] text-[14px] text-textColor">
            <Row
              icon={
                <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
              }
            >
              {t(
                'connect_link_trust',
                'Only continue if you trust whoever sent you this link'
              )}
            </Row>
            <Row icon={<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />}>
              {t(
                'connect_link_automate',
                'Postiz will automate your {{platform}} account: it can schedule and publish posts on your behalf',
                values
              )}
            </Row>
            <Row
              icon={
                <>
                  <rect x="4" y="4" width="16" height="6" rx="1.5" />
                  <rect x="4" y="14" width="16" height="6" rx="1.5" />
                  <path d="M8 7h.01M8 17h.01" />
                </>
              }
            >
              {t(
                'connect_link_system',
                'Everything goes through the Postiz system: your account is added to a Postiz workspace and managed from there'
              )}
            </Row>
            {!!data.redirectTo && (
              <Row
                icon={
                  <>
                    <path d="M14 5h5v5" />
                    <path d="M19 5l-8 8" />
                    <path d="M11 6H6a1 1 0 00-1 1v11a1 1 0 001 1h11a1 1 0 001-1v-5" />
                  </>
                }
              >
                {t(
                  'connect_link_redirect',
                  'When you are done you will be sent to {{site}}, a website outside of Postiz',
                  values
                )}
              </Row>
            )}
          </div>

          <div className="text-[12px] uppercase tracking-[0.5px] text-gray text-center">
            {t(
              'connect_link_next',
              'You will be taken to {{platform}} to sign in and approve the access',
              values
            )}
          </div>

          <div className="flex flex-col gap-[12px]">
            <button
              onClick={connect}
              disabled={submitting}
              className="bg-[#612BD3] hover:bg-[#7B3FF2] disabled:opacity-50 text-white rounded-[8px] py-[12px] px-[16px] text-[14px] font-semibold transition-colors"
            >
              {submitting
                ? t('connect_link_connecting', 'Connecting...')
                : t('connect_link_continue', 'Continue to {{platform}}', values)}
            </button>
            {failed && (
              <div className="text-[14px] text-red-500 text-center">
                {failedMessage ||
                  t(
                    'could_not_connect_to_platform',
                    'Could not connect to the platform'
                  )}
              </div>
            )}
            <div className="text-[12px] text-gray text-center">
              {t(
                'connect_link_close',
                'Not what you expected? Close this page and nothing will be connected.'
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-[20px] flex items-center justify-center gap-[8px] text-[13px] text-gray">
        {t('connect_link_secured_by', 'Secured by')}
        <span className="font-semibold text-textColor">Postiz</span>
      </div>
    </Wrapper>
  );
};
