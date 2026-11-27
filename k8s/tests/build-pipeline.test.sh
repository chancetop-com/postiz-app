#!/usr/bin/env bash
# ============================================================
# Offline stubbed-CLI fixture tests for the four-layer build,
# ACR publish and publish-and-deploy pipeline (ADR-0001).
#
# Runs entirely inside throwaway Git repositories with stubbed
# `docker`, `az`, and `kubectl` binaries ahead on PATH.
# Never talks to a real registry, cluster, or Docker daemon.
#
# Usage: ./k8s/tests/build-pipeline.test.sh
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/assert.sh
. "$SCRIPT_DIR/lib/assert.sh"
# shellcheck source=lib/fixture.sh
. "$SCRIPT_DIR/lib/fixture.sh"

# ------------------------------------------------------------
# Throwaway Git fixture repository & stateful CLI stubs
# ------------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/postiz-pipeline-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FIXTURE="$WORK/repo"
setup_test_fixture_repo "$FIXTURE" "pipeline test" "$K8S_DIR"

# Resolve physical fixture path (macOS /var -> /private/var)
FIXTURE_PHYS="$(git -C "$FIXTURE" rev-parse --show-toplevel)"
FIXTURE_K8S="$FIXTURE_PHYS/k8s"
HEAD_FULL="$(git -C "$FIXTURE_PHYS" rev-parse HEAD)"
HEAD_SHORT="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
BASE_TAG="$("$FIXTURE_K8S/lib/build-cache.sh" base-tag --repo "$FIXTURE_PHYS")"
DEPS_HASH="$("$FIXTURE_K8S/lib/build-cache.sh" deps-hash --repo "$FIXTURE_PHYS" --base-tag "$BASE_TAG")"

STUB="$WORK/stubs"
mkdir -p "$STUB"
CALLS="$WORK/calls.log"
LOCAL_IMAGES="$WORK/local-images.txt"
ACR_IMAGES="$WORK/acr-images.txt"

export STUB_LOCAL_IMAGES="$LOCAL_IMAGES" STUB_ACR_IMAGES="$ACR_IMAGES"
unset SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT DOCKER_DEFAULT_PLATFORM
touch "$ACR_IMAGES" "$LOCAL_IMAGES"
export STUB_CLI_IMPL="$SCRIPT_DIR/lib/build-cli.cjs"
for cli in docker az kubectl; do
  cat > "$STUB/$cli" <<'STUBEOF'
#!/usr/bin/env bash
exec node "$STUB_CLI_IMPL" "${0##*/}" "$@"
STUBEOF
done
chmod +x "$STUB/docker" "$STUB/az" "$STUB/kubectl"

# ------------------------------------------------------------
# Slice 2: k8s/build-local.sh
# ------------------------------------------------------------
echo ""
echo "build-local.sh: cold local 4-layer build"
: > "$CALLS"
: > "$LOCAL_IMAGES"
rm -f "$FIXTURE_K8S/BUILD_PROVENANCE.json"

STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" >"$WORK/local-cold.log" 2>&1
rc=$?
assert_eq "build-local cold build exits 0" "$rc" "0"
if [ "$rc" -ne 0 ]; then sed 's/^/       | /' "$WORK/local-cold.log"; fi

assert_not_regex "build-local never invokes az, kubectl, docker login/push/pull" "$CALLS" '^(az |kubectl |docker (login|push|pull) )'
assert_not_regex "build-local never passes NEXT_PUBLIC_* build args" "$CALLS" 'NEXT_PUBLIC_'
assert_not_regex "build-local normal cold build omits --no-cache" "$CALLS" '--no-cache'

# Verify exact ordered 4-layer docker build sequence from repo root
assert_eq "cold local build runs four stages" "$(grep -c '^docker build ' "$CALLS")" 4
assert_contains "runtime build uses resolved local base" "$CALLS" "--build-arg BASE_IMAGE=postiz-base:id-"
assert_contains "app uses resolved local deps" "$CALLS" "--build-arg DEPS_IMAGE=postiz-deps:id-"
assert_contains "app uses pinned runtime deps" "$CALLS" "--build-arg RUNTIME_DEPS_IMAGE=postiz-runtime-deps:id-"

assert_file "$FIXTURE_K8S/BUILD_PROVENANCE.json" "build-local writes k8s/BUILD_PROVENANCE.json"
if PROV="$FIXTURE_K8S/BUILD_PROVENANCE.json" HEAD_FULL="$HEAD_FULL" HEAD_SHORT="$HEAD_SHORT" BASE_TAG="$BASE_TAG" DEPS_HASH="$DEPS_HASH" node -e '
  const fs = require("node:fs");
  const p = JSON.parse(fs.readFileSync(process.env.PROV, "utf8"));
  const checks = [
    [p.imageTag === `postiz-candidate:${process.env.HEAD_SHORT}`, "imageTag matches default postiz-candidate:<short-sha>"],
    [p.published === false && p.registryDigest === null, "published=false and registryDigest=null"],
    [p.source?.commit === process.env.HEAD_FULL, "source.commit matches HEAD"],
    [p.source?.worktreeState === "clean", "source.worktreeState is clean"],
    [p.source?.worktreeDigest === null, "source.worktreeDigest is null when clean"],
    [p.source?.buildContext === ".", "source.buildContext is repo root"],
    [p.cacheLayers?.baseTag === process.env.BASE_TAG, "cacheLayers.baseTag recorded"],
    [p.cacheLayers?.depsHash === process.env.DEPS_HASH, "cacheLayers.depsHash recorded"],
    [p.cacheLayers?.base?.image === `postiz-base:${process.env.BASE_TAG}-linux-arm64` && p.cacheLayers?.base?.cacheStatus === "built", "cacheLayers.base recorded as built"],
    [p.cacheLayers?.deps?.image === `postiz-deps:${process.env.DEPS_HASH}-linux-arm64` && p.cacheLayers?.deps?.cacheStatus === "built", "cacheLayers.deps recorded as built"],
    [p.cacheLayers?.runtimeDeps?.image.startsWith(`postiz-runtime-deps:${process.env.DEPS_HASH}-`) && p.cacheLayers?.runtimeDeps?.cacheStatus === "built", "cacheLayers.runtimeDeps recorded as built"],
    [p.toolchain?.node === "22.23.4" && p.toolchain?.pnpm === "10.6.1" && p.toolchain?.prisma === "6.5.0", "toolchain versions recorded"],
    [typeof p.inputs?.lockfile?.sha256 === "string" && p.inputs.lockfile.sha256.length === 64, "inputs.lockfile sha256 recorded"],
    [typeof p.inputs?.dockerfileBase?.sha256 === "string" && typeof p.inputs?.dockerfile?.sha256 === "string", "layered Dockerfile digests recorded"],
  ];
  let fail = 0;
  for (const [okFlag, msg] of checks) {
    if (!okFlag) { console.error("FAIL: " + msg); fail++; }
  }
  process.exit(fail === 0 ? 0 : 1);
