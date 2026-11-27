#!/usr/bin/env bash
# ============================================================
# Postiz one-command pipeline (publish [+ deploy])
#
# Convenience wrapper around the separate repository-root layered
# build/publish and deployment scripts (ADR-0001). Publishing always
# runs; Kubernetes deployment runs only when --deploy is passed.
#
# Usage:
#   ./k8s/publish-and-deploy.sh                    # ACR layered publish only
#   ./k8s/publish-and-deploy.sh --deploy           # publish + deploy
#   ./k8s/publish-and-deploy.sh <git_tag>          # explicit image tag
#   ./k8s/publish-and-deploy.sh --allow-dirty      # allow dirty tree (-dirty tag; skips :latest)
#   ./k8s/publish-and-deploy.sh --rebuild-cache    # force rebuild of all 3 ACR cache layers
#   ./k8s/publish-and-deploy.sh --local <image>    # push an image built by build-local.sh
#   ./k8s/publish-and-deploy.sh --namespace NAME   # deployment namespace (default dev)
#   ./k8s/publish-and-deploy.sh --dry-run          # print the plan, run nothing
#
# An explicit tag cannot be combined with --local.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$REPO_ROOT" ]; then
  echo "publish-and-deploy: not inside a git work tree: $SCRIPT_DIR" >&2
  exit 2
fi

DO_DEPLOY=0
DRY_RUN=0
ALLOW_DIRTY=0
REBUILD_CACHE=0
LOCAL_MODE=0
LOCAL_IMAGE=""
GIT_TAG=""
EXPLICIT_TAG=0
NAMESPACE="${DEPLOY_NAMESPACE:-dev}"

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy)
      DO_DEPLOY=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    --rebuild-cache)
      REBUILD_CACHE=1
      ;;
    --local)
      LOCAL_MODE=1
      shift
      if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
        LOCAL_IMAGE="$1"
        shift
      fi
      continue
      ;;
    --namespace)
      shift
      [ $# -gt 0 ] || { echo "publish-and-deploy: --namespace needs a value" >&2; exit 2; }
      NAMESPACE="$1"
      ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "publish-and-deploy: unknown argument: $1" >&2
      exit 2
      ;;
    *)
      if [ "$EXPLICIT_TAG" -eq 1 ]; then
        echo "publish-and-deploy: multiple image tags specified ($GIT_TAG and $1)" >&2
        exit 2
      fi
      GIT_TAG="$1"
      EXPLICIT_TAG=1
      ;;
  esac
  shift
done

if [ "$LOCAL_MODE" -eq 1 ] && [ -z "$LOCAL_IMAGE" ]; then
  echo "publish-and-deploy: --local needs an image name" >&2
  exit 2
fi

if [ "$LOCAL_MODE" -eq 1 ] && [ "$EXPLICIT_TAG" -eq 1 ]; then
  echo "publish-and-deploy: an explicit tag cannot be combined with --local" >&2
  exit 2
fi

if [ ! -f "$SCRIPT_DIR/lib/build-cache.sh" ]; then
  echo "publish-and-deploy: missing helper $SCRIPT_DIR/lib/build-cache.sh" >&2
  exit 2
fi
# shellcheck source=lib/build-cache.sh
. "$SCRIPT_DIR/lib/build-cache.sh"

ACR_HOST="${BUILD_ACR_HOST:-$BUILD_CACHE_ACR_HOST_DEFAULT}"
if [ -z "${BUILD_ACR_HOST:-}" ] && [ "${BUILD_ACR:-$BUILD_CACHE_ACR_NAME_DEFAULT}" != "$BUILD_CACHE_ACR_NAME_DEFAULT" ]; then
  ACR_HOST="<login server for $BUILD_ACR>"
fi
IMAGE_NAME="$BUILD_CACHE_APP_REPO"
BASE_CACHE_REPO="$BUILD_CACHE_BASE_REPO"
DEPS_CACHE_REPO="$BUILD_CACHE_DEPS_REPO"
RUNTIME_DEPS_CACHE_REPO="$BUILD_CACHE_RUNTIME_DEPS_REPO"

WORKTREE_STATE="$(build_cache_check_worktree "$REPO_ROOT" "$ALLOW_DIRTY")"

PUBLISH_CMD=("$SCRIPT_DIR/build-postiz.sh")
if [ "$LOCAL_MODE" -eq 1 ]; then
  PUBLISH_CMD+=(--local "$LOCAL_IMAGE")
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    PUBLISH_CMD+=(--allow-dirty)
  fi
else
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    PUBLISH_CMD+=(--allow-dirty)
  fi
  if [ "$REBUILD_CACHE" -eq 1 ]; then
    PUBLISH_CMD+=(--rebuild-cache)
  fi
  if [ "$EXPLICIT_TAG" -eq 1 ]; then
    PUBLISH_CMD+=("$GIT_TAG")
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$LOCAL_MODE" -eq 1 ]; then
    GIT_TAG="<tag from candidate provenance>"
    echo " local        : $LOCAL_IMAGE"
  else
    build_cache_validate_inputs "$REPO_ROOT"
    if [ -z "$GIT_TAG" ]; then GIT_TAG="$(build_cache_default_tag "$REPO_ROOT" "$ALLOW_DIRTY")"; fi
    build_cache_validate_publish_tag "$GIT_TAG" "$WORKTREE_STATE"
    BASE_TAG="$(build_cache_base_tag "$REPO_ROOT")"
    DEPS_HASH="$(build_cache_deps_hash "$REPO_ROOT" "$BASE_TAG")"
    echo " base cache   : $BASE_CACHE_REPO:$BASE_TAG"
    echo " deps cache   : $DEPS_CACHE_REPO:$DEPS_HASH"
    echo " runtime deps : $RUNTIME_DEPS_CACHE_REPO:$DEPS_HASH-<resolved parents hash>"
  fi
  IMAGE_REF="$ACR_HOST/$IMAGE_NAME:$GIT_TAG"
  echo " publish      : $IMAGE_REF"
  echo "would run: ${PUBLISH_CMD[*]}"
  if [ "$DO_DEPLOY" -eq 1 ]; then
    echo "would run: $SCRIPT_DIR/deploy-postiz.sh --image $IMAGE_REF --namespace $NAMESPACE"
  fi
  exit 0
fi

IMAGE_REF="$(POSTIZ_PRINT_PUBLISHED_IMAGE=1 "${PUBLISH_CMD[@]}")"
if [ "$DO_DEPLOY" -eq 1 ]; then
  "$SCRIPT_DIR/deploy-postiz.sh" --image "$IMAGE_REF" --namespace "$NAMESPACE"
else
  echo "To roll out this image:"
  echo "  $SCRIPT_DIR/deploy-postiz.sh --image $IMAGE_REF --namespace $NAMESPACE"
fi
