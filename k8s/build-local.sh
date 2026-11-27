#!/usr/bin/env bash
# ============================================================
# Postiz local layered image build (local daemon only)
#
# Builds the candidate image directly from the repository root using the
# four-layer cache chain (ADR-0001):
#   1. postiz-base:<base-tag>-<platform>          (k8s/Dockerfile.base)
#   2. postiz-deps:<deps-hash>-<platform>         (k8s/Dockerfile.deps)
#   3. postiz-runtime-deps:<runtime-tag> (k8s/Dockerfile.runtime-deps)
#   4. postiz-candidate:<tag>          (k8s/Dockerfile)
#
# Never logs in to a registry, never pulls private remote images, never
# pushes, and never touches Kubernetes.
#
# Usage:
#   ./k8s/build-local.sh                   # build postiz-candidate:<short-sha>
#   ./k8s/build-local.sh --tag NAME        # override final image tag
#   ./k8s/build-local.sh --allow-dirty     # allow dirty tree (appends -dirty to default tag)
#   ./k8s/build-local.sh --rebuild-cache   # rebuild all 3 local cache layers with --no-cache
#
# No NEXT_PUBLIC_* value is baked into any image: the runtime reads the
# deployment's ConfigMap/Secret and passes public values to client code through
# VariableContext. The build only receives NODE_ENV and cache base image refs.
#
# For publishing use ./k8s/build-postiz.sh, for deployment
# ./k8s/deploy-postiz.sh. Neither is implied by this script.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$REPO_ROOT" ]; then
  echo "build-local: not inside a git work tree: $SCRIPT_DIR" >&2
  exit 2
fi

TAG=""
ALLOW_DIRTY=0
REBUILD_CACHE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      shift
      [ $# -gt 0 ] || { echo "build-local: --tag needs a value" >&2; exit 2; }
      TAG="$1"
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    --rebuild-cache)
      REBUILD_CACHE=1
      ;;
    -h|--help)
      sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "build-local: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ ! -f "$SCRIPT_DIR/lib/build-cache.sh" ]; then
  echo "build-local: missing helper $SCRIPT_DIR/lib/build-cache.sh" >&2
  exit 2
fi
if [ ! -f "$SCRIPT_DIR/lib/json.sh" ]; then
  echo "build-local: missing helper $SCRIPT_DIR/lib/json.sh" >&2
  exit 2
fi
# shellcheck source=lib/build-cache.sh
. "$SCRIPT_DIR/lib/build-cache.sh"
# shellcheck source=lib/json.sh
. "$SCRIPT_DIR/lib/json.sh"

# ------------------------------------------------------------
# Guard worktree and validate repository inputs before invoking Docker
# ------------------------------------------------------------
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_REF="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
WORKTREE_STATE="$(build_cache_check_worktree "$REPO_ROOT" "$ALLOW_DIRTY")"
BUILD_TMP="$(mktemp -d)"
BASE_REF="" DEPS_REF="" RUNTIME_REF=""
cleanup_local_build() {
  local ref
  for ref in "$BASE_REF" "$DEPS_REF" "$RUNTIME_REF"; do
    if [ -n "$ref" ]; then docker image rm "$ref" >/dev/null 2>&1 || true; fi
  done
  if [ -n "${provenance_tmp:-}" ]; then rm -f "$provenance_tmp"; fi
  rm -rf "$BUILD_TMP"
}
trap cleanup_local_build EXIT
WORKTREE_DIGEST="$(build_cache_snapshot "$REPO_ROOT" "$SOURCE_COMMIT" "$WORKTREE_STATE" "$BUILD_TMP")"
CONTEXT="$BUILD_TMP/context"

NODE_VERSION="$(build_cache_node_version "$CONTEXT")"
PNPM_VERSION="$(build_cache_pnpm_version "$CONTEXT")"
PRISMA_VERSION="$(build_cache_prisma_version "$CONTEXT")"
BASE_TAG="$(build_cache_base_tag "$CONTEXT")"
DEPS_HASH="$(build_cache_deps_hash "$CONTEXT" "$BASE_TAG")"

if [ -z "$TAG" ]; then
  TAG="${BUILD_CACHE_LOCAL_APP_REPO}:${SOURCE_COMMIT:0:12}"
  if [ "$WORKTREE_STATE" = dirty ]; then TAG+="-dirty"; fi