'; then
  ok "BUILD_PROVENANCE.json is valid JSON with cache layers, source state, toolchain, and digests"
else
  no "BUILD_PROVENANCE.json is valid JSON with cache layers, source state, toolchain, and digests"
fi

echo ""
echo "build-local.sh: warm local cache hit"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" >"$WORK/local-warm.log" 2>&1
assert_eq "build-local warm build exits 0" "$?" "0"

warm_build_count="$(grep -c '^docker build ' "$CALLS" || true)"
assert_eq "build-local warm build runs only 1 docker build (app layer)" "$warm_build_count" "1"
assert_not_regex "build-local warm build skips Dockerfile.base" "$CALLS" 'Dockerfile\.base'
assert_not_regex "build-local warm build skips Dockerfile.deps" "$CALLS" 'Dockerfile\.deps'
assert_not_regex "build-local warm build skips Dockerfile.runtime-deps" "$CALLS" 'Dockerfile\.runtime-deps'
assert_not_regex "build-local warm build omits --no-cache" "$CALLS" '--no-cache'
if PROV="$FIXTURE_K8S/BUILD_PROVENANCE.json" node -e '
  const p = JSON.parse(require("node:fs").readFileSync(process.env.PROV, "utf8"));
  process.exit(
    p.cacheLayers?.base?.cacheStatus === "hit" &&
    p.cacheLayers?.deps?.cacheStatus === "hit" &&
    p.cacheLayers?.runtimeDeps?.cacheStatus === "hit" ? 0 : 1
  );
'; then
  ok "BUILD_PROVENANCE.json records all 3 cache layers as hit"
else
  no "BUILD_PROVENANCE.json records all 3 cache layers as hit"
fi

echo ""
echo "build-local.sh: partial cache miss (lockfile changed)"
printf '# lockfile bump\n' >> "$FIXTURE_PHYS/pnpm-lock.yaml"
git -C "$FIXTURE_PHYS" add pnpm-lock.yaml
git -C "$FIXTURE_PHYS" commit -q -m "bump lockfile"
NEW_HEAD_SHORT="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
NEW_DEPS_HASH="$("$FIXTURE_K8S/lib/build-cache.sh" deps-hash --repo "$FIXTURE_PHYS" --base-tag "$BASE_TAG")"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" >"$WORK/local-partial.log" 2>&1
assert_eq "build-local partial miss exits 0" "$?" "0"
partial_build_count="$(grep -c '^docker build ' "$CALLS" || true)"
assert_eq "build-local partial miss skips base and runs 3 docker builds (deps, runtime-deps, app)" "$partial_build_count" "3"
assert_not_regex "build-local partial miss skips Dockerfile.base" "$CALLS" 'Dockerfile\.base'
assert_not_regex "build-local partial miss omits --no-cache" "$CALLS" '--no-cache'
assert_regex "build-local partial miss builds new postiz-deps:<new-hash>" "$CALLS" "docker build .*Dockerfile\\.deps.*--tag postiz-deps:${NEW_DEPS_HASH}"
assert_regex "build-local partial miss builds new postiz-runtime-deps:<new-hash>" "$CALLS" "docker build .*Dockerfile\\.runtime-deps.*--tag postiz-runtime-deps:${NEW_DEPS_HASH}"

echo ""
echo "build-local.sh: --rebuild-cache forces all 3 cache layers with --no-cache"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" --rebuild-cache --tag custom:rebuilt >"$WORK/local-rebuild.log" 2>&1
assert_eq "build-local --rebuild-cache exits 0" "$?" "0"
assert_regex "build-local --tag overrides app image tag" "$CALLS" 'docker build .*--tag custom:rebuilt '
if CALLS_FILE="$CALLS" node -e '
  const fs = require("node:fs");
  const builds = fs.readFileSync(process.env.CALLS_FILE, "utf8").trim().split("\n").filter((l) => l.startsWith("docker build "));
  const checks = [
    [builds.length === 4, `expected 4 builds, got ${builds.length}`],
    [builds.every((cmd, i) => cmd.includes("--pull") === (i < 2)), "only the two public Node parents are pulled on refresh"],
    [builds[0]?.includes("Dockerfile.base") && builds[0]?.includes("--no-cache"), "layer 1 (base) passes --no-cache under --rebuild-cache"],
    [builds[1]?.includes("Dockerfile.deps") && builds[1]?.includes("--no-cache"), "layer 2 (deps) passes --no-cache under --rebuild-cache"],
    [builds[2]?.includes("Dockerfile.runtime-deps") && builds[2]?.includes("--no-cache"), "layer 3 (runtime-deps) passes --no-cache under --rebuild-cache"],
    [builds[3]?.includes("k8s/Dockerfile ") && !builds[3]?.includes("--no-cache"), "layer 4 (app) omits --no-cache"],
  ];
  let fail = 0;
  for (const [okFlag, msg] of checks) {
    if (!okFlag) { console.error("FAIL: " + msg + "\n  builds=" + JSON.stringify(builds, null, 2)); fail++; }
  }
  process.exit(fail === 0 ? 0 : 1);
