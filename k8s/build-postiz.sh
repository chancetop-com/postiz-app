#!/usr/bin/env bash
# ============================================================
# Postiz ACR publish (publish only, never deploys)
#
# Publishes the application image to ACR using the repository-root
# four-layer cache chain (ADR-0001). Cache layers live in three
# independent ACR repositories so per-repository retention policies
# (keep latest 3) never evict active layers:
#   1. ops/postiz-base:<base-tag>          (k8s/Dockerfile.base)
#   2. ops/postiz-deps:<deps-hash>         (k8s/Dockerfile.deps)
#   3. ops/postiz-runtime-deps:<runtime-tag> (k8s/Dockerfile.runtime-deps)
#   4. app/postiz:<tag> (+ :latest on clean worktree only)
#
# Usage:
#   ./k8s/build-postiz.sh                    # ACR layered build for HEAD
#   ./k8s/build-postiz.sh <git_tag>          # ACR layered build with explicit tag
#   ./k8s/build-postiz.sh --allow-dirty      # allow dirty tree (-dirty tag; skips :latest)
#   ./k8s/build-postiz.sh --rebuild-cache    # force rebuilding all 3 ACR cache layers
#   ./k8s/build-postiz.sh --local <image>    # push a locally built image
#
# Deployment is a separate action: ./k8s/deploy-postiz.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$REPO_ROOT" ]; then
  echo "build-postiz: not inside a git work tree: $SCRIPT_DIR" >&2
  exit 2
fi

# The wrapper captures the exact published reference while keeping progress visible.
if [ "${POSTIZ_PRINT_PUBLISHED_IMAGE:-0}" = 1 ]; then
  exec 3>&1 1>&2
fi

LOCAL_MODE=0
LOCAL_IMAGE=""
GIT_TAG=""
ALLOW_DIRTY=0
REBUILD_CACHE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --local)
      LOCAL_MODE=1
      shift
      if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
        LOCAL_IMAGE="$1"
        shift
      fi
      # The optional value was consumed above; skip the loop's own shift so
      # `--local <image>` as the last argument does not shift past the end.
      continue
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    --rebuild-cache)
      REBUILD_CACHE=1
      ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "build-postiz: unknown argument: $1" >&2
      exit 2
      ;;
    *)
      if [ -n "$GIT_TAG" ]; then
        echo "build-postiz: multiple image tags specified ($GIT_TAG and $1)" >&2
        exit 2
      fi
      GIT_TAG="$1"
      ;;
  esac
  shift
done

if [ "$LOCAL_MODE" -eq 1 ] && [ -z "$LOCAL_IMAGE" ]; then
  echo "build-postiz: --local needs an image name" >&2
  exit 2
fi

if [ ! -f "$SCRIPT_DIR/lib/build-cache.sh" ]; then
  echo "build-postiz: missing helper $SCRIPT_DIR/lib/build-cache.sh" >&2
  exit 2
fi
# shellcheck source=lib/build-cache.sh
. "$SCRIPT_DIR/lib/build-cache.sh"

ACR_NAME="${BUILD_ACR:-$BUILD_CACHE_ACR_NAME_DEFAULT}"
ACR_HOST="${BUILD_ACR_HOST:-}"
IMAGE_NAME="$BUILD_CACHE_APP_REPO"
BASE_CACHE_REPO="$BUILD_CACHE_BASE_REPO"
DEPS_CACHE_REPO="$BUILD_CACHE_DEPS_REPO"
RUNTIME_DEPS_CACHE_REPO="$BUILD_CACHE_RUNTIME_DEPS_REPO"

# ------------------------------------------------------------
# Guard worktree (and validate build inputs for remote builds)
# before touching ACR or Docker.
# ------------------------------------------------------------
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
WORKTREE_STATE="$(build_cache_check_worktree "$REPO_ROOT" "$ALLOW_DIRTY")"
BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "$BUILD_TMP"' EXIT
if [ "$LOCAL_MODE" -eq 1 ]; then
  # Resolve the tag once. Push this immutable image ID even if the local tag moves.
  metadata="$(docker image inspect "$LOCAL_IMAGE" | node "$SCRIPT_DIR/lib/candidate-source.cjs" "$SCRIPT_DIR/BUILD_PROVENANCE.json")"
  read -r LOCAL_IMAGE_ID SOURCE_COMMIT CANDIDATE_STATE <<< "$metadata"
  if [ "$CANDIDATE_STATE" = dirty ]; then
    if [ "$ALLOW_DIRTY" -ne 1 ]; then
      echo "build-postiz: publishing a dirty candidate requires --allow-dirty" >&2
      exit 2
    fi
    WORKTREE_STATE=dirty
  fi
