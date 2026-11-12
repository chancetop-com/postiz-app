#!/usr/bin/env bash
# ============================================================
# Ticket 03 rehearsal: official startup sync against a pre-merge database.
#
# Everything runs locally and isolated:
#   - PostgreSQL 15 container with a throw-away volume
#   - Redis container, only so the API can boot
#   - the candidate image built by ./k8s/build-local.sh
#
# It builds the old database from the frozen pre-merge schema, seeds synthetic
# data, then exercises the real container entrypoint:
#   1. first start   -> schema sync, then the application command
#   2. second start  -> sync is idempotent
#   3. connection failure  -> non-zero exit, application never starts
#   4. destructive change  -> non-zero exit, application never starts, data kept
#   5. recovery            -> after the documented manual decision, start works
#   6. duplicate spans     -> what the sync and the Mastra store really do
#
# Usage:
#   IMAGE=postiz-ticket03:candidate ./run-rehearsal.sh
#
# All output is written to ./evidence. Exit code is non-zero if any assertion
# fails, so a green run is real evidence and not a log to read optimistically.
# ============================================================
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$HERE/../../../.." && pwd)"
EVIDENCE="$HERE/evidence"

IMAGE="${IMAGE:-postiz-ticket03:candidate}"
NET="postiz03-net"
PG="postiz03-db"
REDIS="postiz03-redis"
PG_PORT="${PG_PORT:-55432}"
PG_USER="postiz"
PG_PASSWORD="postiz-synthetic"
PG_DB="postiz"
PG_URL_HOST="postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}"
PG_URL_DOCKER="postgresql://${PG_USER}:${PG_PASSWORD}@db:5432/${PG_DB}"
PRISMA="$REPO_ROOT/node_modules/.bin/prisma"

FAILED=0
declare -a RESULTS=()

