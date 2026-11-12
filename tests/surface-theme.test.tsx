// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Analytics and billing surfaces (ticket 06, user story 30).
 *
 * Both components used to default to the dark palette and now default to light
 * while still following the user's `mode` cookie. The chart/stripe libraries are
 * the external boundary, so they are replaced; the assertions are on the
 * rendered component output and the options it hands to those libraries.
 */

const chartOptions: any[] = [];

vi.mock('chart.js/auto', () => ({
  default: class {
    constructor(_element: unknown, options: unknown) {
      chartOptions.push(options);
    }
    destroy() {}
  },
}));

let checkoutOptions: any = null;

vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ options, children }: any) => {
    checkoutOptions = options;
    return <div>checkout provider{children}</div>;
  },
  PaymentElement: () => <input aria-label="card number" />,
  BillingAddressElement: () => null,
  useCheckout: () => ({}),
}));

vi.mock('@stripe/stripe-js', () => ({}));

import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { EmbeddedBilling } from '@gitroom/frontend/components/billing/embedded.billing';

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
  chartOptions.length = 0;
  checkoutOptions = null;
  // jsdom has no canvas backend; the component only needs a gradient factory.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  })) as any;
});

afterEach(() => {
  cleanup();
});

describe('analytics chart', () => {
  const data = [
    { date: '2026-11-01', total: 1 },
    { date: '2026-11-02', total: 3 },
  ];

  it('paints a light tooltip by default and follows the dark toggle', () => {
    const { unmount } = render(<ChartSocial data={data} />);
    expect(chartOptions.at(-1).options.plugins.tooltip.backgroundColor).toBe(
      '#fff'
    );
    unmount();

    document.cookie = 'mode=dark;path=/';
    render(<ChartSocial data={data} />);
    expect(chartOptions.at(-1).options.plugins.tooltip.backgroundColor).toBe(
      '#1e1d1d'
    );
  });
});

describe('billing page', () => {
  const stripe = Promise.resolve({} as any);

  it('uses the light stripe appearance by default and follows the dark toggle', () => {
    const { unmount } = render(
      <EmbeddedBilling stripe={stripe} secret="secret_1" />
    );
    expect(screen.getByText('checkout provider')).toBeTruthy();
    expect(
      checkoutOptions.elementsOptions.appearance.variables.colorText
    ).toBe('#0e0e0e');
    unmount();

    document.cookie = 'mode=dark;path=/';
    render(<EmbeddedBilling stripe={stripe} secret="secret_1" />);
    expect(
      checkoutOptions.elementsOptions.appearance.variables.colorText
    ).toBe('#ffffff');
  });
});
