import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

/**
 * The merge pins one toolchain. Declarations drift easily (engines, volta and
 * packageManager disagreed before the merge), so this guards them together.
 */
describe('toolchain declaration', () => {
  it('declares one Node version everywhere', () => {
    expect(pkg.engines.node).toBe('22.23.4');
    expect(pkg.volta.node).toBe(pkg.engines.node);
  });

  it('declares pnpm 10.6.1', () => {
    expect(pkg.packageManager).toBe('pnpm@10.6.1');
  });

  it('pins Prisma 6.5.0', () => {
    expect(pkg.devDependencies.prisma).toBe('6.5.0');
    expect(pkg.dependencies['@prisma/client']).toBe('6.5.0');
  });

  it('keeps the build entry points the merge relies on', () => {
    expect(pkg.scripts.build).toContain('apps/frontend');
    expect(pkg.scripts.build).toContain('apps/backend');
    expect(pkg.scripts.build).toContain('apps/orchestrator');
    expect(pkg.scripts['prisma-db-push']).toBeDefined();
  });

  it('runs the database sync without accepting data loss', () => {
    expect(pkg.scripts['prisma-db-push']).not.toContain('--accept-data-loss');
    expect(pkg.scripts['prisma-db-push']).not.toContain('--force-reset');
  });
});
