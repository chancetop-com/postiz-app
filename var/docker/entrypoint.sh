#!/bin/sh
# ============================================================
# Container startup: sync the database schema, then start the app.
#
# Every container start and restart runs the root project script
# `prisma-db-push`, which invokes the pinned Prisma 6.5.0 CLI without any
# data-loss flag and without a reset. The application command is only executed
# after the sync succeeded. A failed sync prints the error, exits with the
# failing status and starts neither the API nor the worker.
#
# Usage: entrypoint.sh <command> [args...]
#   Dockerfile.dev           -> sh -c "nginx && pnpm run pm2"
#   k8s/Dockerfile(.runtime) -> sh -c "nginx && pm2-runtime ecosystem.config.cjs"
# ============================================================
set -eu

if [ "$#" -eq 0 ]; then
  echo "entrypoint: refusing to start without an application command" >&2
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$APP_DIR"

echo "[startup-sync] cwd=$APP_DIR command=pnpm run prisma-db-push"

if pnpm run prisma-db-push; then
  echo "[startup-sync] database schema is in sync; starting: $*"
else
  status=$?
  echo "[startup-sync] schema sync FAILED with exit $status." >&2
  echo "[startup-sync] refusing to start: $*" >&2
  echo "[startup-sync] the database keeps its rows and whatever the failed sync already changed." >&2
  echo "[startup-sync] inspect the error above before retrying; do not drop tables or data to force a start." >&2
  exit "$status"
fi

exec "$@"
