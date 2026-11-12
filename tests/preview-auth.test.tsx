// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

const appRoot = join(process.cwd(), 'apps/frontend/src/app/(app)');

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

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);

// Replies to /user/self with `self`, anything else (CopilotKit probes) with an
// empty body — the shape PreviewWrapper expects from the real backend.
const stubBackend = (self: () => Promise<Response>) => {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/user/self')) {
      return self();
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', spy);
  return spy;
};

const PREVIEW_URL = 'http://localhost:4200/p/preview-1';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PreviewWrapper (anonymous preview shell)', () => {
  // Reports what the shell handed to the children: the same useUser() the real
  // preview components read.
  const renderPreview = async () => {
    const { PreviewWrapper } = await import(
      '@gitroom/frontend/components/preview/preview.wrapper'
    );
    const { useUser } = await import(
      '@gitroom/frontend/components/layout/user.context'
    );
    const UserProbe = () => {
      const user = useUser();
      return <span data-testid="user-id">{user?.id ?? 'anonymous'}</span>;
    };
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PreviewWrapper>
          <div data-testid="preview-body">
            preview body <UserProbe />
          </div>
        </PreviewWrapper>
      </SWRConfig>
    );
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
    const fetchSpy = stubBackend(async () => jsonResponse({ id: 'user-1' }));

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
    stubBackend(async () => jsonResponse({ message: 'unauthorized' }, false, 401));

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
    stubBackend(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response));

    await renderPreview();

    await expectStillAnonymous(location);
  });
});

describe('main layout user check', () => {
  it('keeps the rejected /user/self redirect that the preview must not copy', async () => {
    const location = stubLocation('http://localhost:4200/launches');
    stubBackend(async () => jsonResponse({ message: 'unauthorized' }, false, 401));

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

// The preview is anonymous because the route group sits beside the (site)
// group that installs the login gate — not inside it.
describe('public preview route placement', () => {
  it('is served from the preview group, outside the authenticated site group', () => {
    expect(existsSync(join(appRoot, '(preview)/p/[id]/page.tsx'))).toBe(true);
    expect(existsSync(join(appRoot, '(preview)/p/[id]/layout.tsx'))).toBe(true);
    expect(existsSync(join(appRoot, '(site)/p'))).toBe(false);
  });
});