else
  build_cache_snapshot "$REPO_ROOT" "$SOURCE_COMMIT" "$WORKTREE_STATE" "$BUILD_TMP" >/dev/null
  CONTEXT="$BUILD_TMP/context"
fi

if [ -z "$GIT_TAG" ]; then
  GIT_TAG="${SOURCE_COMMIT:0:12}"
  if [ "$WORKTREE_STATE" = dirty ]; then GIT_TAG+="-dirty"; fi
fi
build_cache_validate_publish_tag "$GIT_TAG" "$WORKTREE_STATE"
PUSH_LATEST=1
if [ "$WORKTREE_STATE" = dirty ] || [ "$GIT_TAG" = latest ]; then PUSH_LATEST=0; fi

if [ -z "$ACR_HOST" ]; then
  if [ "$ACR_NAME" = "$BUILD_CACHE_ACR_NAME_DEFAULT" ]; then
    ACR_HOST="$BUILD_CACHE_ACR_HOST_DEFAULT"
  else
    ACR_HOST="$(az acr show --name "$ACR_NAME" --query loginServer --output tsv)"
  fi
fi
if [[ ! "$ACR_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*(:[0-9]+)?$ ]]; then
  echo "build-postiz: invalid ACR login server" >&2
  exit 2
fi
ACR_IMAGE="${ACR_HOST}/${IMAGE_NAME}:${GIT_TAG}"

if [ "$LOCAL_MODE" -eq 1 ]; then
  echo "============================================"
  echo " Postiz publish (local image push)"
  echo "============================================"
  echo " registry : ${ACR_HOST}"
  echo " image    : ${IMAGE_NAME}:${GIT_TAG}"
  echo " local    : ${LOCAL_IMAGE}"
  echo " worktree : ${WORKTREE_STATE}"
  if [ "$WORKTREE_STATE" = dirty ]; then
    echo " latest   : skipped (dirty worktree)"
  fi
  echo "============================================"

  az acr login --name "$ACR_NAME"

  # Only this invocation owns the staging tag. All public tags are created
  # from the resulting registry digest, even when local candidates race.
  staging_tag="stage-$(node -p 'require("node:crypto").randomUUID()')"
  staging_image="$ACR_HOST/$IMAGE_NAME:$staging_tag"
  cleanup_promotion() {
    if [ "${staging_pushed:-0}" = 1 ]; then
      az acr repository untag --name "$ACR_NAME" --image "$IMAGE_NAME:$staging_tag" >&2 ||
        echo "build-postiz: could not remove temporary ACR tag $staging_image" >&2
    fi
    docker image rm "$staging_image" >/dev/null 2>&1 || true
    rm -rf "$BUILD_TMP"
  }
  trap cleanup_promotion EXIT
  docker tag "$LOCAL_IMAGE_ID" "$staging_image"
  docker push "$staging_image" | tee "$BUILD_TMP/push.log"
  staging_pushed=1
  PUBLISHED_DIGEST="$(awk -v tag="$staging_tag:" '$1 == tag && $2 == "digest:" { print $3 }' "$BUILD_TMP/push.log")"
  if [[ ! "$PUBLISHED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "build-postiz: push did not return a valid manifest digest" >&2
    exit 1
  fi
  tags=(--tag "$ACR_IMAGE")
  if [ "$PUSH_LATEST" -eq 1 ]; then tags+=(--tag "$ACR_HOST/$IMAGE_NAME:latest"); fi
  docker buildx imagetools create --prefer-index=false "${tags[@]}" "$ACR_HOST/$IMAGE_NAME@$PUBLISHED_DIGEST"
else
  BASE_TAG="$(build_cache_base_tag "$CONTEXT")"
  DEPS_HASH="$(build_cache_deps_hash "$CONTEXT" "$BASE_TAG")"

  # An empty result means a confirmed repository/tag miss. Every other failure
  # stops the publish. Keep warnings on stderr so they cannot become a digest.
  cache_digest() {
    local ref="$1" digest message
    if digest="$(az acr repository show --name "$ACR_NAME" --image "$ref" \
        --query digest --output tsv --only-show-errors 2>"$ERROR_FILE")"; then
      if [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
        printf '%s\n' "$digest"
        return 0
      fi
      echo "build-postiz: invalid manifest digest for $ref" >&2
    else
      message="$(cat "$ERROR_FILE")"
      case "$message" in
        *MANIFEST_UNKNOWN*|*NAME_UNKNOWN*|*"manifest unknown"*|*"repository name not known"*|*"The requested data does not exist."*|*"Error: repository not found"*|*"Error: tag not found"*|*"Error: manifest tagged by"*' is not found'*|*"The repository '${ref%:*}' could not be found."*|*"The tag '${ref##*:}' could not be found."*)
          return 0 ;;
      esac
      echo "build-postiz: failed to query $ref: $message" >&2
    fi
    return 2
  }

  # Return the digest, sending build logs to stderr. Resolve parents first so
  # every downstream FROM is pinned even during overlapping publishes.
  resolve_layer() {
    local ref="$1" dockerfile="$2" digest=""
    shift 2
    if [ "$REBUILD_CACHE" -eq 0 ]; then
      digest="$(cache_digest "$ref")" || return $?
    fi
    if [ -z "$digest" ]; then
      az acr build --registry "$ACR_NAME" --image "$ref" --file "$dockerfile" \
        "$@" --timeout 3600 "$CONTEXT" >&2 || return $?
      digest="$(cache_digest "$ref")" || return $?
      if [ -z "$digest" ]; then
        echo "build-postiz: built $ref but could not resolve its manifest" >&2
        return 1
      fi
    else
      echo "Cache HIT: $ref" >&2
    fi
    printf '%s\n' "$digest"
  }

  ERROR_FILE="$BUILD_TMP/acr-error"
  az acr login --name "$ACR_NAME"
  node_version="$(build_cache_node_version "$CONTEXT")"
  pnpm_version="$(build_cache_pnpm_version "$CONTEXT")"
  toolchain_args=(--build-arg "NODE_VERSION=$node_version" --build-arg "PNPM_PACKAGE=pnpm@$pnpm_version")
  BASE_DIGEST="$(resolve_layer "$BASE_CACHE_REPO:$BASE_TAG" "$CONTEXT/k8s/Dockerfile.base" "${toolchain_args[@]}")"
  DEPS_DIGEST="$(resolve_layer "$DEPS_CACHE_REPO:$DEPS_HASH" "$CONTEXT/k8s/Dockerfile.deps" "${toolchain_args[@]}")"
  DEPS_REF="$ACR_HOST/$DEPS_CACHE_REPO@$DEPS_DIGEST"
  RUNTIME_TAG="$(build_cache_runtime_tag "$DEPS_HASH" "$BASE_DIGEST" "$DEPS_DIGEST")"
  RUNTIME_DIGEST="$(resolve_layer "$RUNTIME_DEPS_CACHE_REPO:$RUNTIME_TAG" "$CONTEXT/k8s/Dockerfile.runtime-deps" \
    --build-arg "BASE_IMAGE=$ACR_HOST/$BASE_CACHE_REPO@$BASE_DIGEST" --build-arg "DEPS_IMAGE=$DEPS_REF")"

  sentry_token="${SENTRY_AUTH_TOKEN:-}"
  if [[ ! "$sentry_token" =~ [^[:space:]] ]]; then sentry_token=""; fi
  latest=skip
  if [ "$PUSH_LATEST" -eq 1 ]; then latest=publish; fi
  app_task=(az acr run --registry "$ACR_NAME" --file k8s/build-app.yaml --timeout 3600
    --set "depsImage=$DEPS_REF" --set "runtimeImage=$ACR_HOST/$RUNTIME_DEPS_CACHE_REPO@$RUNTIME_DIGEST"
    --set "image=$ACR_IMAGE" --set "pushLatest=$latest" --set "latestImage=$ACR_HOST/$IMAGE_NAME:latest"
    --no-logs --query "(outputImages || properties.outputImages)[?repository=='$IMAGE_NAME' && tag=='$GIT_TAG'].digest | [0]" --output tsv)
  echo "Building $ACR_IMAGE"
  if [ -n "$sentry_token" ]; then
    for slug in "${SENTRY_ORG:-}" "${SENTRY_PROJECT:-}"; do
      if [[ ! "$slug" =~ ^[a-zA-Z0-9_.-]*$ ]]; then
        echo "build-postiz: invalid Sentry organization or project slug" >&2
        exit 2
      fi
    done
    # Azure CLI reads the secret task value from stdin.
    # The token is absent from process arguments and the uploaded context.
    PUBLISHED_DIGEST="$(printf '%s' "$sentry_token" | "${app_task[@]}" \
      --set "sentryRelease=$SOURCE_COMMIT" --set "sentryOrg=${SENTRY_ORG:-}" --set "sentryProject=${SENTRY_PROJECT:-}" \
      --set-secret sentryToken=@- "$CONTEXT")"
  else
    PUBLISHED_DIGEST="$("${app_task[@]}" "$CONTEXT")"
  fi
fi

if [[ ! "$PUBLISHED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "build-postiz: publish did not return a manifest digest for $ACR_IMAGE" >&2
  exit 1
fi
echo "Published ${ACR_IMAGE}@$PUBLISHED_DIGEST"
if [ "${POSTIZ_PRINT_PUBLISHED_IMAGE:-0}" = 1 ]; then
  printf '%s@%s\n' "$ACR_IMAGE" "$PUBLISHED_DIGEST" >&3
fi
