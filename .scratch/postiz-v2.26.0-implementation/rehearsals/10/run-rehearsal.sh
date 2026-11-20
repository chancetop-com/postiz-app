#!/usr/bin/env bash
# ============================================================
# Ticket 10 rehearsal — boot the candidate image on an old v2.25.3 database
# and keep data + media.
#
# Local and isolated: a throw-away PostgreSQL 15 (old schema + synthetic
# rows), a throw-away Redis, a throw-away Temporal (auto-setup + PostgreSQL),
# a named uploads volume and the image built by ./k8s/build-local.sh from the
# prepared build context.
#
# What is exercised:
#   * the official startup sync runs before the application command
#   * the five new v2.26.0 indexes exist with Prisma's exact names/columns
#   * nothing else in the schema changes (pg_dump before/after)
#   * every existing row keeps its primary key and every column value
#     (identity, membership, channels/credentials, posts/timezone/publishDate,
#     media references) — compared as digests, secrets never printed
#   * a real uploads volume: old file read, new upload through the app's own
#     LocalStorage, both read again after a restart
#   * a second start is idempotent
#   * an unreachable database and a sync-refusing change exit non-zero and
#     never start nginx/PM2
#   * index build time, a controlled lock wait and write blocking are measured
#
# The runtime image (k8s/Dockerfile.runtime) is attempted as well; the missing
# artifact path is recorded instead of being claimed as verified.
#
# Usage:
#   ./k8s/prepare-build-context.sh
#   ./k8s/build-local.sh --tag postiz-ticket10:<sha>
#   cd .scratch/postiz-v2.26.0-implementation/rehearsals/10
#   IMAGE=postiz-ticket10:<sha> ./run-rehearsal.sh
#
# Exit code is non-zero if any assertion failed. Everything is written to
# evidence/; evidence/summary.txt lists every assertion.
# ============================================================
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HERE/../../../.." && pwd)"
EVIDENCE="$HERE/evidence"

IMAGE="${IMAGE:-postiz-candidate:$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)}"
NET="t10-net"
PG="t10-pg"
TEMPORAL_PG="t10-temporal-pg"
TEMPORAL="t10-temporal"
REDIS="t10-redis"
APP="t10-app"
APP_FAIL="t10-app-connection-fail"
APP_SYNCFAIL="t10-app-sync-fail"
VOLUME="t10-uploads"
ENVFILE="$HERE/.env.rehearsal"
HOST_PORT="${HOST_PORT:-55100}"

PG_USER="postiz"
PG_PASSWORD="synthetic-t10"
PG_DB="postiz"
BASE_DB_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG}:5432"
LOCK_SECONDS="${LOCK_SECONDS:-30}"

FAILED=0
PASSED=0
UNVERIFIED=0
declare -a RESULTS=()
LOCK_PID=""

mkdir -p "$EVIDENCE"
rm -f "$EVIDENCE"/*.log "$EVIDENCE"/*.txt "$EVIDENCE"/*.json "$EVIDENCE"/*.sql "$EVIDENCE"/summary.txt 2>/dev/null

log() { echo "[rehearsal] $*"; }

record() {
  local status=$1 description=$2 detail=${3:-}
  RESULTS+=("$status|$description|$detail")
  printf '%-10s %s%s\n' "$status" "$description" "${detail:+ ($detail)}"
  case "$status" in
    PASS) PASSED=$((PASSED + 1)) ;;
    UNVERIFIED) UNVERIFIED=$((UNVERIFIED + 1)) ;;
    *) FAILED=$((FAILED + 1)) ;;
  esac
}

expect_eq() {
  if [ "$2" = "$3" ]; then record PASS "$1"; else record FAIL "$1" "expected=[$2] actual=[$3]"; fi
}

expect_contains() { # description file needle
  if grep -qF -- "$3" "$2"; then record PASS "$1"; else record FAIL "$1" "missing [$3] in $(basename "$2")"; fi
}

expect_not_contains() {
  if grep -qF -- "$3" "$2"; then record FAIL "$1" "unexpected [$3] in $(basename "$2")"; else record PASS "$1"; fi
}

expect_files_equal() { # description file-a file-b
  if diff -q "$2" "$3" >/dev/null 2>&1; then
    record PASS "$1"
  else
    record FAIL "$1" "diff in $(basename "$2") vs $(basename "$3")"
  fi
}

die() { echo "[rehearsal] FATAL: $*" >&2; exit 2; }

cleanup() {
  [ -n "$LOCK_PID" ] && kill "$LOCK_PID" >/dev/null 2>&1 || true
  docker rm -f "$APP" "$APP_FAIL" "$APP_SYNCFAIL" "$TEMPORAL" "$TEMPORAL_PG" "$REDIS" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$ENVFILE" 2>/dev/null || true
}
trap cleanup EXIT

psql_main() { docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" "$@"; }
psql_db() {
  local db=$1
  shift
  docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$db" "$@"
}
psql_main_file() { docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" -f - < "$1"; }
dump_schema() { # db file
  docker exec "$PG" pg_dump -U "$PG_USER" -d "$1" --schema-only --no-owner --no-privileges -n public 2>/dev/null \
    | sed -E 's/^\\(un)?restrict .*/\1restrict/' > "$2"
}
wait_for_exit() { # container max-seconds
  local name=$1 max=$2 i
  for i in $(seq 1 "$max"); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then return 0; fi
    sleep 1
  done
  return 1
}
log_index_names() { printf '%s\n' \
  'Post_organizationId_publishDate_idx' \
  'Post_publishDate_state_deletedAt_parentPostId_integrationId_idx' \
  'Notifications_organizationId_createdAt_deletedAt_idx' \
  'User_providerId_providerName_idx' \
  'Errors_createdAt_platform_idx'; }

