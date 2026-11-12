import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ticket 12: MCP is an optional service.
 *
 * `apps/backend/src/main.ts` is imported as-is so the shipped
 * `startMcp(app).catch(...)` line is the code under test. Nest, the app module,
 * configuration checking and MCP are replaced; everything else (the argument
 * parsing, the order of the boot sequence, the process-level rejection handler)
 * is the real file.
 */

const state = vi.hoisted(() => ({
  startMcp: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({
  initializeSentry: vi.fn(),
}));

vi.mock('@temporalio/worker', () => ({
  Runtime: { install: vi.fn() },
}));

vi.mock('@gitroom/helpers/swagger/load.swagger', () => ({
  loadSwagger: vi.fn(),
}));

vi.mock('@gitroom/backend/app.module', () => ({
  AppModule: class AppModule {},
}));

vi.mock(
  '@gitroom/backend/services/auth/permissions/subscription.exception',
  () => ({
    SubscriptionExceptionFilter: class SubscriptionExceptionFilter {},
  })
);

vi.mock('@gitroom/backend/api/routes/posts.validation.exception', () => ({
  PostValidationExceptionFilter: class PostValidationExceptionFilter {},
}));

vi.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({
  HttpExceptionFilter: class HttpExceptionFilter {},
}));

vi.mock('@gitroom/helpers/configuration/configuration.checker', () => ({
  ConfigurationChecker: class ConfigurationChecker {
    readEnvFromProcess() {}
    check() {}
    hasIssues() {
      return false;
    }
    getIssues() {
      return [];
    }
    getIssuesCount() {
      return 0;
    }
  },
}));

vi.mock('@gitroom/nestjs-libraries/chat/start.mcp', () => ({
  startMcp: state.startMcp,
}));

const originalEnv = { ...process.env };
const cleanups: (() => void)[] = [];

beforeEach(() => {
  state.startMcp.mockReset();
  process.env.FRONTEND_URL = 'http://localhost:4200';
  delete process.env.MAIN_URL;
  delete process.env.NOT_SECURED;
  delete process.env.PORT;
});

afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.();
  }
  process.env = { ...originalEnv };
});

type Boot = {
  app: any;
  create: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  log: ReturnType<typeof vi.spyOn>;
  consoleLog: ReturnType<typeof vi.spyOn>;
  addedRejectionListeners: Function[];
};

const bootMain = async (): Promise<Boot> => {
  vi.resetModules();

  const { Logger } = await import('@nestjs/common');
  const error = vi.spyOn(Logger, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(Logger, 'log').mockImplementation(() => {});
  // `main.ts` reports the successful listen with console.log, not Logger
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  cleanups.push(() => {
    error.mockRestore();
    warn.mockRestore();
    log.mockRestore();
    consoleLog.mockRestore();
  });

  const app: any = {
    use: vi.fn(),
    useGlobalPipes: vi.fn(),
    useGlobalFilters: vi.fn(),
  };
  let releaseListen: () => void = () => {};
  const listened = new Promise<void>((resolve) => {
    releaseListen = resolve;
  });
  app.listen = vi.fn(async () => {
    releaseListen();
  });

  const { NestFactory } = await import('@nestjs/core');
  const create = vi.spyOn(NestFactory, 'create').mockImplementation(
    (async () => app) as any
  ) as unknown as ReturnType<typeof vi.fn>;
  cleanups.push(() => create.mockRestore());

  const beforeRejection = process.listeners('unhandledRejection');
  await import('../apps/backend/src/main');
  await listened;

  // let the startMcp rejection reach the `.catch` callback
  await new Promise((resolve) => setTimeout(resolve, 0));

  const addedRejectionListeners = process
    .listeners('unhandledRejection')
    .filter((listener) => !beforeRejection.includes(listener));
  cleanups.push(() => {
    for (const listener of addedRejectionListeners) {
      process.off('unhandledRejection', listener as any);
    }
  });

  return {
    app,
    create,
    error,
    warn,
    log,
    consoleLog,
    addedRejectionListeners,
  };
};

describe('MCP startup failure is logged and non-fatal', () => {
  it('logs a rejected startMcp and still listens with the core wiring in place', async () => {
    state.startMcp.mockImplementation(() =>
      Promise.reject(new Error('mcp transport refused'))
    );

    const boot = await bootMain();

    expect(state.startMcp).toHaveBeenCalledTimes(1);
    expect(state.startMcp).toHaveBeenCalledWith(boot.app);
    expect(boot.error).toHaveBeenCalledWith(
      'MCP startup failed (non-fatal)',
      expect.objectContaining({ message: 'mcp transport refused' })
    );

    // the API is not blocked by the failed optional service
    expect(boot.app.listen).toHaveBeenCalledWith(3000);
    expect(boot.consoleLog).toHaveBeenCalledWith(
      'Backend started successfully on port 3000'
    );
    expect(boot.log).toHaveBeenCalledWith(
      '🚀 Backend is running on: http://localhost:3000'
    );

    // request parsing, pipes and the three exception filters are installed
    expect(boot.app.use).toHaveBeenCalledWith(
      ['/copilot/{*splat}', '/posts'],
      expect.any(Function)
    );
    expect(boot.app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(boot.app.useGlobalFilters).toHaveBeenCalledTimes(3);

    // a failure is reported once, not retried or swallowed silently
    expect(boot.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('MCP startup failed'),
      expect.anything()
    );
  });

  it('does not wait for a hanging startMcp before serving the API', async () => {
    state.startMcp.mockImplementation(() => new Promise(() => {}));

    const boot = await bootMain();

    expect(state.startMcp).toHaveBeenCalledTimes(1);
    expect(boot.app.listen).toHaveBeenCalledWith(3000);
    expect(boot.error).not.toHaveBeenCalled();
  });

  it('keeps the upstream CORS and body-parser surface at the boot boundary', async () => {
    state.startMcp.mockImplementation(() => Promise.reject(new Error('refused')));

    const boot = await bootMain();

    const [, options] = boot.create.mock.calls[0];
    expect(options.rawBody).toBe(true);
    expect(options.cors.credentials).toBe(true);
    expect(options.cors.origin).toContain('http://localhost:4200');
    expect(options.cors.allowedHeaders).toContain(
      'x-copilotkit-runtime-client-gql-version'
    );
    expect(options.cors.exposedHeaders).toContain(
      'x-copilotkit-runtime-client-gql-version'
    );
  });

  it('keeps the existing unhandledRejection log line without swallowing it', async () => {
    state.startMcp.mockImplementation(() => Promise.reject(new Error('refused')));

    const boot = await bootMain();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    cleanups.push(() => consoleError.mockRestore());

    expect(boot.addedRejectionListeners).toHaveLength(1);

    const returned = (boot.addedRejectionListeners[0] as any)(
      new Error('synthetic rejection')
    );

    expect(returned).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled promise rejection (non-fatal):',
      'synthetic rejection'
    );
  });
});
