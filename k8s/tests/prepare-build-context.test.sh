#!/usr/bin/env bash
# ============================================================
# Tests for prepare-build-context.sh and the action separation.
#
# Runs entirely against a throwaway fixture repository in $TMPDIR.
# Never talks to a registry, a cluster, or the real build context.
#
# Usage: ./k8s/tests/prepare-build-context.test.sh
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PREPARER_SRC="$K8S_DIR/prepare-build-context.sh"

PASS=0
FAIL=0
FAILED_NAMES=()

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); printf '  FAIL %s\n' "$1"; }

assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else no "$1 (expected [$3], got [$2])"; fi
}

assert_file() {
  if [ -e "$1" ]; then ok "$2"; else no "$2 (missing $1)"; fi
}

assert_no_file() {
  if [ -e "$1" ]; then no "$2 (should be gone: $1)"; else ok "$2"; fi
}

# ------------------------------------------------------------
# Fixture repository
# ------------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/postiz-prepare-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FIXTURE="$WORK/repo"
mkdir -p "$FIXTURE"
git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.email "test@example.invalid"
git -C "$FIXTURE" config user.name "prepare test"
mkdir -p "$FIXTURE/k8s"
cp "$PREPARER_SRC" "$FIXTURE/k8s/prepare-build-context.sh"
chmod +x "$FIXTURE/k8s/prepare-build-context.sh"
# The preparer and the build scripts share one JSON helper; it lives in the
# context, so the fixture needs it too.
mkdir -p "$FIXTURE/k8s/lib"
cp "$K8S_DIR/lib/json.sh" "$FIXTURE/k8s/lib/json.sh"

# Required inputs are read from the preparer so the fixture cannot drift.
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$FIXTURE/$(dirname -- "$rel")"
  printf 'fixture %s\n' "$rel" > "$FIXTURE/$rel"
done < <(
  sed -n '/^REQUIRED_INPUTS=(/,/^)/p' "$PREPARER_SRC" \
    | grep -v '^REQUIRED_INPUTS=(' \
    | grep -v '^)' \
    | tr -d ' ' \
    | tr -d '"'
)

mkdir -p "$FIXTURE/apps/backend/src" "$FIXTURE/libraries/helpers/src" "$FIXTURE/var/docker"
printf 'export const main = 1;\n' > "$FIXTURE/apps/backend/src/main.ts"
printf 'export const helper = 1;\n' > "$FIXTURE/libraries/helpers/src/helper.ts"
# The real context carries files the root does not; they must survive.
printf 'context only\n' > "$FIXTURE/k8s/Dockerfile"
printf 'context only\n' > "$FIXTURE/k8s/.dockerignore"

git -C "$FIXTURE" add -A
git -C "$FIXTURE" commit -q -m "fixture"

commit_all() {
  git -C "$FIXTURE" add -A
  git -C "$FIXTURE" commit -q -m "fixture: $1"
}

PREPARE="$FIXTURE/k8s/prepare-build-context.sh"
CTX="$FIXTURE/k8s"

echo "prepare-build-context: first run"

out="$("$PREPARE" 2>&1)"
assert_eq "exits 0 on a clean tree" "$?" "0"
assert_file "$CTX/BUILD_CONTEXT_MANIFEST.json" "writes a manifest"
assert_file "$CTX/apps/backend/src/main.ts" "copies app source"
assert_file "$CTX/libraries/helpers/src/helper.ts" "copies shared library source"
assert_file "$CTX/Dockerfile" "preserves context-only Dockerfile"
assert_file "$CTX/.dockerignore" "preserves context-only dockerignore"

if grep -q '"sourceCommit"' "$CTX/BUILD_CONTEXT_MANIFEST.json"; then
  ok "manifest records the source commit"
else
  no "manifest records the source commit"
fi
if grep -q '"sha256"' "$CTX/BUILD_CONTEXT_MANIFEST.json"; then
  ok "manifest records input digests"
else
  no "manifest records input digests"
fi

echo ""
echo "prepare-build-context: dirty tree guard"

printf 'dirty\n' > "$FIXTURE/untracked.txt"
"$PREPARE" >/dev/null 2>&1
assert_eq "refuses a dirty tree without --allow-dirty" "$?" "2"

"$PREPARE" --allow-dirty >/dev/null 2>&1
assert_eq "accepts a dirty tree with --allow-dirty" "$?" "0"

if grep -q '"worktreeState": "dirty"' "$CTX/BUILD_CONTEXT_MANIFEST.json"; then
  ok "manifest marks the candidate dirty"
