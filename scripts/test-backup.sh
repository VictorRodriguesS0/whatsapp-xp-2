#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xp-backup-tests.XXXXXX")

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/xp-backup-tests.*) rm -rf -- "$TEST_ROOT" ;;
    *) echo "Recusando limpeza de caminho temporário inesperado: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

expect_failure() {
  description=$1
  shift
  if "$@" >"$TEST_ROOT/command-output" 2>&1; then
    fail "$description"
  fi
}

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/env files" "$TEST_ROOT/out with spaces"
cat > "$TEST_ROOT/bin/docker" <<'DOCKER'
#!/bin/sh
printf '%s\n' "$@" > "$DOCKER_ARGS"
exit 0
DOCKER
chmod 0700 "$TEST_ROOT/bin/docker"
cat > "$TEST_ROOT/bin/mkdir" <<'MKDIR'
#!/bin/sh
if [ "${1:-}" = '-m' ]; then
  shift 2
fi
exec /usr/bin/mkdir "$@"
MKDIR
chmod 0700 "$TEST_ROOT/bin/mkdir"
printf '%s\n' 'SECRET_VALUE=never-print-this-secret' > "$TEST_ROOT/env files/canonical.env"
printf '%s\n' 'restore-path-placeholder' > "$TEST_ROOT/xp-restore-backup-path.XXXXXX"

run_backup() {
  DOCKER_ARGS="$TEST_ROOT/docker-args" \
  TMPDIR="$TEST_ROOT" \
  PATH="$TEST_ROOT/bin:$PATH" \
    "$BACKUP_SCRIPT" "$@" >"$TEST_ROOT/command-output" 2>&1
}

# The parser must accept the legacy path-file flag together with --env-file,
# regardless of input order, and always put Compose global options before ps.
run_backup "$TEST_ROOT/out with spaces" \
  --path-file "$TEST_ROOT/xp-restore-backup-path.XXXXXX" \
  --env-file "$TEST_ROOT/env files/canonical.env" || backup_status=$?
if [ "${backup_status:-0}" -ne 69 ]; then
  cat "$TEST_ROOT/command-output" >&2
  fail "backup com env-file deveria alcançar Compose e parar sem database, saiu ${backup_status:-0}"
fi

EXPECTED_ARGS=$(cat <<EOF
compose
--project-directory
$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
--env-file
$TEST_ROOT/env files/canonical.env
-f
$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)/docker-compose.yml
ps
-q
database
EOF
)
ACTUAL_ARGS=$(cat "$TEST_ROOT/docker-args")
[ "$ACTUAL_ARGS" = "$EXPECTED_ARGS" ] || fail 'Compose não recebeu --env-file como opção global em ordem determinística'
if grep -F 'never-print-this-secret' "$TEST_ROOT/command-output" >/dev/null; then
  fail 'backup imprimiu o conteúdo do arquivo de ambiente'
fi

# The historical one-argument call remains usable without an env-file.
unset backup_status
run_backup "$TEST_ROOT/one-argument-output" || backup_status=$?
[ "${backup_status:-0}" -eq 69 ] || fail "backup de um argumento deveria alcançar Compose e parar sem database, saiu ${backup_status:-0}"
if grep -Fx -- '--env-file' "$TEST_ROOT/docker-args" >/dev/null; then
  fail 'backup de um argumento adicionou --env-file sem solicitação'
fi

# The old --path-file form remains valid and must not synthesize --env-file.
unset backup_status
run_backup "$TEST_ROOT/legacy-output" --path-file "$TEST_ROOT/xp-restore-backup-path.XXXXXX" || backup_status=$?
[ "${backup_status:-0}" -eq 69 ] || fail "backup legado deveria alcançar Compose e parar sem database, saiu ${backup_status:-0}"
if grep -Fx -- '--env-file' "$TEST_ROOT/docker-args" >/dev/null; then
  fail 'backup legado adicionou --env-file sem solicitação'
fi

expect_failure 'backup aceitou env-file relativo' \
  env DOCKER_ARGS="$TEST_ROOT/docker-args" TMPDIR="$TEST_ROOT" PATH="$TEST_ROOT/bin:$PATH" \
  "$BACKUP_SCRIPT" "$TEST_ROOT/relative-output" --env-file relative.env
grep -F 'caminho absoluto' "$TEST_ROOT/command-output" >/dev/null || fail 'rejeição de env-file relativo não explicou o requisito absoluto'

expect_failure 'backup aceitou env-file ausente' \
  env DOCKER_ARGS="$TEST_ROOT/docker-args" TMPDIR="$TEST_ROOT" PATH="$TEST_ROOT/bin:$PATH" \
  "$BACKUP_SCRIPT" "$TEST_ROOT/missing-output" --env-file "$TEST_ROOT/missing.env"
grep -F 'arquivo regular existente' "$TEST_ROOT/command-output" >/dev/null || fail 'rejeição de env-file ausente não falhou fechada'

ln -s "$TEST_ROOT/env files/canonical.env" "$TEST_ROOT/env-link"
if [ -L "$TEST_ROOT/env-link" ]; then
  expect_failure 'backup aceitou env-file symlink' \
    env DOCKER_ARGS="$TEST_ROOT/docker-args" TMPDIR="$TEST_ROOT" PATH="$TEST_ROOT/bin:$PATH" \
    "$BACKUP_SCRIPT" "$TEST_ROOT/symlink-output" --env-file "$TEST_ROOT/env-link"
  grep -F 'arquivo regular existente' "$TEST_ROOT/command-output" >/dev/null || fail 'rejeição de env-file symlink não falhou fechada'
else
  echo 'SKIP: filesystem de teste não permite criar symlink; a asserção roda em POSIX com symlink.' >&2
fi

echo 'Backup parser tests passed.'
