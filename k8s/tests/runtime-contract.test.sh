#!/usr/bin/env bash
# ============================================================
# Tests for the layered source-image runtime contract (ADR-0001).
#
# Fast, static assertions focused strictly on runtime-image contracts:
# toolchain pinning, four-layer Dockerfile split, zero NEXT_PUBLIC_* build
# args, plain Next output, PM2 three-process layout, /api/ healthcheck,
# startup schema sync, and runtime-deps pruning contract.
#
# Never talks to a registry, a cluster or the Docker daemon.
#
# Usage: ./k8s/tests/runtime-contract.test.sh
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$K8S_DIR/.." && pwd)"

# shellcheck source=lib/assert.sh
. "$SCRIPT_DIR/lib/assert.sh"

DOCKERFILE="$K8S_DIR/Dockerfile"
DOCKERFILE_BASE="$K8S_DIR/Dockerfile.base"
DOCKERFILE_DEPS="$K8S_DIR/Dockerfile.deps"
DOCKERFILE_RUNTIME_DEPS="$K8S_DIR/Dockerfile.runtime-deps"
ECOSYSTEM="$REPO_ROOT/var/docker/ecosystem.config.cjs"
BUILD_LOCAL="$K8S_DIR/build-local.sh"
BUILD_POSTIZ="$K8S_DIR/build-postiz.sh"
PACKAGE_JSON="$REPO_ROOT/package.json"

EXPECTED_NODE="$(PACKAGE_JSON="$PACKAGE_JSON" node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.env.PACKAGE_JSON, "utf8")).engines.node)')"
EXPECTED_PNPM_SPEC="$(PACKAGE_JSON="$PACKAGE_JSON" node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.env.PACKAGE_JSON, "utf8")).packageManager)')"

# ------------------------------------------------------------
# Toolchain & four-layer Dockerfile split
# ------------------------------------------------------------
echo "toolchain and layered Dockerfiles"
deps_node="$(awk '/^FROM node:/{print $2; exit}' "$DOCKERFILE_DEPS" | cut -d: -f2)"
base_node="$(awk '/^FROM node:/{print $2; exit}' "$DOCKERFILE_BASE" | cut -d: -f2)"
assert_eq "Dockerfile.deps pins Node ${EXPECTED_NODE} full builder image" "$deps_node" '${NODE_VERSION}-bookworm'
assert_eq "Dockerfile.base pins Node ${EXPECTED_NODE} slim runtime image" "$base_node" '${NODE_VERSION}-bookworm-slim'

assert_contains "base default Node pin" "$DOCKERFILE_BASE" "ARG NODE_VERSION=$EXPECTED_NODE"
assert_contains "deps default Node pin" "$DOCKERFILE_DEPS" "ARG NODE_VERSION=$EXPECTED_NODE"
assert_contains "Dockerfile.base pins ${EXPECTED_PNPM_SPEC}" "$DOCKERFILE_BASE" "$EXPECTED_PNPM_SPEC"
assert_contains "Dockerfile.deps pins ${EXPECTED_PNPM_SPEC}" "$DOCKERFILE_DEPS" "$EXPECTED_PNPM_SPEC"
assert_contains "Dockerfile.deps installs with --frozen-lockfile" "$DOCKERFILE_DEPS" "--frozen-lockfile"

assert_regex "Dockerfile.runtime-deps inherits DEPS_IMAGE for pruning" "$DOCKERFILE_RUNTIME_DEPS" '^FROM[[:space:]]+\$\{DEPS_IMAGE\}'
assert_regex "Dockerfile.runtime-deps inherits BASE_IMAGE for runtime deps" "$DOCKERFILE_RUNTIME_DEPS" '^FROM[[:space:]]+\$\{BASE_IMAGE\}'
assert_regex "runtime dependency pruning is offline and non-interactive" "$DOCKERFILE_RUNTIME_DEPS" 'CI=true[[:space:]]+npm_config_offline=true[[:space:]]+pnpm prune --prod'

assert_regex "Dockerfile builder stage inherits DEPS_IMAGE" "$DOCKERFILE" '^FROM[[:space:]]+\$\{DEPS_IMAGE\}[[:space:]]+AS[[:space:]]+builder'
assert_regex "Dockerfile runtime stage inherits RUNTIME_DEPS_IMAGE" "$DOCKERFILE" '^FROM[[:space:]]+\$\{RUNTIME_DEPS_IMAGE\}[[:space:]]+AS[[:space:]]+runtime'
assert_not_regex "Dockerfile never pulls raw node base image directly" "$DOCKERFILE" '^FROM[[:space:]]+node:'
assert_not_contains "Dockerfile never runs pnpm install" "$DOCKERFILE" "pnpm install"
assert_not_contains "Dockerfile never runs apt-get" "$DOCKERFILE" "apt-get"
assert_not_regex "Dockerfile runtime does not re-copy builder node_modules" "$DOCKERFILE" '^COPY[[:space:]]+--from=builder[[:space:]]+/app/node_modules'
assert_contains "Dockerfile builds workspace with pnpm run build" "$DOCKERFILE" "pnpm run build"
assert_contains "Dockerfile copies compiled backend dist" "$DOCKERFILE" "./apps/backend/dist"
assert_contains "Dockerfile copies compiled orchestrator dist" "$DOCKERFILE" "./apps/orchestrator/dist"
assert_contains "Dockerfile copies Prisma schema for startup sync" "$DOCKERFILE" "libraries/nestjs-libraries/src/database/prisma/schema.prisma"
assert_contains "Dockerfile copies startup entrypoint" "$DOCKERFILE" "var/docker/entrypoint.sh"
assert_contains "Dockerfile copies nginx config" "$DOCKERFILE" "var/docker/nginx.conf"
assert_contains "Dockerfile copies PM2 ecosystem config" "$DOCKERFILE" "var/docker/ecosystem.config.cjs"
assert_regex "Dockerfile exposes port 5000" "$DOCKERFILE" '^EXPOSE[[:space:]]+5000$'
assert_regex "Dockerfile uses startup schema-sync entrypoint" "$DOCKERFILE" '^ENTRYPOINT[[:space:]]+\["/app/var/docker/entrypoint\.sh"\]$'
assert_contains "Dockerfile starts nginx and pm2-runtime" "$DOCKERFILE" 'nginx && pm2-runtime ecosystem.config.cjs'

