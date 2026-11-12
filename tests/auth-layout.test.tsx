// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Login surface (ticket 06, user story 29/30).
 *
 * The fork replaced the hardcoded dark auth shell with theme tokens. Upstream
 * added the MantineWrapper / Toaster / font plumbing around it. Both have to be
 * present in the rendered layout: local theme classes *and* the upstream
 * wrappers.
 */

vi.mock('@gitroom/react/translation/get.translation.service.backend', () => ({
  getT: async () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/helpers/mantine.wrapper', () => ({
  MantineWrapper: ({ children }: any) => (
    <div data-testid="mantine-wrapper">{children}</div>
  ),
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@gitroom/frontend/components/ui/logo-text.component', () => ({
  LogoTextComponent: () => <span>logo text</span>,
}));

vi.mock('@gitroom/frontend/components/auth/testimonial.component', () => ({
  TestimonialComponent: () => <div>testimonial</div>,
}));

import AuthLayout from '@gitroom/frontend/app/(app)/auth/layout';

describe('auth layout', () => {
  it('renders the local theme classes inside the upstream wrappers', async () => {
    const html = renderToStaticMarkup(
      (await AuthLayout({
        children: <div>login form</div>,
      })) as React.ReactElement
    );

    expect(html).toContain('data-testid="mantine-wrapper"');
    expect(html).toContain('data-testid="toaster"');
    expect(html).toContain('login form');
    expect(html).toContain('logo text');
    expect(html).toContain('testimonial');

    // Local theme contract: tokenised shell instead of the old hardcoded black.
    expect(html).toContain('bg-primary');
    expect(html).toContain('bg-secondary');
    expect(html).toContain('text-textColor');
    expect(html).not.toContain('bg-black');
  });
});
