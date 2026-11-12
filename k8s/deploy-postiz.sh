#!/usr/bin/env bash
# ============================================================
# Postiz deployment (deploy only)
#
# Sets the image on the existing deployment and waits for rollout.
# Never builds, never publishes.
#
# Usage:
#   ./k8s/deploy-postiz.sh --image fbrdevacr.azurecr.io/app/postiz:<tag>
# ============================================================
set -euo pipefail

NAMESPACE="${DEPLOY_NAMESPACE:-dev-ai}"
DEPLOYMENT_NAME="${DEPLOY_DEPLOYMENT:-postiz}"
IMAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --image)
      shift
      [ $# -gt 0 ] || { echo "deploy-postiz: --image needs a value" >&2; exit 2; }
      IMAGE="$1"
      ;;
    --namespace)
      shift
      [ $# -gt 0 ] || { echo "deploy-postiz: --namespace needs a value" >&2; exit 2; }
      NAMESPACE="$1"
      ;;
    -h|--help)
      sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "deploy-postiz: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$IMAGE" ]; then
  echo "deploy-postiz: --image is required" >&2
  exit 2
fi

echo "Deploying ${IMAGE} to ${NAMESPACE}/${DEPLOYMENT_NAME}"

kubectl set image "deployment/${DEPLOYMENT_NAME}" \
  "${DEPLOYMENT_NAME}=${IMAGE}" \
  -n "${NAMESPACE}"

kubectl rollout status "deployment/${DEPLOYMENT_NAME}" \
  -n "${NAMESPACE}" \
  --timeout=300s
