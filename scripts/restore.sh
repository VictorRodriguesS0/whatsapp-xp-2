#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
ARCHIVE_VALIDATOR="$SCRIPT_DIR/validate-media-archive.sh"
. "$SCRIPT_DIR/restore-lib.sh"

usage() {
  printf '%s\n' \
    'Uso:' \
    '  restore.sh --database /caminho/database.dump \' \
    '    --media /caminho/media.tar.gz \' \
    '    --pre-restore-backup-dir /caminho/para/backups \' \
    '    --confirm RESTORE-XP-WHATSAPP' \
    '' \
    'A aplicação deve estar parada. O banco deve permanecer em execução.' >&2
  exit 64
}

DATABASE_INPUT=
MEDIA_INPUT=
PRE_RESTORE_BACKUP_INPUT=
CONFIRMATION=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database) [ "$#" -ge 2 ] || usage; DATABASE_INPUT=$2; shift 2 ;;
    --media) [ "$#" -ge 2 ] || usage; MEDIA_INPUT=$2; shift 2 ;;
    --pre-restore-backup-dir) [ "$#" -ge 2 ] || usage; PRE_RESTORE_BACKUP_INPUT=$2; shift 2 ;;
    --confirm) [ "$#" -ge 2 ] || usage; CONFIRMATION=$2; shift 2 ;;
    *) usage ;;
  esac
done

[ "$CONFIRMATION" = 'RESTORE-XP-WHATSAPP' ] || {
  echo 'Confirmação inválida. Use exatamente --confirm RESTORE-XP-WHATSAPP.' >&2
  exit 64
}

