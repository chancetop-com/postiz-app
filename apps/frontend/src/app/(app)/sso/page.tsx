'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function SsoLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fetch = useFetch();
  const { isGeneral, ssoParentOrigins } = useVariables();
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const urlToken = searchParams.get('auth_code');
    if (urlToken) {
      handleSsoLogin(urlToken);
      return;
    }

    const handler = (event: MessageEvent) => {
      const allowedOrigins = (ssoParentOrigins || '')
        .split(',').filter(Boolean);
      if (!allowedOrigins.includes(event.origin)) return;

      if (event.data?.type === 'SSO_TOKEN' && event.data?.auth_code) {
        handleSsoLogin(event.data.auth_code);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [ssoParentOrigins]);

  const handleSsoLogin = async (ssoToken: string) => {
    try {
      const res = await fetch('/auth/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: ssoToken }),
      });

      if (res.ok) {
        // Force light mode to avoid ModeComponent dark toggle
        document.cookie = 'mode=light;path=/;max-age=31536000';
        router.replace(isGeneral ? '/launches' : '/analytics');
        return;
      }

      const text = await res.text();
      setError(text || 'SSO login failed');
    } catch (e: any) {
      setError(e.message || 'SSO login error');
    }
  };

  if (error) {
    return (
      <div className="text-center">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => router.push('/auth/login')} className="underline text-newTextColor">
          Go to login page
        </button>
      </div>
    );
  }

  return null;
}
