#!/usr/bin/env bash
# ============================================================
# Offline tests for the build cache digest and worktree validation CLI.
#
# Never talks to a registry, a cluster, or the Docker daemon.
#
# Usage: ./k8s/tests/cache-layers.test.sh
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$K8S_DIR/.." && pwd)"

# shellcheck source=lib/assert.sh
. "$SCRIPT_DIR/lib/assert.sh"
# shellcheck source=lib/fixture.sh
. "$SCRIPT_DIR/lib/fixture.sh"

BUILD_CACHE_HELPER="$K8S_DIR/lib/build-cache.sh"
PACKAGE_JSON="$REPO_ROOT/package.json"

EXPECTED_NODE="$(PACKAGE_JSON="$PACKAGE_JSON" node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.env.PACKAGE_JSON, "utf8")).engines.node)')"
EXPECTED_PNPM_SPEC="$(PACKAGE_JSON="$PACKAGE_JSON" node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.env.PACKAGE_JSON, "utf8")).packageManager)')"
EXPECTED_PNPM_VER="${EXPECTED_PNPM_SPEC#pnpm@}"
EXPECTED_PRISMA="$(PACKAGE_JSON="$PACKAGE_JSON" node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.env.PACKAGE_JSON, "utf8")).dependencies.prisma)')"

echo "k8s/lib/build-cache.sh (public CLI contract)"
assert_file "$BUILD_CACHE_HELPER" "build-cache.sh exists"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/postiz-cache-layers-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FIXTURE="$WORK/repo"
setup_test_fixture_repo "$FIXTURE" "cache test"
FIXTURE_HEAD_SHORT="$(git -C "$FIXTURE" rev-parse --short=12 HEAD)"

