#!/usr/bin/env bash
# ============================================================
# Shared build-cache constants, digest, and validation helpers (ADR-0001).
#
# Can be sourced as a library by k8s/build-local.sh, k8s/build-postiz.sh,
# and k8s/publish-and-deploy.sh, or executed directly as a CLI:
#
#   ./k8s/lib/build-cache.sh base-tag [--repo DIR]
#   ./k8s/lib/build-cache.sh deps-hash [--repo DIR] [--base-tag TAG]
#   ./k8s/lib/build-cache.sh validate-inputs [--repo DIR]
#   ./k8s/lib/build-cache.sh check-worktree [--repo DIR] [--allow-dirty]
#   ./k8s/lib/build-cache.sh default-tag [--repo DIR] [--allow-dirty]
#   ./k8s/lib/build-cache.sh node-version [--repo DIR]
#   ./k8s/lib/build-cache.sh pnpm-version [--repo DIR]
#   ./k8s/lib/build-cache.sh prisma-version [--repo DIR]
#
# Exit codes:
#   0  success
#   1  missing required build input or invalid toolchain metadata
#   2  usage error, non-git repository, or dirty worktree without --allow-dirty
# ============================================================

# Centralized ACR and local repository names (ADR-0001).
BUILD_CACHE_ACR_NAME_DEFAULT="FBRDevAcr"
BUILD_CACHE_ACR_HOST_DEFAULT="fbrdevacr.azurecr.io"
BUILD_CACHE_APP_REPO="app/postiz"
BUILD_CACHE_BASE_REPO="ops/postiz-base"
BUILD_CACHE_DEPS_REPO="ops/postiz-deps"
BUILD_CACHE_RUNTIME_DEPS_REPO="ops/postiz-runtime-deps"

BUILD_CACHE_LOCAL_APP_REPO="postiz-candidate"
BUILD_CACHE_LOCAL_BASE_REPO="postiz-base"
BUILD_CACHE_LOCAL_DEPS_REPO="postiz-deps"
BUILD_CACHE_LOCAL_RUNTIME_DEPS_REPO="postiz-runtime-deps"

# Required top-level directories for repository-root layered builds.
BUILD_CACHE_REQUIRED_DIRS=(
  apps
  libraries
  var/docker
)

# Required repository files for the four-layer build pipeline.
BUILD_CACHE_REQUIRED_INPUTS=(
  .dockerignore
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json
  apps/backend/package.json
  apps/backend/tsconfig.build.json
  apps/commands/package.json
  apps/extension/package.json
  apps/frontend/package.json
  apps/frontend/next.config.js
  apps/frontend/tsconfig.json
  apps/frontend/tailwind.config.cjs
  apps/frontend/postcss.config.mjs
  apps/frontend/scripts/fetch-gtm.mjs
  apps/orchestrator/package.json
  apps/orchestrator/tsconfig.build.json
  apps/sdk/package.json
  libraries/nestjs-libraries/src/database/prisma/schema.prisma
  var/docker/entrypoint.sh
  var/docker/nginx.conf
  var/docker/ecosystem.config.cjs
  k8s/Dockerfile
  k8s/build-app.yaml
  k8s/Dockerfile.base
  k8s/Dockerfile.deps
  k8s/Dockerfile.runtime-deps
)

# Canonical ordered file inputs hashed into the dependencies cache digest.
# Any edit to these files (or to the runtime OS base tag) invalidates both
# ops/postiz-deps:<deps-hash> and ops/postiz-runtime-deps:<runtime-tag>.
BUILD_CACHE_DEPS_INPUTS=(
  .npmrc
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  apps/backend/package.json
  apps/commands/package.json
  apps/extension/package.json
  apps/frontend/package.json
  apps/frontend/scripts/fetch-gtm.mjs
  apps/orchestrator/package.json
  apps/sdk/package.json
  libraries/nestjs-libraries/src/database/prisma/schema.prisma
  k8s/Dockerfile.deps
  k8s/Dockerfile.runtime-deps
)