for PATH_VALUE in "$DATABASE_INPUT" "$MEDIA_INPUT" "$PRE_RESTORE_BACKUP_INPUT"; do
  case "$PATH_VALUE" in
    /*) ;;
    *) echo 'Todos os caminhos devem ser absolutos e explícitos.' >&2; exit 64 ;;
  esac
done

DATABASE_BACKUP=$(canonical_existing_file "$DATABASE_INPUT") || {
  echo "Dump ausente ou caminho inválido: $DATABASE_INPUT" >&2
  exit 66
}
MEDIA_BACKUP=$(canonical_existing_file "$MEDIA_INPUT") || {
  echo "Arquivo de mídia ausente ou caminho inválido: $MEDIA_INPUT" >&2
  exit 66
}

mkdir -p -- "$PRE_RESTORE_BACKUP_INPUT"
PRE_RESTORE_BACKUP_ROOT=$(CDPATH= cd -- "$PRE_RESTORE_BACKUP_INPUT" && pwd -P)
case "$PRE_RESTORE_BACKUP_ROOT" in
  /|"$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    echo 'O backup preventivo deve ficar fora do deploy /opt/example-app.' >&2
    exit 64
    ;;
esac

verify_backup_bundle "$DATABASE_BACKUP" "$MEDIA_BACKUP" || {
  echo 'Bundle inválido: nomes, hashes, sidecars e manifest devem coincidir exatamente.' >&2
  exit 65
}

compose() {
  docker compose --project-directory "$PROJECT_ROOT" -f "$COMPOSE_FILE" "$@"
}

RUNNING_APP=$(compose ps --status running -q app)
if [ -n "$RUNNING_APP" ]; then
  echo 'Interrompa a aplicação antes do restore: docker compose stop app' >&2
  exit 69
fi

DATABASE_CONTAINER=$(compose ps -q database)
[ -n "$DATABASE_CONTAINER" ] || { echo 'O container database precisa estar em execução.' >&2; exit 69; }
[ "$(docker inspect --format '{{.Name}}' "$DATABASE_CONTAINER")" = '/xp-whatsapp-database' ] || {
  echo 'O container database não é o alvo xp-whatsapp esperado.' >&2
  exit 69
}
[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$DATABASE_CONTAINER")" = 'xp-whatsapp' ] || {
  echo 'O database não pertence ao workspace Compose xp-whatsapp.' >&2
  exit 69
}
[ "$(docker volume inspect --format '{{.Name}}' xp_whatsapp_media)" = 'xp_whatsapp_media' ] || {
  echo 'O volume de mídia não é o alvo xp_whatsapp_media.' >&2
  exit 69
}
[ "$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' xp_whatsapp_media)" = 'xp-whatsapp' ] || {
  echo 'O volume de mídia não pertence ao workspace Compose xp-whatsapp.' >&2
  exit 69
}

TEMP_DATABASE="/tmp/xp-whatsapp-restore-$$.dump"
BACKUP_PATH_FILE=$(mktemp "${TMPDIR:-/tmp}/xp-restore-backup-path.XXXXXX")
ACTIVE_HELPER=
MUTATION_STARTED=0
RESTORE_COMPLETE=0
PREVIOUS_DATABASE=
PREVIOUS_MEDIA=

cleanup_runtime() {
  if [ -n "$ACTIVE_HELPER" ]; then
    docker rm -f "$ACTIVE_HELPER" >/dev/null 2>&1 || true
    ACTIVE_HELPER=
  fi
  compose exec -T database rm -f -- "$TEMP_DATABASE" >/dev/null 2>&1 || true
  case "$BACKUP_PATH_FILE" in
    "${TMPDIR:-/tmp}"/xp-restore-backup-path.*) rm -f -- "$BACKUP_PATH_FILE" ;;
  esac
}

validate_media_archive() {
  archive_path=$1
  ACTIVE_HELPER="xp-whatsapp-media-validation-$$"
  docker create --name "$ACTIVE_HELPER" alpine:3.22 sh /validator /tmp/media.tar.gz >/dev/null
  docker cp "$ARCHIVE_VALIDATOR" "$ACTIVE_HELPER:/validator"
  docker cp "$archive_path" "$ACTIVE_HELPER:/tmp/media.tar.gz"
  validation_status=0
  docker start -a "$ACTIVE_HELPER" || validation_status=$?
  docker rm -f "$ACTIVE_HELPER" >/dev/null 2>&1 || true
  ACTIVE_HELPER=
  return "$validation_status"
}

restore_database_archive() {
  archive_path=$1
  docker cp "$archive_path" "$DATABASE_CONTAINER:$TEMP_DATABASE"
  compose exec -T database pg_restore --list "$TEMP_DATABASE" >/dev/null
  compose exec -T database sh -ceu '
    pg_restore \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges \
      --exit-on-error --single-transaction "$1"
  ' sh "$TEMP_DATABASE"
}

restore_media_archive() {
  archive_path=$1
  ACTIVE_HELPER="xp-whatsapp-media-restore-$$"
  docker create --name "$ACTIVE_HELPER" \
    --mount type=volume,source=xp_whatsapp_media,target=/target \
    alpine:3.22 sh -ceu '
      sh /validator /tmp/media.tar.gz
      find /target -mindepth 1 -depth -delete
      tar -C /target --no-same-owner -xzf /tmp/media.tar.gz
      find /target -exec chown 1001:1001 {} +
    ' >/dev/null
  docker cp "$ARCHIVE_VALIDATOR" "$ACTIVE_HELPER:/validator"
  docker cp "$archive_path" "$ACTIVE_HELPER:/tmp/media.tar.gz"
  restore_status=0
  docker start -a "$ACTIVE_HELPER" || restore_status=$?
  docker rm -f "$ACTIVE_HELPER" >/dev/null 2>&1 || true
  ACTIVE_HELPER=
  return "$restore_status"
}

on_exit() {
  original_status=$?
  trap - EXIT HUP INT TERM
  cleanup_runtime

  if [ "$original_status" -ne 0 ] && [ "$MUTATION_STARTED" -eq 1 ] && [ "$RESTORE_COMPLETE" -eq 0 ]; then
    echo 'Restore falhou após iniciar mutação; restaurando automaticamente o backup preventivo.' >&2
    rollback_database_status=0
    rollback_media_status=0
    restore_database_archive "$PREVIOUS_DATABASE" || rollback_database_status=$?
    restore_media_archive "$PREVIOUS_MEDIA" || rollback_media_status=$?
    cleanup_runtime

    if [ "$rollback_database_status" -eq 0 ] && [ "$rollback_media_status" -eq 0 ]; then
      echo 'Rollback automático concluído; o estado anterior foi restaurado e a aplicação continua parada.' >&2
    else
      echo "FALHA NO ROLLBACK AUTOMÁTICO. Preserve a aplicação parada e recupere manualmente: $(dirname -- "$PREVIOUS_DATABASE")" >&2
    fi
  fi

  exit "$original_status"
}
trap on_exit EXIT
trap 'exit 130' HUP INT TERM

echo 'Validando integralmente o arquivo de mídia antes do backup preventivo...'
validate_media_archive "$MEDIA_BACKUP"

echo 'Criando backup preventivo do estado atual antes do restore...'
"$SCRIPT_DIR/backup.sh" "$PRE_RESTORE_BACKUP_ROOT" --path-file "$BACKUP_PATH_FILE"
PREVIOUS_BACKUP_DIRECTORY=$(sed -n '1p' "$BACKUP_PATH_FILE")
[ "$(wc -l < "$BACKUP_PATH_FILE" | tr -d ' ')" = '1' ] || {
  echo 'O backup preventivo não retornou um caminho único.' >&2
  exit 65
}
PREVIOUS_DATABASE=$(canonical_existing_file "$PREVIOUS_BACKUP_DIRECTORY/database.dump") || exit 65
PREVIOUS_MEDIA=$(canonical_existing_file "$PREVIOUS_BACKUP_DIRECTORY/media.tar.gz") || exit 65
verify_backup_bundle "$PREVIOUS_DATABASE" "$PREVIOUS_MEDIA" || {
  echo 'O backup preventivo falhou na validação estrita.' >&2
  exit 65
}
validate_media_archive "$PREVIOUS_MEDIA"

MUTATION_STARTED=1
echo 'Restaurando PostgreSQL em transação única. Não inicie a aplicação.'
restore_database_archive "$DATABASE_BACKUP"

echo 'Restaurando o volume de mídia após nova validação integral.'
restore_media_archive "$MEDIA_BACKUP"

RESTORE_COMPLETE=1
cleanup_runtime
trap - EXIT HUP INT TERM

echo 'Restore concluído com a aplicação ainda parada.'
echo 'Valide o healthcheck e então execute manualmente: docker compose up -d app'
