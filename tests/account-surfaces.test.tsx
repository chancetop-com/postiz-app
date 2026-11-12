// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';

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
  useVariables: () => ({ isGeneral: true, billingEnabled: false, isSecured: false }),
}));

vi.mock('swr', () => ({
  default: () => ({ data: [] }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(async () => ({ json: async () => [] })),
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