'; then
  ok "build-local --rebuild-cache passes --no-cache to all 3 cache layers and omits it on app layer"
else
  no "build-local --rebuild-cache passes --no-cache to all 3 cache layers and omits it on app layer"
fi
if PROV="$FIXTURE_K8S/BUILD_PROVENANCE.json" node -e '
  const p = JSON.parse(require("node:fs").readFileSync(process.env.PROV, "utf8"));
  process.exit(
    p.imageTag === "custom:rebuilt" &&
    p.cacheLayers?.base?.cacheStatus === "rebuilt" &&
    p.cacheLayers?.deps?.cacheStatus === "rebuilt" &&
    p.cacheLayers?.runtimeDeps?.cacheStatus === "rebuilt" ? 0 : 1
  );
'; then
  ok "BUILD_PROVENANCE.json records custom tag and rebuilt cache statuses"
else
  no "BUILD_PROVENANCE.json records custom tag and rebuilt cache statuses"
fi

echo ""
echo "build-local.sh: dirty tree guard & --allow-dirty"
printf 'dirty\n' > "$FIXTURE_PHYS/untracked.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" >"$WORK/local-dirty.log" 2>&1
assert_eq "build-local rejects dirty tree by default with exit 2" "$?" "2"
assert_not_regex "dirty tree never reaches docker" "$CALLS" '^docker '
assert_regex "dirty tree error guides operator to --allow-dirty" "$WORK/local-dirty.log" '--allow-dirty'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" --allow-dirty >"$WORK/local-allow-dirty.log" 2>&1
assert_eq "build-local --allow-dirty succeeds on dirty tree" "$?" "0"
assert_regex "build-local --allow-dirty appends -dirty suffix to postiz-candidate tag" "$CALLS" "docker build .*--tag postiz-candidate:${NEW_HEAD_SHORT}-dirty "
if PROV="$FIXTURE_K8S/BUILD_PROVENANCE.json" NEW_HEAD_SHORT="$NEW_HEAD_SHORT" node -e '
  const p = JSON.parse(require("node:fs").readFileSync(process.env.PROV, "utf8"));
  process.exit(
    p.imageTag === `postiz-candidate:${process.env.NEW_HEAD_SHORT}-dirty` &&
    p.source?.worktreeState === "dirty" &&
    typeof p.source?.worktreeDigest === "string" &&
    /^[0-9a-f]{64}$/.test(p.source.worktreeDigest) ? 0 : 1
  );
'; then
  ok "BUILD_PROVENANCE.json records postiz-candidate:<sha>-dirty, dirty worktreeState, and 64-hex worktreeDigest"
else
  no "BUILD_PROVENANCE.json records postiz-candidate:<sha>-dirty, dirty worktreeState, and 64-hex worktreeDigest"
fi
rm -f "$FIXTURE_PHYS/untracked.txt"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" --allow-dirty >"$WORK/local-allow-dirty-clean.log" 2>&1
assert_eq "build-local --allow-dirty on clean tree exits 0" "$?" "0"
assert_regex "build-local --allow-dirty on clean tree omits -dirty suffix" "$CALLS" "docker build .*--tag postiz-candidate:${NEW_HEAD_SHORT} "

echo ""
echo "build-local.sh: error handling"
mv "$FIXTURE_PHYS/tsconfig.json" "$WORK/tsconfig.json.bak"
git -C "$FIXTURE_PHYS" add -A && git -C "$FIXTURE_PHYS" commit -q -m "drop tsconfig"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" >/dev/null 2>&1
assert_eq "build-local exits 1 when a required input is missing" "$?" "1"
assert_not_regex "missing required input never reaches docker" "$CALLS" '^docker '
mv "$WORK/tsconfig.json.bak" "$FIXTURE_PHYS/tsconfig.json"
git -C "$FIXTURE_PHYS" add -A && git -C "$FIXTURE_PHYS" commit -q -m "restore tsconfig"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_LOCAL_IMAGES="$LOCAL_IMAGES" STUB_DOCKER_FAIL=1 PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-local.sh" --tag stub:fail >/dev/null 2>&1
assert_eq "build-local propagates docker build failure" "$?" "1"
assert_not_regex "failed build-local still never invokes az, kubectl, login, or push" "$CALLS" '^(az |kubectl |docker (login|push) )'

# ------------------------------------------------------------
# Slice 3: k8s/build-postiz.sh
# ------------------------------------------------------------
CURRENT_HEAD_SHORT="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
CURRENT_DEPS_HASH="$("$FIXTURE_K8S/lib/build-cache.sh" deps-hash --repo "$FIXTURE_PHYS" --base-tag "$BASE_TAG")"

echo ""
echo "build-postiz.sh: cold ACR (missing cache repos treated as miss)"
: > "$CALLS"
: > "$ACR_IMAGES"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >"$WORK/acr-cold.log" 2>&1
rc=$?
assert_eq "build-postiz cold ACR build exits 0" "$rc" "0"
if [ "$rc" -ne 0 ]; then sed 's/^/       | /' "$WORK/acr-cold.log"; fi

