import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

export async function proxy(request: NextRequest) {
  const nextUrl = request.nextUrl;
  const lng = request.cookies.has(cookieName)
    ? acceptLanguage.get(request.cookies.get(cookieName).value)
    : acceptLanguage.get(
        request.headers.get('Accept-Language') ||
          request.headers.get('accept-language')
      );

  const requestHeaders = new Headers(request.headers);
  if (lng) {
    requestHeaders.set(headerName, lng);
  }

  const topResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (lng) {
    topResponse.headers.set(cookieName, lng);
  }

  // Login providers share callback URLs with channel binding/settings. Route
  // only login callbacks to the client exchange, which has sessionStorage.
  const loginState = nextUrl.searchParams.get('state');
  if (
    loginState?.startsWith('login-') &&
    (nextUrl.searchParams.has('code') || nextUrl.searchParams.has('error'))
  ) {
    const provider =
      nextUrl.pathname === '/integrations/social/youtube'
        ? 'GOOGLE'
        : nextUrl.pathname === '/settings'
        ? process.env.IS_GENERAL && process.env.POSTIZ_GENERIC_OAUTH
          ? 'GENERIC'
          : 'GITHUB'
        : null;
    if (provider) {
      const callback = new URL('/auth', nextUrl.href);
      callback.search = nextUrl.search;
      callback.searchParams.set('provider', provider);
      return NextResponse.redirect(callback);
    }
  }

  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/provider/') ||
    nextUrl.pathname.startsWith('/icons/') ||
    // the consent screen of MCP / OAuth clients handles signed-out visitors
    // itself (sign in and come back, or connect a self-hosted instance)
    nextUrl.pathname.startsWith('/oauth/authorize')
  ) {
    return topResponse;
  }

  if (
    nextUrl.pathname.startsWith('/integrations/social/') &&
    nextUrl.href.indexOf('state=login') === -1
  ) {
    return topResponse;
  }

  // Clear any legacy auth cookie and redirect to login
  if (nextUrl.href.indexOf('/auth/logout') > -1) {
    const response = NextResponse.redirect(
      new URL('/auth/login', nextUrl.href)
    );
    response.cookies.set('auth', '', {
      path: '/',
      maxAge: -1,
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    });
    return response;
  }

  if (
    nextUrl.pathname.startsWith('/auth/register') &&
    process.env.DISABLE_REGISTRATION === 'true'
  ) {
    return NextResponse.redirect(new URL('/auth/login', nextUrl.href));
  }

  const org = nextUrl.searchParams.get('org');

  try {
    if (org && !nextUrl.pathname.startsWith('/auth')) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({ org }),
          method: 'POST',
        })
      ).json();
      const redirect = NextResponse.redirect(
        new URL(`/?added=true`, nextUrl.href)
      );
      if (id) {
        redirect.cookies.set('showorg', id, {
          expires: new Date(Date.now() + 15 * 60 * 1000),
        });
      }
      return redirect;
    }

    if (nextUrl.pathname === '/') {
      return NextResponse.redirect(
        new URL(
          !!process.env.IS_GENERAL ? '/launches' : `/analytics`,
          nextUrl.href
        )
      );
    }

    return topResponse;
  } catch (err) {
    console.log('err', err);
    return NextResponse.redirect(new URL('/auth/logout', nextUrl.href));
  }
}

export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};
