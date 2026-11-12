# ============================================================
# Postiz source image (ticket 13)
#
# One image, three processes under nginx + PM2:
#   nginx 5000  ->  backend 3000, frontend 4200
#                   orchestrator (Temporal worker)
#
# Built from the prepared build context in ./k8s:
#   ./k8s/prepare-build-context.sh   (generate apps/, libraries/, var/docker/)
#   ./k8s/build-local.sh             (local build only, never publishes)
#   ./k8s/build-postiz.sh            (publish, separate action)
#
# The build installs with the frozen lockfile and connects to no database.
# The runtime entrypoint syncs the schema with `pnpm run prisma-db-push`
# before it starts the application (see var/docker/entrypoint.sh).
# ============================================================

# ===== Stage 1: build =====
FROM node:22.23.4-bookworm AS builder

WORKDIR /app

# Toolchain is pinned to the locked upstream versions so the same Node and
# pnpm build here and run the application in the runtime stage.
RUN npm install --no-update-notifier --no-fund --global pnpm@10.6.1

# Source inputs. apps/, libraries/ and var/docker/ are generated from the
# repository root by ./k8s/prepare-build-context.sh; never edited here.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY libraries ./libraries

# Frozen install: the lockfile is authoritative, and the root postinstall
# generates the Prisma 6.5.0 client (no database connection).
RUN pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile

# Public build configuration. `next build` inlines these values into the
# browser bundle, so they must be supplied at build time and cannot be changed
# by the runtime environment. The allow-list of values the source actually
# consumes is ./public-build-config.env; build-local.sh/build-postiz.sh pass
# every entry as a build argument. NEXT_PUBLIC_* : no secret belongs here.
ARG NEXT_PUBLIC_BACKEND_URL=""
ARG NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=""
ARG NEXT_PUBLIC_SSO_PARENT_ORIGINS=""
ARG NEXT_PUBLIC_VERSION=""
ARG NEXT_PUBLIC_APP_VERSION=""
ARG NEXT_PUBLIC_POLOTNO=""
ARG NEXT_PUBLIC_FACEBOOK_PIXEL=""
ARG NEXT_PUBLIC_DISCORD_SUPPORT=""
ARG NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL=""
ARG NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME=""
ARG NEXT_PUBLIC_TRACKING_TRIAL=""
ARG NEXT_PUBLIC_GTM_ID=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_OVERRIDE_BACKEND_URL=""
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=$NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY
ENV NEXT_PUBLIC_SSO_PARENT_ORIGINS=$NEXT_PUBLIC_SSO_PARENT_ORIGINS
ENV NEXT_PUBLIC_VERSION=$NEXT_PUBLIC_VERSION
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_POLOTNO=$NEXT_PUBLIC_POLOTNO
ENV NEXT_PUBLIC_FACEBOOK_PIXEL=$NEXT_PUBLIC_FACEBOOK_PIXEL
ENV NEXT_PUBLIC_DISCORD_SUPPORT=$NEXT_PUBLIC_DISCORD_SUPPORT
ENV NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL=$NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL
ENV NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME=$NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME
ENV NEXT_PUBLIC_TRACKING_TRIAL=$NEXT_PUBLIC_TRACKING_TRIAL
ENV NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_OVERRIDE_BACKEND_URL=$NEXT_PUBLIC_OVERRIDE_BACKEND_URL

# NODE_ENV is set only after the install so dev dependencies needed by the
# build (TypeScript, Nest CLI, tailwind) are installed.
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

# Builds frontend (plain `next build`), backend and orchestrator with the real
# Nest output layout. The webpack build cache is not needed by `next start`.
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build \
 && rm -rf apps/frontend/.next/cache

# ===== Stage 2: runtime =====
FROM node:22.23.4-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx curl \
 && rm -rf /var/lib/apt/lists/*

# Same pinned pnpm as the builder: the entrypoint runs `pnpm run
# prisma-db-push`, and root package.json declares packageManager pnpm@10.6.1.
RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1 pm2

# The image runs as root: the deployment mounts the /uploads PVC and expects
# to write there. This is the existing permission model, not a new one.
RUN addgroup --system www \
 && adduser --system --ingroup www --home /www --shell /usr/sbin/nologin www \
 && mkdir -p /www /uploads /app /var/log/nginx \
 && chown -R www:www /www /uploads /var/lib/nginx /var/log/nginx /app

WORKDIR /app

# Runtime dependencies (hoisted install, includes the generated Prisma client,
# Prisma engines, bcrypt, sharp and the Temporal worker bindings).
COPY --from=builder /app/node_modules ./node_modules

# Build artifacts: real Nest output paths + the complete non-standalone Next
# output, its static assets, public directory and the config/package files
# that `next start` loads from apps/frontend.
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder /app/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=builder /app/apps/frontend/next.config.js ./apps/frontend/next.config.js
COPY --from=builder /app/package.json ./

# The container syncs the database schema before it starts the app, so the
# runtime needs the schema, the root scripts and the pinned Prisma CLI that
# is already part of node_modules above.
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
# This only proves the HTTP entry point answers; process, database, Temporal
# and MCP readiness are checked separately.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:5000/api/ || exit 1

# The configured entrypoint syncs the database schema before the app starts.
ENTRYPOINT ["/app/var/docker/entrypoint.sh"]
CMD ["sh", "-c", "nginx && pm2-runtime ecosystem.config.cjs"]
