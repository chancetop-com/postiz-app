module.exports = {
  apps: [
    {
      name: 'backend',
      script: './apps/backend/dist/apps/backend/src/main.js',
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
      script: './node_modules/.bin/next',
      args: 'start -p 4200',
      cwd: './apps/frontend',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '2G',
      merge_logs: true,
    },
    {
      name: 'orchestrator',
      script: './apps/orchestrator/dist/apps/orchestrator/src/main.js',
      exec_mode: 'fork',
      interpreter: 'node',
      interpreter_args: '--experimental-require-module',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '1G',
      merge_logs: true,
    },
  ],
};
