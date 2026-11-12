import { OAuthAuthorize } from '@gitroom/frontend/components/oauth/authorize.component';

export const dynamic = 'force-dynamic';

// signed-out visitors get the page too (sign in, or use self-hosted)
export default function OAuthAuthorizePage() {
  return <OAuthAuthorize />;
}