# ------------------------------------------------------------
# Healthcheck: the root route /api/ exists in the backend
# ------------------------------------------------------------
echo "healthcheck"
assert_contains "HEALTHCHECK hits /api/" "$DOCKERFILE" "http://localhost:5000/api/"
if grep -E '^[[:space:]]*(HEALTHCHECK|CMD curl)' "$DOCKERFILE" | grep -qF '/api/health'; then
  no "the HEALTHCHECK command does not hit /api/health"
else
  ok "the HEALTHCHECK command does not hit /api/health"
fi

# ------------------------------------------------------------
# No public build configuration; runtime context is the only channel
#
# `next build` must not inline environment values: that would bind the image
# to one environment and bypass the deployment's ConfigMap/Secret. Every
# public value is read at runtime by the server components and delivered to
# client code through VariableContext.
# ------------------------------------------------------------
echo "runtime configuration"

for df in "$DOCKERFILE_BASE" "$DOCKERFILE_DEPS" "$DOCKERFILE_RUNTIME_DEPS" "$DOCKERFILE"; do
  name="$(basename "$df")"
  assert_not_contains "$name declares no NEXT_PUBLIC_* build args" "$df" "ARG NEXT_PUBLIC_"
  assert_not_contains "$name sets no NEXT_PUBLIC_* env values" "$df" "ENV NEXT_PUBLIC_"
done
assert_not_contains "build-local.sh passes no NEXT_PUBLIC_* build args" "$BUILD_LOCAL" "--build-arg NEXT_PUBLIC_"
assert_not_contains "build-postiz.sh passes no NEXT_PUBLIC_* build args" "$BUILD_POSTIZ" "--build-arg NEXT_PUBLIC_"

# Every 'use client' module must take its public environment values from
# VariableContext, never from process.env: a client-side process.env lookup is
# not replaced at runtime and silently evaluates to undefined.
client_reads="$(
  for file in $(grep -rl "'use client'" "$REPO_ROOT/apps/frontend/src" "$REPO_ROOT/libraries" --include='*.ts' --include='*.tsx' 2>/dev/null); do
    grep -oE 'process\.env\.NEXT_PUBLIC_[A-Z0-9_]+' "$file" || true
  done | sed 's/^process\.env\.//' | LC_ALL=C sort -u
)"
assert_eq "client modules do not read NEXT_PUBLIC_* from process.env" "$client_reads" ""

# ------------------------------------------------------------
# Next output: plain `next start`, no standalone
# ------------------------------------------------------------
echo "next output"
assert_contains "Dockerfile keeps the complete .next output" "$DOCKERFILE" "./apps/frontend/.next"
assert_contains "Dockerfile keeps the frontend public directory" "$DOCKERFILE" "./apps/frontend/public"
assert_contains "Dockerfile keeps the frontend package.json" "$DOCKERFILE" "./apps/frontend/package.json"
assert_contains "Dockerfile keeps the frontend next.config.js" "$DOCKERFILE" "./apps/frontend/next.config.js"

# ------------------------------------------------------------
# PM2 process set: three processes, absolute hoisted entry points
# ------------------------------------------------------------
echo "pm2 process set"
if ECOSYSTEM="$ECOSYSTEM" node -e '
  const cfg = require(process.env.ECOSYSTEM);
  const apps = cfg.apps || [];
  const names = apps.map((a) => a.name).sort();
  const by = Object.fromEntries(apps.map((a) => [a.name, a]));
  const checks = [
    [JSON.stringify(names) === JSON.stringify(["backend", "frontend", "orchestrator"]), "three apps: backend, frontend, orchestrator"],
    [by.backend && by.backend.script === "/app/apps/backend/dist/apps/backend/src/main.js", "backend runs the real Nest output path"],
    [by.orchestrator && by.orchestrator.script === "/app/apps/orchestrator/dist/apps/orchestrator/src/main.js", "orchestrator runs the real Nest output path"],
    [by.frontend && by.frontend.cwd === "/app/apps/frontend", "frontend PM2 cwd is explicit"],
    [by.frontend && by.frontend.script === "/app/node_modules/next/dist/bin/next", "frontend runs the hoisted Next entry"],
    [by.frontend && String(by.frontend.args).includes("start -p 4200"), "frontend starts with next start on 4200"],
  ];
  for (const [pass, label] of checks) { console.log((pass ? "ok   " : "FAIL ") + label); }
  process.exit(checks.every(([p]) => p) ? 0 : 1);
'; then
  PASS=$((PASS + 6))
else
  FAIL=$((FAIL + 1))
  FAILED_NAMES+=("pm2 process set")
fi

report_and_exit "runtime-contract"