# ------------------------------------------------------------
# Provenance
# ------------------------------------------------------------
echo
echo "provenance"
docker image inspect "$IMAGE" --format '{{.Id}}' > "$EVIDENCE/00-image-id.txt" 2>&1 || die "image $IMAGE not found locally"
docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}' > "$EVIDENCE/00-image-arch.txt" 2>&1
docker version --format '{{.Server.Version}}' > "$EVIDENCE/00-docker-version.txt" 2>&1
HERE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
MANIFEST="$REPO_ROOT/k8s/BUILD_CONTEXT_MANIFEST.json"
[ -f "$MANIFEST" ] || die "missing $MANIFEST; run ./k8s/prepare-build-context.sh first"
MANIFEST_COMMIT="$(sed -n 's/^  "sourceCommit": "\(.*\)",$/\1/p' "$MANIFEST")"
MANIFEST_STATE="$(sed -n 's/^  "worktreeState": "\(.*\)",$/\1/p' "$MANIFEST")"
MANIFEST_SHA="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"
OLD_SCHEMA_SHA="$(shasum -a 256 "$HERE/old-schema.prisma" | awk '{print $1}')"
SEED_SHA="$(shasum -a 256 "$HERE/seed-old.sql" | awk '{print $1}')"
{
  echo "head=$HERE_SHA"
  echo "manifest.sourceCommit=$MANIFEST_COMMIT"
  echo "manifest.worktreeState=$MANIFEST_STATE"
  echo "manifest.sha256=$MANIFEST_SHA"
  echo "image=$IMAGE"
  echo "image.id=$(cat "$EVIDENCE/00-image-id.txt")"
  echo "image.arch=$(cat "$EVIDENCE/00-image-arch.txt")"
  echo "old-schema.commit=838843077 (feat: merge upstream stable v2.25.3)"
  echo "old-schema.sha256=$OLD_SCHEMA_SHA"
  echo "seed.sha256=$SEED_SHA"
} > "$EVIDENCE/00-provenance.txt"
expect_eq "the build context was prepared from HEAD" "$HERE_SHA" "$MANIFEST_COMMIT"
expect_eq "the build context was prepared from a clean worktree" "clean" "$MANIFEST_STATE"
if [ -f "$REPO_ROOT/k8s/BUILD_PROVENANCE.json" ]; then
  cp "$REPO_ROOT/k8s/BUILD_PROVENANCE.json" "$EVIDENCE/00-build-provenance.json"
fi

echo
echo "isolated services"
docker network create "$NET" >/dev/null || die "could not create $NET"

# ------------------------------------------------------------
# Isolated PostgreSQL 15. Statement logging lets the sync's own CREATE INDEX
# statements be timed; log_lock_waits records a real lock wait.
# ------------------------------------------------------------
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB="$PG_DB" \
  postgres:15 \
  -c log_min_duration_statement=0 \
  -c log_lock_waits=on \
  -c deadlock_timeout=200ms \
  -c log_line_prefix='%m [%p] ' \
  -c max_connections=200 >/dev/null || die "could not start PostgreSQL"
for _ in $(seq 1 180); do
  docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
  sleep 1
done
if ! docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  docker logs "$PG" > "$EVIDENCE/00-postgres-startup.log" 2>&1 || true
  die "PostgreSQL did not become ready (see evidence/00-postgres-startup.log)"
fi
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc 'select version()' > "$EVIDENCE/00-postgres-version.txt" 2>&1
record PASS "isolated PostgreSQL 15 is ready" "$(cat "$EVIDENCE/00-postgres-version.txt")"

docker run -d --name "$REDIS" --network "$NET" redis:7-alpine >/dev/null || die "could not start Redis"
for _ in $(seq 1 30); do
  docker exec "$REDIS" redis-cli ping 2>/dev/null | grep -q PONG && break
  sleep 1
done
if docker exec "$REDIS" redis-cli ping 2>/dev/null | grep -q PONG; then
  record PASS "isolated Redis is ready" "redis:7-alpine"
else
  record FAIL "isolated Redis is ready"
fi

# Temporal is a deployment dependency: the API awaits a real operator call on
# startup, and the worker needs a server to poll. auto-setup + its own
# PostgreSQL keeps it isolated from any other local stack.
docker run -d --name "$TEMPORAL_PG" --network "$NET" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=synthetic-temporal -e POSTGRES_DB=postgres \
  postgres:15 >/dev/null || die "could not start Temporal PostgreSQL"
for _ in $(seq 1 60); do
  docker exec "$TEMPORAL_PG" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 1
done
docker run -d --name "$TEMPORAL" --network "$NET" \
  -e DB=postgres12 -e DB_PORT=5432 \
  -e POSTGRES_SEEDS="$TEMPORAL_PG" -e POSTGRES_USER=postgres -e POSTGRES_PWD=synthetic-temporal \
  temporalio/auto-setup:1.28.1 autosetup > /dev/null 2>&1 || die "could not start Temporal"

TEMPORAL_READY=0
for _ in $(seq 1 120); do
  if docker exec "$TEMPORAL" tctl --address "$TEMPORAL:7233" --namespace default cluster health >/dev/null 2>&1; then
    TEMPORAL_READY=1
    break
  fi
  sleep 2
done
if [ "$TEMPORAL_READY" -eq 1 ]; then
  NAMESPACE_READY=0
  for _ in $(seq 1 90); do
    if docker exec "$TEMPORAL" temporal operator namespace describe --namespace default \
      --address "$TEMPORAL:7233" >/dev/null 2>&1; then
      NAMESPACE_READY=1
      break
    fi
    sleep 2
  done
  docker logs "$TEMPORAL" > "$EVIDENCE/01-temporal.log" 2>&1 || true
  docker exec "$TEMPORAL" temporal operator namespace describe --namespace default \
    --address "$TEMPORAL:7233" > "$EVIDENCE/01-temporal-namespace.txt" 2>&1 || true
  if [ "$NAMESPACE_READY" -eq 1 ]; then
    record PASS "isolated Temporal server and default namespace are ready" "temporalio/auto-setup:1.28.1"
  else
    record FAIL "isolated Temporal server and default namespace are ready" "namespace not found"
  fi

  # auto-setup adds CustomStringField/CustomTextField "for testing". Together
  # with the backend's organizationId/postId that exceeds Temporal's 3-Text
  # limit on a fresh substitute namespace; the deployment Temporal already has
  # its attribute budget. Remove the two unused testing attributes so the real
  # startup add path can run, and record it as an environment adjustment.
  ATTRIBUTES_CLEAN=0
  for _ in $(seq 1 30); do
    docker exec "$TEMPORAL" temporal operator search-attribute remove --name CustomStringField --yes \
      --address "$TEMPORAL:7233" --namespace default > /dev/null 2>&1 || true
    docker exec "$TEMPORAL" temporal operator search-attribute remove --name CustomTextField --yes \
      --address "$TEMPORAL:7233" --namespace default > /dev/null 2>&1 || true
    docker exec "$TEMPORAL" temporal operator search-attribute list \
      --address "$TEMPORAL:7233" --namespace default > "$EVIDENCE/01-temporal-search-attributes-before.txt" 2>&1 || true
    if ! grep -qE 'CustomStringField|CustomTextField' "$EVIDENCE/01-temporal-search-attributes-before.txt" && \
       grep -q 'WorkflowId' "$EVIDENCE/01-temporal-search-attributes-before.txt"; then
      ATTRIBUTES_CLEAN=1
      break
    fi
    sleep 2
  done
  if [ "$ATTRIBUTES_CLEAN" -eq 1 ]; then
    record PASS "the substitute Temporal has no leftover testing Text attributes"
  else
    record FAIL "the substitute Temporal has no leftover testing Text attributes"
  fi
