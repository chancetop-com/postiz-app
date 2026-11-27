import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import pkg from '../package.json';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const nextConfigPath = path.join(repoRoot, 'apps/frontend/next.config.js');

let importCounter = 0;

const loadFrontendConfig = async (env: {
  phase?: string;
  SENTRY_AUTH_TOKEN?: string;
  TURBOPACK?: string;
}) => {
  vi.stubEnv('SENTRY_AUTH_TOKEN', env.SENTRY_AUTH_TOKEN);
  vi.stubEnv('TURBOPACK', env.TURBOPACK);
  vi.resetModules();
  importCounter += 1;
  const url = `${pathToFileURL(nextConfigPath).href}?v=${importCounter}`;
  const mod = await import(url);
  return mod.default(env.phase ?? 'phase-production-build') as Record<
    string,
    unknown
  >;
};

afterEach(() => vi.unstubAllEnvs());

describe('frontend build configuration (apps/frontend/next.config.js)', () => {
  it.each([
    [undefined, undefined],
    ['   \t\n ', '1'],
  ])(
    'skips production sourcemaps and upload without usable credentials (%j)',
    async (token, turbopack) => {
      const config = await loadFrontendConfig({
        SENTRY_AUTH_TOKEN: token,
        TURBOPACK: turbopack,
      });
      expect(config.productionBrowserSourceMaps).toBe(false);
      expect(config.experimental).toMatchObject({
        serverSourceMaps: false,
        turbopackSourceMaps: false,
      });
      expect(config.webpack).toBeUndefined();
      expect(config).not.toHaveProperty('compiler.runAfterProductionCompile');
    }
  );

  it('preserves Next development sourcemaps without upload credentials', async () => {
    const config = await loadFrontendConfig({
      phase: 'phase-development-server',
    });
    expect(config.experimental).not.toHaveProperty('turbopackSourceMaps');
    expect(config.experimental).not.toHaveProperty('serverSourceMaps');
  });

  it('enables production browser sourcemaps and Sentry wrapping in webpack mode when SENTRY_AUTH_TOKEN is non-empty', async () => {
    const config = await loadFrontendConfig({
      SENTRY_AUTH_TOKEN: 'sntrys_test_token',
      TURBOPACK: undefined,
    });

    expect(config.productionBrowserSourceMaps).toBe(true);
    expect(typeof config.webpack).toBe('function');
  });

  it('enables Sentry Turbopack sourcemap debugIds and post-compile upload hook when TURBOPACK=1 and SENTRY_AUTH_TOKEN is set', async () => {
    const config = await loadFrontendConfig({
      SENTRY_AUTH_TOKEN: 'sntrys_test_token',
      TURBOPACK: '1',
    });

    expect(config.productionBrowserSourceMaps).toBe(true);
    expect(
      (config.turbopack as Record<string, unknown> | undefined)?.debugIds
    ).toBe(true);
    expect(
      typeof (config.compiler as Record<string, unknown> | undefined)
        ?.runAfterProductionCompile
    ).toBe('function');
  });

  it('keeps plain Next output and the profiling header with or without Sentry', async () => {
    for (const token of [undefined, 'sntrys_test_token']) {
      const config = await loadFrontendConfig({
        SENTRY_AUTH_TOKEN: token,
        TURBOPACK: undefined,
      });

      expect(config.output).toBeUndefined();
      const headers = await (
        config.headers as () => Promise<
          Array<{
            source: string;
            headers: Array<{ key: string; value: string }>;
          }>
        >
      )();
      expect(headers).toContainEqual({
        source: '/:path*',
        headers: expect.arrayContaining([
          { key: 'Document-Policy', value: 'js-profiling' },
        ]),
      });
    }
  });
});

const resolveTsConfigCompilerOptions = (relativeConfigPath: string) => {
  const fullPath = path.join(repoRoot, relativeConfigPath);
  const readResult = ts.readConfigFile(fullPath, ts.sys.readFile);
  if (readResult.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(fullPath),
    undefined,
    fullPath
  );
  return parsed.options;
};

describe('backend and orchestrator build configurations', () => {
  it.each([
    'apps/backend/tsconfig.build.json',
    'apps/orchestrator/tsconfig.build.json',
  ])(
    '%s disables declaration emission while keeping runtime sourcemaps enabled',
    (configPath) => {
      const options = resolveTsConfigCompilerOptions(configPath);

      expect(options.declaration).toBe(false);
      expect(options.sourceMap).toBe(true);
    }
  );
});

it('limits the workspace build to one app at a time', () => {
  expect(pkg.scripts.build.split(/\s+/)).toContain('--workspace-concurrency=1');
});
