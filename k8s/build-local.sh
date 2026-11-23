#!/usr/bin/env bash
# ============================================================
# Postiz local image build (build only)
#
# Builds the candidate image from the prepared build context with the pinned
# toolchain.
# Never logs in to a registry, never pushes, never touches a cluster.
#
# Usage:
#   ./k8s/build-local.sh              # build candidate image for HEAD
#   ./k8s/build-local.sh --tag NAME   # explicit image tag
#   ./k8s/build-local.sh --prepare    # re-run the preparer first
#
# No NEXT_PUBLIC_* value is baked into the image: the runtime reads the
# deployment's ConfigMap/Secret and passes public values to client code through
# VariableContext. The build only receives NODE_ENV.
#
# For publishing use ./k8s/build-postiz.sh, for deployment
# ./k8s/deploy-postiz.sh. Neither is implied by this script.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

TAG=""
RUN_PREPARE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      shift
      [ $# -gt 0 ] || { echo "build-local: --tag needs a value" >&2; exit 2; }
      TAG="$1"
      ;;
    --prepare) RUN_PREPARE=1 ;;
    -h|--help)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "build-local: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$RUN_PREPARE" -eq 1 ]; then
  # No --allow-dirty here on purpose: the documented dirty-tree guard must stay
  # reachable through this entry point. A dirty tree fails with the preparer's
  # message; commit first, or run prepare-build-context.sh --allow-dirty
  # explicitly and then build without --prepare.
  "$SCRIPT_DIR/prepare-build-context.sh"
fi

if [ -z "$TAG" ]; then
  TAG="postiz-candidate:$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
fi

if command -v shasum >/dev/null 2>&1; then
  SHA_CMD=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD=(sha256sum)
else
  echo "build-local: need shasum or sha256sum" >&2
  exit 2
fi

sha_of_file() { "${SHA_CMD[@]}" "$1" | awk '{print $1}'; }

# Shared with prepare-build-context.sh so both escape values identically.
if [ ! -f "$SCRIPT_DIR/lib/json.sh" ]; then
  echo "build-local: missing helper $SCRIPT_DIR/lib/json.sh" >&2
  exit 2
fi
# shellcheck source=lib/json.sh
. "$SCRIPT_DIR/lib/json.sh"

# ------------------------------------------------------------
# Provenance inputs
# ------------------------------------------------------------
MANIFEST="$SCRIPT_DIR/BUILD_CONTEXT_MANIFEST.json"
if [ ! -f "$MANIFEST" ]; then
  echo "build-local: $MANIFEST is missing; run ./k8s/prepare-build-context.sh first" >&2
  exit 2
fi

# The image is built from the prepared context, so the provenance commit is
# the commit the manifest recorded, not whatever HEAD happens to be now.
SOURCE_COMMIT="$(sed -n 's/^  "sourceCommit": "\(.*\)",$/\1/p' "$MANIFEST")"
SOURCE_REF="$(sed -n 's/^  "sourceRef": "\(.*\)",$/\1/p' "$MANIFEST")"
WORKTREE_STATE="$(sed -n 's/^  "worktreeState": "\(.*\)",$/\1/p' "$MANIFEST")"
HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [ "$SOURCE_COMMIT" = "$HEAD_COMMIT" ]; then
  CONTEXT_MATCHES_HEAD="true"
else
  CONTEXT_MATCHES_HEAD="false"
  echo "build-local: WARNING: the build context was prepared from $SOURCE_COMMIT" >&2
  echo "build-local:          but HEAD is $HEAD_COMMIT; the image is built from the stale context." >&2
fi

echo "============================================"
echo " Postiz local image build"
echo "============================================"
echo " context: $SCRIPT_DIR"
echo " image  : $TAG"
echo " commit : $SOURCE_COMMIT ($WORKTREE_STATE)"
echo " node   : 22.23.4 / pnpm 10.6.1 (pinned in the Dockerfile)"
echo "============================================"

BUILD_ARGS=(--build-arg NODE_ENV=production)

docker build \
  --file "$SCRIPT_DIR/Dockerfile" \
  "${BUILD_ARGS[@]}" \
  --tag "$TAG" \
  "$SCRIPT_DIR"

IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$TAG")"
IMAGE_ARCH="$(docker image inspect --format '{{.Architecture}}' "$TAG")"
IMAGE_OS="$(docker image inspect --format '{{.Os}}' "$TAG")"