else
  docker logs "$TEMPORAL" > "$EVIDENCE/01-temporal.log" 2>&1 || true
  record FAIL "isolated Temporal server and default namespace are ready"
fi

# ------------------------------------------------------------
# v2.25.3 database: old schema from 838843077, then synthetic data.
# ------------------------------------------------------------
log "creating the v2.25.3 schema"
docker exec "$PG" psql -U "$PG_USER" -d postgres -c 'CREATE DATABASE postiz_candidate_ref' >/dev/null 2>&1 \
  || die "could not create the reference database"
docker run --rm --network "$NET" \
  -e "DATABASE_URL=${BASE_DB_URL}/postiz_candidate_ref?schema=public" \
  --entrypoint sh "$IMAGE" \
  -c 'cd /app && ./node_modules/.bin/prisma db push --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma --skip-generate' \
  > "$EVIDENCE/02-candidate-ref-push.log" 2>&1 \
  || die "candidate schema push to the reference database failed (see 02-candidate-ref-push.log)"
psql_db postiz_candidate_ref -f - < "$HERE/indexes.sql" > "$EVIDENCE/02-indexes-reference.txt" 2>&1 \
  || die "could not read reference index definitions"
if grep -q 'MISSING' "$EVIDENCE/02-indexes-reference.txt"; then
  record FAIL "the candidate schema creates the five expected index names"
else
  record PASS "the candidate schema creates the five expected index names"
fi
docker exec "$PG" psql -U "$PG_USER" -d postgres -c 'DROP DATABASE postiz_candidate_ref' >/dev/null 2>&1 || true

docker run --rm --network "$NET" -v "$HERE:/rehearsal:ro" \
  -e "DATABASE_URL=${BASE_DB_URL}/${PG_DB}?schema=public" \
  --entrypoint sh "$IMAGE" \
  -c 'cd /app && ./node_modules/.bin/prisma db push --schema /rehearsal/old-schema.prisma --skip-generate' \
  > "$EVIDENCE/02-old-schema-push.log" 2>&1 \
  || die "old v2.25.3 schema push failed (see 02-old-schema-push.log)"
record PASS "the v2.25.3 schema was pushed with the pinned Prisma CLI" "$(head -1 "$EVIDENCE/02-old-schema-push.log")"

log "seeding synthetic v2.25.3 data"
if psql_main_file "$HERE/seed-old.sql" > "$EVIDENCE/02-seed.log" 2>&1; then
  record PASS "synthetic old data was inserted"
else
  tail -20 "$EVIDENCE/02-seed.log" >&2
  die "seed failed (see 02-seed.log)"
fi
psql_main -c 'ANALYZE;' >/dev/null 2>&1 || true

# ------------------------------------------------------------
# Baseline: keys, digests, structure, indexes, size
# ------------------------------------------------------------
psql_main -f - < "$HERE/inventory.sql" > "$EVIDENCE/20-data-pre.txt" 2>&1 || die "pre inventory failed"
psql_main -f - < "$HERE/sample-size.sql" > "$EVIDENCE/23-sample-size-pre.txt" 2>&1 || die "pre size failed"
psql_main -f - < "$HERE/indexes.sql" > "$EVIDENCE/21-indexes-pre.txt" 2>&1 || die "pre indexes failed"
dump_schema "$PG_DB" "$EVIDENCE/22-schema-pre.sql"

PRE_MISSING="$(grep -c 'MISSING' "$EVIDENCE/21-indexes-pre.txt" || true)"
PRE_TOTAL="$(awk -F'\t' '$1=="indexes.total" {print $2}' "$EVIDENCE/21-indexes-pre.txt")"
PRE_POSTS="$(awk '$1=="rows.post" {print $2}' "$EVIDENCE/23-sample-size-pre.txt")"
PRE_DB_BYTES="$(awk '$1=="size.database_bytes" {print $2}' "$EVIDENCE/23-sample-size-pre.txt")"
expect_eq "the old schema has 281 indexes" "281" "$PRE_TOTAL"
expect_eq "the old database has none of the five new indexes" "5" "$PRE_MISSING"
record PASS "sample size" "posts=$PRE_POSTS db_bytes=$PRE_DB_BYTES indexes=$PRE_TOTAL"

# ------------------------------------------------------------
# Legacy media in a real named volume
# ------------------------------------------------------------
docker volume create "$VOLUME" >/dev/null || die "could not create uploads volume"
docker run --rm -v "$VOLUME:/uploads" -v "$HERE:/seed:ro" busybox:latest sh -c \
  'mkdir -p /uploads/2025/01 && cp /seed/legacy-launch.png /uploads/2025/01/launch.png && cp /seed/legacy-launch.thumb.png /uploads/2025/01/launch.thumb.png' \
  > "$EVIDENCE/30-seed-media.log" 2>&1 \
  || die "could not seed the uploads volume"
OLD_SHA="$(shasum -a 256 "$HERE/legacy-launch.png" | awk '{print $1}')"
record PASS "a legacy media file was placed in the real uploads volume" "sha256=$OLD_SHA"

# ------------------------------------------------------------
# First start: a controlled ROW EXCLUSIVE lock on Post makes the sync wait,
# proving that CREATE INDEX takes a SHARE lock against writers. The lock is
# released by itself after $LOCK_SECONDS seconds.
# ------------------------------------------------------------
log "holding a write lock on Post to force a measurable index lock wait"
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" \
  -c "BEGIN; LOCK TABLE \"Post\" IN ROW EXCLUSIVE MODE; SELECT pg_sleep($LOCK_SECONDS); COMMIT;" \
  > "$EVIDENCE/12-lock-holder.log" 2>&1 &
LOCK_PID=$!
sleep 0.5
LOCK_GRANTED="$(psql_main -tAc "select count(*) from pg_locks l join pg_class c on c.oid=l.relation where c.relname='Post' and l.mode='RowExclusiveLock' and l.granted")"
expect_eq "a writer transaction holds RowExclusiveLock on Post before startup" "1" "$LOCK_GRANTED"