else
  no "manifest marks the candidate dirty"
fi

if grep -q '"worktreeDigest"' "$CTX/BUILD_CONTEXT_MANIFEST.json"; then
  ok "manifest records a worktree digest"
else
  no "manifest records a worktree digest"
fi

rm -f "$FIXTURE/untracked.txt"

echo ""
echo "prepare-build-context: add / modify / delete"

printf 'export const added = 1;\n' > "$FIXTURE/apps/backend/src/added.ts"
commit_all "add source"
"$PREPARE" >/dev/null 2>&1
assert_file "$CTX/apps/backend/src/added.ts" "added source reaches the context"

printf 'export const main = 2;\n' > "$FIXTURE/apps/backend/src/main.ts"
commit_all "modify source"
"$PREPARE" >/dev/null 2>&1
assert_eq "modified source is refreshed" \
  "$(cat "$CTX/apps/backend/src/main.ts")" "export const main = 2;"

rm -f "$FIXTURE/apps/backend/src/added.ts"
commit_all "delete source"
"$PREPARE" >/dev/null 2>&1
assert_no_file "$CTX/apps/backend/src/added.ts" "deleted source is dropped from the context"

echo ""
echo "prepare-build-context: repeated prepare keeps no stale copies"

printf 'stale\n' > "$CTX/apps/backend/src/stale.ts"
printf 'stale\n' > "$CTX/libraries/helpers/src/stale.ts"
"$PREPARE" >/dev/null 2>&1
assert_no_file "$CTX/apps/backend/src/stale.ts" "stale app copy removed on re-prepare"
assert_no_file "$CTX/libraries/helpers/src/stale.ts" "stale library copy removed on re-prepare"

echo ""
echo "prepare-build-context: exclusions"

mkdir -p "$FIXTURE/apps/backend/node_modules/pkg" "$FIXTURE/apps/frontend/dist"
printf 'x\n' > "$FIXTURE/apps/backend/node_modules/pkg/index.js"
printf 'x\n' > "$FIXTURE/apps/frontend/dist/bundle.js"
printf 'SECRET=1\n' > "$FIXTURE/apps/backend/.env"
commit_all "excluded material"
"$PREPARE" >/dev/null 2>&1
assert_no_file "$CTX/apps/backend/node_modules" "node_modules is excluded"
assert_no_file "$CTX/apps/frontend/dist" "build output is excluded"
assert_no_file "$CTX/apps/backend/.env" "environment files are excluded"

echo ""
echo "prepare-build-context: missing required input"

mv "$FIXTURE/tsconfig.json" "$WORK/tsconfig.json.bak"
commit_all "drop required input"
"$PREPARE" >/dev/null 2>&1
assert_eq "fails with exit 1 when a required input is missing" "$?" "1"
mv "$WORK/tsconfig.json.bak" "$FIXTURE/tsconfig.json"
commit_all "restore required input"

"$PREPARE" >/dev/null 2>&1
assert_eq "recovers once the input is back" "$?" "0"

echo ""
echo "prepare-build-context: --check"

"$PREPARE" --check >/dev/null 2>&1
assert_eq "--check passes on a synced context" "$?" "0"

printf 'drifted\n' > "$CTX/apps/backend/src/drift.ts"
"$PREPARE" --check >/dev/null 2>&1
assert_eq "--check fails when the context drifted" "$?" "1"
assert_file "$CTX/apps/backend/src/drift.ts" "--check never writes"
rm -f "$CTX/apps/backend/src/drift.ts"

printf 'drift\n' > "$CTX/package.json"
"$PREPARE" --check >/dev/null 2>&1
assert_eq "--check fails when a generated file drifted" "$?" "1"

"$PREPARE" >/dev/null 2>&1

echo ""
echo "prepare-build-context: --check is read-only"

"$PREPARE" --check --context k8s-absent-context >/dev/null 2>&1
assert_eq "--check reports drift when the context is missing" "$?" "1"
assert_no_file "$FIXTURE/k8s-absent-context" "--check never creates a missing context directory"

echo ""
echo "action separation"

STUB="$WORK/stubs"
mkdir -p "$STUB"
CALLS="$WORK/calls.log"

cat > "$STUB/docker" <<'STUBEOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_CALLS"
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  echo "sha256:stubimage"
  exit 0
fi
if [ "${STUB_DOCKER_FAIL:-0}" = "1" ]; then
  echo "docker build failed" >&2
  exit 1