_build_cache_default_repo_root() {
  local helper_dir repo_root
  helper_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(git -C "$helper_dir" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$repo_root" ]; then
    printf '%s' "$repo_root"
  else
    pwd
  fi
}

_build_cache_sha256_stdin() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    echo "build-cache: need shasum or sha256sum" >&2
    return 2
  fi
}

# Print the 64-character lowercase hex SHA-256 digest of a file.
build_cache_sha256_file() {
  local file="${1:-}"
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    echo "build-cache: missing file for sha256: ${file:-<empty>}" >&2
    return 1
  fi
  _build_cache_sha256_stdin < "$file"
}

# Print the 64-character lowercase hex SHA-256 digest of a string.
build_cache_sha256_string() {
  printf '%s' "${1:-}" | _build_cache_sha256_stdin
}

build_cache_validate_publish_tag() {
  local tag="$1" state="$2"
  if [[ ! "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
    echo "build-postiz: invalid image tag: $tag" >&2
    return 2
  fi
  if [ "$state" = dirty ] && [ "$tag" = latest ]; then
    echo "build-postiz: a dirty build cannot be published as latest" >&2
    return 2
  fi
}

# A forced rebuild can replace a parent without changing its input tag.
build_cache_runtime_tag() {
  local deps_hash="$1" base_id="$2" deps_id="$3" digest
  digest="$(build_cache_sha256_string "$base_id $deps_id")" || return 1
  printf '%s-%s\n' "$deps_hash" "${digest:0:16}"
}

_build_cache_pkg_field() {
  local pkg_file="$1"
  local field="$2"
  if [ ! -f "$pkg_file" ]; then
    echo "build-cache: missing package manifest: $pkg_file" >&2
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "build-cache: node is required to read toolchain versions from $pkg_file" >&2
    return 2
  fi

  node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const field = process.argv[2];
    let val = "";
    if (field === "node") {
      val = (pkg.engines && pkg.engines.node) || "";
    } else if (field === "pnpm") {
      const pm = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
      val = pm.startsWith("pnpm@") ? pm.slice(5) : "";
    } else if (field === "prisma") {
      val = (pkg.dependencies && pkg.dependencies.prisma) || "";
    }
    if (typeof val !== "string" || !val) process.exit(1);
    process.stdout.write(val);
  ' "$pkg_file" "$field"
}

_build_cache_validate_semver() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
    echo "build-cache: invalid pinned $label version: [$value]" >&2
    return 1
  fi
}

# Print the pinned Node version from <repo_root>/package.json (engines.node).
build_cache_node_version() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local ver
  ver="$(_build_cache_pkg_field "$repo_root/package.json" node)" || {
    echo "build-cache: failed to read engines.node from $repo_root/package.json" >&2
    return 1
  }
  _build_cache_validate_semver "Node" "$ver" || return 1
  printf '%s\n' "$ver"
}

# Print the pinned pnpm version from <repo_root>/package.json (packageManager).
build_cache_pnpm_version() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local ver
  ver="$(_build_cache_pkg_field "$repo_root/package.json" pnpm)" || {
    echo "build-cache: failed to read pnpm packageManager from $repo_root/package.json" >&2
    return 1
  }
  _build_cache_validate_semver "pnpm" "$ver" || return 1
  printf '%s\n' "$ver"
}

# Print the pinned Prisma version from <repo_root>/package.json (dependencies.prisma).
build_cache_prisma_version() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local ver
  ver="$(_build_cache_pkg_field "$repo_root/package.json" prisma)" || {
    echo "build-cache: failed to read dependencies.prisma from $repo_root/package.json" >&2
    return 1
  }
  _build_cache_validate_semver "Prisma" "$ver" || return 1
  printf '%s\n' "$ver"
}

# Compute deterministic runtime OS base cache tag:
#   node<node-version>-pnpm<pnpm-version>-<12-hex-sha256(k8s/Dockerfile.base)>
build_cache_base_tag() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local node_ver pnpm_ver base_sha
  node_ver="$(build_cache_node_version "$repo_root")" || return $?
  pnpm_ver="$(build_cache_pnpm_version "$repo_root")" || return $?
  base_sha="$(build_cache_sha256_file "$repo_root/k8s/Dockerfile.base")" || return $?
  printf 'node%s-pnpm%s-%s\n' "$node_ver" "$pnpm_ver" "${base_sha:0:12}"
}