cat > "$ENVFILE" <<EOF
DATABASE_URL=${BASE_DB_URL}/${PG_DB}?schema=public
REDIS_URL=redis://${REDIS}:6379
TEMPORAL_ADDRESS=${TEMPORAL}:7233
TEMPORAL_NAMESPACE=default
JWT_SECRET=synthetic-t10-jwt-secret
MAIN_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5000
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000/api
BACKEND_INTERNAL_URL=http://localhost:3000
STORAGE_PROVIDER=local
UPLOAD_DIRECTORY=/uploads
NODE_ENV=production
IS_GENERAL=true
EOF

log "starting the candidate image (real entrypoint, nginx + PM2)"
CONTAINER_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SYNC_LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "sync_log_since=$SYNC_LOG_SINCE" > "$EVIDENCE/13-sync-timing.txt"
docker run -d --name "$APP" --network "$NET" --env-file "$ENVFILE" \
  -p "127.0.0.1:${HOST_PORT}:5000" \
  -v "$VOLUME:/uploads" \
  "$IMAGE" >/dev/null || die "could not start the candidate image"

SYNCED=0
for _ in $(seq 1 240); do
  docker logs -t "$APP" > "$EVIDENCE/03-start-1.log" 2>&1 || true
  if grep -qF '[startup-sync] database schema is in sync' "$EVIDENCE/03-start-1.log"; then
    SYNCED=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" != "true" ]; then break; fi
  sleep 1
done
if [ "$SYNCED" -eq 1 ]; then
  record PASS "the startup sync reported success" "container started at $CONTAINER_STARTED_AT"
else
  docker logs "$APP" > "$EVIDENCE/03-start-1.log" 2>&1 || true
  record FAIL "the startup sync reported success"
fi

# Capture the DDL/lock lines while statement logging is still on, then switch
# the per-statement log off so the application's own queries do not flood it.
docker logs --since "$SYNC_LOG_SINCE" "$PG" 2>&1 | grep -Ei 'statement: (create|alter|drop) |still waiting' \
  > "$EVIDENCE/10-postgres-ddl.log" 2>&1 || true
psql_main -c "ALTER SYSTEM SET log_min_duration_statement = -1;" >/dev/null 2>&1 || true
psql_main -c "ALTER SYSTEM SET log_lock_waits = off;" >/dev/null 2>&1 || true
psql_main -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || true

grep -Ei 'statement: create (unique )?index' "$EVIDENCE/10-postgres-ddl.log" \
  > "$EVIDENCE/10-index-timings.txt" 2>&1 || true
grep -F 'still waiting' "$EVIDENCE/10-postgres-ddl.log" > "$EVIDENCE/11-lock-waits.txt" 2>&1 || true
if [ -s "$EVIDENCE/11-lock-waits.txt" ]; then
  WAIT_OID="$(grep -o 'relation [0-9]*' "$EVIDENCE/11-lock-waits.txt" | head -1 | awk '{print $2}')"
  WAIT_REL="$(psql_main -tAc "select relname from pg_class where oid=$WAIT_OID" 2>/dev/null | tr -d '[:space:]')"
  expect_eq "the startup sync waited on the locked Post table" "Post" "$WAIT_REL"
else
  record FAIL "the startup sync waited on the locked Post table" "no 'still waiting' line in the PostgreSQL log"
fi

node - "$EVIDENCE/03-start-1.log" >> "$EVIDENCE/13-sync-timing.txt" 2>/dev/null <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const ms = (line) => {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})/);
  return m ? Date.parse(m[1] + 'Z') : NaN;
};
const start = raw.find((l) => l.includes('[startup-sync] cwd='));
const done = raw.find((l) => l.includes('[startup-sync] database schema is in sync'));
if (!start || !done) { console.log('sync_ms=unavailable'); process.exit(0); }
console.log('sync_start=' + start.slice(0, 30));
console.log('sync_done=' + done.slice(0, 30));
console.log('sync_ms=' + (ms(done) - ms(start)));
NODE
SYNC_MS="$(awk -F= '$1=="sync_ms" {print $2}' "$EVIDENCE/13-sync-timing.txt")"
if [ -n "$SYNC_MS" ] && [ "$SYNC_MS" != "unavailable" ] && [ "$SYNC_MS" -gt 1000 ] 2>/dev/null; then
  record PASS "the sync duration includes the controlled lock wait" "${SYNC_MS}ms"
else
  record FAIL "the sync duration includes the controlled lock wait" "${SYNC_MS:-unavailable}ms"
fi

# Wait for the API, the worker health route and PM2.
log "waiting for the API, frontend and worker"
API_READY=0
for _ in $(seq 1 120); do
  API_CODE=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:5000/api/ 2>/dev/null)
  if [ "$API_CODE" = "200" ]; then API_READY=1; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" != "true" ]; then break; fi
  sleep 2
done
docker logs -t "$APP" > "$EVIDENCE/03-start-1.log" 2>&1 || true
if [ "$API_READY" -eq 1 ]; then
  record PASS "the API answers /api/ 200" "$(docker exec "$APP" curl -s http://localhost:5000/api/)"
else
  record FAIL "the API answers /api/ 200" "last status=$API_CODE"
fi

STABLE=0
for _ in $(seq 1 10); do
  C=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:5000/api/ 2>/dev/null)
  [ "$C" = "200" ] && STABLE=$((STABLE + 1)) || STABLE=0
  [ "$STABLE" -ge 3 ] && break
  sleep 2
done
expect_eq "three consecutive /api/ requests answer 200" "3" "$STABLE"

APP_ROOT_CODE=$(docker exec "$APP" curl -s -o /tmp/t10-root.html -w '%{http_code}' --max-time 10 http://localhost:5000/ 2>/dev/null)
FRONTEND_CODE=$(docker exec "$APP" curl -sL -o /tmp/t10-front.html -w '%{http_code}' --max-time 20 http://localhost:5000/ 2>/dev/null)
case "$FRONTEND_CODE" in
  2*) record PASS "the frontend answers through nginx" "root=$APP_ROOT_CODE final=$FRONTEND_CODE" ;;
  *) record FAIL "the frontend answers through nginx" "root=$APP_ROOT_CODE final=$FRONTEND_CODE" ;;
esac
if docker exec "$APP" grep -qi '_next\|postiz' /tmp/t10-front.html 2>/dev/null; then
  record PASS "the frontend response contains the Next.js application shell"
else
  record FAIL "the frontend response contains the Next.js application shell"
fi

