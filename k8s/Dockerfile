# ============================================================
# Postiz application image (ADR-0001)
#
# One image, three processes under nginx + PM2:
#   nginx 5000  ->  backend 3000, frontend 4200
#                   orchestrator (Temporal worker)
#
# Built directly from the repository root context using cached dependency
# layers produced by k8s/Dockerfile.base, k8s/Dockerfile.deps, and
# k8s/Dockerfile.runtime-deps:
#   ./k8s/build-local.sh         (local four-layer build only, never publishes)
#   ./k8s/build-postiz.sh        (ACR four-layer publish, never deploys)
#   ./k8s/publish-and-deploy.sh  (wrapper: publish, optionally --deploy)
#
# Dependencies, pinned pnpm, Prisma client, and runtime OS packages are
# inherited from DEPS_IMAGE and RUNTIME_DEPS_IMAGE so routine code changes
# compile and ship only incremental application layers. The build connects
# to no database; the runtime entrypoint syncs the schema with
# `pnpm run prisma-db-push` before starting the application.
# ============================================================
ARG DEPS_IMAGE=postiz-deps:local
ARG RUNTIME_DEPS_IMAGE=postiz-runtime-deps:local

# ===== Stage 1: build =====
FROM ${DEPS_IMAGE} AS builder

WORKDIR /app

# Source inputs and TypeScript configs from the repository root.
# Dependency manifests, lockfile, hoisted node_modules, and generated Prisma
# client are inherited from ${DEPS_IMAGE}.
COPY tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY libraries ./libraries

# No NEXT_PUBLIC_* build arguments. `next build` would inline them into the
# browser bundle, which would bind the image to one environment and take the
# value away from the deployment's ConfigMap/Secret. Environment configuration
# (backend URL, upload directory, SSO parent origins, OAuth branding, tracking
# ids, Sentry DSN, version) is read at runtime by the server components and
# delivered to client code through VariableContext.

ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ARG SENTRY_UPLOAD=0
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

# Builds frontend (plain `next build`), backend, and orchestrator with the
# real Nest output layout. The Next build cache is not needed by `next start`.
RUN --mount=type=secret,id=sentry_token \
    if [ "$SENTRY_UPLOAD" = 1 ]; then \
      SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_token)" && test -n "$SENTRY_AUTH_TOKEN" || exit 1; \
      export SENTRY_AUTH_TOKEN; \
    fi \
 && NODE_OPTIONS="--max-old-space-size=4096" pnpm run build \
 && rm -rf apps/frontend/.next/cache

# ===== Stage 2: runtime =====
FROM ${RUNTIME_DEPS_IMAGE} AS runtime

WORKDIR /app

# Runtime OS base (nginx, curl, pinned pnpm, pm2, www user, /uploads) and
# pruned runtime node_modules (including generated Prisma client, pinned
# Prisma CLI + engine binaries, bcrypt, sharp, and Temporal bindings) are
# inherited from ${RUNTIME_DEPS_IMAGE}.

# Build artifacts: real Nest output paths + the complete non-standalone Next
# output, its static assets, public directory, and the config/package files
# that `next start` loads from apps/frontend.
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY apps/frontend/scripts/fetch-gtm.mjs ./apps/frontend/scripts/fetch-gtm.mjs
COPY --from=builder /app/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=builder /app/apps/frontend/next.config.js ./apps/frontend/next.config.js
COPY --from=builder /app/package.json ./

# The container syncs the database schema before it starts the app, so the
# runtime needs the schema, the root scripts, and the startup entrypoint.
COPY libraries/nestjs-libraries/src/database/prisma/schema.prisma \
     ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
COPY var/docker/entrypoint.sh ./var/docker/entrypoint.sh
RUN chmod +x ./var/docker/entrypoint.sh

# Copy nginx config
COPY var/docker/nginx.conf /etc/nginx/nginx.conf

# Copy PM2 config
COPY --chown=www:www var/docker/ecosystem.config.cjs ./ecosystem.config.cjs

# USER www  # Run as root for PVC write permissions

EXPOSE 5000

# /api/ maps to the backend root route `GET /`, which exists in the source.
# /api/health never had a controller and is not used any more.
# This only proves the HTTP entry point answers; process, database, Temporal,
# and MCP readiness are checked separately.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:5000/api/ || exit 1

# The configured entrypoint syncs the database schema before the app starts.
ENTRYPOINT ["/app/var/docker/entrypoint.sh"]
CMD ["sh", "-c", "nginx && pm2-runtime ecosystem.config.cjs"]
