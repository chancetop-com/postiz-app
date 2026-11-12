#!/usr/bin/env bash
# ============================================================
# Postiz publish (publish only)
#
# Publishes an image to the registry. Never deploys.
#
# Usage:
#   ./k8s/build-postiz.sh                  # ACR cloud build of the prepared context
#   ./k8s/build-postiz.sh <git_tag>        # ACR cloud build with an explicit tag
#   ./k8s/build-postiz.sh --local <image>  # push an image built by build-local.sh
#   ./k8s/build-postiz.sh --prepare        # re-run the preparer first
#
# Deployment is a separate action: ./k8s/deploy-postiz.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

ACR_NAME="${BUILD_ACR:-FBRDevAcr}"
ACR_HOST="${BUILD_ACR_HOST:-fbrdevacr.azurecr.io}"
IMAGE_NAME="app/postiz"

LOCAL_MODE=0
LOCAL_IMAGE=""
GIT_TAG=""
RUN_PREPARE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --local)
      LOCAL_MODE=1
      shift
      if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then
        LOCAL_IMAGE="$1"
        shift
      fi
      # The optional value was consumed above; skip the loop's own shift so
      # `--local <image>` as the last argument does not shift past the end.
      continue
      ;;
    --prepare) RUN_PREPARE=1 ;;
    -h|--help)
      sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "build-postiz: unknown argument: $1" >&2
      exit 2
      ;;
    *)
      GIT_TAG="$1"
      ;;
  esac
  shift
done

if [ "$RUN_PREPARE" -eq 1 ]; then
  # Same guard as build-local.sh: no implicit --allow-dirty.
  "$SCRIPT_DIR/prepare-build-context.sh"
fi

if [ -z "$GIT_TAG" ]; then
  GIT_TAG="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
fi

ACR_IMAGE="${ACR_HOST}/${IMAGE_NAME}:${GIT_TAG}"

echo "============================================"
echo " Postiz publish"
echo "============================================"
echo " registry : ${ACR_HOST}"
echo " image    : ${IMAGE_NAME}:${GIT_TAG}"
echo "============================================"

if [ "$LOCAL_MODE" -eq 1 ]; then
  if [ -z "$LOCAL_IMAGE" ]; then
    echo "build-postiz: --local needs an image name" >&2
    exit 2
  fi

  az acr login --name "$ACR_NAME"

  docker tag "${LOCAL_IMAGE}" "${ACR_IMAGE}"
  docker tag "${LOCAL_IMAGE}" "${ACR_HOST}/${IMAGE_NAME}:latest"
  docker push "${ACR_IMAGE}"
  docker push "${ACR_HOST}/${IMAGE_NAME}:latest"
else
  # The ACR build uses the build context prepared by
  # prepare-build-context.sh. Prepare first so no stale copy is shipped.
  if ! "$SCRIPT_DIR/prepare-build-context.sh" --check; then
    echo "" >&2
    echo "build-postiz: the build context is out of date; run ./k8s/prepare-build-context.sh first." >&2
    exit 1
  fi

  az acr login --name "$ACR_NAME"

  # Same public build-configuration allow-list as build-local.sh: the values
  # are inlined into the browser bundle by `next build`.
  PUBLIC_BUILD_ARGS=(--build-arg NODE_ENV=production)
  if [ -f "$SCRIPT_DIR/public-build-config.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|'#'*) continue ;; esac
      key=${line%%=*}
      value=${line#*=}
      if printenv "$key" >/dev/null 2>&1; then value="$(printenv "$key")"; fi
      PUBLIC_BUILD_ARGS+=(--build-arg "$key=$value")
    done < "$SCRIPT_DIR/public-build-config.env"
  fi

  az acr build \
    --registry "$ACR_NAME" \
    --image "${IMAGE_NAME}:${GIT_TAG}" \
    --image "${IMAGE_NAME}:latest" \
    --file "$SCRIPT_DIR/Dockerfile" \
    "${PUBLIC_BUILD_ARGS[@]}" \
    --timeout 3600 \
    "$SCRIPT_DIR"
fi

echo ""
echo "Published ${ACR_IMAGE}"
echo "Deploying is a separate action: ./k8s/deploy-postiz.sh --image ${ACR_IMAGE}"