assert_not_regex "build-postiz never invokes kubectl" "$CALLS" '^kubectl '
assert_not_regex "build-postiz never passes NEXT_PUBLIC_* build args" "$CALLS" 'NEXT_PUBLIC_'
assert_regex "build-postiz logs in to ACR" "$CALLS" '^az acr login --name TestAcr$'

assert_eq "cold publish builds three cache layers" "$(grep -c '^az acr build ' "$CALLS")" 3
assert_eq "cold publish builds the application once" "$(grep -c '^az acr run ' "$CALLS")" 1
assert_contains "runtime is built from pinned base" "$CALLS" "BASE_IMAGE=example.invalid/ops/postiz-base@sha256:"
assert_contains "runtime is built from pinned deps" "$CALLS" "DEPS_IMAGE=example.invalid/ops/postiz-deps@sha256:"
assert_contains "app task gets immutable deps" "$CALLS" "depsImage=example.invalid/ops/postiz-deps@sha256:"
assert_contains "app task gets immutable runtime" "$CALLS" "runtimeImage=example.invalid/ops/postiz-runtime-deps@sha256:"

echo ""
echo "build-postiz.sh: warm ACR cache hit"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >"$WORK/acr-warm.log" 2>&1
assert_eq "build-postiz warm ACR build exits 0" "$?" "0"
acr_warm_builds="$(grep -Ec '^az acr (build|run) ' "$CALLS" || true)"
assert_eq "build-postiz warm ACR runs only 1 az acr build (app layer)" "$acr_warm_builds" "1"
assert_not_regex "build-postiz warm ACR skips Dockerfile.base" "$CALLS" 'Dockerfile\.base'
assert_not_regex "build-postiz warm ACR skips Dockerfile.deps" "$CALLS" 'Dockerfile\.deps'
assert_not_regex "build-postiz warm ACR skips Dockerfile.runtime-deps" "$CALLS" 'Dockerfile\.runtime-deps'
assert_not_regex "build-postiz warm ACR never invokes kubectl" "$CALLS" '^kubectl '

echo ""
echo "build-postiz.sh: partial ACR cache miss (schema.prisma changed)"
printf '// schema change\n' >> "$FIXTURE_PHYS/libraries/nestjs-libraries/src/database/prisma/schema.prisma"
git -C "$FIXTURE_PHYS" add libraries/nestjs-libraries/src/database/prisma/schema.prisma
git -C "$FIXTURE_PHYS" commit -q -m "bump schema"
SCHEMA_HEAD_SHORT="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
SCHEMA_DEPS_HASH="$("$FIXTURE_K8S/lib/build-cache.sh" deps-hash --repo "$FIXTURE_PHYS" --base-tag "$BASE_TAG")"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >"$WORK/acr-partial.log" 2>&1
assert_eq "build-postiz partial miss exits 0" "$?" "0"
acr_partial_builds="$(grep -Ec '^az acr (build|run) ' "$CALLS" || true)"
assert_eq "build-postiz partial miss skips base and runs 3 az acr builds" "$acr_partial_builds" "3"
assert_not_regex "build-postiz partial miss skips Dockerfile.base" "$CALLS" 'Dockerfile\.base'
assert_regex "build-postiz partial miss builds ops/postiz-deps:<new-hash>" "$CALLS" "az acr build .*--image ops/postiz-deps:${SCHEMA_DEPS_HASH} "
assert_regex "build-postiz partial miss builds ops/postiz-runtime-deps:<new-hash>" "$CALLS" "az acr build .*--image ops/postiz-runtime-deps:${SCHEMA_DEPS_HASH}-[a-f0-9]+ "

echo ""
echo "build-postiz.sh: --rebuild-cache and positional tag"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --rebuild-cache v2.1.0 >"$WORK/acr-rebuild.log" 2>&1
assert_eq "build-postiz --rebuild-cache with positional tag exits 0" "$?" "0"
acr_rebuild_builds="$(grep -Ec '^az acr (build|run) ' "$CALLS" || true)"
assert_eq "build-postiz --rebuild-cache runs all 4 az acr builds on warm cache" "$acr_rebuild_builds" "4"
assert_regex "build-postiz clean positional tag tags app/postiz:v2.1.0 and :latest" "$CALLS" 'az acr run .*image=example[.]invalid/app/postiz:v2\.1\.0 --set pushLatest=publish'

STUB_CALLS="$CALLS" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --tag rel-456 >/dev/null 2>&1
assert_eq "build-postiz rejects unsupported --tag flag with exit 2" "$?" "2"

STUB_CALLS="$CALLS" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" tag-a tag-b >/dev/null 2>&1
assert_eq "build-postiz rejects duplicate positional tags with exit 2" "$?" "2"

