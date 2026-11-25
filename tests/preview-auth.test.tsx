// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import PreviewLayout from '@gitroom/frontend/app/(app)/(preview)/p/[id]/layout';

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock('next/font/local', () => ({
  default: () => ({ className: 'mock-font' }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
}));

interface StubLocation {
  href: string;
  pathname: string;
}

// jsdom refuses real navigation, so a redirect only becomes observable when
// the location object is replaced with something we can read back.
const stubLocation = (initial: string): StubLocation => {
  const location: StubLocation = {
    href: initial,
    pathname: new URL(initial).pathname,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).location;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).location = location;
  return location;
};

const stubBackend = (self: () => Promise<Response>) => {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/user/self')) {
      return self();
    }
    throw new Error('Unexpected request: ' + url);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
};

const PREVIEW_URL = 'http://localhost:4200/p/preview-1';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public preview layout', () => {
  // Reports what the shell handed to the children: the same useUser() the real
  // preview components read.
  const renderPreview = async () => {
    const { useUser } = await import(
      '@gitroom/frontend/components/layout/user.context'
    );
    const UserProbe = () => {
      const user = useUser();
      return <span data-testid="user-id">{user?.id ?? 'anonymous'}</span>;
    };
    const layout = await PreviewLayout({
      children: <div data-testid="preview-body">preview body <UserProbe /></div>,
    });
    const settled = vi.fn();
    render(
      <SWRConfig value={{
        provider: () => new Map(),
        onSuccess: settled,
        onError: settled,
        shouldRetryOnError: false,
      }}>
        {layout}
      </SWRConfig>
    );
    await waitFor(() => expect(settled).toHaveBeenCalled());
  };

  const expectStillAnonymous = async (location: StubLocation) => {
    await waitFor(() =>
      expect(screen.getByTestId('user-id').textContent).toBe('anonymous')
    );
    expect(screen.getByTestId('preview-body')).toBeTruthy();
    expect(location.href).toBe(PREVIEW_URL);
  };

  it('renders its children with the signed-in user when /user/self succeeds', async () => {
    const location = stubLocation(PREVIEW_URL);
    const fetchSpy = stubBackend(async () => Response.json({ id: 'user-1' }));

    await renderPreview();

    await waitFor(() =>
      expect(screen.getByTestId('user-id').textContent).toBe('user-1')
    );
    expect(screen.getByTestId('preview-body')).toBeTruthy();
    expect(
      fetchSpy.mock.calls.map(([input]) => String(input))
    ).toContain('/user/self');
    expect(location.href).toBe(PREVIEW_URL);
  });

  it('renders its children when /user/self is rejected', async () => {
    const location = stubLocation(PREVIEW_URL);
    stubBackend(async () => new Response(null, { status: 401 }));

    await renderPreview();

    await expectStillAnonymous(location);
  });

  it('renders its children when /user/self cannot be reached', async () => {
    const location = stubLocation(PREVIEW_URL);
    stubBackend(async () => {
      throw new TypeError('fetch failed');
    });

    await renderPreview();

    await expectStillAnonymous(location);
  });

  it('renders its children when /user/self is not JSON', async () => {
    const location = stubLocation(PREVIEW_URL);
    stubBackend(async () => new Response('<html>gateway</html>'));

    await renderPreview();

    await expectStillAnonymous(location);
  });
});

describe('main layout user check', () => {
  it('keeps the rejected /user/self redirect that the preview must not copy', async () => {
    const location = stubLocation('http://localhost:4200/launches');
    stubBackend(async () => new Response(null, { status: 401 }));

    const { LayoutComponent } = await import(
      '@gitroom/frontend/components/new-layout/layout.component'
    );
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LayoutComponent>
          <div data-testid="app-body">app body</div>
        </LayoutComponent>
      </SWRConfig>
    );

    await waitFor(() => expect(location.href).toBe('/auth/login'));
    expect(screen.queryByTestId('app-body')).toBeNull();
  });
});