fi

PLATFORM="${DOCKER_DEFAULT_PLATFORM:-}"
if [ -z "$PLATFORM" ]; then
  PLATFORM="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
fi
if [[ ! "$PLATFORM" =~ ^[a-z0-9]+/[a-z0-9_]+(/[a-z0-9]+)?$ ]]; then
  echo "build-local: invalid Docker target platform: $PLATFORM" >&2
  exit 2
fi
platform_tag="${PLATFORM//\//-}"
BASE_IMAGE="${BUILD_CACHE_LOCAL_BASE_REPO}:${BASE_TAG}-$platform_tag"
DEPS_IMAGE="${BUILD_CACHE_LOCAL_DEPS_REPO}:${DEPS_HASH}-$platform_tag"
# Local builds have image IDs but may have no registry digest. Tag the
# resolved ID so subsequent FROM steps can use a stable local reference.
image_id_file="$BUILD_TMP/image-id"
pin_suffix="${BUILD_TMP##*/}"

pin_local_image() {
  local repo="$1" id="$2" ref
  ref="$repo:id-${id#sha256:}-$pin_suffix"
  docker tag "$id" "$ref" || return $?
  printf '%s\n' "$ref"
}

local_image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

# Build or reuse one local cache layer.
# Usage: build_local_layer <step> <label> <dockerfile> <image> [extra_docker_args...]
# Sets LOCAL_LAYER_STATUS ("hit" | "built" | "rebuilt").
LOCAL_LAYER_STATUS=""

