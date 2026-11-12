#!/usr/bin/env bash
# ============================================================
# Tests for the source-image runtime contract (ticket 13).
#
# These are fast, static assertions over the packaging inputs. They are a
# regression guard only: the behavioural proof (three processes, /api/, media
# persistence, native modules) lives in
# .scratch/postiz-stable-merge-implementation/rehearsals/13/.
#
# Never talks to a registry, a cluster or the Docker daemon.
#
# Usage: ./k8s/tests/runtime-contract.test.sh
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$K8S_DIR/.." && pwd)"

DOCKERFILE="$K8S_DIR/Dockerfile"
ECOSYSTEM="$REPO_ROOT/var/docker/ecosystem.config.cjs"
NEXT_CONFIG="$REPO_ROOT/apps/frontend/next.config.js"
PUBLIC_CONFIG="$K8S_DIR/public-build-config.env"
BUILD_LOCAL="$K8S_DIR/build-local.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); printf '  FAIL %s\n' "$1"; }

assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else no "$1 (expected [$3], got [$2])"; fi
}

assert_contains() { # description file needle
  if grep -qF -- "$3" "$2"; then ok "$1"; else no "$1 (missing [$3] in $2)"; fi
}

assert_not_contains() {
  if grep -qF -- "$3" "$2"; then no "$1 (unexpected [$3] in $2)"; else ok "$1"; fi
}

# ------------------------------------------------------------
# Toolchain: builder and runtime both on Node 22.23.4, pnpm 10.6.1
# ------------------------------------------------------------
echo "toolchain"
upstream_node="$(awk '/^FROM node:/{print $2; exit}' "$DOCKERFILE" | cut -d: -f2)"
runtime_node="$(awk '/^FROM node:/{print $2}' "$DOCKERFILE" | tail -1 | cut -d: -f2)"
assert_eq "builder base image is node 22.23.4" "$upstream_node" "22.23.4-bookworm"
assert_eq "runtime base image is node 22.23.4" "$runtime_node" "22.23.4-bookworm-slim"
assert_eq "there are exactly two stages" "$(grep -c '^FROM ' "$DOCKERFILE")" "2"

if grep -qE 'npm (install|i) -g pnpm(@[0-9.]+)?' "$DOCKERFILE"; then
  no "pnpm is installed from an unpinned global npm install"
else
  ok "pnpm is not installed from an unpinned global npm install"
fi
assert_contains "builder pins pnpm 10.6.1" "$DOCKERFILE" "pnpm@10.6.1"
assert_contains "builder installs with --frozen-lockfile" "$DOCKERFILE" "--frozen-lockfile"

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
# Public build configuration allow-list
# ------------------------------------------------------------
echo "public build config"
if [ -f "$PUBLIC_CONFIG" ]; then ok "public build config allow-list exists"; else no "public build config allow-list exists ($PUBLIC_CONFIG)"; fi

listed_keys=()
if [ -f "$PUBLIC_CONFIG" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    listed_keys+=("${line%%=*}")
  done < "$PUBLIC_CONFIG"
fi

if [ ${#listed_keys[@]} -gt 0 ]; then
  ok "allow-list is not empty (${#listed_keys[@]} keys)"
else
  no "allow-list is not empty"
fi

for key in "${listed_keys[@]}"; do
  assert_contains "Dockerfile declares ARG $key" "$DOCKERFILE" "ARG $key"
  assert_contains "Dockerfile sets ENV $key before the build" "$DOCKERFILE" "ENV $key"
done

# Every NEXT_PUBLIC_* the source really reads must be in the allow-list, and
# every entry must be read somewhere: no unlisted public value can slip into
# the bundle, and no dead entry can pretend to be configuration.
consumed="$(
  grep -rhoE 'process\.env\.NEXT_PUBLIC_[A-Z0-9_]+' \
    "$REPO_ROOT/apps/frontend/src" \
    "$REPO_ROOT/apps/backend/src" \
    "$REPO_ROOT/apps/orchestrator/src" \
    "$REPO_ROOT/libraries" \
    --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null \
    | sed 's/^process\.env\.//' | LC_ALL=C sort -u
)"
listed="$(printf '%s\n' "${listed_keys[@]}" | LC_ALL=C sort -u)"
if [ "$consumed" = "$listed" ]; then
  ok "allow-list matches the NEXT_PUBLIC_* values the source consumes"
else
  no "allow-list matches the NEXT_PUBLIC_* values the source consumes"
  diff -u <(printf '%s\n' "$consumed") <(printf '%s\n' "$listed") | sed 's/^/       /'
fi

# ------------------------------------------------------------
# Next output: plain `next start`, no standalone
# ------------------------------------------------------------
echo "next output"
assert_not_contains "next.config.js no longer requests standalone output" "$NEXT_CONFIG" "output: 'standalone'"
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

# ------------------------------------------------------------
# Actions stay separated: local build must not publish or deploy
# ------------------------------------------------------------
echo "action separation"
for needle in "docker push" "az acr login" "kubectl" "docker login"; do
  assert_not_contains "build-local.sh does not run [$needle]" "$BUILD_LOCAL" "$needle"
done

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo
echo "runtime-contract: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  printf 'failed: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
