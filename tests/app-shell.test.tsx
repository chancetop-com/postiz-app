// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Server-rendered app shell (ticket 06, user story 30).
 *
 * Every page below the main layout - calendar, analytics, billing, settings -
 * inherits this body class. The fork ships `light` here so a browser with no
 * `mode` cookie paints the light theme before the client toggle mounts.
 */

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ name: 'lang', value: 'en' }),
  }),
}));

vi.mock('@gitroom/frontend/fonts/plus-jakarta-sans/plus.jakarta.sans.font', () => ({
  jakartaSans: { className: 'font-jakarta' },
}));

vi.mock('next-plausible', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('next/script', () => ({ default: () => null }));

vi.mock('@gitroom/frontend/components/layout/sentry.component', () => ({
  SentryComponent: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/frontend/components/layout/layout.context', () => ({
  default: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  VariableContextComponent: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/helpers/utils/utm.saver', () => ({ default: () => null }));
vi.mock('@gitroom/frontend/components/layout/dubAnalytics', () => ({
  DubAnalytics: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/facebook.component', () => ({
  FacebookComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/gtm.component', () => ({
  GoogleTagManagerComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/html.component', () => ({
  HtmlComponent: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/frontend/components/new-layout/change.dir.client', () => ({
  ChangeDirClient: () => null,
}));
vi.mock('@gitroom/react/translation/i18n.config', () => ({
  cookieName: 'lang',
  fallbackLng: 'en',
}));

import AppLayout from '@gitroom/frontend/app/(app)/layout';

describe('app shell', () => {
  it('renders the light theme and the local font by default', async () => {
    const html = renderToStaticMarkup(
      (await AppLayout({ children: <div>page</div> })) as React.ReactElement
    );

    expect(html).toContain('font-jakarta');
    expect(html).toMatch(/<body[^>]*class="[^"]*\blight\b/);
    expect(html).not.toMatch(/<body[^>]*class="[^"]*\bdark\b/);
    expect(html).toContain('page');
  });
});