fi
exit 0
STUBEOF
cat > "$STUB/az" <<'STUBEOF'
#!/usr/bin/env bash
echo "az $*" >> "$STUB_CALLS"
exit 0
STUBEOF
cat > "$STUB/kubectl" <<'STUBEOF'
#!/usr/bin/env bash
echo "kubectl $*" >> "$STUB_CALLS"
exit 0
STUBEOF
chmod +x "$STUB/docker" "$STUB/az" "$STUB/kubectl"

cp "$K8S_DIR/build-local.sh" "$CTX/build-local.sh"
cp "$K8S_DIR/build-postiz.sh" "$CTX/build-postiz.sh"
cp "$K8S_DIR/deploy-postiz.sh" "$CTX/deploy-postiz.sh"
cp "$K8S_DIR/public-build-config.env" "$CTX/public-build-config.env"
chmod +x "$CTX/build-local.sh" "$CTX/build-postiz.sh" "$CTX/deploy-postiz.sh"

echo ""
echo "shared JSON helper"

# shellcheck source=../lib/json.sh
. "$K8S_DIR/lib/json.sh"
assert_eq "json_escape escapes newline, tab, CR, quote and backslash" \
  "$(json_escape $'a\nb\tc\rd"e\\f')" 'a\nb\tc\rd\"e\\f'
if grep -q 'lib/json.sh' "$K8S_DIR/build-local.sh" && grep -q 'lib/json.sh' "$K8S_DIR/prepare-build-context.sh"; then
  ok "both scripts source the shared helper"
else
  no "both scripts source the shared helper"
fi
if grep -Eq '^json_escape\(\)' "$K8S_DIR/build-local.sh"; then
  no "build-local keeps no weaker local json_escape"
else
  ok "build-local keeps no weaker local json_escape"
fi

echo ""
echo "dirty tree stays visible through the build entry points"

printf 'dirty\n' > "$FIXTURE/untracked.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/build-local.sh" --prepare --tag stub:dirty \
  >"$WORK/build-local-dirty.log" 2>&1
assert_eq "build-local --prepare fails on a dirty tree" "$?" "2"
if grep -q '^docker ' "$CALLS"; then
  no "a dirty tree never reaches docker build"
else
  ok "a dirty tree never reaches docker build"
fi
if grep -q -- '--allow-dirty' "$WORK/build-local-dirty.log"; then
  ok "the failure tells the operator how to proceed"
else
  no "the failure tells the operator how to proceed"
fi
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/build-postiz.sh" --prepare \
  >"$WORK/build-postiz-dirty.log" 2>&1
assert_eq "build-postiz --prepare fails on a dirty tree" "$?" "2"
rm -f "$FIXTURE/untracked.txt"

: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/build-local.sh" --prepare --tag stub:clean \
  >"$WORK/build-local-prepare.log" 2>&1
assert_eq "build-local --prepare succeeds on a clean tree" "$?" "0"

: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/build-local.sh" --tag stub:candidate >"$WORK/build-local.log" 2>&1
BL_STATUS=$?
assert_eq "build-local exits 0 with a stubbed docker" "$BL_STATUS" "0"
if [ "$BL_STATUS" -ne 0 ]; then
  sed 's/^/       | /' "$WORK/build-local.log"
fi
if grep -q '^docker build' "$CALLS"; then
  ok "build-local calls docker build"
else
  no "build-local calls docker build"
fi
if grep -qE '^(az|kubectl) ' "$CALLS"; then
  no "build-local performs no registry login, push or rollout"
else
  ok "build-local performs no registry login, push or rollout"
fi
if grep -q 'postiz-candidate' "$CALLS" || grep -q 'stub:candidate' "$CALLS"; then
  ok "build-local tags the candidate image"
else
  no "build-local tags the candidate image"
fi

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_DOCKER_FAIL=1 PATH="$STUB:$PATH" "$CTX/build-local.sh" --tag stub:fail >/dev/null 2>&1
assert_eq "build-local propagates a docker failure" "$?" "1"
if grep -qE '^(az|kubectl) ' "$CALLS"; then
  no "a failed local build still never publishes"
else
  ok "a failed local build still never publishes"
fi

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/build-postiz.sh" --local example.invalid/app/postiz:t >/dev/null 2>&1
assert_eq "publish --local accepts an image as the last argument" "$?" "0"
if grep -q '^docker push example.invalid/app/postiz:' "$CALLS"; then
  ok "publish --local pushes the given image"
