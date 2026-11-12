// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

// The Next route calls the backend over the internal HTTP client, which needs
// a request scope for cookies(). Everything below that boundary is the real
// route: the URLs it asks for, the payload it accepts, the tree it renders.
const backend = {
  ok: true,
  status: 200,
  body: [] as unknown,
  json: async () => backend.body,
};

vi.mock('@gitroom/helpers/utils/internal.fetch', () => ({
  internalFetch: vi.fn(async () => backend),
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
  backend.ok = true;
  backend.status = 200;
  backend.body = [];
  vi.mocked(internalFetch).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public preview route', () => {
  it('asks the backend for the public posts of the preview', async () => {
    backend.body = [post()];

    await renderRoute();

    expect(internalFetch).toHaveBeenCalledWith('/public/posts/preview-1');
  });

  it('renders the post of a valid preview with the retained preview chrome', async () => {
    backend.body = [post()];

    const { container } = await renderRoute();

    await waitFor(() =>
      expect(document.body.textContent).toContain('Hello world')
    );
    expect(document.body.textContent).toContain('Acme Studio');
    expect(document.body.textContent).toContain('@acme');
    // the preview keeps its own brand, width and share affordances
    expect(container.querySelector('img[src="/postiz.svg"]')).toBeTruthy();
    expect(container.querySelector('.max-w-\\[1346px\\]')).toBeTruthy();
  });

  it('renders the inline comment panel of a valid preview', async () => {
    backend.body = [post()];
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
    backend.body = [
      post({
        image: JSON.stringify([
          { name: 'one', path: 'https://cdn.example.invalid/one.png' },
          { name: 'two', path: 'https://cdn.example.invalid/two.jpg' },
        ]),
      }),
    ];

    const { container } = await renderRoute();

    await waitFor(() =>
      expect(
        container.querySelectorAll('img[src^="https://cdn.example.invalid/"]')
          .length
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it('sanitises the post content the backend returned', async () => {
    backend.body = [
      post({
        content:
          '<div>First line</div>' +
          '<script>alert("xss")</script>' +
          '<img src="javascript:alert(1)" onerror="alert(2)" />' +
          '<p>Safe <a href="https://example.invalid/post">link</a></p>',
      }),
    ];

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
    ['a rejected request', () => {
      backend.ok = false;
      backend.status = 404;
      backend.body = { message: 'This preview does not exist' };
    }],
    ['a network failure', () => {
      vi.mocked(internalFetch).mockImplementationOnce(async () => {
        throw new TypeError('fetch failed');
      });
    }],
    ['an invalid JSON body', () => {
      vi.mocked(internalFetch).mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      }));
    }],
    ['a non-array body', () => {
      backend.body = { data: [] };
    }],
    ['an empty array', () => {
      backend.body = [];
    }],
  ])('shows the Post not found fallback for %s', async (_label, arrange) => {
    arrange();

    const { container } = await renderRoute();

    await waitFor(() =>
      expect(document.body.textContent).toContain('Post not found')
    );
    expect(container.querySelector('.max-w-\\[1346px\\]')).toBeNull();
  });
});