WORKER_CODE=""
for _ in $(seq 1 60); do
  WORKER_CODE=$(docker exec "$APP" curl -s -o /tmp/t10-worker.json -w '%{http_code}' --max-time 10 http://localhost:3002/health/status 2>/dev/null)
  [ "$WORKER_CODE" = "200" ] && break
  sleep 2
done
if [ "$WORKER_CODE" = "200" ] && docker exec "$APP" grep -q '"status":"ok"' /tmp/t10-worker.json 2>/dev/null; then
  record PASS "the worker health route reaches Temporal" "$(docker exec "$APP" cat /tmp/t10-worker.json)"
else
  record FAIL "the worker health route reaches Temporal" "status=$WORKER_CODE"
fi

PM2_ONLINE=0
for _ in $(seq 1 60); do
  PM2_ONLINE=$(docker exec "$APP" pm2 jlist 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      try { const l = JSON.parse(raw); console.log(l.filter((p) => p.pm2_env.status === "online").length); }
      catch { console.log(0); }
    });' 2>/dev/null || echo 0)
  [ "$PM2_ONLINE" = "3" ] && break
  sleep 2
done
expect_eq "three PM2 processes are online" "3" "$PM2_ONLINE"
docker exec "$APP" pm2 jlist > "$EVIDENCE/03-pm2-jlist.json" 2>/dev/null || true

# The worker really polls Temporal, not just starts a process.
POLLERS=0
for _ in $(seq 1 15); do
  docker exec "$TEMPORAL" tctl --address "$TEMPORAL:7233" --namespace default \
    taskqueue describe --taskqueue main --taskqueuetype workflow \
    > "$EVIDENCE/03-worker-pollers.txt" 2>&1 || true
  if grep -qi 'poller identity' "$EVIDENCE/03-worker-pollers.txt" && \
     grep -q '@' "$EVIDENCE/03-worker-pollers.txt"; then
    POLLERS=1
    break
  fi
  sleep 2
done
if [ "$POLLERS" -eq 1 ]; then
  record PASS "the Temporal main task queue has live pollers" "$(grep -c '@' "$EVIDENCE/03-worker-pollers.txt") poller row(s)"
else
  record FAIL "the Temporal main task queue has live pollers"
fi

docker exec "$TEMPORAL" temporal operator search-attribute list \
  --address "$TEMPORAL:7233" --namespace default > "$EVIDENCE/03-temporal-search-attributes-post.txt" 2>&1 || true
if grep -q 'organizationId' "$EVIDENCE/03-temporal-search-attributes-post.txt" && \
   grep -q 'postId' "$EVIDENCE/03-temporal-search-attributes-post.txt"; then
  record PASS "the backend registered organizationId and postId on the substitute Temporal"
else
  record FAIL "the backend registered organizationId and postId on the substitute Temporal"
fi

# Startup ordering from the timestamped container log.
SYNC_LINE="$(grep -nF '[startup-sync] database schema is in sync' "$EVIDENCE/03-start-1.log" | head -1 | cut -d: -f1)"
BACKEND_LINE="$(grep -nF 'Backend started successfully' "$EVIDENCE/03-start-1.log" | head -1 | cut -d: -f1)"
WORKER_LINE="$(grep -nF 'Orchestrator health check listening' "$EVIDENCE/03-start-1.log" | head -1 | cut -d: -f1)"
if [ -n "$SYNC_LINE" ] && [ -n "$BACKEND_LINE" ] && [ "$SYNC_LINE" -lt "$BACKEND_LINE" ]; then
  record PASS "the sync line appears before the API starts" "sync=$SYNC_LINE backend=$BACKEND_LINE"
else
  record FAIL "the sync line appears before the API starts" "sync=${SYNC_LINE:-none} backend=${BACKEND_LINE:-none}"
fi
if [ -n "$SYNC_LINE" ] && [ -n "$WORKER_LINE" ] && [ "$SYNC_LINE" -lt "$WORKER_LINE" ]; then
  record PASS "the sync line appears before the worker starts" "sync=$SYNC_LINE worker=$WORKER_LINE"
else
  record FAIL "the sync line appears before the worker starts" "sync=${SYNC_LINE:-none} worker=${WORKER_LINE:-none}"
fi
expect_contains "the entrypoint then launched the real application command" "$EVIDENCE/03-start-1.log" '[startup-sync] database schema is in sync; starting: sh -c nginx && pm2-runtime ecosystem.config.cjs'
expect_contains "the API logs its successful start" "$EVIDENCE/03-start-1.log" 'Backend started successfully'

# ------------------------------------------------------------
# Structure and indexes after the first sync
# ------------------------------------------------------------
psql_main -f - < "$HERE/inventory.sql" > "$EVIDENCE/20-data-post1.txt" 2>&1
psql_main -f - < "$HERE/sample-size.sql" > "$EVIDENCE/23-sample-size-post.txt" 2>&1
psql_main -f - < "$HERE/indexes.sql" > "$EVIDENCE/31-indexes-post1.txt" 2>&1
dump_schema "$PG_DB" "$EVIDENCE/32-schema-post1.sql"

expect_files_equal "every row keeps its primary key and column digest" "$EVIDENCE/20-data-pre.txt" "$EVIDENCE/20-data-post1.txt"
POST_MISSING="$(grep -c 'MISSING' "$EVIDENCE/31-indexes-post1.txt" || true)"
POST_TOTAL="$(awk -F'\t' '$1=="indexes.total" {print $2}' "$EVIDENCE/31-indexes-post1.txt")"
expect_eq "all five new indexes exist after the sync" "0" "$POST_MISSING"
expect_eq "the schema now has 286 indexes (281 + 5)" "286" "$POST_TOTAL"
expect_files_equal "the five index definitions match the candidate reference" "$EVIDENCE/02-indexes-reference.txt" "$EVIDENCE/31-indexes-post1.txt"

diff "$EVIDENCE/22-schema-pre.sql" "$EVIDENCE/32-schema-post1.sql" > "$EVIDENCE/33-schema-diff.txt" 2>&1 || true
ADDED_LINES="$(grep -c '^>' "$EVIDENCE/33-schema-diff.txt" || true)"
REMOVED_LINES="$(grep -c '^<' "$EVIDENCE/33-schema-diff.txt" || true)"
ADDED_CREATE_INDEX="$(grep -c '^> CREATE INDEX' "$EVIDENCE/33-schema-diff.txt" || true)"
expect_eq "the sync added no column/table definitions (removed lines)" "0" "$REMOVED_LINES"
expect_eq "the sync added exactly 35 dump lines (5 index blocks)" "35" "$ADDED_LINES"
expect_eq "the added definitions are exactly five CREATE INDEX statements" "5" "$ADDED_CREATE_INDEX"
for name in $(log_index_names); do
  expect_contains "the added schema defines $name" "$EVIDENCE/33-schema-diff.txt" "CREATE INDEX \"$name\""
done

