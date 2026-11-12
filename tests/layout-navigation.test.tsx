// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Navigation scope for the merged frontend (ticket 06, user story 31/32).
 *
 * The fork hides Agent and Settings in both the desktop sidebar and the mobile
 * drawer. Upstream moved Plugs/Integrations into Settings, so the top-level
 * entries must not come back. Everything is asserted on rendered output: the
 * same `TopMenu` feeds the desktop rail and the mobile drawer, and the main
 * layout test proves the logo survives in both containers.
 */

const currentUser: any = {
  id: 'user-1',
  orgId: 'org-1',
  role: 'ADMIN',
  tier: 'PRO',
  admin: false,
  isLifetime: false,
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/launches',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('swr', () => ({
  default: () => ({ data: currentUser, mutate: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/helpers/mantine.wrapper', () => ({
  MantineWrapper: ({ children }: any) => <>{children}</>,
}));

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children }: any) => <>{children}</>,
}));

vi.mock(
  '@gitroom/frontend/fonts/plus-jakarta-sans/plus.jakarta.sans.font',
  () => ({ jakartaSans: { className: 'font-jakarta' } })
);

vi.mock('@gitroom/react/sentry/initialize.sentry.client', () => ({
  setSentryUser: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  setUserTimezone: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/layout/check.payment', () => ({
  CheckPayment: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/frontend/components/layout/continue.provider', () => ({
  ContinueProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/frontend/components/layout/top.tip', () => ({
  ToolTip: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/new.subscription', () => ({
  NewSubscription: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/support', () => ({
  Support: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/impersonate', () => ({
  Impersonate: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/announcement.banner', () => ({
  AnnouncementBanner: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/title', () => ({
  Title: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/language.component', () => ({
  LanguageComponent: () => null,
}));
vi.mock(
  '@gitroom/frontend/components/layout/chrome.extension.component',
  () => ({ ChromeExtensionComponent: () => null })
);
vi.mock('@gitroom/frontend/components/layout/organization.selector', () => ({
  OrganizationSelector: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/invoices.component', () => ({
  InvoicesComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/streak.component', () => ({
  StreakComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/pre-condition.component', () => ({
  PreConditionComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/new-layout/sentry.feedback.component', () => ({
  AttachToFeedbackIcon: () => null,
}));
vi.mock('@gitroom/frontend/components/billing/first.billing.component', () => ({
  FirstBillingComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/gtm.component', () => ({
  TrialTracker: () => null,
}));
vi.mock('@gitroom/frontend/components/notifications/notification.component', () => ({
  default: () => null,
}));
vi.mock('@gitroom/frontend/components/media/media.component', () => ({
  ShowMediaBoxModal: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/linkedin.component', () => ({
  ShowLinkedinCompany: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/media.settings.component', () => ({
  MediaSettingsLayout: () => null,
}));
vi.mock('@gitroom/frontend/components/post-url-selector/post.url.selector', () => ({
  ShowPostSelector: () => null,
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  Toaster: () => null,
}));

import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { UserContext } from '@gitroom/frontend/components/layout/user.context';
import { LayoutComponent } from '@gitroom/frontend/components/new-layout/layout.component';

afterEach(() => {
  cleanup();
});

const renderMenu = () =>
  render(
    <UserContext.Provider value={currentUser}>
      <TopMenu />
    </UserContext.Provider>
  );

describe('menu entries', () => {
  it('keeps Agent and Settings out of the rendered menu', () => {
    renderMenu();

    expect(screen.queryByText('Agent')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.queryByText('Integrations')).toBeNull();
    expect(screen.queryByText('Plugs')).toBeNull();
  });

  it('keeps the remaining top-level entries', () => {
    renderMenu();

    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('Analytics')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
  });
});

describe('main layout', () => {
  const renderLayout = () =>
    render(
      <LayoutComponent>
        <div>page content</div>
      </LayoutComponent>
    );

  it('renders the 32x32 PNG mark in the desktop rail', () => {
    renderLayout();

    const logo = screen.getByAltText('Logo') as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/logo-postiz.png');
    expect(logo.style.width).toBe('32px');
    expect(logo.style.height).toBe('32px');
    // The mark must keep its box when the flex container is squeezed.
    expect(logo.style.minWidth).toBe('32px');
    expect(logo.style.minHeight).toBe('32px');
    expect(logo.closest('.w-\\[80px\\]')).toBeTruthy();
  });

  it('keeps the mark inside the mobile drawer container', () => {
    renderLayout();

    const logo = screen.getByAltText('Logo');
    const drawer = logo.closest('[class*="mobile:fixed"]') as HTMLElement;
    expect(drawer).toBeTruthy();
    expect(drawer.className).toContain('mobile:bottom-0');
    expect(drawer.className).toContain('mobile:hidden');
  });

  it('opens the mobile drawer with the same hidden menu', () => {
    renderLayout();

    const toggle = screen.getByLabelText('Open menu');
    fireEvent.click(toggle);

    const logo = screen.getByAltText('Logo');
    const drawer = logo.closest('[class*="mobile:fixed"]') as HTMLElement;
    expect(drawer.className).not.toContain('mobile:hidden');
    expect(drawer.textContent).toContain('Calendar');
    expect(drawer.textContent).not.toContain('Agent');
    expect(drawer.textContent).not.toContain('Settings');
  });
});
