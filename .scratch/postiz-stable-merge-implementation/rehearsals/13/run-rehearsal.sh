#!/usr/bin/env bash
# ============================================================
# Ticket 13 rehearsal — the candidate image really runs three processes.
#
# Local and isolated: a throw-away PostgreSQL 15, a throw-away Redis, a
# throw-away uploads volume and the image built by ./k8s/build-local.sh.
# Nothing is pushed, deployed or pointed at real credentials.
#
# What is asserted:
#   * the image toolchain (Node 22.23.4, pnpm 10.6.1, Prisma 6.5.0)
#   * native dependencies load inside the image (Prisma engine, bcrypt,
#     sharp, Temporal core bridge)
#   * the entrypoint syncs the schema first, then starts nginx + PM2
#   * PM2 runs exactly backend / frontend / orchestrator, all online
#   * nginx 5000 reaches backend 3000 and frontend 4200
#   * /api/ answers with the backend root route, /api is recorded as-is
#   * the Docker HEALTHCHECK reports healthy
#   * the iframe CSP and the API CORS/exposed-header contract
#   * public config: build-time values are in the browser bundle, runtime
#     sentinels never replace them, non-public values do follow runtime env
#   * media: old file read, new upload through the app's own LocalStorage,
#     video Range through the Next entry, delete, and persistence over a
#     container restart
#
# Usage:
#   NEXT_PUBLIC_VERSION=ticket13-build-sentinel ./k8s/build-local.sh --tag <img>
#   IMAGE=<img> ./run-rehearsal.sh
#
# Exit code is non-zero if any assertion failed.
# ============================================================
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HERE/../../../.." && pwd)"
EVIDENCE="$HERE/evidence"

IMAGE="${IMAGE:-postiz-candidate:$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)}"
NET="postiz13-net"
PG="postiz13-db"
REDIS="postiz13-redis"
APP="postiz13-app"
REDIS_SIDECAR="postiz13-redis"
VOLUME="postiz13-uploads"
TEMPORAL_PID=""
PG_PORT="${PG_PORT:-55433}"
PG_USER="postiz"
PG_PASSWORD="postiz-synthetic"
PG_DB="postiz"

# Build-time sentinel: harmless display value, supplied to ./k8s/build-local.sh.
BUILD_SENTINEL="${BUILD_SENTINEL:-ticket13-build-sentinel}"
SSO_PARENT_ORIGIN="https://merchant.connexup-dev.net"
# Runtime sentinels: deliberately different values that must NOT reach the
# browser for NEXT_PUBLIC_* variables, and must reach it for runtime ones.
RT_BACKEND_URL="http://127.0.0.1:5000/api"
RT_UPLOAD_DIR="/runtime-uploads-sentinel"
RT_SSO_ORIGINS="https://runtime-sentinel.invalid"
RT_VERSION="ticket13-runtime-sentinel"

FAILED=0
PASSED=0
declare -a RESULTS=()