echo ""
echo "build-postiz.sh: dirty tree guard, --allow-dirty, and :latest protection"
printf 'dirty\n' > "$FIXTURE_PHYS/untracked-acr.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >"$WORK/acr-dirty.log" 2>&1
assert_eq "build-postiz rejects dirty tree by default with exit 2" "$?" "2"
assert_not_regex "dirty tree never reaches az, docker, or kubectl" "$CALLS" '^(az|docker|kubectl) '
assert_regex "build-postiz dirty tree error guides operator to --allow-dirty" "$WORK/acr-dirty.log" '--allow-dirty'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --allow-dirty >"$WORK/acr-allow-dirty.log" 2>&1
assert_eq "build-postiz --allow-dirty succeeds on dirty tree" "$?" "0"
assert_regex "build-postiz --allow-dirty publishes -dirty default tag" "$CALLS" "az acr run .*image=example[.]invalid/app/postiz:${SCHEMA_HEAD_SHORT}-dirty "
assert_not_regex "build-postiz dirty build NEVER overwrites app/postiz:latest" "$CALLS" 'pushLatest=publish|docker (tag|push) .*app/postiz:latest'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --allow-dirty explicit-debug >"$WORK/acr-allow-dirty-explicit.log" 2>&1
assert_eq "build-postiz --allow-dirty with explicit positional tag succeeds" "$?" "0"
assert_regex "build-postiz preserves explicit tag verbatim under --allow-dirty" "$CALLS" 'az acr run .*image=example[.]invalid/app/postiz:explicit-debug '
assert_not_regex "build-postiz dirty explicit-tag build NEVER overwrites app/postiz:latest" "$CALLS" 'pushLatest=publish|docker (tag|push) .*app/postiz:latest'
rm -f "$FIXTURE_PHYS/untracked-acr.txt"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --allow-dirty >"$WORK/acr-allow-dirty-clean.log" 2>&1
assert_eq "build-postiz --allow-dirty on clean tree exits 0" "$?" "0"
assert_regex "build-postiz --allow-dirty on clean tree pushes clean tag and :latest" "$CALLS" "az acr run .*image=example[.]invalid/app/postiz:${SCHEMA_HEAD_SHORT} --set pushLatest=publish"

echo ""
echo "build-postiz.sh: --local <image> push flow"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$FIXTURE_K8S/build-local.sh" --tag postiz-candidate:local-test >"$WORK/candidate.log" 2>&1
assert_eq "candidate for promotion was built" "$?" 0
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --local postiz-candidate:local-test >"$WORK/acr-local.log" 2>&1
assert_eq "build-postiz --local exits 0" "$?" "0"
assert_regex "build-postiz --local logs in to ACR" "$CALLS" '^az acr login --name TestAcr$'
assert_regex "upload uses a temporary tag bound to the chosen image ID" "$CALLS" '^docker tag sha256:[a-f0-9]{64} example[.]invalid/app/postiz:stage-'
assert_regex "both clean release tags use one registry digest" "$CALLS" "^docker buildx imagetools create --prefer-index=false --tag example.invalid/app/postiz:$SCHEMA_HEAD_SHORT --tag example.invalid/app/postiz:latest example.invalid/app/postiz@sha256:"
assert_regex "temporary registry tag is removed" "$CALLS" '^az acr repository untag .*--image app/postiz:stage-'
assert_not_regex "build-postiz --local never runs az acr build or repository show or kubectl" "$CALLS" '^(az acr (build|repository show)|kubectl )'

STUB_CALLS="$CALLS" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --local >/dev/null 2>&1
assert_eq "build-postiz --local without image fails with exit 2" "$?" "2"

printf 'dirty\n' > "$FIXTURE_PHYS/untracked-local.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --local postiz-candidate:local-test >/dev/null 2>&1
assert_eq "build-postiz --local rejects dirty tree without --allow-dirty" "$?" "2"
assert_not_regex "dirty --local push never calls az or docker" "$CALLS" '^(az|docker) '

: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" --local postiz-candidate:local-test --allow-dirty >/dev/null 2>&1
assert_eq "build-postiz --local --allow-dirty succeeds on dirty tree" "$?" "0"
assert_regex "dirty promotion sets only the version tag from the digest" "$CALLS" "^docker buildx imagetools create --prefer-index=false --tag example.invalid/app/postiz:${SCHEMA_HEAD_SHORT}-dirty example.invalid/app/postiz@sha256:"
assert_not_regex "dirty promotion never tags latest" "$CALLS" '--tag [^ ]+:latest'

echo ""
echo "build-postiz.sh: error handling"
mv "$FIXTURE_PHYS/k8s/Dockerfile.deps" "$WORK/Dockerfile.deps.bak"
git -C "$FIXTURE_PHYS" add -A && git -C "$FIXTURE_PHYS" commit -q -m "drop Dockerfile.deps"
: > "$CALLS"
STUB_CALLS="$CALLS" BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >/dev/null 2>&1
assert_eq "build-postiz exits 1 when a required input is missing" "$?" "1"
assert_not_regex "missing input never reaches az" "$CALLS" '^az '
mv "$WORK/Dockerfile.deps.bak" "$FIXTURE_PHYS/k8s/Dockerfile.deps"
git -C "$FIXTURE_PHYS" add -A && git -C "$FIXTURE_PHYS" commit -q -m "restore Dockerfile.deps"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_AZ_AUTH_FAIL=1 BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/build-postiz.sh" >/dev/null 2>&1
assert_eq "build-postiz surfaces ACR auth errors instead of treating them as cache misses" "$?" "2"
assert_not_regex "ACR auth failure does not trigger az acr build" "$CALLS" '^az acr build '

# ------------------------------------------------------------
# Slice 4: k8s/deploy-postiz.sh & k8s/publish-and-deploy.sh
# ------------------------------------------------------------
WRAPPER_HEAD_SHORT="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
echo ""
echo "deploy-postiz.sh: deploy-only action separation"
: > "$CALLS"
STUB_CALLS="$CALLS" PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/deploy-postiz.sh" --image example.invalid/app/postiz:t --namespace staging >/dev/null 2>&1
assert_eq "deploy-postiz exits 0 with stubbed kubectl" "$?" "0"
assert_regex "deploy-postiz updates deployment image in target namespace" "$CALLS" '^kubectl set image deployment/postiz postiz=example\.invalid/app/postiz:t -n staging$'
assert_regex "deploy-postiz waits for rollout status" "$CALLS" '^kubectl rollout status deployment/postiz -n staging '
assert_not_regex "deploy-postiz never invokes az or docker" "$CALLS" '^(az|docker) '

STUB_CALLS="$CALLS" PATH="$STUB:$PATH" "$FIXTURE_K8S/deploy-postiz.sh" >/dev/null 2>&1
assert_eq "deploy-postiz requires --image" "$?" "2"

