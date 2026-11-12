// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import ModeComponent, {
  modeEmitter,
} from '@gitroom/frontend/components/layout/mode.component';
import { NoMediaIcon } from '@gitroom/frontend/components/ui/icons';
import SsoLayout from '@gitroom/frontend/app/(app)/sso/layout';

/**
 * Brand and theme contract for the merged frontend (ticket 06).
 *
 * Covers: the new-layout PNG brand mark at 32x32, default light theme with a
 * working dark toggle, the light-only SSO layout, and the light empty-media art
 * that calendar/analytics/billing/media all share.
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
  it('renders the fork PNG logo at 32x32', () => {
    render(<Logo />);
    const img = screen.getByAltText('Logo') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/logo-postiz.png');
    expect(img.style.width).toBe('32px');
    expect(img.style.height).toBe('32px');
  });

  it('ships a decodable PNG asset for the main layout', () => {
    const file = path.resolve(
      import.meta.dirname,
      '../apps/frontend/public/logo-postiz.png'
    );
    const buffer = fs.readFileSync(file);
    // PNG signature + IHDR: the layout forces a 32x32 box, so the source has to
    // stay a valid image rather than a placeholder.
    expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR');
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
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

describe('empty media state', () => {
  it('uses the light illustration by default', () => {
    const { container } = render(<NoMediaIcon />);
    expect(container.querySelector('svg path[stroke="#DACBFB"]')).toBeTruthy();
    expect(container.querySelector('svg path[stroke="white"]')).toBeNull();
  });

  it('follows the dark cookie when the user switched', () => {
    document.cookie = 'mode=dark;path=/';
    const { container } = render(<NoMediaIcon />);
    expect(container.querySelector('svg path[stroke="white"]')).toBeTruthy();
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
