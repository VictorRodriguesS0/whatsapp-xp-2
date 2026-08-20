#!/bin/sh
set -eu

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

DATABASE_BACKUP=
MEDIA_BACKUP=
PRE_RESTORE_BACKUP_ROOT=
CONFIRMATION=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database) [ "$#" -ge 2 ] || usage; DATABASE_BACKUP=$2; shift 2 ;;
    --media) [ "$#" -ge 2 ] || usage; MEDIA_BACKUP=$2; shift 2 ;;
    --pre-restore-backup-dir) [ "$#" -ge 2 ] || usage; PRE_RESTORE_BACKUP_ROOT=$2; shift 2 ;;
    --confirm) [ "$#" -ge 2 ] || usage; CONFIRMATION=$2; shift 2 ;;
    *) usage ;;
  esac
done

[ "$CONFIRMATION" = 'RESTORE-XP-WHATSAPP' ] || {
  echo 'Confirmação inválida. Use exatamente --confirm RESTORE-XP-WHATSAPP.' >&2
  exit 64
}

for PATH_VALUE in "$DATABASE_BACKUP" "$MEDIA_BACKUP" "$PRE_RESTORE_BACKUP_ROOT"; do
  case "$PATH_VALUE" in
    /*) ;;
    *) echo 'Todos os caminhos devem ser absolutos e explícitos.' >&2; exit 64 ;;
  esac
done

[ -f "$DATABASE_BACKUP" ] || { echo "Dump ausente: $DATABASE_BACKUP" >&2; exit 66; }
[ -f "$MEDIA_BACKUP" ] || { echo "Arquivo de mídia ausente: $MEDIA_BACKUP" >&2; exit 66; }
[ -f "$DATABASE_BACKUP.sha256" ] || { echo "Checksum ausente: $DATABASE_BACKUP.sha256" >&2; exit 66; }
[ -f "$MEDIA_BACKUP.sha256" ] || { echo "Checksum ausente: $MEDIA_BACKUP.sha256" >&2; exit 66; }

DATABASE_BACKUP=$(readlink -f -- "$DATABASE_BACKUP")
MEDIA_BACKUP=$(readlink -f -- "$MEDIA_BACKUP")
PRE_RESTORE_BACKUP_ROOT=$(readlink -m -- "$PRE_RESTORE_BACKUP_ROOT")
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"

case "$PRE_RESTORE_BACKUP_ROOT" in
  /|"$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    echo 'O backup preventivo deve ficar fora do deploy /opt/example-app.' >&2
    exit 64
    ;;
esac

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

[ "$(docker volume inspect --format '{{.Name}}' xp_whatsapp_media)" = 'xp_whatsapp_media' ] || {
  echo 'O volume de mídia não é o alvo xp_whatsapp_media.' >&2
  exit 69
}
[ "$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' xp_whatsapp_media)" = 'xp-whatsapp' ] || {
  echo 'O volume de mídia não pertence ao workspace Compose xp-whatsapp.' >&2
  exit 69
}

(cd "$(dirname -- "$DATABASE_BACKUP")" && sha256sum -c "$(basename -- "$DATABASE_BACKUP").sha256")
(cd "$(dirname -- "$MEDIA_BACKUP")" && sha256sum -c "$(basename -- "$MEDIA_BACKUP").sha256")

MEDIA_DIRECTORY=$(dirname -- "$MEDIA_BACKUP")
MEDIA_FILENAME=$(basename -- "$MEDIA_BACKUP")
docker run --rm \
  --mount "type=bind,source=$MEDIA_DIRECTORY,target=/restore,readonly" \
  alpine:3.22 sh -ceu '
    archive=$1
    tar -tzf "/restore/$archive" | awk '\''
      /^\// || /^\.\.($|\/)/ || /\/\.\.($|\/)/ { bad=1 }
      END { exit bad }
    '\''
  ' sh "$MEDIA_FILENAME"

TEMP_DATABASE="/tmp/xp-whatsapp-restore-$$.dump"
cleanup() {
  compose exec -T database rm -f -- "$TEMP_DATABASE" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker cp "$DATABASE_BACKUP" "$DATABASE_CONTAINER:$TEMP_DATABASE"
compose exec -T database pg_restore --list "$TEMP_DATABASE" >/dev/null

echo 'Criando backup preventivo do estado atual antes do restore...'
"$SCRIPT_DIR/backup.sh" "$PRE_RESTORE_BACKUP_ROOT"

echo 'Restaurando PostgreSQL. Não inicie a aplicação durante esta etapa.'
compose exec -T database sh -ceu '
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --clean --if-exists --no-owner --no-privileges \
    --exit-on-error --single-transaction "$1"
' sh "$TEMP_DATABASE"

echo 'Restaurando o volume de mídia validado...'
docker run --rm \
  --mount type=volume,source=xp_whatsapp_media,target=/target \
  --mount "type=bind,source=$MEDIA_DIRECTORY,target=/restore,readonly" \
  alpine:3.22 sh -ceu '
    archive=$1
    find /target -mindepth 1 -depth -delete
    tar -C /target -xzf "/restore/$archive"
  ' sh "$MEDIA_FILENAME"

trap - EXIT HUP INT TERM
cleanup

echo 'Restore concluído com a aplicação ainda parada.'
echo 'Valide o healthcheck e então execute: docker compose up -d app'