echo ""
echo "publish-and-deploy.sh: one-command wrapper"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --dry-run --deploy >"$WORK/wrapper-dry-deploy.log" 2>&1
assert_eq "wrapper --dry-run --deploy exits 0" "$?" "0"
if [ -s "$CALLS" ]; then
  no "wrapper --dry-run --deploy invokes zero external commands"
else
  ok "wrapper --dry-run --deploy invokes zero external commands"
fi
assert_regex "wrapper --dry-run prints base cache layer" "$WORK/wrapper-dry-deploy.log" "ops/postiz-base:${BASE_TAG}"
assert_regex "wrapper --dry-run prints deps cache layer" "$WORK/wrapper-dry-deploy.log" "ops/postiz-deps:${SCHEMA_DEPS_HASH}"
assert_regex "wrapper --dry-run prints runtime-deps cache layer" "$WORK/wrapper-dry-deploy.log" "ops/postiz-runtime-deps:${SCHEMA_DEPS_HASH}"
assert_regex "wrapper --dry-run --deploy prints build-postiz plan" "$WORK/wrapper-dry-deploy.log" 'would run: .*build-postiz\.sh'
assert_regex "wrapper --dry-run --deploy prints deploy-postiz plan" "$WORK/wrapper-dry-deploy.log" 'would run: .*deploy-postiz\.sh'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --dry-run >"$WORK/wrapper-dry-nodeploy.log" 2>&1
assert_eq "wrapper --dry-run without --deploy exits 0" "$?" "0"
if [ -s "$CALLS" ]; then
  no "wrapper --dry-run without --deploy invokes zero external commands"
else
  ok "wrapper --dry-run without --deploy invokes zero external commands"
fi
assert_not_regex "wrapper --dry-run without --deploy does not plan deploy-postiz.sh" "$WORK/wrapper-dry-nodeploy.log" 'would run: .*deploy-postiz\.sh'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --dry-run --allow-dirty --rebuild-cache rel-dry --namespace uat --deploy >"$WORK/wrapper-dry-flags.log" 2>&1
assert_eq "wrapper --dry-run with all flags exits 0" "$?" "0"
if [ -s "$CALLS" ]; then
  no "wrapper --dry-run with all flags invokes zero external commands"
else
  ok "wrapper --dry-run with all flags invokes zero external commands"
fi
assert_regex "wrapper forwards --allow-dirty, --rebuild-cache, and positional tag to build-postiz.sh" "$WORK/wrapper-dry-flags.log" 'would run: .*build-postiz\.sh --allow-dirty --rebuild-cache rel-dry$'
assert_regex "wrapper forwards --image and --namespace to deploy-postiz.sh" "$WORK/wrapper-dry-flags.log" 'would run: .*deploy-postiz\.sh --image example\.invalid/app/postiz:rel-dry --namespace uat'

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" >"$WORK/wrapper-publish.log" 2>&1
assert_eq "wrapper without --deploy exits 0" "$?" "0"
assert_regex "wrapper publishes via ACR task" "$CALLS" '^az acr run '
assert_not_regex "wrapper without --deploy never invokes kubectl" "$CALLS" '^kubectl '

task_digest="sha256:$(printf '%064x' 123)"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  STUB_TASK_DIGEST="$task_digest" "$FIXTURE_K8S/publish-and-deploy.sh" --deploy >"$WORK/wrapper-deploy.log" 2>&1
assert_eq "wrapper --deploy exits 0" "$?" "0"
assert_contains "wrapper deploys the digest returned by the publish" "$CALLS" "postiz=example.invalid/app/postiz:$WRAPPER_HEAD_SHORT@$task_digest -n dev"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --deploy --namespace staging v3.0.0 --rebuild-cache >"$WORK/wrapper-full.log" 2>&1
assert_eq "wrapper --deploy --namespace positional tag --rebuild-cache exits 0" "$?" "0"
wrapper_rebuild_builds="$(grep -Ec '^az acr (build|run) ' "$CALLS" || true)"
assert_eq "wrapper forwards --rebuild-cache (runs all 4 az acr builds)" "$wrapper_rebuild_builds" "4"
assert_regex "wrapper publishes explicit positional tag v3.0.0 and :latest on clean tree" "$CALLS" 'az acr run .*image=example[.]invalid/app/postiz:v3\.0\.0 --set pushLatest=publish'
assert_regex "wrapper deploys explicit positional tag v3.0.0 to staging" "$CALLS" '^kubectl set image deployment/postiz postiz=example\.invalid/app/postiz:v3\.0\.0@sha256:[a-f0-9]{64} -n staging$'

printf 'dirty\n' > "$FIXTURE_PHYS/untracked-wrapper.txt"
: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --deploy >/dev/null 2>&1
assert_eq "wrapper rejects dirty tree by default with exit 2" "$?" "2"
assert_not_regex "dirty tree in wrapper never calls az, docker, or kubectl" "$CALLS" '^(az|docker|kubectl) '

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --allow-dirty --deploy >"$WORK/wrapper-dirty-ok.log" 2>&1
assert_eq "wrapper --allow-dirty --deploy succeeds on dirty tree" "$?" "0"
assert_regex "wrapper --allow-dirty publishes -dirty default tag" "$CALLS" "az acr run .*image=example[.]invalid/app/postiz:${WRAPPER_HEAD_SHORT}-dirty "
assert_not_regex "wrapper --allow-dirty on dirty tree NEVER overwrites :latest" "$CALLS" 'pushLatest=publish|docker (tag|push) .*app/postiz:latest'
assert_regex "wrapper --allow-dirty --deploy rolls out exact -dirty tag" "$CALLS" "^kubectl set image deployment/postiz postiz=example\\.invalid/app/postiz:${WRAPPER_HEAD_SHORT}-dirty@sha256:[a-f0-9]{64} -n dev$"
rm -f "$FIXTURE_PHYS/untracked-wrapper.txt"

