import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ORG_INVITE_HEADER } from '@gitroom/helpers/auth/org.invite';

/**
 * Browser clients keep `auth`, `showorg` and `impersonate` in the current
 * tab's sessionStorage instead of relying on cookies. They must be allowed on
 * requests and readable from responses even when the backend is on another
 * origin. App startup passes this same object to Nest, so the list has one
 * source for every deployment.
 */
export const getCorsOptions = (): CorsOptions => ({
  ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'auth',
    'showorg',
    'impersonate',
    'oauth-state-token',
    ORG_INVITE_HEADER,
    'x-postiz-org',
    'x-postiz-include-deleted',
    'x-copilotkit-runtime-client-gql-version',
  ],
  exposedHeaders: [
    'reload',
    'onboarding',
    'activate',
    'auth',
    'showorg',
    'impersonate',
    'logout',
    'oauth-state',
    'oauth-state-token',
    'x-copilotkit-runtime-client-gql-version',
  ],
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:6274',
    ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
    // Optional: the Canva app calls the public API from its iframe origin
    // (browsers send it lowercase, e.g. https://app-aabbcc.canva-apps.com)
    ...(process.env.CANVA_APP_ORIGIN
      ? [
          process.env.CANVA_APP_ORIGIN.trim()
            .replace(/\/+$/, '')
            .toLowerCase(),
        ]
      : []),
  ],
});
