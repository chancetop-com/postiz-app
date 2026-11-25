// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import sharp from 'sharp';
import path from 'node:path';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import ModeComponent, {
  modeEmitter,
} from '@gitroom/frontend/components/layout/mode.component';
import SsoLayout from '@gitroom/frontend/app/(app)/sso/layout';

/**
 * Brand and theme contract for the merged frontend (ticket 06).
 *
 * Covers: the new-layout PNG brand mark at 32x32, default light theme with a
 * working dark toggle, and the light-only SSO layout.
 */

const clearCookies = () => {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=;path=/;max-age=0`;
    }
  }
};

beforeEach(() => {
  clearCookies();
  document.body.className = '';
});

afterEach(() => {
  cleanup();
  modeEmitter.removeAllListeners();
});

describe('brand mark', () => {
  it('renders the 32px brand mark with a readable PNG from the public directory', async () => {
    render(<Logo />);
    const img = screen.getByAltText('Logo') as HTMLImageElement;
    const src = img.getAttribute('src');
    expect(src).toBe('/logo-postiz.png');
    expect(img.style.width).toBe('32px');
    expect(img.style.height).toBe('32px');

    const file = path.join(import.meta.dirname, '../apps/frontend/public', src!);
    const { info } = await sharp(file).toBuffer({ resolveWithObject: true });
    expect(info.format).toBe('png');
  });
});

describe('default theme', () => {
  it('is light without a mode cookie and still allows switching to dark', () => {
    const { container } = render(<ModeComponent />);
    const toggle = container.firstElementChild as HTMLElement;

    expect(document.body.classList.contains('light')).toBe(true);
    expect(document.body.classList.contains('dark')).toBe(false);

    fireEvent.click(toggle);
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(document.cookie).toContain('mode=dark');

    fireEvent.click(toggle);
    expect(document.body.classList.contains('light')).toBe(true);
  });

  it('honours an existing dark cookie on load', () => {
    document.cookie = 'mode=dark;path=/';
    render(<ModeComponent />);
    expect(document.body.classList.contains('dark')).toBe(true);
  });
});

describe('SSO surface', () => {
  it('keeps the SSO page on the light layout', () => {
    render(
      <SsoLayout>
        <div>sso child</div>
      </SsoLayout>
    );
    const wrapper = screen.getByText('sso child').parentElement as HTMLElement;
    expect(wrapper.className).toContain('light');
    expect(wrapper.className).toContain('bg-white');
    expect(wrapper.className).not.toContain('dark');
  });
});