: > "$CALLS"
STUB_CALLS="$CALLS" STUB_ACR_IMAGES="$ACR_IMAGES" \
  BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --local postiz-candidate:local-test --deploy --namespace qa >"$WORK/wrapper-local.log" 2>&1
assert_eq "wrapper --local --deploy exits 0" "$?" "0"
assert_not_regex "wrapper --local never runs az acr build" "$CALLS" '^az acr build '
assert_regex "wrapper --local publishes to its version tag" "$CALLS" "^docker buildx imagetools create .*--tag example.invalid/app/postiz:$SCHEMA_HEAD_SHORT "
assert_regex "wrapper --local --deploy rolls out pushed image in qa" "$CALLS" "^kubectl set image deployment/postiz postiz=example\\.invalid/app/postiz:${SCHEMA_HEAD_SHORT}@sha256:[a-f0-9]{64} -n qa$"

STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --local >/dev/null 2>&1
assert_eq "wrapper --local requires an image" "$?" "2"

STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --local postiz-candidate:x some-tag >/dev/null 2>&1
assert_eq "wrapper rejects --local combined with positional tag" "$?" "2"

STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --tag some-tag >/dev/null 2>&1
assert_eq "wrapper rejects unsupported --tag flag with exit 2" "$?" "2"

STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" tag-a tag-b >/dev/null 2>&1
assert_eq "wrapper rejects duplicate positional tags with exit 2" "$?" "2"

STUB_CALLS="$CALLS" BUILD_ACR_HOST=example.invalid PATH="$STUB:$PATH" \
  "$FIXTURE_K8S/publish-and-deploy.sh" --bogus >/dev/null 2>&1
assert_eq "wrapper rejects unknown argument with exit 2" "$?" "2"

# Regression cases use only the isolated registry and Docker doubles.
export PATH="$STUB:$PATH" STUB_CALLS="$CALLS"
export BUILD_ACR=TestAcr BUILD_ACR_HOST=example.invalid
: > "$CALLS"
touch "$FIXTURE_K8S/BUILD_CONTEXT_MANIFEST.json"
mkdir -p "$FIXTURE_K8S/apps"
touch "$FIXTURE_K8S/apps/old-copy"
"$FIXTURE_K8S/publish-and-deploy.sh" --dry-run >/dev/null
assert_eq "retired generated inputs still allow a clean release" "$?" 0

touch "$FIXTURE_PHYS/uncommitted"
"$FIXTURE_K8S/build-postiz.sh" --allow-dirty latest >/dev/null 2>&1
assert_eq "dirty tree cannot request latest explicitly" "$?" 2
assert_not_regex "invalid dirty latest never reaches a CLI" "$CALLS" '^(az|docker|kubectl) '
rm "$FIXTURE_PHYS/uncommitted"

dirty_candidate="postiz-candidate:$NEW_HEAD_SHORT-dirty"
: > "$CALLS"
"$FIXTURE_K8S/build-postiz.sh" --local "$dirty_candidate" >/dev/null 2>&1
assert_eq "dirty candidate needs explicit opt-in after cleaning the tree" "$?" 2
"$FIXTURE_K8S/publish-and-deploy.sh" --local "$dirty_candidate" --allow-dirty --deploy >/dev/null 2>&1
assert_eq "wrapper can promote a dirty candidate with explicit opt-in" "$?" 0
assert_contains "rollout uses actual candidate source" "$CALLS" "postiz=example.invalid/app/postiz:$NEW_HEAD_SHORT-dirty"
assert_not_regex "promoted dirty candidate never updates latest" "$CALLS" '--tag [^ ]+:latest'
: > "$CALLS"
"$FIXTURE_K8S/build-postiz.sh" --local "$dirty_candidate" --allow-dirty latest >/dev/null 2>&1
assert_eq "dirty candidate cannot be explicitly tagged latest" "$?" 2
assert_not_regex "rejected candidate never reaches ACR" "$CALLS" '^az '

for error in 'HTTP 503' 'HTTP 429' 'connection timed out'; do
  : > "$CALLS"
  STUB_AZ_QUERY_ERROR="$error" "$FIXTURE_K8S/build-postiz.sh" >/dev/null 2>&1
  assert_eq "$error stops the publish" "$?" 2
  assert_not_regex "$error never triggers a cache refresh" "$CALLS" '^az acr (build|run) '
done

: > "$CALLS"
STUB_FAIL_LAYER=Dockerfile.runtime-deps "$FIXTURE_K8S/build-postiz.sh" --rebuild-cache >/dev/null 2>&1
assert_eq "interrupted remote refresh returns failure" "$?" 1
assert_not_regex "no application is published after failed refresh" "$CALLS" '^az acr run '
: > "$CALLS"
(cd "$FIXTURE_K8S" && ./build-postiz.sh) >/dev/null 2>&1
assert_eq "publishing from k8s recovers interrupted remote refresh" "$?" 0
assert_regex "retry builds runtime deps for the new parents" "$CALLS" '^az acr build .*Dockerfile.runtime-deps'
assert_not_regex "retry reuses successful parent builds" "$CALLS" '^az acr build .*Dockerfile[.](base|deps) '