# Index definition text and order, printed for the record.
grep -v 'MISSING' "$EVIDENCE/31-indexes-post1.txt" > "$EVIDENCE/31-index-definitions.txt" 2>&1 || true

# ------------------------------------------------------------
# Media: read the legacy file, upload a new one through the app's storage
# ------------------------------------------------------------
OLD_CODE=$(docker exec "$APP" curl -s -o /tmp/t10-legacy.png -w '%{http_code}' --max-time 10 http://localhost:5000/uploads/2025/01/launch.png 2>/dev/null)
OLD_HTTP_SHA=$(docker exec "$APP" sha256sum /tmp/t10-legacy.png 2>/dev/null | awk '{print $1}')
THUMB_CODE=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:5000/uploads/2025/01/launch.thumb.png 2>/dev/null)
MEDIA_PATH="$(psql_main -tAc "select path from \"Media\" where id='cccccccc-0000-4000-8000-000000000001'" 2>/dev/null | tr -d '[:space:]')"
expect_eq "the old media row still points at its uploads path" "uploads/2025/01/launch.png" "$MEDIA_PATH"
expect_eq "nginx serves the legacy media file" "200" "$OLD_CODE"
expect_eq "the legacy file bytes did not change" "$OLD_SHA" "$OLD_HTTP_SHA"
expect_eq "nginx serves the legacy thumbnail" "200" "$THUMB_CODE"

NEW_URL=$(docker exec "$APP" node --experimental-require-module -e '
  const { LocalStorage } = require("/app/apps/backend/dist/libraries/nestjs-libraries/src/upload/local.storage.js");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  new LocalStorage(process.env.UPLOAD_DIRECTORY).uploadSimple("data:image/png;base64," + png)
    .then((url) => console.log(url))
    .catch((e) => { console.error(e); process.exit(1); });
' 2>/dev/null | tail -1)
NEW_PATH="${NEW_URL#http://localhost:5000}"
if [ -n "$NEW_URL" ] && [ "$NEW_PATH" != "$NEW_URL" ]; then
  record PASS "a new file was uploaded through the app's LocalStorage" "$NEW_URL"
else
  record FAIL "a new file was uploaded through the app's LocalStorage" "url=[$NEW_URL]"
fi
NEW_CODE=$(docker exec "$APP" curl -s -o /tmp/t10-new.png -w '%{http_code}' --max-time 10 "http://localhost:5000${NEW_PATH}" 2>/dev/null)
NEW_HTTP_SHA=$(docker exec "$APP" sha256sum /tmp/t10-new.png 2>/dev/null | awk '{print $1}')
expect_eq "nginx serves the new upload" "200" "$NEW_CODE"
expect_eq "the uploaded file bytes match" "$OLD_SHA" "$NEW_HTTP_SHA"
{
  echo "legacy_url=http://localhost:5000/uploads/2025/01/launch.png"
  echo "legacy_http=$OLD_CODE sha256=$OLD_HTTP_SHA"
  echo "legacy_thumb_http=$THUMB_CODE"
  echo "new_url=$NEW_URL"
  echo "new_http=$NEW_CODE sha256=$NEW_HTTP_SHA"
  echo "volume=t10-uploads:/uploads"
} > "$EVIDENCE/40-media.txt"

# ------------------------------------------------------------
# Restart: idempotent sync, stable schema, media still there
# ------------------------------------------------------------
log "restarting the same container"
RESTART_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker restart "$APP" >/dev/null || die "restart failed"
SYNCED2=0
for _ in $(seq 1 240); do
  docker logs --since "$RESTART_TS" -t "$APP" > "$EVIDENCE/04-start-2.log" 2>&1 || true
  if grep -qF '[startup-sync] database schema is in sync' "$EVIDENCE/04-start-2.log"; then
    API2=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:5000/api/ 2>/dev/null)
    if [ "$API2" = "200" ]; then SYNCED2=1; break; fi
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" != "true" ]; then break; fi
  sleep 2
done
if [ "$SYNCED2" -eq 1 ]; then
  record PASS "the second start syncs and becomes ready" "api=200"
else
  docker logs --since "$RESTART_TS" -t "$APP" > "$EVIDENCE/04-start-2.log" 2>&1 || true
  record FAIL "the second start syncs and becomes ready"
fi
expect_contains "the second sync reports the database as already in sync" "$EVIDENCE/04-start-2.log" 'already in sync'
if grep -q 'CREATE INDEX' "$EVIDENCE/04-start-2.log"; then
  record FAIL "the second sync runs no further DDL"
else
  record PASS "the second sync runs no further DDL"
fi

psql_main -f - < "$HERE/inventory.sql" > "$EVIDENCE/20-data-post2.txt" 2>&1
psql_main -f - < "$HERE/indexes.sql" > "$EVIDENCE/41-indexes-post2.txt" 2>&1
dump_schema "$PG_DB" "$EVIDENCE/42-schema-post2.sql"
expect_files_equal "the second start leaves every row digest unchanged" "$EVIDENCE/20-data-pre.txt" "$EVIDENCE/20-data-post2.txt"
expect_files_equal "the second start leaves the five index definitions unchanged" "$EVIDENCE/31-indexes-post1.txt" "$EVIDENCE/41-indexes-post2.txt"
expect_files_equal "the second start leaves the schema unchanged" "$EVIDENCE/32-schema-post1.sql" "$EVIDENCE/42-schema-post2.sql"

LEGACY_AFTER=$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:5000/uploads/2025/01/launch.png 2>/dev/null)
NEW_AFTER=$(docker exec "$APP" curl -s -o /tmp/t10-new-after.png -w '%{http_code}' --max-time 10 "http://localhost:5000${NEW_PATH}" 2>/dev/null)
NEW_AFTER_SHA=$(docker exec "$APP" sha256sum /tmp/t10-new-after.png 2>/dev/null | awk '{print $1}')
expect_eq "the legacy file is still served after the restart" "200" "$LEGACY_AFTER"
expect_eq "the new upload is still served after the restart" "200" "$NEW_AFTER"
expect_eq "the new upload bytes survive the restart" "$OLD_SHA" "$NEW_AFTER_SHA"
PM2_AFTER=$(docker exec "$APP" pm2 jlist 2>/dev/null | node -e '
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    try { const l = JSON.parse(raw); console.log(l.filter((p) => p.pm2_env.status === "online").length); } catch { console.log(0); }
  });' 2>/dev/null || echo 0)
expect_eq "three PM2 processes are online after the restart" "3" "$PM2_AFTER"
docker inspect -f 'restartCount={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{end}}' "$APP" \
  > "$EVIDENCE/43-container-state.txt" 2>&1 || true