# Compute deterministic 16-hex dependencies cache digest incorporating:
#   - runtime OS base-tag
#   - .npmrc, package.json, pnpm-lock.yaml, pnpm-workspace.yaml
#   - all workspace apps/*/package.json manifests
#   - apps/frontend/scripts/fetch-gtm.mjs
#   - libraries/nestjs-libraries/src/database/prisma/schema.prisma
#   - k8s/Dockerfile.deps and k8s/Dockerfile.runtime-deps
build_cache_deps_hash() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local base_tag="${2:-}"
  if [ -z "$base_tag" ]; then
    base_tag="$(build_cache_base_tag "$repo_root")" || return $?
  fi

  local manifest file_sha rel digest
  manifest="base-tag=${base_tag}"$'\n'
  for rel in "${BUILD_CACHE_DEPS_INPUTS[@]}"; do
    file_sha="$(build_cache_sha256_file "$repo_root/$rel")" || return $?
    manifest+="file ${rel} ${file_sha}"$'\n'
  done

  digest="$(build_cache_sha256_string "$manifest")" || return $?
  printf '%s\n' "${digest:0:16}"
}

# Verify all required build input files and directories exist under repo_root.
build_cache_validate_inputs() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  if [ ! -d "$repo_root" ]; then
    echo "build-cache: repository root does not exist: $repo_root" >&2
    return 1
  fi

  local missing_files=()
  local missing_dirs=()
  local rel

  for rel in "${BUILD_CACHE_REQUIRED_INPUTS[@]}"; do
    [ -f "$repo_root/$rel" ] || missing_files+=("$rel")
  done

  for rel in "${BUILD_CACHE_REQUIRED_DIRS[@]}"; do
    [ -d "$repo_root/$rel" ] || missing_dirs+=("$rel")
  done

  if [ "${#missing_files[@]}" -gt 0 ] || [ "${#missing_dirs[@]}" -gt 0 ]; then
    echo "build-cache: missing required build input(s) under $repo_root:" >&2
    if [ "${#missing_files[@]}" -gt 0 ]; then
      printf '  - file: %s\n' "${missing_files[@]}" >&2
    fi
    if [ "${#missing_dirs[@]}" -gt 0 ]; then
      printf '  - dir : %s\n' "${missing_dirs[@]}" >&2
    fi
    return 1
  fi
  return 0
}

_build_cache_require_git_head() {
  local repo_root="$1"
  if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "build-cache: not inside a git work tree: $repo_root" >&2
    return 2
  fi
  if ! git -C "$repo_root" rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "build-cache: repository has no HEAD commit: $repo_root" >&2
    return 2
  fi
  return 0
}

# Print git porcelain status (including untracked files) for repo_root.
build_cache_worktree_status() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  _build_cache_require_git_head "$repo_root" || return $?
  git -C "$repo_root" status --porcelain --untracked-files=normal
}

# Print "clean" or "dirty" for repo_root without rejecting dirty trees.
build_cache_worktree_state() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local status
  status="$(build_cache_worktree_status "$repo_root")" || return $?
  if [ -n "$status" ]; then
    printf 'dirty\n'
  else
    printf 'clean\n'
  fi
}

# Freeze the repository-root inputs once. Clean builds read Git objects; opted-in
# dirty builds capture tracked and non-ignored untracked files in private Git
# storage. Only the exported context is handed to Docker and Azure CLI.
build_cache_snapshot() (
  set -euo pipefail
  local repo="$1" commit="$2" state="$3" temp="$4"
  local context="$temp/context" tree
  mkdir "$context"
  cd "$repo"
  if [ "$state" = dirty ]; then
    local objects
    objects="$(git rev-parse --path-format=absolute --git-path objects)"
    git ls-files --cached --others --exclude-standard -z > "$temp/paths"
    export GIT_INDEX_FILE="$temp/index"
    export GIT_OBJECT_DIRECTORY="$temp/objects"
    export GIT_ALTERNATE_OBJECT_DIRECTORIES="$objects"
    mkdir "$GIT_OBJECT_DIRECTORY"
    git -c core.splitIndex=false update-index --add --remove -z --stdin < "$temp/paths"
    tree="$(git write-tree)"
    git archive "$tree" | tar -x -C "$context"
    if [ "$(git rev-parse HEAD)" != "$commit" ]; then
      echo "build-cache: HEAD changed while capturing dirty inputs; retry the build" >&2
      exit 2
    fi
    build_cache_sha256_string "$tree"
  else
    git archive "$commit" | tar -x -C "$context" || {
      echo "build-cache: missing required build input or unreadable source snapshot" >&2
      exit 1
    }
  fi
  build_cache_validate_inputs "$context"
)