: > "$CALLS"
STUB_FAIL_LAYER=Dockerfile.runtime-deps "$FIXTURE_K8S/build-local.sh" --rebuild-cache >/dev/null 2>&1
assert_eq "interrupted local refresh returns failure" "$?" 1
: > "$CALLS"
SENTRY_AUTH_TOKEN=test-only-sentry "$FIXTURE_K8S/build-local.sh" >/dev/null 2>&1
assert_eq "local build recovers interrupted refresh" "$?" 0
assert_regex "local retry builds runtime dependencies" "$CALLS" '^docker build .*Dockerfile.runtime-deps'
assert_contains "local compiler receives its source revision" "$CALLS" "SENTRY_RELEASE=$(git -C "$FIXTURE_PHYS" rev-parse HEAD)"
assert_contains "local build mounts the token by environment name" "$CALLS" "--secret id=sentry_token,env=SENTRY_AUTH_TOKEN"
assert_not_contains "local Docker argv excludes token value" "$CALLS" "test-only-sentry"

: > "$CALLS"
BUILD_ACR_HOST="" SENTRY_AUTH_TOKEN=test-only-sentry "$FIXTURE_K8S/publish-and-deploy.sh" --deploy >"$WORK/resolved.log" 2>&1
assert_eq "publish resolves a custom registry and supplies the ACR task secret" "$?" 0
assert_contains "ACR compiler receives its source revision" "$CALLS" "sentryRelease=$(git -C "$FIXTURE_PHYS" rev-parse HEAD)"
assert_contains "custom registry supplies the login server" "$CALLS" "acr show --name TestAcr --query loginServer"
assert_contains "app task uses custom registry parent digest" "$CALLS" "depsImage=resolved.azurecr.io/ops/postiz-deps@sha256:"
assert_contains "wrapper deploys actual custom registry reference" "$CALLS" "postiz=resolved.azurecr.io/app/postiz:"
assert_not_contains "publish output excludes token value" "$WORK/resolved.log" "test-only-sentry"

: > "$CALLS"
DOCKER_DEFAULT_PLATFORM=linux/amd64 "$FIXTURE_K8S/build-local.sh" >/dev/null 2>&1
assert_eq "amd64 can be built after arm64 on the same daemon" "$?" 0
assert_regex "amd64 gets its own base" "$CALLS" 'docker build --platform linux/amd64 .*--tag postiz-base:.*-linux-amd64'
assert_regex "amd64 gets its own builder deps" "$CALLS" 'docker build --platform linux/amd64 .*--tag postiz-deps:.*-linux-amd64'
assert_eq "candidate provenance records the target platform" \
  "$(node -p 'const t = require(process.argv[1]).target; t.os + "/" + t.architecture' "$FIXTURE_K8S/BUILD_PROVENANCE.json")" "linux/amd64"

# Source changes during a cold build must not enter a later layer.
source_path="$FIXTURE_PHYS/apps/backend/src/main.ts"
for entry in build-local build-postiz; do
  STUB_EDIT_SOURCE="$source_path" STUB_EXPECT_SOURCE='export const main = 1;' \
    "$FIXTURE_K8S/$entry.sh" --rebuild-cache >"$WORK/frozen.log" 2>&1
  assert_eq "$entry builds all layers from the initial clean commit" "$?" 0
  assert_contains "$entry fixture edited the live checkout" "$source_path" 'edited during build'
  git -C "$FIXTURE_PHYS" restore apps/backend/src/main.ts
done
printf 'dirty snapshot\n' > "$source_path"
STUB_EDIT_SOURCE="$source_path" STUB_EXPECT_SOURCE='dirty snapshot' \
  "$FIXTURE_K8S/build-postiz.sh" --allow-dirty --rebuild-cache >"$WORK/frozen-dirty.log" 2>&1
assert_eq "dirty publish freezes the opted-in contents once" "$?" 0
git -C "$FIXTURE_PHYS" restore apps/backend/src/main.ts

# Simulate a competing publish replacing the common local destination tag.
candidate_id="$(node -p 'require(process.argv[1]).imageId' "$FIXTURE_K8S/BUILD_PROVENANCE.json")"
head_tag="$(git -C "$FIXTURE_PHYS" rev-parse --short=12 HEAD)"
release_ref="example.invalid/app/postiz:$head_tag"
published="$(STUB_COMPETING_TAG="$release_ref" POSTIZ_PRINT_PUBLISHED_IMAGE=1 \
  "$FIXTURE_K8S/build-postiz.sh" --local "$candidate_id" 2>"$WORK/promotion.log")"
node -e '
  const state = JSON.parse(require("fs").readFileSync(process.argv[1]));
  const [tag, candidateId, releaseRef, published] = process.argv.slice(2);
  const digest = state["app/postiz:" + tag];
  if (!digest || state[digest] !== candidateId || published !== releaseRef + "@" + digest ||
      state["app/postiz:latest"] !== digest ||
      Object.keys(state).some(key => key.startsWith("app/postiz:stage-"))) process.exit(1);
' "$ACR_IMAGES" "$head_tag" "$candidate_id" "$release_ref" "$published"
assert_eq "both published tags resolve to the selected candidate after a competing local retag, with staging cleaned" "$?" 0

# The cache tag and the actual public base build must use identical pins.
node -e '
  const fs = require("fs");
  const file = process.argv[1], pkg = require(file);
  pkg.engines.node = "22.23.5";
  pkg.packageManager = "pnpm@10.7.0";
  fs.writeFileSync(file, JSON.stringify(pkg));
' "$FIXTURE_PHYS/package.json"
for entry in build-local build-postiz; do
  : > "$CALLS"
  "$FIXTURE_K8S/$entry.sh" --allow-dirty >/dev/null 2>&1
  assert_eq "$entry accepts changed toolchain pins" "$?" 0
  assert_eq "$entry sends updated pins to both public-base builds" "$(grep -c -- '--build-arg NODE_VERSION=22.23.5 --build-arg PNPM_PACKAGE=pnpm@10.7.0' "$CALLS")" 2
done
report_and_exit "build-pipeline"
