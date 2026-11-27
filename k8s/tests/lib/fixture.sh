#!/usr/bin/env bash
# ============================================================
# Shared throwaway Git fixture setup for offline k8s/tests/ suites.
#
# Creates an isolated Git repository populated with the repository-root
# inputs expected by the four-layer build pipeline without touching the
# real repository or sourcing production helper internals.
# ============================================================

TEST_FIXTURE_BASE_FILES=(
  .dockerignore
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  apps/backend/package.json
  apps/backend/tsconfig.build.json
  apps/commands/package.json
  apps/extension/package.json
  apps/frontend/package.json
  apps/frontend/next.config.js
  apps/frontend/tsconfig.json
  apps/frontend/tailwind.config.cjs
  apps/frontend/postcss.config.mjs
  apps/frontend/scripts/fetch-gtm.mjs
  apps/orchestrator/package.json
  apps/orchestrator/tsconfig.build.json
  apps/sdk/package.json
  libraries/nestjs-libraries/src/database/prisma/schema.prisma
  var/docker/entrypoint.sh
  var/docker/nginx.conf
  var/docker/ecosystem.config.cjs
)

TEST_FIXTURE_DOCKERFILES=(
  k8s/Dockerfile
  k8s/build-app.yaml
  k8s/Dockerfile.base
  k8s/Dockerfile.deps
  k8s/Dockerfile.runtime-deps
)

# Usage: setup_test_fixture_repo <dest_dir> <test_name> [k8s_source_dir]
# When k8s_source_dir is provided, copies real k8s Dockerfiles, lib/, and
# entrypoints into the fixture; otherwise creates minimal placeholder
# Dockerfiles for digest/validation testing.
setup_test_fixture_repo() {
  local dest="$1"
  local author_name="$2"
  local k8s_src="${3:-}"
  local rel

  mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" config user.email "test@example.invalid"
  git -C "$dest" config user.name "$author_name"

  for rel in "${TEST_FIXTURE_BASE_FILES[@]}"; do
    mkdir -p "$dest/$(dirname -- "$rel")"
    printf 'fixture %s\n' "$rel" > "$dest/$rel"
  done

  cat > "$dest/package.json" <<'PKGEOF'
{
  "name": "fixture",
  "engines": {
    "node": "22.23.4"
  },
  "packageManager": "pnpm@10.6.1",
  "dependencies": {
    "prisma": "6.5.0"
  }
}
PKGEOF

  mkdir -p "$dest/apps/backend/src" "$dest/libraries/helpers/src"
  printf 'export const main = 1;\n' > "$dest/apps/backend/src/main.ts"
  printf 'export const helper = 1;\n' > "$dest/libraries/helpers/src/helper.ts"

  if [ -n "$k8s_src" ]; then
    mkdir -p "$dest/k8s/lib"
    for rel in "${TEST_FIXTURE_DOCKERFILES[@]}"; do
      cp "$k8s_src/$(basename -- "$rel")" "$dest/$rel"
    done
    cp "$k8s_src/lib/build-cache.sh" "$dest/k8s/lib/build-cache.sh"
    cp "$k8s_src/lib/candidate-source.cjs" "$dest/k8s/lib/"
    cp "$k8s_src/lib/json.sh" "$dest/k8s/lib/json.sh"
    cp "$k8s_src/build-local.sh" "$dest/k8s/build-local.sh"
    cp "$k8s_src/build-postiz.sh" "$dest/k8s/build-postiz.sh"
    cp "$k8s_src/deploy-postiz.sh" "$dest/k8s/deploy-postiz.sh"
    cp "$k8s_src/publish-and-deploy.sh" "$dest/k8s/publish-and-deploy.sh"
    chmod +x \
      "$dest/k8s/lib/build-cache.sh" \
      "$dest/k8s/build-local.sh" \
      "$dest/k8s/build-postiz.sh" \
      "$dest/k8s/deploy-postiz.sh" \
      "$dest/k8s/publish-and-deploy.sh"
    cp "$k8s_src/../.gitignore" "$dest/.gitignore"
  else
    for rel in "${TEST_FIXTURE_DOCKERFILES[@]}"; do
      mkdir -p "$dest/$(dirname -- "$rel")"
      printf 'fixture %s\n' "$rel" > "$dest/$rel"
    done
  fi

  git -C "$dest" add -A
  git -C "$dest" commit -q -m "fixture initial"
}
