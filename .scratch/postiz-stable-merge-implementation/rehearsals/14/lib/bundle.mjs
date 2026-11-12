/**
 * Workflow bundling for the rehearsal.
 *
 * The candidate bundle is produced exactly the way the orchestrator produces it
 * at runtime (`bundleWorkflowCode` with no extra configuration), so a replay
 * failure is a real production failure. The legacy bundle only needs module
 * aliases because the extracted sources live outside `apps/orchestrator` and
 * therefore do not see `apps/orchestrator/.swcrc`.
 */
import { createHash } from 'node:crypto';
import { bundleWorkflowCode } from '@temporalio/worker';
import { REPO_ROOT } from './paths.mjs';

const logger = {
  trace() {},
  debug() {},
  info() {},
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** `@gitroom/*` monorepo aliases matching tsconfig.base.json. */
export const MONOREPO_ALIASES = {
  '@gitroom/backend': `${REPO_ROOT}/apps/backend/src`,
  '@gitroom/orchestrator': `${REPO_ROOT}/apps/orchestrator/src`,
  '@gitroom/helpers': `${REPO_ROOT}/libraries/helpers/src`,
  '@gitroom/nestjs-libraries': `${REPO_ROOT}/libraries/nestjs-libraries/src`,
  '@gitroom/plugins': `${REPO_ROOT}/libraries/plugins/src`,
  '@gitroom/react': `${REPO_ROOT}/libraries/react-shared-libraries/src`,
};

/**
 * Bundles a workflows entrypoint.
 *
 * @param {string} workflowsPath
 * @param {{ aliases?: Record<string, string> }} [options]
 */
export async function bundleWorkflows(workflowsPath, options = {}) {
  const aliases = options.aliases;
  const bundle = await bundleWorkflowCode({
    workflowsPath,
    logger,
    ...(aliases
      ? {
          webpackConfigHook: (config) => {
            config.resolve = config.resolve ?? {};
            config.resolve.alias = { ...(config.resolve.alias ?? {}), ...aliases };
            return config;
          },
        }
      : {}),
  });

  return {
    code: bundle.code,
    sha256: createHash('sha256').update(bundle.code).digest('hex'),
    workflowsPath,
  };
}

/** The candidate bundle used by the orchestrator worker. */
export function bundleCandidate(workflowsPath) {
  // No aliasing: this is the production bundling path.
  return bundleWorkflows(workflowsPath);
}

/** Old workflows, bundled the way the old worker did (sources extracted verbatim). */
export function bundleLegacy(workflowsPath, { signalDir }) {
  return bundleWorkflows(workflowsPath, {
    aliases: {
      // Old signal/payload definitions win over the candidate's copies so the
      // generated histories carry the documented old contract.
      '@gitroom/orchestrator/signals': signalDir,
      ...MONOREPO_ALIASES,
    },
  });
}
