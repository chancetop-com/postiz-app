// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

/**
 * Ticket 05: the Copilot surfaces each pass identity their own way.
 *
 * The main layout and the Agent chat pass auth/showorg as explicit headers but
 * leave out impersonate; the public preview passes nothing and relies on the
 * cookie (`credentials="include"`). These are the established per-surface
 * behaviours the merge keeps, not one unified policy.
 */

const captured: any[] = [];

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: (props: any) => {
    captured.push(props);
    return <>{props.children}</>;
  },
  useCopilotAction: () => {},
  useCopilotMessagesContext: () => ({
    messages: [],
    setMessages: vi.fn(),
  }),
}));

vi.mock('@copilotkit/react-ui', () => ({
  CopilotChat: () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'new' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    backendUrl: 'http://api',
    isGeneral: false,
    billingEnabled: false,
    storageProvider: 'local',
    transloadit: [],
    mediaProcessing: false,
    disableImageCompression: true,
  }),
}));

vi.mock('@gitroom/frontend/components/agents/agent', () => ({
  PropertiesContext: React.createContext({ properties: [] }),
  MediaPortal: () => null,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeModal: vi.fn() }),
  ModalManager: ({ children }: any) => <>{children}</>,
}));

vi.mock('@gitroom/frontend/components/agents/agent.input', () => ({
  Input: () => null,
}));

vi.mock('@gitroom/frontend/components/new-launch/add.edit.modal', () => ({
  AddEditModal: () => null,
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.existing.data', () => ({
  ExistingDataContextProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  fromUtc: (value: unknown) => value,
  newDayjs: () => ({}),
  setUserTimezone: vi.fn(),
  setTimezone: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'id',
}));

vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: () => false,
}));

vi.mock('@gitroom/frontend/components/layout/organization.selector', () => ({
  OrganizationSelector: () => null,
}));

vi.mock('next/font/local', () => ({
  default: () => ({ className: 'mock-font' }),
}));

vi.mock('@gitroom/react/helpers/mantine.wrapper', () => ({
  MantineWrapper: ({ children }: any) => <>{children}</>,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [] }),
  })),
}));

const json = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);

const seed = () => {
  window.sessionStorage.setItem('auth', 'jwt-a');
  window.sessionStorage.setItem('showorg', 'org-a');
  window.sessionStorage.setItem('impersonate', 'imp-a');
};

beforeEach(() => {
  captured.length = 0;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ id: 'user-1', orgId: 'org-a', tier: 'FREE' }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('main layout Copilot', () => {
  it('passes auth/showorg headers and leaves impersonate to the request fetch', async () => {
    seed();
    const { LayoutComponent } = await import(
      '@gitroom/frontend/components/new-layout/layout.component'
    );

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LayoutComponent>
          <div>app</div>
        </LayoutComponent>
      </SWRConfig>
    );

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const props = captured[0];
    expect(props.credentials).toBe('include');
    expect(props.runtimeUrl).toBe('http://api/copilot/chat');
    // ticket 12: the upstream single-endpoint mode stays on for the main chat
    expect(props.useSingleEndpoint).toBe(true);
    expect(props.headers).toEqual({ auth: 'jwt-a', showorg: 'org-a' });
    expect(props.headers.impersonate).toBeUndefined();
  });

  it('waits for /user/self before rendering or redirecting', async () => {
    window.sessionStorage.setItem('auth', 'jwt-a');
    let settle: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await pending;
        return json({ id: 'user-1', orgId: 'org-a', tier: 'FREE' });
      })
    );
    const { screen } = await import('@testing-library/react');
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

    // the shell stays empty while the identity check is in flight
    expect(screen.queryByTestId('app-body')).toBeNull();
    expect(window.location.pathname).toBe('/');

    settle(undefined);
    await waitFor(() => expect(screen.getByTestId('app-body')).toBeTruthy());
  });
});

describe('Agent Copilot', () => {
  it('passes the same auth/showorg headers to the agent runtime', async () => {
    seed();
    const { AgentChat } = await import(
      '@gitroom/frontend/components/agents/agent.chat'
    );

    render(<AgentChat />);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const props = captured[0];
    expect(props.runtimeUrl).toBe('http://api/copilot/agent');
    expect(props.credentials).toBe('include');
    expect(props.useSingleEndpoint).toBe(true);
    expect(props.headers).toEqual({ auth: 'jwt-a', showorg: 'org-a' });
    expect(props.headers.impersonate).toBeUndefined();
  });
});

describe('preview Copilot', () => {
  it('passes no explicit headers and keeps cookie credentials', async () => {
    seed();
    const { PreviewWrapper } = await import(
      '@gitroom/frontend/components/preview/preview.wrapper'
    );

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PreviewWrapper>
          <div>preview</div>
        </PreviewWrapper>
      </SWRConfig>
    );

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const props = captured[0];
    expect(props.credentials).toBe('include');
    expect(props.useSingleEndpoint).toBe(true);
    expect(props.headers).toBeUndefined();
  });
});
