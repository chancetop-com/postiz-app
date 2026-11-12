// ============================================================
// PM2 process definition used by the container image.
//
// Paths are absolute on purpose: PM2 resolves a relative script against
// `cwd`, and the pnpm install is hoisted, so there is no
// `apps/frontend/node_modules/.bin/next`. The real Next entry point is the
// hoisted one under /app/node_modules.
//
// The three processes are independent: the API (3000), the frontend
// (`next start`, 4200) and the Temporal worker.
// ============================================================
module.exports = {
  apps: [
    {
      name: 'backend',
      script: '/app/apps/backend/dist/apps/backend/src/main.js',
      cwd: '/app',
      exec_mode: 'fork',
      interpreter: 'node',
      interpreter_args: '--experimental-require-module',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '2G',
      merge_logs: true,
    },
    {
      name: 'frontend',
      // Plain `next start` on the complete (non-standalone) .next output.
      script: '/app/node_modules/next/dist/bin/next',
      cwd: '/app/apps/frontend',
      args: 'start -p 4200',
      exec_mode: 'fork',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '2G',
      merge_logs: true,
    },
    {
      name: 'orchestrator',
      script: '/app/apps/orchestrator/dist/apps/orchestrator/src/main.js',
      cwd: '/app',
      exec_mode: 'fork',
      interpreter: 'node',
      interpreter_args: '--experimental-require-module',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '2G',
      merge_logs: true,
    },
  ],
};
