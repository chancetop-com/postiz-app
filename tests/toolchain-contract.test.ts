import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

/**
 * The merge pins one toolchain. Declarations drift easily (engines, volta and
 * packageManager disagreed before the merge), so this guards them together.
 */
describe('toolchain declaration', () => {
  it('declares one Node version everywhere', () => {
    expect(pkg.engines.node).toBeDefined();
    expect(pkg.volta.node).toBe(pkg.engines.node);
  });

  it('uses the same Prisma CLI and client version', () => {
    expect(pkg.dependencies['@prisma/client']).toBeDefined();
    expect(pkg.devDependencies.prisma).toBe(pkg.dependencies['@prisma/client']);
  });

  it('runs the database sync without accepting data loss', () => {
    expect(pkg.scripts['prisma-db-push']).not.toContain('--accept-data-loss');
    expect(pkg.scripts['prisma-db-push']).not.toContain('--force-reset');
  });
});
