'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
import {
  clearOrgInvite,
  orgInviteHeaders,
} from '@gitroom/frontend/components/auth/org.invite';
export const AfterActivate = () => {
  const fetch = useFetch();
  const params = useParams();
  const [showLoader, setShowLoader] = useState(true);
  const [organizations, setOrganizations] = useState<
    { id: string; name: string }[]
  >([]);
  const [error, setError] = useState(false);
  const { getAndClear } = useReturnUrl();
  const { isGeneral } = useVariables();
  const run = useRef(false);
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');

  useEffect(() => {
    if (!run.current) {
      run.current = true;
      loadCode();
    }
  }, []);
  const loadCode = useCallback(async () => {
    if (params.code) {
      const response = await fetch(`/auth/activate`, {
        method: 'POST',
        body: JSON.stringify({
          code: params.code,
          datafast_visitor_id,
        }),
        headers: {
          'Content-Type': 'application/json',
          ...orgInviteHeaders(),
        },
      });
      if (response.headers.get('onboarding')) {
        clearOrgInvite();
        return;
      }
      const { can, organizations: choices } = await response.json();
      if (can && choices?.length) {
        clearOrgInvite();
        setOrganizations(choices);
      }
      if (!can) {
        setShowLoader(false);
      }
    }
  }, []);
  if (organizations.length) {
    const choose = async (id: string) => {
      setError(false);
      try {
        const response = await fetch('/user/change-org', {
          method: 'POST',
          body: JSON.stringify({ id }),
        });
        if (!response.ok) throw new Error();
        window.location.href =
          getAndClear() ||
          (isGeneral
            ? '/launches?onboarding=true'
            : '/analytics?onboarding=true');
      } catch {
        setError(true);
      }
    };
    return (
      <div className="flex flex-col gap-3">
        <h1>{t('label_select_organization', 'Select organization')}</h1>
        {organizations.map(({ id, name }) => (
          <Button key={id} type="button" onClick={() => choose(id)}>
            {name}
          </Button>
        ))}
        {error && (
          <p role="alert">
            {t(
              'workspace_switch_failed',
              'Could not switch workspace. Please try again.'
            )}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      {showLoader ? (
        <LoadingComponent />
      ) : (
        <>
          This user is already activated,
          <br />
          <Link href="/auth/login" className="underline">
            {t(
              'click_here_to_go_back_to_login',
              'Click here to go back to login'
            )}
          </Link>
        </>
      )}
    </>
  );
};