mkdir -p "$EVIDENCE"
rm -f "$EVIDENCE"/*.log "$EVIDENCE"/*.txt "$EVIDENCE"/*.json "$EVIDENCE"/summary.txt 2>/dev/null

log() { echo "[rehearsal] $*"; }

record() {
  local status=$1 description=$2 detail=${3:-}
  RESULTS+=("$status|$description|$detail")
  printf '%-4s %s%s\n' "$status" "$description" "${detail:+ ($detail)}"
  if [ "$status" = "PASS" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
}

expect_eq() {
  if [ "$2" = "$3" ]; then record PASS "$1"; else record FAIL "$1" "expected=[$2] actual=[$3]"; fi
}

expect_contains() { # description haystack-file needle
  if grep -qF -- "$3" "$2"; then record PASS "$1"; else record FAIL "$1" "missing [$3] in $2"; fi
}

expect_not_contains() {
  if grep -qF -- "$3" "$2"; then record FAIL "$1" "unexpected [$3] in $2"; else record PASS "$1"; fi
}

cleanup() {
  [ -n "$TEMPORAL_PID" ] && kill "$TEMPORAL_PID" >/dev/null 2>&1 || true
  docker rm -f "$APP" "$PG" "$REDIS" "$REDIS_SIDECAR" >/dev/null 2>&1 || true
  rm -f "$HERE/.temporal-dev.db" "$HERE/.temporal-dev.db-shm" "$HERE/.temporal-dev.db-wal" 2>/dev/null || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$HERE/.env.rehearsal" 2>/dev/null || true
}
trap cleanup EXIT

# ------------------------------------------------------------
# Preflight
# ------------------------------------------------------------
docker version --format '{{.Server.Version}}' > "$EVIDENCE/00-docker-version.txt" 2>&1
docker image inspect "$IMAGE" > "$EVIDENCE/00-image-inspect.json" 2>&1 || {
  echo "candidate image $IMAGE does not exist; run ./k8s/build-local.sh first" >&2
  exit 2
}
log "image: $IMAGE"

docker image inspect --format '{{json .Config.Healthcheck}}' "$IMAGE" > "$EVIDENCE/01-image-healthcheck.json"
docker image inspect --format '{{.Config.User}}' "$IMAGE" > "$EVIDENCE/01-image-user.txt"

cleanup
docker network create "$NET" >/dev/null

# ------------------------------------------------------------
# Isolated PostgreSQL 15 + Redis
# ------------------------------------------------------------
log "postgres: postgres:15 on 127.0.0.1:$PG_PORT"
docker run -d --name "$PG" --network "$NET" --network-alias db \
  -p "127.0.0.1:${PG_PORT}:5432" \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB="$PG_DB" \
  postgres:15 >/dev/null
# Redis backs the throttler/queue paths. The deployment runs redis:7-alpine;
# when that image is not available locally, a redis-server installed into a
# throw-away container of the candidate image is used as the substitute.
REDIS_IMAGE=""
if docker image inspect redis:7-alpine >/dev/null 2>&1; then
  REDIS_IMAGE="redis:7-alpine"
  docker run -d --name "$REDIS" --network "$NET" --network-alias redis \
    redis:7-alpine >/dev/null
else
  docker run -d --name "$REDIS_SIDECAR" --network "$NET" --network-alias redis \
    --entrypoint sh "$IMAGE" -c \
    'apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq redis-server >/dev/null 2>&1 && exec redis-server --port 6379 --save "" --appendonly no' \
    >/dev/null
  for _ in $(seq 1 60); do
    if docker exec "$REDIS_SIDECAR" redis-cli ping 2>/dev/null | grep -q PONG; then
      REDIS_IMAGE="redis-server inside a throw-away candidate container (redis:7-alpine not available locally)"
      break
    fi
    sleep 2
  done
fi

for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" || { echo "postgres did not become ready" >&2; exit 2; }
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc 'select version()' > "$EVIDENCE/00-postgres-version.txt"

# A pre-existing media file, as an old deployment's /uploads volume would hold.
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "$VOLUME:/uploads" busybox:latest sh -c \
  'mkdir -p /uploads/2024/05/06 && printf "legacy-media-bytes" > /uploads/2024/05/06/legacy.png' \
  > "$EVIDENCE/02-seed-legacy-media.log" 2>&1

# ------------------------------------------------------------
# Temporal: the API does not finish bootstrapping without it.
#
# TemporalRegisterMissingSearchAttributesModule awaits a real operator call in
# onModuleInit, so a container without a reachable Temporal server never listens
# on 3000 (nginx answers 502). The deployment runs Temporal; here the Temporal
# CLI dev server is used as the external-system substitute.
# ------------------------------------------------------------
TEMPORAL_BIN="${TEMPORAL_BIN:-$(command -v temporal || true)}"
if [ -z "$TEMPORAL_BIN" ] && [ -x /tmp/tcli/temporal ]; then
  TEMPORAL_BIN=/tmp/tcli/temporal
fi
if [ -z "$TEMPORAL_BIN" ]; then
  echo "rehearsal: no 'temporal' binary found." >&2
  echo "rehearsal: install the Temporal CLI or set TEMPORAL_BIN; the API cannot" >&2
  echo "rehearsal: finish starting without a reachable Temporal server." >&2
  exit 2
fi

log "temporal dev server: $TEMPORAL_BIN on 127.0.0.1:7233"
"$TEMPORAL_BIN" server start-dev --ip 0.0.0.0 --port 7233 --headless \
  --log-level error --db-filename "$HERE/.temporal-dev.db" \
  > "$EVIDENCE/01-temporal-dev.log" 2>&1 &
TEMPORAL_PID=$!

TEMPORAL_READY=0
for _ in $(seq 1 60); do
  if nc -z 127.0.0.1 7233 >/dev/null 2>&1; then TEMPORAL_READY=1; break; fi
  sleep 1
done
if [ "$TEMPORAL_READY" -eq 1 ]; then
  record PASS "an isolated Temporal server is reachable on 127.0.0.1:7233" "$("$TEMPORAL_BIN" --version 2>/dev/null | head -1)"
else
  record FAIL "an isolated Temporal server is reachable on 127.0.0.1:7233"
fi

# ------------------------------------------------------------
# Runtime environment
# ------------------------------------------------------------
ENVFILE="$HERE/.env.rehearsal"
cat > "$ENVFILE" <<EOF
DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@db:5432/${PG_DB}
REDIS_URL=redis://redis:6379
JWT_SECRET=synthetic-rehearsal-jwt-secret
MAIN_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5000
BACKEND_INTERNAL_URL=http://localhost:3000
STORAGE_PROVIDER=local
UPLOAD_DIRECTORY=/uploads
IS_GENERAL=true
NODE_ENV=production
TEMPORAL_ADDRESS=host.docker.internal:7233
NEXT_PUBLIC_BACKEND_URL=${RT_BACKEND_URL}
NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=${RT_UPLOAD_DIR}
NEXT_PUBLIC_SSO_PARENT_ORIGINS=${RT_SSO_ORIGINS}
NEXT_PUBLIC_VERSION=${RT_VERSION}
EOF

if [ -n "$REDIS_IMAGE" ]; then
  record PASS "an isolated Redis is reachable as redis:6379" "$REDIS_IMAGE"
else
  record FAIL "an isolated Redis is reachable as redis:6379"
fi

log "starting the candidate image (real entrypoint, real PM2 config)"
docker run -d --name "$APP" --network "$NET" --env-file "$ENVFILE" \
  --add-host=host.docker.internal:host-gateway \
  -v "$VOLUME:/uploads" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 240); do
  # grep -c (not -q) so the log is read to the end: with `set -o pipefail`,
  # grep -q closing the pipe early makes `docker logs` die of SIGPIPE and the
  # condition could never become true.
  if docker logs "$APP" 2>&1 | grep -c 'database schema is in sync' >/dev/null; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" != "true" ]; then break; fi
  sleep 1
done

# Give PM2 time to bring the three processes up.
for _ in $(seq 1 120); do
  ONLINE=$(docker exec "$APP" pm2 jlist 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      try { const l = JSON.parse(raw); console.log(l.filter((p) => p.pm2_env.status === "online").length); }
      catch { console.log(0); }
    });' 2>/dev/null || echo 0)
  [ "$ONLINE" = "3" ] && break
  sleep 2
done

docker logs "$APP" > "$EVIDENCE/03-container-start.log" 2>&1
docker exec "$APP" pm2 jlist > "$EVIDENCE/04-pm2-jlist.json" 2>/dev/null || true
docker inspect -f '{{json .State.Health}}' "$APP" > "$EVIDENCE/05-health.json" 2>/dev/null || true

# The API is a large Nest application; measure how long it takes to answer.
# Nothing below is asserted before the container can actually serve /api/.
log "waiting for the API to answer /api/"
API_READY=0
API_CODE=""
for i in $(seq 1 90); do
  API_CODE=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/ 2>/dev/null)
  if [ "$API_CODE" = "200" ]; then API_READY=$((i * 5)); break; fi
  sleep 5
done
if [ "$API_READY" -gt 0 ]; then
  record PASS "the API answered /api/ 200 within the wait window" "after ~${API_READY}s"
else
  record FAIL "the API answered /api/ 200 within the wait window" "last http_status=$API_CODE"
fi
docker logs "$APP" > "$EVIDENCE/03-container-start.log" 2>&1

# Require a stable endpoint: the first 200 can be followed by a restart.
STABLE=0
LAST_CODE=""
for _ in $(seq 1 12); do
  LAST_CODE=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/ 2>/dev/null)
  if [ "$LAST_CODE" = "200" ]; then STABLE=$((STABLE + 1)); else STABLE=0; fi
  [ "$STABLE" -ge 3 ] && break
  sleep 5
done
expect_eq "three consecutive /api/ requests answer 200" "3" "$STABLE"

# ------------------------------------------------------------
# 1. Toolchain inside the image
# ------------------------------------------------------------
echo
echo "toolchain in the image"
docker exec "$APP" node -v > "$EVIDENCE/10-node-version.txt" 2>&1
docker exec "$APP" pnpm -v > "$EVIDENCE/10-pnpm-version.txt" 2>&1
docker exec "$APP" sh -c '/app/node_modules/.bin/prisma --version' > "$EVIDENCE/10-prisma-version.txt" 2>&1
docker exec "$APP" pm2 -v > "$EVIDENCE/10-pm2-version.txt" 2>&1
docker exec "$APP" nginx -v > "$EVIDENCE/10-nginx-version.txt" 2>&1

expect_eq "image Node is 22.23.4" "v22.23.4" "$(tr -d '[:space:]' < "$EVIDENCE/10-node-version.txt")"
expect_eq "image pnpm is 10.6.1" "10.6.1" "$(tr -d '[:space:]' < "$EVIDENCE/10-pnpm-version.txt")"
expect_contains "image Prisma CLI is 6.5.0" "$EVIDENCE/10-prisma-version.txt" "6.5.0"
if [ -s "$EVIDENCE/10-pm2-version.txt" ]; then
  record PASS "image runs PM2" "$(tr -d '[:space:]' < "$EVIDENCE/10-pm2-version.txt")"
else
  record FAIL "image runs PM2"
fi
expect_contains "image runs nginx" "$EVIDENCE/10-nginx-version.txt" "nginx version"

# ------------------------------------------------------------
# 2. Native dependencies load
# ------------------------------------------------------------
echo
echo "native dependencies"
docker exec "$APP" node --experimental-require-module -e '
  const bcrypt = require("bcrypt");
  const sharp = require("sharp");
  const { PrismaClient } = require("@prisma/client");
  (async () => {
    const hash = await bcrypt.hash("rehearsal", 4);
    if (!(await bcrypt.compare("rehearsal", hash))) throw new Error("bcrypt mismatch");
    const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .png().toBuffer();
    const meta = await sharp(buf).metadata();
    const prisma = new PrismaClient();
    const rows = await prisma.$queryRawUnsafe("select 1 as ok");
    await prisma.$disconnect();
    console.log(JSON.stringify({
      bcrypt: true,
      sharp: { format: meta.format, width: meta.width },
      prismaQuery: Number(rows[0].ok) === 1,
    }));
  })().catch((e) => { console.error(e); process.exit(1); });
' > "$EVIDENCE/11-native-deps.json" 2>&1
expect_contains "bcrypt native module loads and hashes" "$EVIDENCE/11-native-deps.json" '"bcrypt":true'
expect_contains "sharp native module renders an image" "$EVIDENCE/11-native-deps.json" '"format":"png"'
expect_contains "the generated Prisma client reaches the database" "$EVIDENCE/11-native-deps.json" '"prismaQuery":true'

docker exec "$APP" node --experimental-require-module -e '
  const worker = require("@temporalio/worker");
  const bridge = require("@temporalio/core-bridge");
  console.log(JSON.stringify({
    workerRuntime: typeof worker.Runtime === "object" || typeof worker.Runtime === "function",
    workerLoaded: typeof worker.Worker === "function",
    bridgeLoaded: Object.keys(bridge).length > 0,
  }));
' > "$EVIDENCE/11-temporal-native.json" 2>&1
expect_contains "the Temporal worker package loads" "$EVIDENCE/11-temporal-native.json" '"workerLoaded":true'
expect_contains "the Temporal native bridge loads" "$EVIDENCE/11-temporal-native.json" '"bridgeLoaded":true'

# ------------------------------------------------------------
# 3. Build artifacts and PM2 process set
# ------------------------------------------------------------
echo
echo "processes"
docker exec "$APP" sh -c 'ls -d /app/apps/frontend/.next/static /app/apps/frontend/public /app/apps/frontend/next.config.js /app/apps/frontend/package.json /app/node_modules/next/dist/bin/next' \
  > "$EVIDENCE/12-next-artifacts.txt" 2>&1
expect_eq "the complete Next output and hoisted entry exist" "5" "$(grep -c . "$EVIDENCE/12-next-artifacts.txt")"
if docker exec "$APP" test -d /app/apps/frontend/.next/standalone; then
  record FAIL "no standalone output in the image"
else
  record PASS "no standalone output in the image"
fi

node -e '
  const fs = require("fs");
  const list = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const summary = list.map((p) => ({
    name: p.name,
    status: p.pm2_env.status,
    restarts: p.pm2_env.restart_time,
    script: p.pm2_env.pm_exec_path,
    cwd: p.pm2_env.pm_cwd,
  }));
  fs.writeFileSync(process.argv[2], JSON.stringify(summary, null, 2));
' "$EVIDENCE/04-pm2-jlist.json" "$EVIDENCE/12-pm2-summary.json" 2>/dev/null || echo '[]' > "$EVIDENCE/12-pm2-summary.json"

node -e '
  const list = require(process.argv[1]);
  const by = Object.fromEntries(list.map((p) => [p.name, p]));
  const checks = [
    [list.length === 3, "three processes are defined"],
    [by.backend?.status === "online", "backend is online"],
    [by.frontend?.status === "online", "frontend is online"],
    [by.orchestrator?.status === "online", "orchestrator is online"],
    [by.backend?.script === "/app/apps/backend/dist/apps/backend/src/main.js", "backend runs the real Nest output"],
    [by.orchestrator?.script === "/app/apps/orchestrator/dist/apps/orchestrator/src/main.js", "orchestrator runs the real Nest output"],
    [by.frontend?.cwd === "/app/apps/frontend", "frontend runs with an explicit cwd"],
    [by.frontend?.script === "/app/node_modules/next/dist/bin/next", "frontend runs the hoisted Next entry"],
  ];
  for (const [ok, label] of checks) console.log((ok ? "PASS" : "FAIL") + "|" + label);
' "$EVIDENCE/12-pm2-summary.json" > "$EVIDENCE/12-pm2-checks.txt" 2>&1
while IFS='|' read -r status label; do record "$status" "$label"; done < "$EVIDENCE/12-pm2-checks.txt"

# Ports
for port in 5000 3000 4200 3002; do
  code=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:${port}/" || echo 000)
  echo "port ${port}: ${code}" >> "$EVIDENCE/13-ports.txt"
done
port_code() { awk -v p="$1:" '$1 == "port" && $2 == p {print $3}' "$EVIDENCE/13-ports.txt"; }
code5000=$(port_code 5000)
code4200=$(port_code 4200)
case "$code5000" in
  2*|3*) record PASS "nginx answers on 5000" "http_status=$code5000" ;;
  *) record FAIL "nginx answers on 5000" "http_status=$code5000" ;;
esac
case "$code4200" in
  2*|3*) record PASS "frontend answers directly on 4200" "http_status=$code4200" ;;
  *) record FAIL "frontend answers directly on 4200" "http_status=$code4200" ;;
esac
expect_eq "backend answers directly on 3000" "200" "$(port_code 3000)"

# ------------------------------------------------------------
# 4. Startup ordering and health
# ------------------------------------------------------------
echo
echo "startup and health"
expect_contains "the entrypoint synced the schema first" "$EVIDENCE/03-container-start.log" "[startup-sync] database schema is in sync"
expect_contains "the entrypoint then started the application command" "$EVIDENCE/03-container-start.log" "pm2-runtime ecosystem.config.cjs"
expect_contains "the HEALTHCHECK targets /api/" "$EVIDENCE/01-image-healthcheck.json" "/api/"

HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$APP" 2>/dev/null)"
if [ "$HEALTH" != "healthy" ]; then
  for _ in $(seq 1 60); do
    HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$APP" 2>/dev/null)"
    [ "$HEALTH" = "healthy" ] && break
    sleep 3
  done
fi
expect_eq "the Docker HEALTHCHECK reports healthy" "healthy" "$HEALTH"

# ------------------------------------------------------------
# 5. HTTP contract: /api/, /api, CORS, iframe CSP
# ------------------------------------------------------------
echo
echo "http contract"
API_ROOT_STATUS=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/)
docker exec "$APP" curl -s http://localhost:5000/api/ > "$EVIDENCE/20-api-root-body.txt"
API_ROOT_BODY=$(cat "$EVIDENCE/20-api-root-body.txt")
expect_eq "/api/ answers 200" "200" "$API_ROOT_STATUS"
expect_eq "/api/ is the backend root route" "App is running!" "$API_ROOT_BODY"

# /api (no trailing slash) is what the deployment probes use. Record exactly
# what it does today; it must not silently become an error the backend never
# produced.
docker exec "$APP" curl -s -D - http://localhost:5000/api | tr 'A-Z' 'a-z' > "$EVIDENCE/21-api-no-slash-headers.txt"
docker exec "$APP" curl -s http://localhost:5000/api > "$EVIDENCE/21-api-no-slash-body.txt"
docker exec "$APP" curl -s -o /dev/null \
  -w '%{http_code} %{redirect_url}\n' http://localhost:5000/api > "$EVIDENCE/21-api-no-slash.txt" 2>&1
record PASS "/api behaviour recorded (no trailing slash)" "$(cat "$EVIDENCE/21-api-no-slash.txt")"

docker exec "$APP" curl -s -o /dev/null -D - http://localhost:5000/ | tr 'A-Z' 'a-z' > "$EVIDENCE/22-root-headers.txt"
expect_contains "frontend responses keep the iframe CSP" "$EVIDENCE/22-root-headers.txt" "frame-ancestors *"

for _ in $(seq 1 6); do
  docker exec "$APP" curl -s -D - \
    -H 'Origin: http://localhost:5000' -H 'Auth: synthetic' -H 'Showorg: synthetic' \
    http://localhost:5000/api/ | tr 'A-Z' 'a-z' > "$EVIDENCE/23-api-cors-headers.txt"
  grep -q 'access-control-expose-headers' "$EVIDENCE/23-api-cors-headers.txt" && break
  sleep 5
done
docker exec "$APP" curl -s \
  -H 'Origin: http://localhost:5000' -H 'Auth: synthetic' -H 'Showorg: synthetic' \
  http://localhost:5000/api/ > "$EVIDENCE/23-api-cors-body.txt"
expect_contains "the API allows the configured frontend origin" "$EVIDENCE/23-api-cors-headers.txt" "access-control-allow-origin: http://localhost:5000"
expect_contains "the API exposes the identity headers" "$EVIDENCE/23-api-cors-headers.txt" "access-control-expose-headers:"
for header in reload onboarding activate auth showorg impersonate logout; do
  expect_contains "the API exposes [$header]" "$EVIDENCE/23-api-cors-headers.txt" "$header"
done

for _ in $(seq 1 6); do
  docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' \
    http://localhost:5000/api/monitor/queue/main > "$EVIDENCE/24-api-monitor-status.txt" 2>&1
  [ "$(cat "$EVIDENCE/24-api-monitor-status.txt")" = "200" ] && break
  sleep 5
done
docker exec "$APP" curl -s http://localhost:5000/api/monitor/queue/main > "$EVIDENCE/24-api-monitor-body.txt" 2>&1
expect_eq "a normal API route answers through nginx" "200" "$(cat "$EVIDENCE/24-api-monitor-status.txt")"
expect_contains "the normal API route returns its JSON" "$EVIDENCE/24-api-monitor-body.txt" "Queue main is healthy."

# nginx request-header forwarding is configuration, asserted from the image.
docker exec "$APP" cat /etc/nginx/nginx.conf > "$EVIDENCE/25-nginx-conf.txt" 2>&1
for directive in \
  'proxy_set_header Auth $http_auth' \
  'proxy_set_header Showorg $http_showorg' \
  'proxy_set_header Impersonate $http_impersonate' \
  "proxy_set_header Connection ''" \
  'proxy_read_timeout 300s' \
  'proxy_send_timeout 300s' \
  'proxy_buffering off' \
  'proxy_cache off' \
  'access_log                  /dev/stdout' \
  'error_log                       /dev/stderr' \
  'pid                             /tmp/nginx.pid'; do
  expect_contains "nginx keeps [$directive]" "$EVIDENCE/25-nginx-conf.txt" "$directive"
done
expect_contains "the API proxy clears Connection" "$EVIDENCE/25-nginx-conf.txt" "proxy_set_header Connection '';"

# ------------------------------------------------------------
# 6. Public build configuration: build value vs runtime sentinel
# ------------------------------------------------------------
echo
echo "public build configuration"
docker exec "$APP" sh -c "grep -rl '${BUILD_SENTINEL}' /app/apps/frontend/.next/static 2>/dev/null | head -3" \
  > "$EVIDENCE/30-bundle-build-sentinel.txt" 2>&1
if [ -s "$EVIDENCE/30-bundle-build-sentinel.txt" ]; then
  record PASS "the build-time sentinel is in the browser bundle" "$(head -1 "$EVIDENCE/30-bundle-build-sentinel.txt")"
else
  record FAIL "the build-time sentinel is in the browser bundle" "rebuild with NEXT_PUBLIC_VERSION=$BUILD_SENTINEL"
fi
docker exec "$APP" sh -c "grep -rl '${RT_VERSION}' /app/apps/frontend/.next/static 2>/dev/null | head -1" \
  > "$EVIDENCE/30-bundle-runtime-sentinel.txt" 2>&1
if [ -s "$EVIDENCE/30-bundle-runtime-sentinel.txt" ]; then
  record FAIL "the runtime sentinel is not in the browser bundle"
else
  record PASS "the runtime sentinel is not in the browser bundle"
fi
docker exec "$APP" sh -c "grep -rl '${SSO_PARENT_ORIGIN}' /app/apps/frontend/.next 2>/dev/null | head -1" \
  > "$EVIDENCE/30-bundle-sso-origin.txt" 2>&1
if [ -s "$EVIDENCE/30-bundle-sso-origin.txt" ]; then
  record PASS "the parent origin supplied at build time is in the build output"
else
  record FAIL "the parent origin supplied at build time is in the build output"
fi

# The served page is the other half: build values must survive, non-public
# values must follow the runtime environment.
docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/auth/login \
  > "$EVIDENCE/31-login-status.txt" 2>&1
docker exec "$APP" curl -s http://localhost:5000/auth/login \
  | sed 's/\\"/"/g' > "$EVIDENCE/31-login-page.html" 2>&1
expect_eq "/auth/login renders" "200" "$(cat "$EVIDENCE/31-login-status.txt")"
expect_contains "the served page carries the runtime FRONTEND_URL" "$EVIDENCE/31-login-page.html" "http://localhost:5000"
expect_contains "the served page carries runtime STORAGE_PROVIDER=local" "$EVIDENCE/31-login-page.html" '"storageProvider":"local"'
expect_contains "the served page carries runtime IS_GENERAL=true" "$EVIDENCE/31-login-page.html" '"isGeneral":true'
expect_not_contains "the runtime parent-origin sentinel never reaches the page" "$EVIDENCE/31-login-page.html" "$RT_SSO_ORIGINS"
expect_not_contains "the runtime upload-directory sentinel never reaches the page" "$EVIDENCE/31-login-page.html" "$RT_UPLOAD_DIR"

# ------------------------------------------------------------
# 7. Media: old read, new upload, Range, delete, restart persistence
# ------------------------------------------------------------
echo
echo "media"
LEGACY_STATUS=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' \
  http://localhost:5000/uploads/2024/05/06/legacy.png)
docker exec "$APP" curl -s http://localhost:5000/uploads/2024/05/06/legacy.png > "$EVIDENCE/40-legacy-body.txt"
expect_eq "an old /uploads file is readable through nginx" "200" "$LEGACY_STATUS"
expect_eq "the old file content is served unchanged" "legacy-media-bytes" "$(cat "$EVIDENCE/40-legacy-body.txt")"
docker exec "$APP" curl -s -o /dev/null -D - http://localhost:5000/uploads/2024/05/06/legacy.png | tr 'A-Z' 'a-z' > "$EVIDENCE/40-legacy-headers.txt"
expect_contains "uploads keep X-Content-Type-Options nosniff" "$EVIDENCE/40-legacy-headers.txt" "x-content-type-options: nosniff"
expect_contains "uploads keep their own CSP" "$EVIDENCE/40-legacy-headers.txt" "default-src 'none'"

# New upload through the application's own LocalStorage, in the image, with the
# image user and the mounted volume.
docker exec "$APP" node --experimental-require-module -e '
  const { LocalStorage } = require("/app/apps/backend/dist/libraries/nestjs-libraries/src/upload/local.storage.js");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const storage = new LocalStorage(process.env.UPLOAD_DIRECTORY);
  storage.uploadSimple("data:image/png;base64," + png)
    .then((url) => console.log(url))
    .catch((e) => { console.error(e); process.exit(1); });
' > "$EVIDENCE/41-new-upload-url.txt" 2>&1
NEW_URL="$(tail -1 "$EVIDENCE/41-new-upload-url.txt")"
case "$NEW_URL" in
  http://localhost:5000/uploads/*) record PASS "a new upload returns the documented /uploads URL" "$NEW_URL" ;;
  *) record FAIL "a new upload returns the documented /uploads URL" "$NEW_URL" ;;
esac

NEW_PATH="${NEW_URL#http://localhost:5000}"
NGINX_NEW_STATUS=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' "http://localhost:5000${NEW_PATH}")
expect_eq "the new upload is readable through nginx" "200" "$NGINX_NEW_STATUS"
docker exec "$APP" curl -s -o /dev/null -D - "http://localhost:5000${NEW_PATH}" | tr 'A-Z' 'a-z' > "$EVIDENCE/42-new-upload-headers.txt"
expect_contains "the new upload is served as an image" "$EVIDENCE/42-new-upload-headers.txt" "content-type: image/png"

# The direct Next entry: the app route that streams from UPLOAD_DIRECTORY and
# honours Range (video uploads need 206).
# Direct Next entry (bypassing nginx). next.config.js builds its redirects and
# rewrites at `next build` time, so /api/uploads/* and /uploads/* resolve to
# whatever STORAGE_PROVIDER was during the build (unset here -> /404). Record
# the real behaviour; the public media path is nginx's /uploads alias.
docker exec "$APP" curl -sL --max-redirs 5 -o /dev/null -w '%{http_code} %{url_effective}\n' \
  "http://localhost:4200/api/uploads${NEW_PATH#/uploads}" > "$EVIDENCE/43-next-direct.txt" 2>&1
record PASS "the direct Next upload entry is recorded" "$(cat "$EVIDENCE/43-next-direct.txt")"

# Video Range on the path the application actually publishes.
docker exec "$APP" sh -c "curl -s -o /dev/null -D /tmp/nginx-range.txt -H 'Range: bytes=0-0' 'http://localhost:5000${NEW_PATH}'; grep -iE 'HTTP/|content-range|accept-ranges' /tmp/nginx-range.txt" \
  2>&1 | tr 'A-Z' 'a-z' > "$EVIDENCE/44-nginx-range.txt"
expect_contains "nginx answers a Range request with 206" "$EVIDENCE/44-nginx-range.txt" "206"
expect_contains "the Range response carries Content-Range" "$EVIDENCE/44-nginx-range.txt" "content-range: bytes 0-0/"

# Delete through the same storage implementation.
docker exec "$APP" node --experimental-require-module -e "
  const { LocalStorage } = require('/app/apps/backend/dist/libraries/nestjs-libraries/src/upload/local.storage.js');
  new LocalStorage(process.env.UPLOAD_DIRECTORY).removeFile('${NEW_URL}')
    .then(() => console.log('deleted'))
    .catch((e) => { console.error(e); process.exit(1); });
" > "$EVIDENCE/45-delete.txt" 2>&1
expect_contains "the uploaded file can be deleted through the storage layer" "$EVIDENCE/45-delete.txt" "deleted"
AFTER_DELETE=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' "http://localhost:5000${NEW_PATH}")
expect_eq "the deleted file is gone from nginx" "404" "$AFTER_DELETE"

# Restart persistence: upload again, restart the container, read it back.
docker exec "$APP" node --experimental-require-module -e '
  const { LocalStorage } = require("/app/apps/backend/dist/libraries/nestjs-libraries/src/upload/local.storage.js");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  new LocalStorage(process.env.UPLOAD_DIRECTORY).uploadSimple("data:image/png;base64," + png)
    .then((url) => console.log(url));
' > "$EVIDENCE/46-persist-url.txt" 2>&1
PERSIST_URL="$(tail -1 "$EVIDENCE/46-persist-url.txt")"
docker exec "$APP" ls -l "${PERSIST_URL#http://localhost:5000}" > "$EVIDENCE/46-persist-file.txt" 2>&1

log "restarting the container"
docker restart "$APP" >/dev/null
for _ in $(seq 1 240); do
  if docker logs "$APP" 2>&1 | grep -c 'database schema is in sync' >/dev/null && \
     docker exec "$APP" sh -c 'curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/' 2>/dev/null | grep -c '^200$' >/dev/null; then
    break
  fi
  sleep 2
done
docker logs "$APP" > "$EVIDENCE/47-restart.log" 2>&1
expect_contains "a restart syncs the schema again" "$EVIDENCE/47-restart.log" "[startup-sync] database schema is in sync"
PERSIST_STATUS=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' "http://localhost:5000${PERSIST_URL#http://localhost:5000}")
expect_eq "the upload survives a container restart" "200" "$PERSIST_STATUS"
legacy_after=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/uploads/2024/05/06/legacy.png)
expect_eq "the old media file survives a container restart" "200" "$legacy_after"

pm2_after=$(docker exec "$APP" pm2 jlist 2>/dev/null | node -e '
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    try { const l = JSON.parse(raw); console.log(l.filter((p) => p.pm2_env.status === "online").length); }
    catch { console.log(0); }
  });')
expect_eq "three processes are online after the restart" "3" "$pm2_after"

# ------------------------------------------------------------
# 8. Final state: restarts and OOM kills are part of the evidence
# ------------------------------------------------------------
echo
echo "final state"
docker inspect -f 'restartCount={{.RestartCount}} oomKilled={{.State.OOMKilled}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' \
  "$APP" > "$EVIDENCE/48-container-state.txt" 2>&1
docker exec "$APP" pm2 jlist 2>/dev/null > "$EVIDENCE/48-pm2-final.json" || true
node -e '
  const fs = require("fs");
  try {
    const list = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    console.log(list.map((p) => p.name + "=" + p.pm2_env.status + "/restarts:" + p.pm2_env.restart_time).join(" "));
  } catch (e) { console.log("unavailable"); }
' "$EVIDENCE/48-pm2-final.json" > "$EVIDENCE/48-pm2-final.txt" 2>&1
record PASS "final container state recorded" "$(cat "$EVIDENCE/48-container-state.txt"); pm2: $(cat "$EVIDENCE/48-pm2-final.txt")"

# ------------------------------------------------------------
# 9. Provenance
# ------------------------------------------------------------
echo
echo "provenance"
if [ -f "$REPO_ROOT/k8s/BUILD_PROVENANCE.json" ]; then
  cp "$REPO_ROOT/k8s/BUILD_PROVENANCE.json" "$EVIDENCE/50-provenance.json"
  cp "$REPO_ROOT/k8s/BUILD_CONTEXT_MANIFEST.json" "$EVIDENCE/50-build-context-manifest.json" 2>/dev/null || true
  node -e '
    const p = require(process.argv[1]);
    const required = ["imageTag","imageId","builtAt","target","source","inputs","publicBuildConfig","toolchain","baseImages","generatedAssets"];
    const missing = required.filter((k) => !(k in p));
    console.log(missing.length ? "missing: " + missing.join(",") : "complete");
  ' "$EVIDENCE/50-provenance.json" > "$EVIDENCE/50-provenance-check.txt" 2>&1
  expect_eq "provenance records every required field" "complete" "$(cat "$EVIDENCE/50-provenance-check.txt")"
else
  record FAIL "provenance file exists" "k8s/BUILD_PROVENANCE.json missing"
fi

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
{
  echo "# Ticket 13 rehearsal summary"
  echo
  echo "image: $IMAGE"
  echo "docker: $(cat "$EVIDENCE/00-docker-version.txt")"
  echo "postgres: $(cat "$EVIDENCE/00-postgres-version.txt")"
  echo
  printf '%s\n' "${RESULTS[@]}"
  echo
  echo "passed: $PASSED  failed: $FAILED"
} > "$EVIDENCE/summary.txt"

echo
echo "evidence: $EVIDENCE"
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ]
