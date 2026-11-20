// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';

/**
 * Ticket 09 adds the billing feedback a plain member and an admin receive for
 * the same 402: the member is told to ask an admin, the admin still gets the
 * billing action. The transport boundary is replaced; the shipped
 * `LayoutContext.afterRequest` is the code under test.
 */

const billing = vi.hoisted(() => ({
  decision: { open: vi.fn() },
}));

const fetchState = vi.hoisted(() => ({
  afterRequest: undefined as any,
}));

/**
 * Account-surface scope (ticket 06, user story 18).
 *
 * Delete-account and the permanent login switch are hidden everywhere in the
 * UI, while component source, routes and APIs stay. Admin impersonation is a
 * different feature and must keep working.
 */

let currentUser: any = {};

vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => currentUser,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: true,
    billingEnabled: false,
    isSecured: false,
    backendUrl: 'http://backend.test',
  }),
}));

vi.mock('swr', () => ({
  default: () => ({ data: [] }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(async () => ({ json: async () => [] })),
  FetchWrapperComponent: ({ children, afterRequest }: any) => {
    fetchState.afterRequest = afterRequest;
    return <>{children}</>;
  },
}));

vi.mock('@gitroom/frontend/app/(app)/auth/return.url.component', () => ({
  useReturnUrl: () => ({ getAndClear: () => undefined }),
}));

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(async () => false),
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@gitroom/react/form/input', () => ({
  Input: ({ value, placeholder }: any) => (
    <input value={value} placeholder={placeholder} readOnly />
  ),
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeCurrent: vi.fn() }),
  useDecisionModal: () => billing.decision,
}));

vi.mock('@gitroom/frontend/components/launches/import-debug-post.modal', () => ({
  ImportDebugPostModal: () => null,
}));

vi.mock('@gitroom/frontend/components/settings/authentication.component', () => ({
  default: () => <div>authentication section</div>,
}));

vi.mock('@gitroom/frontend/components/settings/email-notifications.component', () => ({
  default: () => <div>email notifications section</div>,
}));

vi.mock('@gitroom/frontend/components/settings/shortlink-preference.component', () => ({
  default: () => <div>shortlink section</div>,
}));

vi.mock('@gitroom/frontend/components/settings/metric.component', () => ({
  default: () => <div>metric section</div>,
}));

// The delete-account component itself is kept in the tree; only its entry is
// hidden. Rendering a sentinel lets the assertions prove the entry is gone
// without deleting the code under test.
vi.mock('@gitroom/frontend/components/settings/delete-account.component', () => ({
  default: () => <div>delete my account entry</div>,
}));

import { GlobalSettings } from '@gitroom/frontend/components/settings/global.settings';
import { useFaqList } from '@gitroom/frontend/components/billing/faq.component';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

beforeEach(() => {
  currentUser = {};
});

afterEach(() => {
  cleanup();
});

describe('settings page', () => {
  it('has no delete-account entry while keeping the settings sections', () => {
    currentUser = { tier: { current: 'FREE' } };
    render(<GlobalSettings />);

    expect(screen.queryByText('delete my account entry')).toBeNull();
    expect(screen.queryByText(/delete account/i)).toBeNull();
    expect(screen.getByText('authentication section')).toBeTruthy();
    expect(screen.getByText('email notifications section')).toBeTruthy();
  });
});

describe('billing FAQ', () => {
  it('no longer exposes an account deletion entry', () => {
    currentUser = { tier: { current: 'FREE' }, allowTrial: true };
    const { result } = renderHook(() => useFaqList());

    const serialized = JSON.stringify(
      result.current.map((item: any) => ({
        title: item.title,
        description: item.description,
        hasContent: !!item.content,
      }))
    );

    expect(serialized).not.toMatch(/delete.*account/i);
    expect(result.current.some((item: any) => !!item.content)).toBe(false);
  });
});

describe('admin impersonation', () => {
  it('keeps the impersonation entry for admins', () => {
    currentUser = { id: 'admin', tier: { current: 'STANDARD' }, admin: true };
    render(<Impersonate />);

    expect(screen.getByPlaceholderText('Write the user details')).toBeTruthy();
  });

  it('hides the permanent login switch but keeps the stop-impersonating control', () => {
    currentUser = {
      id: 'admin',
      tier: { current: 'STANDARD' },
      impersonate: true,
      admin: true,
    };
    const { container } = render(<Impersonate />);

    expect(screen.getByText('Currently Impersonating')).toBeTruthy();
    expect(screen.queryByText('Switch User')).toBeNull();
    expect(screen.queryByText(/Select user to switch to/i)).toBeNull();
    expect(container.textContent).not.toMatch(/replace the current account/i);
  });
});

describe('billing feedback for a 402', () => {
  const message =
    'You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels.';

  beforeEach(() => {
    billing.decision.open.mockReset();
    billing.decision.open.mockResolvedValue(true);
    vi.mocked(deleteDialog).mockReset();
    vi.mocked(deleteDialog).mockResolvedValue(false);
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = async (body: unknown) => {
    render(
      <LayoutContext>
        <div>layout child</div>
      </LayoutContext>
    );
    return fetchState.afterRequest(
      'http://backend.test/posts',
      {},
      new Response(JSON.stringify(body), { status: 402 })
    );
  };

  it('tells a plain member to ask an admin and offers no billing action', async () => {
    const handled = await request({ message, canManageBillingUi: false });

    expect(handled).toBe(true);
    expect(billing.decision.open).toHaveBeenCalledTimes(1);
    expect(billing.decision.open).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Payment Required',
        onlyApprove: true,
        approveLabel: 'OK',
        description: `${message} Please ask an admin of your organization.`,
      })
    );
    expect(deleteDialog).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps the move-to-billing action for an admin', async () => {
    vi.mocked(deleteDialog).mockResolvedValueOnce(true);

    const handled = await request({ message, canManageBillingUi: true });

    expect(handled).toBe(false);
    expect(deleteDialog).toHaveBeenCalledWith(
      message,
      'Move to billing',
      'Payment Required'
    );
    expect(window.open).toHaveBeenCalledWith('/billing', '_blank');
    expect(billing.decision.open).not.toHaveBeenCalled();
  });
});