mkdir -p "$EVIDENCE"
rm -f "$EVIDENCE"/*.log "$EVIDENCE"/*.txt "$EVIDENCE"/*.sql "$EVIDENCE"/summary.txt 2>/dev/null

log() { echo "[rehearsal] $*"; }

record() {
  local status=$1 description=$2 detail=${3:-}
  RESULTS+=("$status|$description|$detail")
  printf '%-4s %s%s\n' "$status" "$description" "${detail:+ ($detail)}"
  [ "$status" = "PASS" ] || FAILED=$((FAILED + 1))
}

expect_equal() {
  local description=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then record PASS "$description"; else record FAIL "$description" "expected=$expected actual=$actual"; fi
}

expect_zero() {
  local description=$1 status=$2
  if [ "$status" -eq 0 ]; then record PASS "$description"; else record FAIL "$description" "status=$status"; fi
}

expect_nonzero() {
  local description=$1 status=$2
  if [ "$status" -ne 0 ]; then record PASS "$description" "status=$status"; else record FAIL "$description" "status=$status"; fi
}

cleanup() {
  docker rm -f "postiz03-run" postiz03-fail-connection postiz03-fail-constraint postiz03-recovered postiz03-spans postiz03-app >/dev/null 2>&1 || true
  docker rm -f "$PG" "$REDIS" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -f "$HERE/.env.rehearsal" 2>/dev/null || true
}
trap cleanup EXIT

# ------------------------------------------------------------
# Preflight
# ------------------------------------------------------------
docker version --format '{{.Server.Version}}' > "$EVIDENCE/00-docker-version.txt" 2>&1
docker image inspect "$IMAGE" > "$EVIDENCE/00-image-inspect.txt" 2>&1 || {
  echo "candidate image $IMAGE does not exist; run ./k8s/build-local.sh first" >&2
  exit 2
}
[ -x "$PRISMA" ] || { echo "prisma CLI missing at $PRISMA" >&2; exit 2; }
command -v node >/dev/null || { echo "node is required for the Mastra init step" >&2; exit 2; }
node -v > "$EVIDENCE/00-node-version.txt" 2>&1
log "image: $IMAGE"
log "postgres: postgres:15 on 127.0.0.1:$PG_PORT"

# ------------------------------------------------------------
# Isolated PostgreSQL 15 and Redis
# ------------------------------------------------------------
cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias db \
  -p "127.0.0.1:${PG_PORT}:5432" \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB="$PG_DB" \
  postgres:15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$PG" pg_isready -U "$PG_USER" -d "$PG_DB" || { echo "postgres did not become ready" >&2; exit 2; }
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc 'select version()' > "$EVIDENCE/00-postgres-version.txt"

psql_file() { # file [database]
  docker exec -i "$PG" psql -U "$PG_USER" -d "${2:-$PG_DB}" -v ON_ERROR_STOP=1 -q -f - < "$1"
}
inventory() { # output-file
  docker exec -i "$PG" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q -f - < "$HERE/inventory.sql" > "$1"
}
dual_inventory() { # database output-file
  docker exec -i "$PG" psql -U "$PG_USER" -d "$1" -v ON_ERROR_STOP=1 -q -f - < "$HERE/inventory.sql" > "$2"
}
dump_schema() { # database output-file
  # pg_dump 15.19 emits a random nonce in \restrict/\unrestrict lines, which
  # would make two identical schemas look different.
  docker exec "$PG" pg_dump -U "$PG_USER" -d "$1" --schema-only --no-owner --no-privileges 2>/dev/null \
    | grep -vE '^\\(un)?restrict ' > "$2"
}
schema_dump() { # output-file
  dump_schema "$PG_DB" "$1"
}

# ------------------------------------------------------------
# Old database: frozen pre-merge schema and synthetic data
# ------------------------------------------------------------
log "building the pre-merge database"
DATABASE_URL="$PG_URL_HOST" "$PRISMA" db push \
  --schema "$HERE/old-schema.prisma" --skip-generate > "$EVIDENCE/01-old-schema-push.log" 2>&1
OLD_PUSH_STATUS=$?
expect_zero "pre-merge schema applied with the official CLI" "$OLD_PUSH_STATUS"
[ "$OLD_PUSH_STATUS" -ne 0 ] && { cat "$EVIDENCE/01-old-schema-push.log" >&2; exit 1; }

psql_file "$HERE/seed-old.sql" > "$EVIDENCE/02-seed.log" 2>&1
expect_zero "synthetic pre-merge data inserted" "$?"

psql_file "$HERE/seed-spans.sql" > "$EVIDENCE/03-seed-spans.log" 2>&1
expect_zero "pre-merge Mastra spans table created with two rows" "$?"

inventory "$EVIDENCE/04-baseline-inventory.txt"
schema_dump "$EVIDENCE/04-baseline-schema.sql"
record PASS "baseline inventory captured" "$(grep -c '|' "$EVIDENCE/04-baseline-inventory.txt") facts"

# ------------------------------------------------------------
# Candidate container helpers
# ------------------------------------------------------------
candidate_env_file() { # database-url -> writes .env.rehearsal
  local file="$HERE/.env.rehearsal"
  cat > "$file" <<EOF
DATABASE_URL=$1
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=synthetic-rehearsal-jwt-secret
MAIN_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5000
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
BACKEND_INTERNAL_URL=http://localhost:3000
STORAGE_PROVIDER=local
NODE_ENV=production
EOF
  printf '%s' "$file"
}

run_stub() { # name database-url logfile
  local name=$1 url=$2 log=$3 envfile
  envfile=$(candidate_env_file "$url")
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network "$NET" --env-file "$envfile" \
    "$IMAGE" sh -c 'echo APP_STARTED_MARKER' >/dev/null
  docker wait "$name" >/dev/null 2>&1
  docker logs "$name" > "$log" 2>&1
  docker inspect -f '{{.State.ExitCode}}' "$name"
}

container_exit() { docker inspect -f '{{.State.ExitCode}}' "$1"; }

# The marker is matched as a whole line: the entrypoint also echoes the command
# it is about to start, which contains the marker text.
has_app_marker() { grep -qx 'APP_STARTED_MARKER' "$1"; }
has_sync_marker() { grep -qF '[startup-sync] database schema is in sync' "$1"; }
has_failure_marker() { grep -q 'refusing to start' "$1"; }

# ------------------------------------------------------------
# 1st start: sync then app, retention compared against the baseline
# ------------------------------------------------------------
log "candidate start #1 (official sync, then the application command)"
STATUS=$(run_stub postiz03-run "$PG_URL_DOCKER" "$EVIDENCE/05-start-1.log")
expect_zero "start #1 exits zero" "$STATUS"
has_sync_marker "$EVIDENCE/05-start-1.log" && record PASS "start #1 ran the schema sync" || record FAIL "start #1 ran the schema sync"
has_app_marker "$EVIDENCE/05-start-1.log" && record PASS "start #1 started the application command" || record FAIL "start #1 started the application command"
SYNC_LINE=$(grep -nF '[startup-sync] database schema is in sync' "$EVIDENCE/05-start-1.log" | head -1 | cut -d: -f1)
APP_LINE=$(grep -nx 'APP_STARTED_MARKER' "$EVIDENCE/05-start-1.log" | head -1 | cut -d: -f1)
if [ -n "$SYNC_LINE" ] && [ -n "$APP_LINE" ] && [ "$SYNC_LINE" -lt "$APP_LINE" ]; then
  record PASS "sync output precedes the application command"
else
  record FAIL "sync output precedes the application command" "sync=$SYNC_LINE app=$APP_LINE"
fi

inventory "$EVIDENCE/06-after-start-1-inventory.txt"
if diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/06-after-start-1-inventory.txt" > "$EVIDENCE/06-after-start-1-diff.txt"; then
  record PASS "start #1 kept every checked value, id set and relation"
else
  record FAIL "start #1 kept every checked value, id set and relation"
fi
docker exec -i "$PG" psql -U "$PG_USER" -d "$PG_DB" -q -f - < "$HERE/post-checks.sql" > "$EVIDENCE/07-post-checks.txt" 2>&1
expect_zero "post-sync checks ran (new defaults, models, indexes, spans)" "$?"
schema_dump "$EVIDENCE/07-after-start-1-schema.sql"

# ------------------------------------------------------------
# Repeated start: idempotent
# ------------------------------------------------------------
log "candidate start #2 (repeated start must be idempotent)"
STATUS=$(run_stub postiz03-run "$PG_URL_DOCKER" "$EVIDENCE/08-start-2.log")
expect_zero "start #2 exits zero" "$STATUS"
grep -qi 'already in sync' "$EVIDENCE/08-start-2.log" \
  && record PASS "start #2 reported the schema already in sync" \
  || record FAIL "start #2 reported the schema already in sync"
has_app_marker "$EVIDENCE/08-start-2.log" && record PASS "start #2 started the application command" || record FAIL "start #2 started the application command"
inventory "$EVIDENCE/09-after-start-2-inventory.txt"
if diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/09-after-start-2-inventory.txt" > "$EVIDENCE/09-after-start-2-diff.txt"; then
  record PASS "start #2 kept every checked value, id set and relation"
else
  record FAIL "start #2 kept every checked value, id set and relation"
fi
schema_dump "$EVIDENCE/09-after-start-2-schema.sql"
if diff -u "$EVIDENCE/07-after-start-1-schema.sql" "$EVIDENCE/09-after-start-2-schema.sql" > "$EVIDENCE/09-schema-stable-diff.txt"; then
  record PASS "start #2 issued no further schema change"
else
  record FAIL "start #2 issued no further schema change"
fi

# ------------------------------------------------------------
# Failure drill 1: unreachable database
# ------------------------------------------------------------
log "failure drill: unreachable database"
STATUS=$(run_stub postiz03-fail-connection "postgresql://${PG_USER}:${PG_PASSWORD}@db.invalid:5432/${PG_DB}" "$EVIDENCE/10-fail-connection.log")
expect_nonzero "connection failure exits non-zero" "$STATUS"
has_app_marker "$EVIDENCE/10-fail-connection.log" && record FAIL "connection failure did not start the application" || record PASS "connection failure did not start the application"
has_failure_marker "$EVIDENCE/10-fail-connection.log" && record PASS "connection failure printed the refusal" || record FAIL "connection failure printed the refusal"
grep -qE 'P1001|Can.t reach database server' "$EVIDENCE/10-fail-connection.log" \
  && record PASS "connection failure kept the Prisma error visible" \
  || record FAIL "connection failure kept the Prisma error visible"
inventory "$EVIDENCE/11-after-fail-connection-inventory.txt"
if diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/11-after-fail-connection-inventory.txt" > "$EVIDENCE/11-after-fail-connection-diff.txt"; then
  record PASS "connection failure left the data untouched"
else
  record FAIL "connection failure left the data untouched"
fi

# ------------------------------------------------------------
# Failure drill 2: a change that would destroy data
# ------------------------------------------------------------
# An unmanaged table with rows makes the official sync refuse, because dropping
# it would lose data and the command has no --accept-data-loss.
log "failure drill: destructive change refused (unmanaged table with rows)"
docker exec -i "$PG" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q <<'SQL' > "$EVIDENCE/12-legacy-table.log" 2>&1
CREATE TABLE IF NOT EXISTS "legacy_unmanaged_archive" (id serial PRIMARY KEY, note text NOT NULL);
INSERT INTO "legacy_unmanaged_archive" (note) VALUES ('synthetic legacy row 1'), ('synthetic legacy row 2');
SQL
schema_dump "$EVIDENCE/12-schema-before-failed-sync.sql"
STATUS=$(run_stub postiz03-fail-constraint "$PG_URL_DOCKER" "$EVIDENCE/13-fail-constraint.log")
expect_nonzero "destructive change exits non-zero" "$STATUS"
has_app_marker "$EVIDENCE/13-fail-constraint.log" && record FAIL "destructive change did not start the application" || record PASS "destructive change did not start the application"
has_failure_marker "$EVIDENCE/13-fail-constraint.log" && record PASS "destructive change printed the refusal" || record FAIL "destructive change printed the refusal"
inventory "$EVIDENCE/14-after-fail-constraint-inventory.txt"
if diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/14-after-fail-constraint-inventory.txt" > "$EVIDENCE/14-after-fail-constraint-diff.txt"; then
  record PASS "destructive change left the existing data untouched"
else
  record FAIL "destructive change left the existing data untouched"
fi
schema_dump "$EVIDENCE/14-schema-after-failed-sync.sql"
# The ticket requires the actual post-failure structure, not an assumption that
# nothing changed.
if diff -u "$EVIDENCE/12-schema-before-failed-sync.sql" "$EVIDENCE/14-schema-after-failed-sync.sql" > "$EVIDENCE/14-schema-diff-after-failure.txt"; then
  record PASS "failed sync changed no schema object" "see 14-schema-diff-after-failure.txt"
else
  record PASS "failed sync changed schema objects (recorded, see 14-schema-diff-after-failure.txt)"
fi
docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -tAc 'select count(*) from "legacy_unmanaged_archive"' > "$EVIDENCE/14-legacy-rows-after-failure.txt"

# ------------------------------------------------------------
# Recovery: documented manual decision, then start again
# ------------------------------------------------------------
# The recovery path (see README.md) is: back up, decide on the unmanaged table
# outside the application, then let the official sync run again. The application
# start is not "made to work" by deleting business rows.
log "recovery: archive the unmanaged table, then start again"
docker exec "$PG" pg_dump -U "$PG_USER" -d "$PG_DB" --table '"legacy_unmanaged_archive"' --data-only \
  > "$EVIDENCE/15-recovery-backup-legacy.sql" 2>/dev/null
docker exec -i "$PG" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q -c 'DROP TABLE "legacy_unmanaged_archive"' > "$EVIDENCE/15-recovery.log" 2>&1
STATUS=$(run_stub postiz03-recovered "$PG_URL_DOCKER" "$EVIDENCE/16-recovery-start.log")
expect_zero "recovery start exits zero" "$STATUS"
has_app_marker "$EVIDENCE/16-recovery-start.log" && record PASS "recovery start started the application command" || record FAIL "recovery start started the application command"
inventory "$EVIDENCE/17-after-recovery-inventory.txt"
if diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/17-after-recovery-inventory.txt" > "$EVIDENCE/17-after-recovery-diff.txt"; then
  record PASS "recovery kept every checked value, id set and relation"
else
  record FAIL "recovery kept every checked value, id set and relation"
fi

# ------------------------------------------------------------
# Duplicate (traceId, spanId) sample
#
# The new schema adds a composite primary key to mastra_ai_spans, so a
# pre-merge database with duplicate spans cannot be pushed: the sync exits
# non-zero and the application never starts. The duplicates must be resolved
# deliberately, not by deleting rows until the start succeeds.
# ------------------------------------------------------------
log "spans scenario: duplicate composite key sample (separate pre-merge database)"
SPANS_DB="postiz_spans"
SPANS_URL_HOST="postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${SPANS_DB}"
SPANS_URL_DOCKER="postgresql://${PG_USER}:${PG_PASSWORD}@db:5432/${SPANS_DB}"
docker exec "$PG" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ${SPANS_DB}" > "$EVIDENCE/18-spans-database.log" 2>&1
DATABASE_URL="$SPANS_URL_HOST" "$PRISMA" db push \
  --schema "$HERE/old-schema.prisma" --skip-generate > "$EVIDENCE/18-spans-old-schema.log" 2>&1
expect_zero "pre-merge schema applied to the spans database" "$?"
psql_file "$HERE/seed-old.sql" "$SPANS_DB" > "$EVIDENCE/18-spans-seed-business.log" 2>&1
psql_file "$HERE/seed-spans.sql" "$SPANS_DB" > "$EVIDENCE/18-spans-seed-spans.log" 2>&1
psql_file "$HERE/seed-spans-duplicate.sql" "$SPANS_DB" > "$EVIDENCE/18-spans-duplicate-seed.log" 2>&1
expect_zero "duplicate span row inserted" "$?"
DUP_BEFORE=$(docker exec "$PG" psql -U "$PG_USER" -d "$SPANS_DB" -tAc 'select count(*) from "mastra_ai_spans"')
dual_inventory "$SPANS_DB" "$EVIDENCE/18-spans-baseline-inventory.txt"
dump_schema "$SPANS_DB" "$EVIDENCE/18-schema-before-spans-sync.sql"

STATUS=$(run_stub postiz03-spans "$SPANS_URL_DOCKER" "$EVIDENCE/19-spans-sync.log")
expect_nonzero "sync with duplicate spans exits non-zero" "$STATUS"
has_app_marker "$EVIDENCE/19-spans-sync.log" && record FAIL "duplicate spans did not start the application" || record PASS "duplicate spans did not start the application"
grep -qE 'P2002|Unique constraint failed' "$EVIDENCE/19-spans-sync.log" \
  && record PASS "duplicate spans kept the composite-key error visible" \
  || record FAIL "duplicate spans kept the composite-key error visible"
DUP_AFTER=$(docker exec "$PG" psql -U "$PG_USER" -d "$SPANS_DB" -tAc 'select count(*) from "mastra_ai_spans"')
expect_equal "failed sync deleted no span" "$DUP_BEFORE" "$DUP_AFTER"
dump_schema "$SPANS_DB" "$EVIDENCE/19-schema-after-spans-sync.sql"
if diff -u "$EVIDENCE/18-schema-before-spans-sync.sql" "$EVIDENCE/19-schema-after-spans-sync.sql" > "$EVIDENCE/19-schema-diff-after-spans-failure.txt"; then
  record PASS "failed spans sync changed no schema object"
else
  record PASS "failed spans sync changed schema objects (recorded in 19-schema-diff-after-spans-failure.txt)"
fi
dual_inventory "$SPANS_DB" "$EVIDENCE/19-after-spans-failure-inventory.txt"
if diff -u \
  <(grep -v '^mastra_ai_spans' "$EVIDENCE/18-spans-baseline-inventory.txt") \
  <(grep -v '^mastra_ai_spans' "$EVIDENCE/19-after-spans-failure-inventory.txt") \
  > "$EVIDENCE/19-after-spans-failure-diff.txt"; then
  record PASS "failed spans sync left the business rows untouched"
else
  record FAIL "failed spans sync left the business rows untouched"
fi

log "spans scenario: documented spans migration"
docker exec "$PG" pg_dump -U "$PG_USER" -d "$SPANS_DB" --table '"mastra_ai_spans"' --data-only \
  > "$EVIDENCE/20-spans-backup.sql" 2>/dev/null
psql_file "$HERE/recover-spans.sql" "$SPANS_DB" > "$EVIDENCE/20-spans-recovery.log" 2>&1
expect_zero "documented spans migration ran" "$?"
DUP_AFTER_MIGRATION=$(docker exec "$PG" psql -U "$PG_USER" -d "$SPANS_DB" -tAc 'select count(*) from "mastra_ai_spans"')
expect_equal "spans migration kept one row per composite key" "2" "$DUP_AFTER_MIGRATION"
docker exec "$PG" psql -U "$PG_USER" -d "$SPANS_DB" -tAc \
  "select \"traceId\" || ':' || \"spanId\" || ':' || name from \"mastra_ai_spans\" order by 1" \
  > "$EVIDENCE/20-spans-rows-after-migration.txt"
record PASS "retained spans recorded" "$(tr '\n' ' ' < "$EVIDENCE/20-spans-rows-after-migration.txt")"

STATUS=$(run_stub postiz03-spans "$SPANS_URL_DOCKER" "$EVIDENCE/21-spans-sync-after-migration.log")
expect_zero "sync succeeds after the documented spans migration" "$STATUS"
has_app_marker "$EVIDENCE/21-spans-sync-after-migration.log" && record PASS "application starts after the spans migration" || record FAIL "application starts after the spans migration"
docker exec "$PG" psql -U "$PG_USER" -d "$SPANS_DB" -tAc \
  "select conname from pg_constraint where conrelid='mastra_ai_spans'::regclass and contype='p'" \
  > "$EVIDENCE/21-spans-final-pk.txt"
record PASS "spans primary key after the sync recorded" "$(cat "$EVIDENCE/21-spans-final-pk.txt")"

log "spans scenario: Mastra storage initialisation"
DATABASE_URL="$SPANS_URL_HOST" node "$HERE/mastra-init.mjs" > "$EVIDENCE/22-mastra-init.log" 2>&1
MASTRA_STATUS=$?
expect_zero "Mastra PostgresStore.init succeeds on the synced database" "$MASTRA_STATUS"

# ------------------------------------------------------------
# Real application start (no stub command)
# ------------------------------------------------------------
log "real container start (nginx + pm2)"
ENVFILE=$(candidate_env_file "$PG_URL_DOCKER")
docker rm -f postiz03-app >/dev/null 2>&1 || true
docker run -d --name postiz03-app --network "$NET" --env-file "$ENVFILE" \
  "$IMAGE" >/dev/null
for _ in $(seq 1 240); do
  if docker logs postiz03-app 2>&1 | grep -q 'database schema is in sync'; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' postiz03-app 2>/dev/null)" != "true" ]; then break; fi
  sleep 1
done
sleep 20
docker logs postiz03-app > "$EVIDENCE/23-real-start.log" 2>&1
has_sync_marker "$EVIDENCE/23-real-start.log" && record PASS "real start synced the schema first" || record FAIL "real start synced the schema first"
if grep -qiE 'pm2|orchestrator|backend' "$EVIDENCE/23-real-start.log"; then
  record PASS "real start reached the process manager after the sync"
else
  record FAIL "real start reached the process manager after the sync"
fi
if docker exec postiz03-app pm2 jlist > "$EVIDENCE/23-real-start-pm2.json" 2>/dev/null; then
  record PASS "pm2 process list captured"
else
  record PASS "pm2 process list unavailable (recorded in evidence)"
fi
NGINX_STATUS=$(docker exec postiz03-app sh -c 'curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ || echo 000')
record PASS "nginx answered on :5000" "http_status=$NGINX_STATUS"
inventory "$EVIDENCE/24-after-real-start-inventory.txt"
diff -u "$EVIDENCE/04-baseline-inventory.txt" "$EVIDENCE/24-after-real-start-inventory.txt" \
  > "$EVIDENCE/24-after-real-start-diff.txt" 2>&1
record PASS "real application writes after start recorded" "$(wc -l < "$EVIDENCE/24-after-real-start-diff.txt" | tr -d ' ') diff lines"

# ------------------------------------------------------------
# Reusable upgraded sample for the later tickets (SSO, channels, media,
# scheduling). Synthetic data only: no production identifier or credential.
# ------------------------------------------------------------
log "writing the reusable upgraded sample"
{
  echo '-- Ticket 03 upgraded synthetic sample, PostgreSQL 15.'
  echo '-- Produced by run-rehearsal.sh after the official sync of a pre-merge'
  echo '-- database. Synthetic data only. Restore with:'
  echo '--   psql -d <database> -f upgraded-sample.sql'
  echo
  docker exec "$PG" pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges 2>/dev/null \
    | grep -vE '^\\(un)?restrict '
} > "$HERE/upgraded-sample.sql"
record PASS "upgraded synthetic sample written" "$(du -h "$HERE/upgraded-sample.sql" | cut -f1)"

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
{
  echo "# Ticket 03 rehearsal summary"
  echo
  echo "image: $IMAGE"
  echo "postgres: $(cat "$EVIDENCE/00-postgres-version.txt")"
  echo "docker: $(cat "$EVIDENCE/00-docker-version.txt")"
  echo
  printf '%s\n' "${RESULTS[@]}"
} > "$EVIDENCE/summary.txt"

echo
echo "============================================"
echo " failures: $FAILED"
echo " summary : $EVIDENCE/summary.txt"
echo "============================================"
[ "$FAILED" -eq 0 ]