else
  no "publish --local pushes the given image"
fi

: > "$CALLS"
printf 'drift\n' > "$CTX/apps/backend/src/drift2.ts"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/build-postiz.sh" >/dev/null 2>&1
assert_eq "publish refuses a stale context" "$?" "1"
if grep -qE '^kubectl ' "$CALLS"; then
  no "publish never deploys"
else
  ok "publish never deploys"
fi
rm -f "$CTX/apps/backend/src/drift2.ts"
"$PREPARE" >/dev/null 2>&1

: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/deploy-postiz.sh" --image example.invalid/app/postiz:t >/dev/null 2>&1
assert_eq "deploy exits 0 with a stubbed kubectl" "$?" "0"
if grep -q '^kubectl set image' "$CALLS"; then
  ok "deploy only runs kubectl set image"
else
  no "deploy only runs kubectl set image"
fi
if grep -qE '^(az|docker) ' "$CALLS"; then
  no "deploy never builds or publishes"
else
  ok "deploy never builds or publishes"
fi

: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$CTX/deploy-postiz.sh" >/dev/null 2>&1
assert_eq "deploy requires --image" "$?" "2"

echo ""
echo "one-command wrapper"

cp "$K8S_DIR/publish-and-deploy.sh" "$CTX/publish-and-deploy.sh"
chmod +x "$CTX/publish-and-deploy.sh"
FIXTURE_TAG="$(git -C "$FIXTURE" rev-parse --short=12 HEAD)"
WRAPPER_ENV="BUILD_ACR_HOST=example.invalid"

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --dry-run --deploy >"$WORK/wrapper-dry.log" 2>&1
assert_eq "wrapper --dry-run exits 0" "$?" "0"
if [ -s "$CALLS" ]; then
  no "wrapper --dry-run touches nothing"
else
  ok "wrapper --dry-run touches nothing"
fi
if grep -q 'would run' "$WORK/wrapper-dry.log"; then
  ok "wrapper --dry-run prints the plan"
else
  no "wrapper --dry-run prints the plan"
fi

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" >"$WORK/wrapper-publish.log" 2>&1
assert_eq "wrapper prepare + publish exits 0" "$?" "0"
if grep -q '^az acr build' "$CALLS"; then
  ok "wrapper publishes through the ACR build"
else
  no "wrapper publishes through the ACR build"
fi
if grep -qE '^kubectl ' "$CALLS"; then
  no "wrapper does not deploy without --deploy"
else
  ok "wrapper does not deploy without --deploy"
fi

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --deploy >"$WORK/wrapper-deploy.log" 2>&1
assert_eq "wrapper --deploy exits 0" "$?" "0"
if grep -q "^kubectl set image deployment/postiz postiz=example.invalid/app/postiz:${FIXTURE_TAG} " "$CALLS"; then
  ok "wrapper --deploy rolls out the image it published"
else
  no "wrapper --deploy rolls out the image it published"
fi

printf 'dirty\n' > "$FIXTURE/untracked.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --deploy >/dev/null 2>&1
assert_eq "wrapper stops on a dirty tree" "$?" "2"
if grep -qE '^(az|kubectl) ' "$CALLS"; then
  no "a dirty tree never reaches publish or deploy"
else
  ok "a dirty tree never reaches publish or deploy"
fi
rm -f "$FIXTURE/untracked.txt"

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --local >/dev/null 2>&1
assert_eq "wrapper --local requires an image" "$?" "2"

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --local example.invalid/app/postiz:local some-tag >/dev/null 2>&1
assert_eq "wrapper rejects --local with an explicit tag" "$?" "2"

# --local skips the preparer: a stray context file survives the run.
STRAY="$CTX/stray-from-test.txt"
printf 'stray\n' > "$STRAY"
: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --local example.invalid/app/postiz:local >/dev/null 2>&1
assert_eq "wrapper --local exits 0" "$?" "0"
assert_file "$STRAY" "wrapper --local skips the preparer"
if grep -q '^docker push .*example.invalid/app/postiz:latest' "$CALLS"; then
  ok "wrapper --local pushes through the registry"
else
  no "wrapper --local pushes through the registry"
fi
rm -f "$STRAY"

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$CTX/publish-and-deploy.sh" --bogus >/dev/null 2>&1
assert_eq "wrapper rejects an unknown argument" "$?" "2"

echo ""
echo "--------------------------------------------"
printf 'passed: %d, failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf 'failing: %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