# ------------------------------------------------------------
# Provenance: what was built, from which inputs.
# The registry digest only exists after a publish, which this script does not do.
# ------------------------------------------------------------
PROVENANCE="$SCRIPT_DIR/BUILD_PROVENANCE.json"

{
  printf '{\n'
  printf '  "schemaVersion": 1,\n'
  printf '  "imageTag": "%s",\n' "$(json_escape "$TAG")"
  printf '  "imageId": "%s",\n' "$(json_escape "$IMAGE_ID")"
  printf '  "builtAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "published": false,\n'
  printf '  "registryDigest": null,\n'
  printf '  "note": "Local candidate image. No registry digest exists because nothing was pushed; the image ID is local to this Docker daemon.",\n'
  printf '  "target": { "os": "%s", "architecture": "%s" },\n' \
    "$(json_escape "$IMAGE_OS")" "$(json_escape "$IMAGE_ARCH")"
  printf '  "source": {\n'
  printf '    "commit": "%s",\n' "$(json_escape "$SOURCE_COMMIT")"
  printf '    "ref": "%s",\n' "$(json_escape "$SOURCE_REF")"
  printf '    "worktreeState": "%s",\n' "$(json_escape "$WORKTREE_STATE")"
  printf '    "currentHead": "%s",\n' "$(json_escape "$HEAD_COMMIT")"
  printf '    "contextMatchesHead": %s,\n' "$CONTEXT_MATCHES_HEAD"
  printf '    "buildContextManifest": { "path": "k8s/BUILD_CONTEXT_MANIFEST.json", "sha256": "%s" }\n' \
    "$(sha_of_file "$MANIFEST")"
  printf '  },\n'
  printf '  "inputs": {\n'
  printf '    "lockfile": { "path": "pnpm-lock.yaml", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/pnpm-lock.yaml")"
  printf '    "workspace": { "path": "pnpm-workspace.yaml", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/pnpm-workspace.yaml")"
  printf '    "dockerfile": { "path": "k8s/Dockerfile", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/Dockerfile")"
  printf '    "pm2Config": { "path": "var/docker/ecosystem.config.cjs", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/var/docker/ecosystem.config.cjs")"
  printf '    "nginxConfig": { "path": "var/docker/nginx.conf", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/var/docker/nginx.conf")"
  printf '    "entrypoint": { "path": "var/docker/entrypoint.sh", "sha256": "%s" },\n' \
    "$(sha_of_file "$SCRIPT_DIR/var/docker/entrypoint.sh")"
  printf '    "nextConfig": { "path": "apps/frontend/next.config.js", "sha256": "%s" }\n' \
    "$(sha_of_file "$SCRIPT_DIR/apps/frontend/next.config.js")"
  printf '  },\n'
  printf '  "toolchain": { "node": "22.23.4", "pnpm": "10.6.1", "prisma": "6.5.0" },\n'
  printf '  "baseImages": [\n'
  printf '    { "image": "node:22.23.4-bookworm", "repoDigest": "%s", "id": "%s" },\n' \
    "$(json_escape "$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' node:22.23.4-bookworm 2>/dev/null || true)")" \
    "$(json_escape "$(docker image inspect --format '{{.Id}}' node:22.23.4-bookworm 2>/dev/null || true)")"
  printf '    { "image": "node:22.23.4-bookworm-slim", "repoDigest": "%s", "id": "%s" }\n' \
    "$(json_escape "$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' node:22.23.4-bookworm-slim 2>/dev/null || true)")" \
    "$(json_escape "$(docker image inspect --format '{{.Id}}' node:22.23.4-bookworm-slim 2>/dev/null || true)")"
  printf '  ],\n'
  if [ -f "$REPO_ROOT/apps/frontend/public/g.js" ]; then
    printf '  "generatedAssets": [ { "path": "apps/frontend/public/g.js", "status": "generated", "sha256": "%s" } ]\n' \
      "$(sha_of_file "$REPO_ROOT/apps/frontend/public/g.js")"
  else
    printf '  "generatedAssets": [ { "path": "apps/frontend/public/g.js", "status": "not-generated", "reason": "GTM is not enabled for this profile; no tracking service is added." } ]\n'
  fi
  printf '}\n'
} > "$PROVENANCE"

echo ""
echo "Built $TAG"
echo "Image ID: $IMAGE_ID"
echo "Provenance: $PROVENANCE"
echo ""
echo "This script did not publish or deploy anything."
echo "Publish: ./k8s/build-postiz.sh --local $TAG"
echo "Deploy : ./k8s/deploy-postiz.sh --image <registry>/app/postiz:<tag>"
