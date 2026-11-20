'use client';

/**
 * Organization invitations are tab-scoped.
 *
 * The link carries a server-signed token ("/?org=<token>"). A Next proxy
 * cannot read this fork's sessionStorage session, so it only forwards the
 * token to the client. The client keeps it in this tab's sessionStorage,
 * next to auth/showorg/impersonate, and returns it as the `org-invite` request
 * header. The API verifies the signature, role and expiry; the browser never
 * sends an unsigned organization id. Because no cookie is shared, accepting in
 * one tab cannot move another tab to the invited organization.
 */
import {
  ORG_INVITE_KEY,
  ORG_INVITE_HEADER,
} from '@gitroom/helpers/auth/org.invite';

export { ORG_INVITE_KEY, ORG_INVITE_HEADER };

const sessionStorageOrNull = () =>
  typeof window === 'undefined' ? null : window.sessionStorage;

export function readOrgInvite() {
  return sessionStorageOrNull()?.getItem(ORG_INVITE_KEY) || null;
}

export function saveOrgInvite(invite: string | null | undefined) {
  const storage = sessionStorageOrNull();
  if (!storage) return;
  if (invite) {
    storage.setItem(ORG_INVITE_KEY, invite);
  }
}

export function clearOrgInvite() {
  sessionStorageOrNull()?.removeItem(ORG_INVITE_KEY);
}

export function orgInviteHeaders(
  invite = readOrgInvite()
): Record<string, string> {
  return invite ? { [ORG_INVITE_HEADER]: invite } : {};
}
