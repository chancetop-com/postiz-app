export interface Params {
  baseUrl: string;
  beforeRequest?: (url: string, options: RequestInit) => Promise<RequestInit>;
  afterRequest?: (
    url: string,
    options: RequestInit,
    response: Response
  ) => Promise<boolean>;
}
export const customFetch = (
  params: Params,
  auth?: string,
  showorg?: string
) => {
  return async function newFetch(url: string, options: RequestInit = {}) {
    const loggedAuth =
      typeof window === 'undefined'
        ? undefined
        : new URL(window.location.href).searchParams.get('loggedAuth');
    const newRequestObject = await params?.beforeRequest?.(url, options);
    const sessionAuth =
      typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem('auth');

    const sessionOrg =
      typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem('showorg');

    const sessionImpersonate =
      typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem('impersonate');

    const oauthRoute = url.match(/^\/auth\/oauth\/([^/?]+)(\/exists)?(?:\?|$)/);
    const oauthStateKey = oauthRoute
      ? `oauth_state:${oauthRoute[1].toUpperCase()}`
      : null;
    const oauthStateToken =
      oauthStateKey && oauthRoute?.[2] && typeof window !== 'undefined'
        ? window.sessionStorage.getItem(oauthStateKey)
        : null;

    const fetchRequest = await fetch(params.baseUrl + url, {
      ...(newRequestObject || options),
      headers: {
        ...(showorg
          ? { showorg }
          : sessionOrg
          ? { showorg: sessionOrg }
          : {}),
        ...(options.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        Accept: 'application/json',
        ...(loggedAuth ? { auth: loggedAuth } : {}),
        ...options?.headers,
        ...(auth
          ? { auth }
          : sessionAuth
          ? { auth: sessionAuth }
          : {}),
        ...(sessionImpersonate
          ? { impersonate: sessionImpersonate }
          : {}),
        ...(oauthStateToken ? { 'oauth-state-token': oauthStateToken } : {}),
      },
      // @ts-ignore
      ...(!options.next && options.cache !== 'force-cache'
        ? { cache: options.cache || 'no-store' }
        : {}),
    });

    if (oauthStateKey && typeof window !== 'undefined' && fetchRequest.ok) {
      if (oauthRoute?.[2]) {
        window.sessionStorage.removeItem(oauthStateKey);
      } else {
        const stateToken = fetchRequest.headers.get('oauth-state-token');
        if (stateToken) {
          window.sessionStorage.setItem(oauthStateKey, stateToken);
        }
      }
    }

    if (
      !params?.afterRequest ||
      (await params?.afterRequest?.(url, options, fetchRequest))
    ) {
      return fetchRequest;
    }

    // @ts-ignore
    return new Promise((res) => {}) as Response;
  };
};

export const fetchBackend = customFetch({
  get baseUrl() {
    return process.env.BACKEND_URL!;
  },
});