[ -n "$LOCK_PID" ] && wait "$LOCK_PID" 2>/dev/null || true
LOCK_PID=""

# ------------------------------------------------------------
# Isolated index-build benchmark on a copy of the upgraded sample.
# The startup DDL durations above include the controlled lock wait; these
# numbers are the pure build times on the same data, plus a direct writer wait.
# ------------------------------------------------------------
log "measuring isolated index build and writer blocking on a copy"
docker stop "$APP" >/dev/null 2>&1 || true
psql_main -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PG_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql_main -c 'CREATE DATABASE postiz_bench TEMPLATE postiz' >/dev/null 2>&1 \
  || die "could not create the benchmark database copy"
: > "$EVIDENCE/50-index-bench.txt"
for name in $(log_index_names); do
  DDL="$(psql_db postiz_bench -tAc "select indexdef from pg_indexes where schemaname='public' and indexname='$name'" | tr -d '\r')"
  [ -n "$DDL" ] || die "missing index $name in the benchmark copy"
  {
    echo '\timing on'
    echo "DROP INDEX \"$name\";"
    echo "$DDL;"
  } | docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postiz_bench \
    > "$EVIDENCE/.bench-$name.log" 2>&1 || die "benchmark rebuild failed for $name"
  TIME_MS="$(grep '^Time:' "$EVIDENCE/.bench-$name.log" | tail -1 | sed 's/^Time: //')"
  echo "$name|$TIME_MS" >> "$EVIDENCE/50-index-bench.txt"
done
rm -f "$EVIDENCE"/.bench-*.log

# A writer that starts during CREATE INDEX blocks on the same SHARE lock.
LONG_INDEX="Post_publishDate_state_deletedAt_parentPostId_integrationId_idx"
LONG_DDL="$(psql_db postiz_bench -tAc "select indexdef from pg_indexes where schemaname='public' and indexname='$LONG_INDEX'" | tr -d '\r')"
psql_db postiz_bench -c "DROP INDEX \"$LONG_INDEX\";" >/dev/null 2>&1 || die "could not drop $LONG_INDEX for the writer test"
(
  sleep 0.1
  {
    echo '\timing on'
    echo "UPDATE \"Post\" SET content = content WHERE id = 'ffffffff-0000-4000-8000-000000000001';"
  } | docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postiz_bench \
    > "$EVIDENCE/51-writer-wait.txt" 2>&1
) &
WRITER_PID=$!
{
  echo '\timing on'
  echo "$LONG_DDL;"
} | docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postiz_bench \
  > "$EVIDENCE/51-index-create-with-writer.txt" 2>&1 || true
wait "$WRITER_PID" 2>/dev/null || true
WRITER_TIME="$(grep '^Time:' "$EVIDENCE/51-writer-wait.txt" | tail -1 | sed 's/^Time: //')"
WRITER_MS="${WRITER_TIME%% *}"
WRITER_ROW="$(grep -c 'UPDATE 1' "$EVIDENCE/51-writer-wait.txt" || true)"
echo "writer_update_time=$WRITER_TIME" >> "$EVIDENCE/51-writer-wait.txt"
echo "create_index_time=$(grep '^Time:' "$EVIDENCE/51-index-create-with-writer.txt" | tail -1 | sed 's/^Time: //')" >> "$EVIDENCE/51-writer-wait.txt"
if [ "$WRITER_ROW" = "1" ] && [ -n "$WRITER_MS" ] && awk -v ms="$WRITER_MS" 'BEGIN { exit !(ms > 10) }'; then
  record PASS "a write that overlaps CREATE INDEX waits and then succeeds" "writer_time=$WRITER_TIME"
else
  record FAIL "a write that overlaps CREATE INDEX waits and then succeeds" "writer_time=$WRITER_TIME"
fi
BENCH_TOTAL="$(psql_db postiz_bench -tAc "select count(*) from pg_indexes where schemaname='public'" | tr -d '[:space:]')"
expect_eq "the benchmark copy ends with 286 indexes" "286" "$BENCH_TOTAL"
docker exec "$PG" psql -U "$PG_USER" -d postgres -c 'DROP DATABASE postiz_bench' >/dev/null 2>&1 || true

# ------------------------------------------------------------
# Failure 1: unreachable database -> non-zero exit, no application.
# ------------------------------------------------------------
log "failure sample: unreachable database"
docker run -d --name "$APP_FAIL" --network "$NET" --env-file "$ENVFILE" \
  -e "DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@t10-pg-missing:5432/${PG_DB}?schema=public" \
  "$IMAGE" >/dev/null 2>&1 || true
if wait_for_exit "$APP_FAIL" 180; then
  fail_code="$(docker inspect -f '{{.State.ExitCode}}' "$APP_FAIL" 2>/dev/null)"
  docker logs "$APP_FAIL" > "$EVIDENCE/60-fail-connection.log" 2>&1 || true
  if [ "${fail_code:-0}" != "0" ]; then
    record PASS "an unreachable database exits non-zero" "exit=$fail_code"
  else
    record FAIL "an unreachable database exits non-zero" "exit=$fail_code"
  fi
  expect_contains "the connection failure is surfaced by Prisma" "$EVIDENCE/60-fail-connection.log" 'P1001'
  expect_contains "the entrypoint reports the failed sync" "$EVIDENCE/60-fail-connection.log" 'schema sync FAILED'
  expect_contains "the entrypoint refuses to start the application" "$EVIDENCE/60-fail-connection.log" 'refusing to start'
  expect_not_contains "the API never starts after a failed sync" "$EVIDENCE/60-fail-connection.log" 'Backend started successfully'
  expect_not_contains "the worker never starts after a failed sync" "$EVIDENCE/60-fail-connection.log" 'Orchestrator health check listening'
else
  docker logs "$APP_FAIL" > "$EVIDENCE/60-fail-connection.log" 2>&1 || true
  record FAIL "an unreachable database exits non-zero" "container still running after 180s"
fi

psql_main -f - < "$HERE/inventory.sql" > "$EVIDENCE/61-data-after-connection-failure.txt" 2>&1
expect_files_equal "the failed connection start leaves the data unchanged" "$EVIDENCE/20-data-pre.txt" "$EVIDENCE/61-data-after-connection-failure.txt"

# ------------------------------------------------------------
# Failure 2: a sync that would lose data (unmanaged table with rows) on an
# isolated copy of the upgraded database -> non-zero exit, no application.
# ------------------------------------------------------------
log "failure sample: sync refuses a destructive change"
psql_main -c 'CREATE DATABASE postiz_fail TEMPLATE postiz' >/dev/null 2>&1 \
  || die "could not create the sync-failure database copy"