# Guard against dirty working trees by default.
# Usage: build_cache_check_worktree [repo_root] [--allow-dirty|1]
# Prints "clean" or "dirty" on stdout when permitted; exits 2 on dirty tree
# without --allow-dirty or when repo_root is not a valid git repository.
build_cache_check_worktree() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local allow_flag="${2:-0}"
  local allow_dirty=0
  case "$allow_flag" in
    --allow-dirty|1|true) allow_dirty=1 ;;
    ""|0|false) allow_dirty=0 ;;
    *)
      echo "build-cache: unknown allow_dirty option: $allow_flag" >&2
      return 2
      ;;
  esac

  local status
  status="$(build_cache_worktree_status "$repo_root")" || return $?
  if [ -n "$status" ]; then
    if [ "$allow_dirty" -ne 1 ]; then
      echo "build-cache: working tree is not clean; commit changes or pass --allow-dirty" >&2
      printf '%s\n' "$status" | sed 's/^/  /' >&2
      return 2
    fi
    printf 'dirty\n'
    return 0
  fi

  printf 'clean\n'
  return 0
}

# Compute default candidate/publish image tag from HEAD short SHA, appending
# "-dirty" automatically when the working tree is dirty and --allow-dirty is set.
# Usage: build_cache_default_tag [repo_root] [--allow-dirty|1]
build_cache_default_tag() {
  local repo_root="${1:-$(_build_cache_default_repo_root)}"
  local allow_flag="${2:-0}"
  local state short_sha
  state="$(build_cache_check_worktree "$repo_root" "$allow_flag")" || return $?
  short_sha="$(git -C "$repo_root" rev-parse --short=12 HEAD)" || return 2
  if [ "$state" = "dirty" ]; then
    printf '%s-dirty\n' "$short_sha"
  else
    printf '%s\n' "$short_sha"
  fi
}

_build_cache_cli_main() {
  set -euo pipefail

  if [ $# -eq 0 ]; then
    sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    -h|--help)
      sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac

  local repo_root=""
  local base_tag=""
  local allow_dirty=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        shift
        [ $# -gt 0 ] || { echo "build-cache: --repo needs a value" >&2; exit 2; }
        repo_root="$1"
        ;;
      --base-tag)
        shift
        [ $# -gt 0 ] || { echo "build-cache: --base-tag needs a value" >&2; exit 2; }
        base_tag="$1"
        ;;
      --allow-dirty)
        allow_dirty=1
        ;;
      -h|--help)
        sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *)
        echo "build-cache: unknown argument: $1" >&2
        exit 2
        ;;
    esac
    shift
  done

  if [ -z "$repo_root" ]; then
    repo_root="$(_build_cache_default_repo_root)"
  fi

  case "$cmd" in
    base-tag)
      build_cache_base_tag "$repo_root"
      ;;
    deps-hash)
      build_cache_deps_hash "$repo_root" "$base_tag"
      ;;
    validate-inputs)
      build_cache_validate_inputs "$repo_root"
      ;;
    check-worktree)
      build_cache_check_worktree "$repo_root" "$allow_dirty"
      ;;
    default-tag)
      build_cache_default_tag "$repo_root" "$allow_dirty"
      ;;
    node-version)
      build_cache_node_version "$repo_root"
      ;;
    pnpm-version)
      build_cache_pnpm_version "$repo_root"
      ;;
    prisma-version)
      build_cache_prisma_version "$repo_root"
      ;;
    *)
      echo "build-cache: unknown command: $cmd" >&2
      exit 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _build_cache_cli_main "$@"
fi
