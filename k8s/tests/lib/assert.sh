#!/usr/bin/env bash
# ============================================================
# Shared assertion helpers for offline shell contract suites under k8s/tests/.
# ============================================================

PASS=0
FAIL=0
FAILED_NAMES=()

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

no() {
  FAIL=$((FAIL + 1))
  FAILED_NAMES+=("$1")
  printf '  FAIL %s\n' "$1"
}

assert_eq() {
  if [ "$2" = "$3" ]; then
    ok "$1"
  else
    no "$1 (expected [$3], got [$2])"
  fi
}

assert_file() {
  if [ -f "$1" ]; then
    ok "$2"
  else
    no "$2 (missing $1)"
  fi
}

assert_contains() { # description file needle
  if [ -f "$2" ] && grep -qF -- "$3" "$2"; then
    ok "$1"
  else
    no "$1 (missing [$3] in $2)"
  fi
}

assert_not_contains() { # description file needle
  if [ -f "$2" ] && grep -qF -- "$3" "$2"; then
    no "$1 (unexpected [$3] in $2)"
  else
    ok "$1"
  fi
}

assert_regex() { # description file pattern
  if [ -f "$2" ] && grep -qE -- "$3" "$2"; then
    ok "$1"
  else
    no "$1 (pattern [$3] not matched in $2)"
  fi
}

assert_not_regex() { # description file pattern
  if [ -f "$2" ] && grep -qE -- "$3" "$2"; then
    no "$1 (unexpected pattern [$3] matched in $2)"
  else
    ok "$1"
  fi
}

report_and_exit() {
  local suite_name="$1"
  echo ""
  echo "${suite_name}: $PASS passed, $FAIL failed"
  if [ "$FAIL" -ne 0 ]; then
    printf 'failed: %s\n' "${FAILED_NAMES[@]}"
    exit 1
  fi
}