build_local_layer() {
  local step="$1"
  local label="$2"
  local dockerfile="$3"
  local image="$4"
  shift 4

  local cmd=(docker build --platform "$PLATFORM")
  if [ "$REBUILD_CACHE" -eq 1 ]; then
    echo "[${step}/4] Rebuilding ${label}: ${image}"
    cmd+=(--no-cache)
    # Only these two stages inherit public Node images; later parents are local pins.
    if [ "$step" -le 2 ]; then cmd+=(--pull); fi
    LOCAL_LAYER_STATUS="rebuilt"
  elif local_image_exists "$image"; then
    echo "[${step}/4] Cache HIT : ${image}"
    LOCAL_LAYER_STATUS="hit"
    return 0
  else
    echo "[${step}/4] Cache MISS: building ${image}"
    LOCAL_LAYER_STATUS="built"
  fi

  if [ "$step" -le 2 ]; then
    cmd+=(--build-arg "NODE_VERSION=$NODE_VERSION" --build-arg "PNPM_PACKAGE=pnpm@$PNPM_VERSION")
  fi
  cmd+=(--file "$dockerfile")
  if [ $# -gt 0 ]; then
    cmd+=("$@")
  fi
  cmd+=(--tag "$image" "$CONTEXT")

  "${cmd[@]}"
}

echo "============================================"
echo " Postiz local layered image build"
echo "============================================"
echo " context      : $REPO_ROOT"
echo " image        : $TAG"
echo " commit       : $SOURCE_COMMIT ($WORKTREE_STATE)"
echo " toolchain    : node ${NODE_VERSION} / pnpm ${PNPM_VERSION} / prisma ${PRISMA_VERSION}"
echo " base cache   : $BASE_IMAGE"
echo " deps cache   : $DEPS_IMAGE"
if [ "$REBUILD_CACHE" -eq 1 ]; then
  echo " cache mode   : force rebuild (--rebuild-cache, --no-cache on layers 1-3)"
fi
echo "============================================"

# Layer 1: runtime OS base
build_local_layer 1 "base cache" "$CONTEXT/k8s/Dockerfile.base" "$BASE_IMAGE"
BASE_CACHE_STATUS="$LOCAL_LAYER_STATUS"
BASE_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$BASE_IMAGE")"
BASE_REF="$(pin_local_image "$BUILD_CACHE_LOCAL_BASE_REPO" "$BASE_IMAGE_ID")"

# Layer 2: builder dependencies
build_local_layer 2 "builder deps cache" "$CONTEXT/k8s/Dockerfile.deps" "$DEPS_IMAGE"
DEPS_CACHE_STATUS="$LOCAL_LAYER_STATUS"
DEPS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$DEPS_IMAGE")"
DEPS_REF="$(pin_local_image "$BUILD_CACHE_LOCAL_DEPS_REPO" "$DEPS_IMAGE_ID")"

# Layer 3: pruned runtime dependencies
RUNTIME_TAG="$(build_cache_runtime_tag "$DEPS_HASH" "$BASE_IMAGE_ID" "$DEPS_IMAGE_ID")"
RUNTIME_DEPS_IMAGE="$BUILD_CACHE_LOCAL_RUNTIME_DEPS_REPO:$RUNTIME_TAG"
build_local_layer 3 "runtime deps cache" "$CONTEXT/k8s/Dockerfile.runtime-deps" "$RUNTIME_DEPS_IMAGE" \
  --build-arg "BASE_IMAGE=$BASE_REF" --build-arg "DEPS_IMAGE=$DEPS_REF"
RUNTIME_DEPS_CACHE_STATUS="$LOCAL_LAYER_STATUS"
RUNTIME_DEPS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$RUNTIME_DEPS_IMAGE")"
RUNTIME_REF="$(pin_local_image "$BUILD_CACHE_LOCAL_RUNTIME_DEPS_REPO" "$RUNTIME_DEPS_IMAGE_ID")"

# Layer 4: application image
echo "[4/4] Building application image: $TAG"
sentry_args=()
if [[ "${SENTRY_AUTH_TOKEN:-}" =~ [^[:space:]] ]]; then
  sentry_args=(--secret id=sentry_token,env=SENTRY_AUTH_TOKEN --build-arg SENTRY_UPLOAD=1
    --build-arg SENTRY_ORG --build-arg SENTRY_PROJECT --build-arg "SENTRY_RELEASE=$SOURCE_COMMIT")
fi
DOCKER_BUILDKIT=1 docker build --platform "$PLATFORM" \
  --file "$CONTEXT/k8s/Dockerfile" \
  --build-arg "DEPS_IMAGE=$DEPS_REF" \
  --build-arg "RUNTIME_DEPS_IMAGE=$RUNTIME_REF" \
  --build-arg "NODE_ENV=production" \
  --label "org.opencontainers.image.revision=$SOURCE_COMMIT" \
  --label "io.postiz.worktree=$WORKTREE_STATE" \
  ${sentry_args[@]+"${sentry_args[@]}"} \
  --iidfile "$image_id_file" --tag "$TAG" "$CONTEXT"

IMAGE_ID="$(cat "$image_id_file")"
IMAGE_ARCH="$(docker image inspect --format '{{.Architecture}}' "$IMAGE_ID")"
IMAGE_OS="$(docker image inspect --format '{{.Os}}' "$IMAGE_ID")"

# ------------------------------------------------------------
# Provenance: what was built, from which repository inputs and cache layers.
# The registry digest only exists after a publish, which this script never does.
# ------------------------------------------------------------
PROVENANCE="$SCRIPT_DIR/BUILD_PROVENANCE.json"
provenance_tmp="$(mktemp "$SCRIPT_DIR/.build-provenance.XXXXXXXX")"

{
  printf '{\n'
  printf '  "schemaVersion": 2,\n'
  printf '  "imageTag": "%s",\n' "$(json_escape "$TAG")"
  printf '  "imageId": "%s",\n' "$(json_escape "$IMAGE_ID")"
  printf '  "builtAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "published": false,\n'
  printf '  "registryDigest": null,\n'
  printf '  "note": "Local candidate image built from repository root using the four-layer cache chain. No registry digest exists because nothing was pushed; the image ID is local to this Docker daemon.",\n'
  printf '  "target": { "os": "%s", "architecture": "%s" },\n' \
    "$(json_escape "$IMAGE_OS")" "$(json_escape "$IMAGE_ARCH")"
  printf '  "source": {\n'
  printf '    "commit": "%s",\n' "$(json_escape "$SOURCE_COMMIT")"
  printf '    "ref": "%s",\n' "$(json_escape "$SOURCE_REF")"
  printf '    "worktreeState": "%s",\n' "$(json_escape "$WORKTREE_STATE")"
  if [ -n "$WORKTREE_DIGEST" ]; then
    printf '    "worktreeDigest": "%s",\n' "$(json_escape "$WORKTREE_DIGEST")"
  else
    printf '    "worktreeDigest": null,\n'
  fi
  printf '    "buildContext": "."\n'
  printf '  },\n'
  printf '  "cacheLayers": {\n'
  printf '    "baseTag": "%s",\n' "$(json_escape "$BASE_TAG")"
  printf '    "depsHash": "%s",\n' "$(json_escape "$DEPS_HASH")"
  printf '    "base": { "image": "%s", "id": "%s", "cacheStatus": "%s" },\n' \
    "$(json_escape "$BASE_IMAGE")" "$(json_escape "$BASE_IMAGE_ID")" "$(json_escape "$BASE_CACHE_STATUS")"
  printf '    "deps": { "image": "%s", "id": "%s", "cacheStatus": "%s" },\n' \
    "$(json_escape "$DEPS_IMAGE")" "$(json_escape "$DEPS_IMAGE_ID")" "$(json_escape "$DEPS_CACHE_STATUS")"
  printf '    "runtimeDeps": { "image": "%s", "id": "%s", "cacheStatus": "%s" }\n' \
    "$(json_escape "$RUNTIME_DEPS_IMAGE")" "$(json_escape "$RUNTIME_DEPS_IMAGE_ID")" "$(json_escape "$RUNTIME_DEPS_CACHE_STATUS")"
  printf '  },\n'
  printf '  "inputs": {\n'
  printf '    "dockerignore": { "path": ".dockerignore", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/.dockerignore")"
  printf '    "npmrc": { "path": ".npmrc", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/.npmrc")"
  printf '    "packageJson": { "path": "package.json", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/package.json")"
  printf '    "lockfile": { "path": "pnpm-lock.yaml", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/pnpm-lock.yaml")"
  printf '    "workspace": { "path": "pnpm-workspace.yaml", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/pnpm-workspace.yaml")"
  printf '    "prismaSchema": { "path": "libraries/nestjs-libraries/src/database/prisma/schema.prisma", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/libraries/nestjs-libraries/src/database/prisma/schema.prisma")"
  printf '    "dockerfileBase": { "path": "k8s/Dockerfile.base", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/k8s/Dockerfile.base")"
  printf '    "dockerfileDeps": { "path": "k8s/Dockerfile.deps", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/k8s/Dockerfile.deps")"
  printf '    "dockerfileRuntimeDeps": { "path": "k8s/Dockerfile.runtime-deps", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/k8s/Dockerfile.runtime-deps")"
  printf '    "dockerfile": { "path": "k8s/Dockerfile", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/k8s/Dockerfile")"
  printf '    "pm2Config": { "path": "var/docker/ecosystem.config.cjs", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/var/docker/ecosystem.config.cjs")"
  printf '    "nginxConfig": { "path": "var/docker/nginx.conf", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/var/docker/nginx.conf")"
  printf '    "entrypoint": { "path": "var/docker/entrypoint.sh", "sha256": "%s" },\n' \
    "$(build_cache_sha256_file "$CONTEXT/var/docker/entrypoint.sh")"
  printf '    "nextConfig": { "path": "apps/frontend/next.config.js", "sha256": "%s" }\n' \
    "$(build_cache_sha256_file "$CONTEXT/apps/frontend/next.config.js")"
  printf '  },\n'
  printf '  "toolchain": { "node": "%s", "pnpm": "%s", "prisma": "%s" },\n' \
    "$(json_escape "$NODE_VERSION")" "$(json_escape "$PNPM_VERSION")" "$(json_escape "$PRISMA_VERSION")"
  # The cache-layer IDs above are observed. Upstream Node tags may since have moved.
  printf '  "baseImages": [\n'
  printf '    { "image": "node:%s-bookworm", "repoDigest": null, "id": null },\n' "$NODE_VERSION"
  printf '    { "image": "node:%s-bookworm-slim", "repoDigest": null, "id": null }\n' "$NODE_VERSION"
  printf '  ],\n'
  printf '  "generatedAssets": []\n'
  printf '}\n'
} > "$provenance_tmp"
mv -f "$provenance_tmp" "$PROVENANCE"

echo ""
echo "Built $TAG"
echo "Image ID  : $IMAGE_ID"
echo "Provenance: $PROVENANCE"
echo ""
echo "This script did not publish or deploy anything."
echo "Publish: ./k8s/build-postiz.sh --local $TAG"
echo "Deploy : ./k8s/deploy-postiz.sh --image <registry>/${BUILD_CACHE_APP_REPO}:<tag>"