if [ -f "$BUILD_CACHE_HELPER" ]; then
  # --- base-tag determinism and invalidation ---
  base_tag_1="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  base_tag_rc=$?
  base_tag_2="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  assert_eq "base-tag exits 0 on valid fixture" "$base_tag_rc" "0"
  assert_eq "base-tag is deterministic across repeated calls" "$base_tag_1" "$base_tag_2"

  if [[ "$base_tag_1" =~ ^node22\.23\.4-pnpm10\.6\.1-[0-9a-f]{12}$ ]]; then
    ok "base-tag incorporates Node version, pnpm version, and 12-hex Dockerfile.base digest ($base_tag_1)"
  else
    no "base-tag format matches node<ver>-pnpm<ver>-<12-hex> (got [$base_tag_1])"
  fi

  # Mutating Node version changes base-tag
  cp "$FIXTURE/package.json" "$WORK/package.json.orig"
  sed 's/"22\.23\.4"/"22.24.0"/' "$WORK/package.json.orig" > "$FIXTURE/package.json"
  base_tag_node="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  if [ "$base_tag_node" != "$base_tag_1" ] && [[ "$base_tag_node" == node22.24.0-* ]]; then
    ok "mutating pinned Node version changes base-tag"
  else
    no "mutating pinned Node version changes base-tag (orig=[$base_tag_1], mutated=[$base_tag_node])"
  fi
  cp "$WORK/package.json.orig" "$FIXTURE/package.json"

  # Mutating pnpm version changes base-tag
  sed 's/pnpm@10\.6\.1/pnpm@10.7.0/' "$WORK/package.json.orig" > "$FIXTURE/package.json"
  base_tag_pnpm="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  if [ "$base_tag_pnpm" != "$base_tag_1" ] && [[ "$base_tag_pnpm" == *-pnpm10.7.0-* ]]; then
    ok "mutating pinned pnpm version changes base-tag"
  else
    no "mutating pinned pnpm version changes base-tag (orig=[$base_tag_1], mutated=[$base_tag_pnpm])"
  fi
  cp "$WORK/package.json.orig" "$FIXTURE/package.json"

  # Mutating k8s/Dockerfile.base changes base-tag
  cp "$FIXTURE/k8s/Dockerfile.base" "$WORK/Dockerfile.base.orig"
  printf '# mutated base\n' >> "$FIXTURE/k8s/Dockerfile.base"
  base_tag_df="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  if [ "$base_tag_df" != "$base_tag_1" ]; then
    ok "mutating k8s/Dockerfile.base changes base-tag"
  else
    no "mutating k8s/Dockerfile.base changes base-tag (remained [$base_tag_1])"
  fi
  cp "$WORK/Dockerfile.base.orig" "$FIXTURE/k8s/Dockerfile.base"

  # Mutating unrelated app source does NOT change base-tag
  printf '// code edit\n' >> "$FIXTURE/apps/backend/src/main.ts"
  base_tag_code="$("$BUILD_CACHE_HELPER" base-tag --repo "$FIXTURE" 2>&1)"
  assert_eq "mutating unrelated app source leaves base-tag unchanged" "$base_tag_code" "$base_tag_1"
  git -C "$FIXTURE" checkout -- apps/backend/src/main.ts

  # --- deps-hash determinism and invalidation across every input ---
  deps_hash_1="$("$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" 2>&1)"
  deps_hash_rc=$?
  deps_hash_2="$("$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" 2>&1)"
  assert_eq "deps-hash exits 0 on valid fixture" "$deps_hash_rc" "0"
  assert_eq "deps-hash is deterministic across repeated calls" "$deps_hash_1" "$deps_hash_2"

  if [[ "$deps_hash_1" =~ ^[0-9a-f]{16}$ ]]; then
    ok "deps-hash is a 16-char lowercase hex digest ($deps_hash_1)"
  else
    no "deps-hash is a 16-char lowercase hex digest (got [$deps_hash_1])"
  fi

  # Independent specification list of files whose mutation must invalidate deps-hash.
  DEPS_MUTATION_INPUTS=(
    .npmrc
    package.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    apps/backend/package.json
    apps/commands/package.json
    apps/extension/package.json
    apps/frontend/package.json
    apps/frontend/scripts/fetch-gtm.mjs
    apps/orchestrator/package.json
    apps/sdk/package.json
    libraries/nestjs-libraries/src/database/prisma/schema.prisma
    k8s/Dockerfile.base
    k8s/Dockerfile.deps
    k8s/Dockerfile.runtime-deps
  )

  for rel in "${DEPS_MUTATION_INPUTS[@]}"; do
    backup="$WORK/backup_$(printf '%s' "$rel" | tr '/.' '__')"
    cp "$FIXTURE/$rel" "$backup"
    if [ "$rel" = "package.json" ]; then
      sed 's/"6\.5\.0"/"6.5.1"/' "$backup" > "$FIXTURE/$rel"
    else
      printf '\n# mutated %s\n' "$rel" >> "$FIXTURE/$rel"
    fi
    mutated_hash="$("$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" 2>&1)"
    mutated_rc=$?
    cp "$backup" "$FIXTURE/$rel"
    if [ "$mutated_rc" -eq 0 ] && [ "$mutated_hash" != "$deps_hash_1" ]; then
      ok "mutating $rel changes deps-hash"
    else
      no "mutating $rel changes deps-hash (rc=$mutated_rc, orig=[$deps_hash_1], mutated=[$mutated_hash])"
    fi
  done

  deps_hash_override="$("$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" --base-tag "node22.23.4-pnpm10.6.1-000000000000" 2>&1)"
  if [ "$deps_hash_override" != "$deps_hash_1" ]; then
    ok "passing a different --base-tag changes deps-hash"
  else
    no "passing a different --base-tag changes deps-hash"
  fi

  # Mutating unrelated app source or app Dockerfile does NOT change deps-hash
  printf '// code edit\n' >> "$FIXTURE/apps/backend/src/main.ts"
  printf '# app dockerfile edit\n' >> "$FIXTURE/k8s/Dockerfile"
  deps_hash_code="$("$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" 2>&1)"
  assert_eq "mutating app source and k8s/Dockerfile leaves deps-hash unchanged" "$deps_hash_code" "$deps_hash_1"
  git -C "$FIXTURE" checkout -- apps/backend/src/main.ts k8s/Dockerfile

  # --- required-inputs validation ---
  "$BUILD_CACHE_HELPER" validate-inputs --repo "$FIXTURE" >/dev/null 2>&1
  assert_eq "validate-inputs exits 0 when all required files exist" "$?" "0"

  "$BUILD_CACHE_HELPER" validate-inputs --repo "$REPO_ROOT" >/dev/null 2>&1
  assert_eq "validate-inputs exits 0 on the real repository root" "$?" "0"

  mv "$FIXTURE/pnpm-lock.yaml" "$WORK/pnpm-lock.yaml.bak"
  mv "$FIXTURE/k8s/Dockerfile.deps" "$WORK/Dockerfile.deps.bak"
  missing_out="$("$BUILD_CACHE_HELPER" validate-inputs --repo "$FIXTURE" 2>&1)"
  missing_rc=$?
  assert_eq "validate-inputs exits 1 when required inputs are missing" "$missing_rc" "1"
  if printf '%s' "$missing_out" | grep -q 'pnpm-lock.yaml' && printf '%s' "$missing_out" | grep -q 'k8s/Dockerfile.deps'; then
    ok "validate-inputs error lists all missing required inputs"
  else
    no "validate-inputs error lists all missing required inputs (got: $missing_out)"
  fi

  "$BUILD_CACHE_HELPER" deps-hash --repo "$FIXTURE" >/dev/null 2>&1
  if [ "$?" -ne 0 ]; then
    ok "deps-hash exits non-zero when a required input is missing"
  else
    no "deps-hash exits non-zero when a required input is missing"
  fi

  mv "$WORK/pnpm-lock.yaml.bak" "$FIXTURE/pnpm-lock.yaml"
  mv "$WORK/Dockerfile.deps.bak" "$FIXTURE/k8s/Dockerfile.deps"

  # --- clean-worktree guard & default-tag ---
  clean_state="$("$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" 2>&1)"
  assert_eq "check-worktree exits 0 on a clean repo" "$?" "0"
  assert_eq "check-worktree reports clean on a clean repo" "$clean_state" "clean"

  clean_tag="$("$BUILD_CACHE_HELPER" default-tag --repo "$FIXTURE" 2>&1)"
  assert_eq "default-tag returns 12-char HEAD sha on clean repo" "$clean_tag" "$FIXTURE_HEAD_SHORT"
  clean_tag_allow="$("$BUILD_CACHE_HELPER" default-tag --repo "$FIXTURE" --allow-dirty 2>&1)"
  assert_eq "default-tag --allow-dirty does not append -dirty on clean repo" "$clean_tag_allow" "$FIXTURE_HEAD_SHORT"

  # Modified tracked file (unstaged)
  printf '// unstaged edit\n' >> "$FIXTURE/apps/backend/src/main.ts"
  dirty_mod_err="$("$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" 2>&1)"
  assert_eq "check-worktree rejects modified tracked file with exit 2" "$?" "2"
  if printf '%s' "$dirty_mod_err" | grep -q -- '--allow-dirty'; then
    ok "dirty worktree error guides operator to --allow-dirty"
  else
    no "dirty worktree error guides operator to --allow-dirty (got: $dirty_mod_err)"
  fi

  dirty_mod_ok="$("$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" --allow-dirty 2>&1)"
  assert_eq "check-worktree accepts modified tracked file with --allow-dirty" "$?" "0"
  assert_eq "check-worktree reports dirty with --allow-dirty" "$dirty_mod_ok" "dirty"

  dirty_mod_tag="$("$BUILD_CACHE_HELPER" default-tag --repo "$FIXTURE" --allow-dirty 2>&1)"
  assert_eq "default-tag --allow-dirty appends -dirty suffix on modified repo" "$dirty_mod_tag" "${FIXTURE_HEAD_SHORT}-dirty"

  # Staged tracked file
  git -C "$FIXTURE" add apps/backend/src/main.ts
  "$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" >/dev/null 2>&1
  assert_eq "check-worktree rejects staged modification without --allow-dirty" "$?" "2"
  "$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" --allow-dirty >/dev/null 2>&1
  assert_eq "check-worktree accepts staged modification with --allow-dirty" "$?" "0"
  git -C "$FIXTURE" reset -q HEAD -- apps/backend/src/main.ts
  git -C "$FIXTURE" checkout -- apps/backend/src/main.ts

  # Untracked file
  printf 'untracked\n' > "$FIXTURE/untracked-file.txt"
  "$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" >/dev/null 2>&1
  assert_eq "check-worktree rejects untracked file without --allow-dirty" "$?" "2"
  "$BUILD_CACHE_HELPER" check-worktree --repo "$FIXTURE" --allow-dirty >/dev/null 2>&1
  assert_eq "check-worktree accepts untracked file with --allow-dirty" "$?" "0"
  dirty_untracked_tag="$("$BUILD_CACHE_HELPER" default-tag --repo "$FIXTURE" --allow-dirty 2>&1)"
  assert_eq "default-tag --allow-dirty appends -dirty suffix on untracked file" "$dirty_untracked_tag" "${FIXTURE_HEAD_SHORT}-dirty"
  rm -f "$FIXTURE/untracked-file.txt"

  # Non-git directory
  NON_GIT="$WORK/not-a-git-repo"
  mkdir -p "$NON_GIT"
  "$BUILD_CACHE_HELPER" check-worktree --repo "$NON_GIT" --allow-dirty >/dev/null 2>&1
  assert_eq "check-worktree rejects non-git directory with exit 2" "$?" "2"

  # --- public CLI outputs on the real repository root ---
  assert_eq "CLI node-version matches real repo package.json" \
    "$("$BUILD_CACHE_HELPER" node-version --repo "$REPO_ROOT")" "$EXPECTED_NODE"
  assert_eq "CLI pnpm-version matches real repo package.json" \
    "$("$BUILD_CACHE_HELPER" pnpm-version --repo "$REPO_ROOT")" "$EXPECTED_PNPM_VER"
  assert_eq "CLI prisma-version matches real repo package.json" \
    "$("$BUILD_CACHE_HELPER" prisma-version --repo "$REPO_ROOT")" "$EXPECTED_PRISMA"

  real_base_tag="$("$BUILD_CACHE_HELPER" base-tag --repo "$REPO_ROOT" 2>&1)"
  assert_eq "CLI base-tag exits 0 on real repo" "$?" "0"
  if [[ "$real_base_tag" =~ ^node${EXPECTED_NODE//./\\.}-pnpm${EXPECTED_PNPM_VER//./\\.}-[0-9a-f]{12}$ ]]; then
    ok "CLI base-tag matches pinned toolchain + 12-hex digest on real repo ($real_base_tag)"
  else
    no "CLI base-tag matches pinned toolchain + 12-hex digest on real repo (got [$real_base_tag])"
  fi

  real_deps_hash="$("$BUILD_CACHE_HELPER" deps-hash --repo "$REPO_ROOT" 2>&1)"
  assert_eq "CLI deps-hash exits 0 on real repo" "$?" "0"
  if [[ "$real_deps_hash" =~ ^[0-9a-f]{16}$ ]]; then
    ok "CLI deps-hash returns 16-hex digest on real repo ($real_deps_hash)"
  else
    no "CLI deps-hash returns 16-hex digest on real repo (got [$real_deps_hash])"
  fi
fi

report_and_exit "cache-layers"
