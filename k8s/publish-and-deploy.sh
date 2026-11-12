#!/usr/bin/env bash
# ============================================================
# Postiz one-command pipeline (prepare + publish [+ deploy])
#
# Convenience wrapper around the separate actions. Preparation and
# publishing always run; the deployment runs only with --deploy.
#
# Usage:
#   ./k8s/publish-and-deploy.sh                    # prepare + publish
#   ./k8s/publish-and-deploy.sh --deploy           # prepare + publish + deploy
#   ./k8s/publish-and-deploy.sh <git_tag>          # explicit image tag
#   ./k8s/publish-and-deploy.sh --local <image>    # push an image from build-local.sh
#   ./k8s/publish-and-deploy.sh --skip-prepare     # reuse the current context
#   ./k8s/publish-and-deploy.sh --namespace NAME   # deployment namespace (default dev-ai)
#   ./k8s/publish-and-deploy.sh --dry-run          # print the plan, run nothing
#
# --local implies --skip-prepare: that image was already built from the
# current context and an explicit git tag cannot be combined with it.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

ACR_HOST="${BUILD_ACR_HOST:-fbrdevacr.azurecr.io}"
IMAGE_NAME="app/postiz"

DO_DEPLOY=0
RUN_PREPARE=1
DRY_RUN=0
LOCAL_MODE=0
LOCAL_IMAGE=""
GIT_TAG=""
NAMESPACE="${DEPLOY_NAMESPACE:-dev-ai}"

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy) DO_DEPLOY=1 ;;
    --skip-prepare) RUN_PREPARE=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --local)
      LOCAL_MODE=1
      RUN_PREPARE=0
      if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then
        LOCAL_IMAGE="$2"
        shift
      fi
      ;;
    --namespace)
      shift
      [ $# -gt 0 ] || { echo "publish-and-deploy: --namespace needs a value" >&2; exit 2; }
      NAMESPACE="$1"
      ;;
    -h|--help)
      sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "publish-and-deploy: unknown argument: $1" >&2
      exit 2
      ;;
    *)
      GIT_TAG="$1"
      ;;
  esac
  shift
done

if [ "$LOCAL_MODE" -eq 1 ] && [ -z "$LOCAL_IMAGE" ]; then
  echo "publish-and-deploy: --local needs an image name" >&2
  exit 2
fi

if [ "$LOCAL_MODE" -eq 1 ] && [ -n "$GIT_TAG" ]; then
  echo "publish-and-deploy: an explicit tag cannot be combined with --local" >&2
  exit 2
fi

if [ -z "$GIT_TAG" ]; then
  GIT_TAG="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
fi

IMAGE_REF="${ACR_HOST}/${IMAGE_NAME}:${GIT_TAG}"

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'would run: %s\n' "$*"
  else
    "$@"
  fi
}

echo "============================================"
echo " Postiz publish pipeline"
echo "============================================"
if [ "$RUN_PREPARE" -eq 1 ]; then
  echo " prepare  : yes"
else
  echo " prepare  : skipped"
fi
echo " publish  : ${IMAGE_REF}"
if [ "$DO_DEPLOY" -eq 1 ]; then
  echo " deploy   : yes (${NAMESPACE})"
else
  echo " deploy   : no (pass --deploy to roll out)"
fi
if [ "$LOCAL_MODE" -eq 1 ]; then
  echo " local    : ${LOCAL_IMAGE}"
fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo " dry run  : nothing will change"
fi
echo "============================================"

if [ "$RUN_PREPARE" -eq 1 ]; then
  run "$SCRIPT_DIR/prepare-build-context.sh"
fi

if [ "$LOCAL_MODE" -eq 1 ]; then
  run "$SCRIPT_DIR/build-postiz.sh" --local "$LOCAL_IMAGE"
else
  run "$SCRIPT_DIR/build-postiz.sh" "$GIT_TAG"
fi

if [ "$DO_DEPLOY" -eq 1 ]; then
  run "$SCRIPT_DIR/deploy-postiz.sh" --image "$IMAGE_REF" --namespace "$NAMESPACE"
else
  echo ""
  echo "Not deploying. To roll out this image:"
  echo "  $SCRIPT_DIR/deploy-postiz.sh --image $IMAGE_REF --namespace $NAMESPACE"
fi
