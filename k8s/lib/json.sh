#!/usr/bin/env bash
# ============================================================
# Shared JSON helpers for the k8s build scripts.
#
# Sourced by prepare-build-context.sh (manifest) and build-local.sh
# (provenance), so both emit the same escaping for values interpolated
# into hand-written JSON.
# ============================================================

# Escape one string for a double-quoted JSON scalar.
# Backslash first, then the quote and the control characters that would
# otherwise produce invalid JSON.
json_escape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\t'/\\t}
  value=${value//$'\r'/\\r}
  printf '%s' "$value"
}
