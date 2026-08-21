#!/bin/sh
set -eu

migration_recovery_state() {
  [ "$#" -eq 3 ] || return 64

  for migration_count in "$1" "$2" "$3"; do
    case "$migration_count" in ''|*[!0-9]*) return 65 ;; esac
  done

  case "$1:$2:$3" in
    1:0:0) printf '%s\n' 'initial-server-only' ;;
    0:1:0) printf '%s\n' 'initial-failed' ;;
    0:0:1) printf '%s\n' 'retry-not-applied' ;;
    1:0:1) printf '%s\n' 'retry-server-only' ;;
    0:1:1) printf '%s\n' 'retry-failed' ;;
    *) return 65 ;;
  esac
}