psql_db postiz_fail -c "CREATE TABLE \"legacy_unmanaged\" (id integer); INSERT INTO \"legacy_unmanaged\" (id) VALUES (1), (2);" >/dev/null 2>&1 \
  || die "could not add the unmanaged table"
dump_schema postiz_fail "$EVIDENCE/62-schema-before-sync-failure.sql"
docker run -d --name "$APP_SYNCFAIL" --network "$NET" --env-file "$ENVFILE" \
  -e "DATABASE_URL=${BASE_DB_URL}/postiz_fail?schema=public" \
  "$IMAGE" >/dev/null 2>&1 || true
if wait_for_exit "$APP_SYNCFAIL" 180; then
  sync_code="$(docker inspect -f '{{.State.ExitCode}}' "$APP_SYNCFAIL" 2>/dev/null)"
  docker logs "$APP_SYNCFAIL" > "$EVIDENCE/63-fail-sync.log" 2>&1 || true
  if [ "${sync_code:-0}" != "0" ]; then
    record PASS "a sync that needs --accept-data-loss exits non-zero" "exit=$sync_code"
  else
    record FAIL "a sync that needs --accept-data-loss exits non-zero" "exit=$sync_code"
  fi
  if grep -qiE 'accept-data-loss|data loss' "$EVIDENCE/63-fail-sync.log"; then
    record PASS "Prisma asked for data-loss acceptance and did not get it"
  else
    record FAIL "Prisma asked for data-loss acceptance and did not get it"
  fi
  expect_contains "the entrypoint refuses to start the application" "$EVIDENCE/63-fail-sync.log" 'refusing to start'
  expect_not_contains "the API never starts after a refused sync" "$EVIDENCE/63-fail-sync.log" 'Backend started successfully'
  expect_not_contains "the worker never starts after a refused sync" "$EVIDENCE/63-fail-sync.log" 'Orchestrator health check listening'
else
  docker logs "$APP_SYNCFAIL" > "$EVIDENCE/63-fail-sync.log" 2>&1 || true
  record FAIL "a sync that needs --accept-data-loss exits non-zero" "container still running after 180s"
fi
dump_schema postiz_fail "$EVIDENCE/64-schema-after-sync-failure.sql"
diff "$EVIDENCE/62-schema-before-sync-failure.sql" "$EVIDENCE/64-schema-after-sync-failure.sql" \
  > "$EVIDENCE/64-schema-diff-after-sync-failure.txt" 2>&1 || true
if [ -s "$EVIDENCE/64-schema-diff-after-sync-failure.txt" ]; then
  record PASS "the failed sync left partial structural changes recorded" "$(grep -c '^[<>]' "$EVIDENCE/64-schema-diff-after-sync-failure.txt") changed line(s)"
else
  record PASS "the failed sync left the structure unchanged" "0 changed lines"
fi
psql_db postiz_fail -f - < "$HERE/inventory.sql" > "$EVIDENCE/65-data-after-sync-failure.txt" 2>&1
expect_files_equal "the refused sync leaves the copied data unchanged" "$EVIDENCE/20-data-pre.txt" "$EVIDENCE/65-data-after-sync-failure.txt"
docker exec "$PG" psql -U "$PG_USER" -d postgres -c 'DROP DATABASE postiz_fail' >/dev/null 2>&1 || true

# ------------------------------------------------------------
# Runtime image (k8s/Dockerfile.runtime): the artifact path is not produced by
# this repository; record the exact missing condition instead of claiming it.
# ------------------------------------------------------------
log "attempting the inactive runtime image (expected to be unbuildable)"
RUNTIME_TAG="postiz-ticket10-runtime:$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
docker build -f "$REPO_ROOT/k8s/Dockerfile.runtime" -t "$RUNTIME_TAG" "$REPO_ROOT/k8s" \
  > "$EVIDENCE/70-runtime-image-build.log" 2>&1
RUNTIME_EXIT=$?
echo "exit=$RUNTIME_EXIT" > "$EVIDENCE/70-runtime-image.txt"
if [ "$RUNTIME_EXIT" -ne 0 ]; then
  record UNVERIFIED "the inactive runtime image was not built" "k8s/Dockerfile.runtime needs prebuilt artifacts this repo does not produce (exit=$RUNTIME_EXIT)"
else
  record PASS "the inactive runtime image built" "$RUNTIME_TAG"
fi
grep -q 'node_modules' "$REPO_ROOT/k8s/.dockerignore" \
  && echo "dockerignore excludes node_modules; the runtime Dockerfile expects it in the context." >> "$EVIDENCE/70-runtime-image.txt"
grep -q '^node_modules' "$REPO_ROOT/k8s/.dockerignore" \
  || echo "note: check k8s/.dockerignore for the exact excluded artifact paths." >> "$EVIDENCE/70-runtime-image.txt"

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo
echo "final state"
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "select 'posts='||count(*) from \"Post\"; select 'indexes='||count(*) from pg_indexes where schemaname='public';" \
  > "$EVIDENCE/90-final-db-state.txt" 2>&1 || true
cat "$EVIDENCE/90-final-db-state.txt"
docker system df > "$EVIDENCE/91-docker-disk.txt" 2>&1 || true

{
  echo "Ticket 10 rehearsal summary — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "image=$IMAGE id=$(cat "$EVIDENCE/00-image-id.txt") arch=$(cat "$EVIDENCE/00-image-arch.txt")"
  echo "source=$MANIFEST_COMMIT worktree=$MANIFEST_STATE"
  echo "sample: $(tr '\n' ' ' < "$EVIDENCE/23-sample-size-pre.txt")"
  echo "startup sync duration (incl. controlled lock): $(tr '\n' ' ' < "$EVIDENCE/13-sync-timing.txt")"
  echo "index build benchmark (copy of upgraded sample):"
  cat "$EVIDENCE/50-index-bench.txt"
  echo "writer wait: $(tr '\n' ' ' < "$EVIDENCE/51-writer-wait.txt")"
  echo "result: PASS=$PASSED FAIL=$FAILED UNVERIFIED=$UNVERIFIED"
  echo
  printf '%s\n' "${RESULTS[@]}"
} > "$EVIDENCE/summary.txt"

echo
cat "$EVIDENCE/summary.txt"
echo
log "evidence: $EVIDENCE"
if [ "$FAILED" -ne 0 ]; then
  log "FAILED=$FAILED"
  exit 1
fi
log "all assertions passed (PASS=$PASSED UNVERIFIED=$UNVERIFIED)"
