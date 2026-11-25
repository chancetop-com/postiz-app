// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

// The Next route calls the backend over the internal HTTP client, which needs
// a request scope for cookies(). Everything below that boundary is the real
// route: the URLs it asks for, the payload it accepts, the tree it renders.
vi.mock('@gitroom/helpers/utils/internal.fetch', () => ({
  internalFetch: vi.fn(),
}));

vi.mock('next/font/local', () => ({
  default: () => ({ className: 'mock-font' }),
}));

import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  organizationId: 'org-1',
  publishDate: '2026-11-01T10:00:00.000Z',
  content: '<p>Hello <strong>world</strong></p>',
  image: '[]',
  creationMethod: 'WEB',
  integration: {
    name: 'Acme Studio',
    profile: 'acme',
    picture: 'https://cdn.example.invalid/avatar.png',
    providerIdentifier: 'x',
  },
  ...overrides,
});

const renderRoute = async (searchParams: Record<string, string> = {}) => {
  const page = await import(
    '@gitroom/frontend/app/(app)/(preview)/p/[id]/page'
  );
  const tree = await page.default({
    params: Promise.resolve({ id: 'preview-1' }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(tree);
};

beforeEach(() => {
  vi.mocked(internalFetch).mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public preview route', () => {
  it('renders the posts returned for the requested preview in order', async () => {
    vi.mocked(internalFetch).mockResolvedValue(
      Response.json([
        post(),
        post({ id: 'post-2', content: '<p>Second post</p>' }),
      ])
    );

    await renderRoute();

    expect(internalFetch).toHaveBeenCalledWith('/public/posts/preview-1');

    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hello world[\s\S]*Second post/)
    );
    expect(document.body.textContent).toContain('Acme Studio');
    expect(document.body.textContent).toContain('@acme');
  });

  it('renders the inline comment panel of a valid preview', async () => {
    vi.mocked(internalFetch).mockResolvedValue(Response.json([post()]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ comments: [] }),
      }))
    );

    await renderRoute();

    await waitFor(() =>
      expect(document.body.textContent).toContain('Comments')
    );
  });

  it('renders the media of a valid preview', async () => {
    vi.mocked(internalFetch).mockResolvedValue(
      Response.json([
        post({
          image: JSON.stringify([
            { name: 'one', path: 'https://cdn.example.invalid/one.png' },
            { name: 'two', path: 'https://cdn.example.invalid/two.jpg' },
          ]),
        }),
      ])
    );

    const { container } = await renderRoute();

    await waitFor(() =>
      expect(
        container.querySelectorAll('img[src^="https://cdn.example.invalid/"]')
          .length
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it('sanitises the post content the backend returned', async () => {
    vi.mocked(internalFetch).mockResolvedValue(
      Response.json([
        post({
          content:
            '<div>First line</div>' +
            '<script>alert("xss")</script>' +
            '<img src="javascript:alert(1)" onerror="alert(2)" />' +
            '<p>Safe <a href="https://example.invalid/post">link</a></p>',
        }),
      ])
    );

    const { container } = await renderRoute();

    await waitFor(() =>
      expect(document.body.textContent).toContain('First line')
    );
    const rendered = container.innerHTML;
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('javascript:alert');
    expect(rendered).not.toContain('onerror');
    expect(document.body.textContent).toContain('Safe link');
  });

  it.each([
    [
      'a rejected request with a valid-looking post',
      () => Response.json([post()], { status: 404 }),
    ],
    [
      'a network failure',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
    ['an invalid JSON body', () => new Response('<html>gateway</html>')],
    ['a non-array body', () => Response.json({ data: [] })],
    ['an empty array', () => Response.json([])],
  ])('shows the Post not found fallback for %s', async (_label, reply) => {
    vi.mocked(internalFetch).mockImplementationOnce(async () => reply());

    await renderRoute();

    await waitFor(() =>
      expect(document.body.textContent).toContain('Post not found')
    );
  });
});
