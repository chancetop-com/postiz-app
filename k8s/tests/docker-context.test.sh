#!/usr/bin/env bash
# Exercise Docker's own context filtering with a synthetic workspace.
set -euo pipefail

repo="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
context="$work/context"
mkdir -p "$context/k8s"
cp "$repo/.dockerignore" "$repo/Dockerfile.dev.dockerignore" "$context/"

# Columns are the expected inclusion in the release and development images.
cat > "$work/cases" <<'CASES'
yes yes package.json
yes yes pnpm-lock.yaml
yes yes apps/frontend/public/favicon.ico
yes yes apps/frontend/src/app/(app)/api/uploads/route.ts
yes yes var/docker/entrypoint.sh
yes yes libraries/nestjs-libraries/src/database/prisma/schema.prisma
yes yes apps/commands/package.json
yes yes apps/sdk/package.json
yes yes apps/extension/package.json
yes yes k8s/build-app.yaml
yes yes k8s/Dockerfile.base
yes yes k8s/Dockerfile.deps
yes yes k8s/Dockerfile.runtime-deps
no  yes apps/commands/src/main.ts
no  yes apps/sdk/src/main.ts
no  yes apps/extension/src/index.ts
no  yes k8s/tests/runtime-contract.test.sh
no  yes .scratch/postiz-stable-merge-implementation/rehearsals/14/run.mjs
no  yes k8s/build-local.sh
no  yes tests/startup-sync.test.ts
no  yes docs/diagram.png
no  yes .env.example
no  no  .scratch/unrelated/report.json
no  no  .git/HEAD
no  no  .env
no  no  .env.production
no  no  apps/backend/tsconfig.tsbuildinfo
no  no  .pnpm-store/v10/index
no  no  apps/frontend/.env.local
no  no  apps/frontend/certificates/local.pem
no  no  .apple/AuthKey_test.p8
no  no  .secrets/api-key.txt
no  no  uploads/sample.png
no  no  node_modules/pkg/index.js
no  no  apps/backend/node_modules/pkg/index.js
no  no  apps/backend/dist/main.js
no  no  apps/frontend/.next/BUILD_ID
no  no  apps/frontend/public/g.js
no  no  k8s/BUILD_PROVENANCE.json
CASES

while read -r release dev file; do
  mkdir -p "$context/$(dirname -- "$file")"
  touch "$context/$file"
done < "$work/cases"

for dockerfile in k8s/Dockerfile Dockerfile.dev; do
  printf 'FROM scratch\nCOPY . /\n' > "$context/$dockerfile"
done

for dockerfile in k8s/Dockerfile Dockerfile.dev; do
  output="$work/$(basename -- "$dockerfile")-output"
  docker build --network=none --file "$context/$dockerfile" \
    --output "type=local,dest=$output" "$context"
  while read -r release dev file; do
    expected="$release"
    if [[ "$dockerfile" == Dockerfile.dev ]]; then expected="$dev"; fi
    actual=no
    if [[ -f "$output/$file" ]]; then actual=yes; fi
    if [[ "$actual" != "$expected" ]]; then
      echo "$dockerfile included $file: expected $expected, got $actual" >&2
      exit 1
    fi
  done < "$work/cases"
  echo "$dockerfile context passed"
done
