#!/usr/bin/env bash
# ============================================================
# Postiz build-context preparer
#
# Regenerates the generated part of ./k8s from the repository root,
# so the repository root stays the only source of business code.
#
# Actions are deliberately separate:
#   prepare (this script) -> local build (build-local.sh)
#                         -> publish     (build-postiz.sh)
#                         -> deploy      (deploy-postiz.sh)
#
# Usage:
#   ./k8s/prepare-build-context.sh                  # regenerate ./k8s
#   ./k8s/prepare-build-context.sh --check          # verify only, never writes
#   ./k8s/prepare-build-context.sh --allow-dirty    # allow an uncommitted candidate
#   ./k8s/prepare-build-context.sh --context DIR    # alternative build-context dir
#
# Exit codes:
#   0  prepared (or --check found the context in sync)
#   1  a required input is missing, or --check found drift
#   2  usage / environment error
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$REPO_ROOT" ]; then
  echo "prepare-build-context: not inside a git work tree: $SCRIPT_DIR" >&2
  exit 2
fi

CONTEXT_DIR="$REPO_ROOT/k8s"
CHECK_ONLY=0
ALLOW_DIRTY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --context)
      shift
      [ $# -gt 0 ] || { echo "prepare-build-context: --context needs a value" >&2; exit 2; }
      case "$1" in
        /*) CONTEXT_DIR="$1" ;;
        *) CONTEXT_DIR="$REPO_ROOT/$1" ;;
      esac
      CONTEXT_DIR="$(cd -- "$CONTEXT_DIR" 2>/dev/null && pwd || printf '%s' "$CONTEXT_DIR")"
      case "$CONTEXT_DIR" in
        "$REPO_ROOT"/*) ;;
        *)
          echo "prepare-build-context: --context must be inside the repository ($REPO_ROOT)" >&2
          exit 2
          ;;
      esac
      case "$CONTEXT_DIR" in
        "$REPO_ROOT")
          echo "prepare-build-context: --context must not be the repository root" >&2
          exit 2
          ;;
      esac
      ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "prepare-build-context: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

# ------------------------------------------------------------
# Inputs generated from the repository root.
# Anything not listed here is a context-only file and is preserved.
# ------------------------------------------------------------
SYNC_DIRS=(apps libraries var/docker)

SYNC_FILES=(
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
)

# Required inputs: missing any of these fails the run instead of
# silently producing an incomplete build context.
REQUIRED_INPUTS=(
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  apps/backend/package.json
  apps/backend/tsconfig.build.json
  apps/frontend/package.json
  apps/frontend/next.config.js
  apps/frontend/tsconfig.json
  apps/frontend/tailwind.config.cjs
  apps/frontend/postcss.config.mjs
  apps/orchestrator/package.json
  apps/orchestrator/tsconfig.build.json
  libraries/nestjs-libraries/src/database/prisma/schema.prisma
  var/docker/nginx.conf
  var/docker/ecosystem.config.cjs
)

# Never carried into a build context.
EXCLUDES=(
  --exclude 'node_modules'
  --exclude '*.tsbuildinfo'
  --exclude '.git'
  --exclude '.next'
  --exclude 'dist'
  --exclude '.nx'
  --exclude 'coverage'
  --exclude '.DS_Store'
  --exclude '*.log'
  --exclude '.env'
  --exclude '.env.*'
)

# ------------------------------------------------------------
# Source provenance
# ------------------------------------------------------------
if ! git -C "$REPO_ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "prepare-build-context: repository has no HEAD commit" >&2
  exit 2
fi

SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"

# The build context lives inside the repository, so its generated
# content must not be counted as "uncommitted source".
CONTEXT_REL=""
case "$CONTEXT_DIR" in
  "$REPO_ROOT"/*) CONTEXT_REL="${CONTEXT_DIR#"$REPO_ROOT"/}" ;;
esac

if [ -n "$CONTEXT_REL" ]; then
  DIRTY_STATUS="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal -- \
    . ":(exclude)${CONTEXT_REL}" ":(exclude)${CONTEXT_REL}/**")"
else
  DIRTY_STATUS="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)"
fi

if [ -n "$DIRTY_STATUS" ] && [ "$CHECK_ONLY" -eq 0 ]; then
  if [ "$ALLOW_DIRTY" -ne 1 ]; then
    echo "prepare-build-context: working tree is not clean; commit first or pass --allow-dirty" >&2
    echo "$DIRTY_STATUS" | sed 's/^/  /' >&2
    exit 2
  fi
  WORKTREE_STATE="dirty"
else
  WORKTREE_STATE="clean"
fi

if command -v shasum >/dev/null 2>&1; then
  SHA_CMD=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD=(sha256sum)
else
  echo "prepare-build-context: need shasum or sha256sum" >&2
  exit 2
fi

sha_of_file() {
  "${SHA_CMD[@]}" "$1" | awk '{print $1}'
}

sha_of_string() {
  printf '%s' "$1" | "${SHA_CMD[@]}" | awk '{print $1}'
}

# Paths and refs are interpolated into the manifest, so quote them properly.
# The helper lives next to this script so every build script escapes alike.
if [ ! -f "$SCRIPT_DIR/lib/json.sh" ]; then
  echo "prepare-build-context: missing helper $SCRIPT_DIR/lib/json.sh" >&2
  exit 2
fi
# shellcheck source=lib/json.sh
. "$SCRIPT_DIR/lib/json.sh"

# The generated trees, relative to the context directory.
generated_files() {
  local dir
  for dir in "${SYNC_DIRS[@]}"; do
    if [ -d "$CONTEXT_DIR/$dir" ]; then
      find "$CONTEXT_DIR/$dir" -type f
    fi
  done | sed "s|^$CONTEXT_DIR/||"
}

generated_file_count() {
  generated_files | wc -l | tr -d ' '
}

# ------------------------------------------------------------
# Verify every required input exists before mutating anything.
# ------------------------------------------------------------
missing=()
for input in "${REQUIRED_INPUTS[@]}"; do
  [ -f "$REPO_ROOT/$input" ] || missing+=("$input")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "prepare-build-context: missing required build input(s):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

for dir in "${SYNC_DIRS[@]}"; do
  if [ ! -d "$REPO_ROOT/$dir" ]; then
    echo "prepare-build-context: missing required source directory: $dir" >&2
    exit 1
  fi
done

# ------------------------------------------------------------
# Sync
# ------------------------------------------------------------
# --check is read-only: it must never create or modify anything, not even
# the context directory itself. A missing context is reported as drift.
if [ "$CHECK_ONLY" -eq 1 ]; then
  drift=0

  if ! command -v rsync >/dev/null 2>&1; then
    echo "prepare-build-context: rsync is required" >&2
    exit 2
  fi

  if [ ! -d "$CONTEXT_DIR" ]; then
    echo "DRIFT  $CONTEXT_DIR (missing)" >&2
    echo "prepare-build-context: build context does not exist; run ./k8s/prepare-build-context.sh first" >&2
    exit 1
  fi

  for dir in "${SYNC_DIRS[@]}"; do
    if [ ! -d "$CONTEXT_DIR/$dir" ]; then
      echo "DRIFT  $dir/ (missing)" >&2
      drift=1
      continue
    fi
    changes="$(rsync -ain --delete "${EXCLUDES[@]}" "$REPO_ROOT/$dir/" "$CONTEXT_DIR/$dir/" \
      | grep -v '^\.d' | grep -v '^$' || true)"
    if [ -n "$changes" ]; then
      echo "DRIFT  $dir/" >&2
      echo "$changes" | sed 's/^/  /' >&2
      drift=1
    fi
  done
  for file in "${SYNC_FILES[@]}"; do
    if ! cmp -s "$REPO_ROOT/$file" "$CONTEXT_DIR/$file"; then
      echo "DRIFT  $file" >&2
      drift=1
    fi
  done
  if [ "$drift" -ne 0 ]; then
    echo "prepare-build-context: build context is out of date with the repository root" >&2
    exit 1
  fi
  echo "prepare-build-context: build context is in sync with $SOURCE_COMMIT"
  exit 0
fi

# Remove only the generated trees, never the whole context: the
# Dockerfile, Dockerfile.runtime, .dockerignore, build scripts,
# ecosystem.config.cjs and .core-ai are context-only files.
# This is the first mutation, so --check (above) stays read-only.
mkdir -p "$CONTEXT_DIR"
for dir in "${SYNC_DIRS[@]}"; do
  rm -rf "$CONTEXT_DIR/$dir"
done
for file in "${SYNC_FILES[@]}"; do
  rm -f "$CONTEXT_DIR/$file"
done

for dir in "${SYNC_DIRS[@]}"; do
  rsync -a "${EXCLUDES[@]}" "$REPO_ROOT/$dir/" "$CONTEXT_DIR/$dir/"
done
for file in "${SYNC_FILES[@]}"; do
  mkdir -p "$CONTEXT_DIR/$(dirname -- "$file")"
  cp "$REPO_ROOT/$file" "$CONTEXT_DIR/$file"
done

# ------------------------------------------------------------
# Manifest: which inputs came from where, and what they hashed to.
# ------------------------------------------------------------
MANIFEST="$CONTEXT_DIR/BUILD_CONTEXT_MANIFEST.json"

{
  printf '{\n'
  printf '  "sourceCommit": "%s",\n' "$(json_escape "$SOURCE_COMMIT")"
  printf '  "sourceRef": "%s",\n' "$(json_escape "$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')")"
  printf '  "worktreeState": "%s",\n' "$WORKTREE_STATE"
  if [ "$WORKTREE_STATE" = "dirty" ]; then
    printf '  "worktreeDigest": "%s",\n' "$(sha_of_string "$DIRTY_STATUS")"
  fi
  printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "requiredInputs": [\n'
  first=1
  for input in "${REQUIRED_INPUTS[@]}"; do
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    { "path": "%s", "sha256": "%s" }' \
      "$(json_escape "$input")" "$(sha_of_file "$REPO_ROOT/$input")"
  done
  printf '\n  ],\n'
  printf '  "generatedPathCount": %s,\n' "$(generated_file_count)"
  printf '  "generatedFiles": [\n'
  first=1
  while IFS= read -r rel; do
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    { "path": "%s/%s", "sha256": "%s" }' \
      "$(json_escape "$CONTEXT_REL")" "$(json_escape "$rel")" "$(sha_of_file "$CONTEXT_DIR/$rel")"
  done < <(generated_files | LC_ALL=C sort)
  printf '\n  ],\n'
  printf '  "preservedContextFiles": [\n    "Dockerfile",\n    "Dockerfile.runtime",\n    ".dockerignore",\n    "build-postiz.sh",\n    "build-local.sh",\n    "deploy-postiz.sh",\n    "prepare-build-context.sh",\n    "lib/",\n    "tests/",\n    "ecosystem.config.cjs",\n    ".core-ai/"\n  ]\n'
  printf '}\n'
} > "$MANIFEST"

echo "prepare-build-context: prepared $CONTEXT_DIR"
echo "  source commit : $SOURCE_COMMIT ($WORKTREE_STATE)"
echo "  generated files: $(generated_file_count)"
echo "  manifest      : $MANIFEST"
