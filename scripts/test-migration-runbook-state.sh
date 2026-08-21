#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
STATE_LIBRARY="$SCRIPT_DIR/migration-runbook-state.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

[ -f "$STATE_LIBRARY" ] || fail 'migration-runbook-state.sh ausente'
. "$STATE_LIBRARY"

expect_state() {
  expected=$1
  applied=$2
  failed=$3
  rolled_back=$4
  actual=$(migration_recovery_state "$applied" "$failed" "$rolled_back") || fail "estado $applied/$failed/$rolled_back foi recusado"
  [ "$actual" = "$expected" ] || fail "estado $applied/$failed/$rolled_back retornou $actual, esperado $expected"
}

expect_failure() {
  if migration_recovery_state "$@" >/dev/null 2>&1; then
    fail "estado inválido foi aceito: $*"
  fi
}

expect_state initial-server-only 1 0 0
expect_state initial-failed 0 1 0
expect_state retry-not-applied 0 0 1
expect_state retry-server-only 1 0 1
expect_state retry-failed 0 1 1
expect_failure 1 0 2
expect_failure 0 2 0
expect_failure 0 2 1
expect_failure 0 1 2
expect_failure 1 0 not-a-count
expect_failure 0 0 0

echo 'Migration runbook state tests passed.'
