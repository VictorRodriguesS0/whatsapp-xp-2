#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Uso: $0 /caminho/absoluto/para/backups" >&2
  exit 64
fi

case "$1" in
  /*) ;;
  *) echo 'O diretório de backup deve ser um caminho absoluto explícito.' >&2; exit 64 ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
OUTPUT_ROOT=$1

mkdir -p -- "$OUTPUT_ROOT"
OUTPUT_ROOT=$(CDPATH= cd -- "$OUTPUT_ROOT" && pwd -P)

case "$OUTPUT_ROOT" in
  /|"$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    echo 'Use um diretório de backup dedicado fora do deploy /opt/example-app.' >&2
    exit 64
    ;;
esac

TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_DIR="$OUTPUT_ROOT/xp-whatsapp-$TIMESTAMP"
if [ -e "$BACKUP_DIR" ]; then
  echo "O diretório de backup já existe: $BACKUP_DIR" >&2
  exit 73
fi
mkdir -m 0700 -- "$BACKUP_DIR"

compose() {
  docker compose --project-directory "$PROJECT_ROOT" -f "$COMPOSE_FILE" "$@"
}

DATABASE_CONTAINER=$(compose ps -q database)
if [ -z "$DATABASE_CONTAINER" ]; then
  echo 'O container database precisa estar em execução.' >&2
  exit 69
fi

DATABASE_NAME=$(docker inspect --format '{{.Name}}' "$DATABASE_CONTAINER")
if [ "$DATABASE_NAME" != '/xp-whatsapp-database' ]; then
  echo "Container database inesperado: $DATABASE_NAME" >&2
  exit 69
fi

MEDIA_VOLUME=$(docker volume inspect --format '{{.Name}}' xp_whatsapp_media)
if [ "$MEDIA_VOLUME" != 'xp_whatsapp_media' ]; then
  echo 'O volume xp_whatsapp_media não pertence ao alvo esperado.' >&2
  exit 69
fi
MEDIA_PROJECT=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' xp_whatsapp_media)
if [ "$MEDIA_PROJECT" != 'xp-whatsapp' ]; then
  echo 'O volume xp_whatsapp_media não pertence ao workspace Compose xp-whatsapp.' >&2
  exit 69
fi

TEMP_DATABASE="/tmp/xp-whatsapp-backup-${TIMESTAMP}-$$.dump"
cleanup() {
  compose exec -T database rm -f -- "$TEMP_DATABASE" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

compose exec -T database sh -ceu '
  umask 077
  pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file="$1"
  pg_restore --list "$1" >/dev/null
' sh "$TEMP_DATABASE"
docker cp "$DATABASE_CONTAINER:$TEMP_DATABASE" "$BACKUP_DIR/database.dump"

docker run --rm \
  --mount type=volume,source=xp_whatsapp_media,target=/source,readonly \
  --mount "type=bind,source=$BACKUP_DIR,target=/backup" \
  alpine:3.22 sh -ceu 'umask 077; tar -C /source -czf /backup/media.tar.gz .'

docker run --rm \
  --mount "type=bind,source=$BACKUP_DIR,target=/backup,readonly" \
  alpine:3.22 sh -ceu 'test -s /backup/database.dump; test -s /backup/media.tar.gz; tar -tzf /backup/media.tar.gz >/dev/null'

(cd "$BACKUP_DIR" && sha256sum database.dump > database.dump.sha256)
(cd "$BACKUP_DIR" && sha256sum media.tar.gz > media.tar.gz.sha256)

printf '%s\n' \
  'application=xp-whatsapp' \
  "created_at_utc=$TIMESTAMP" \
  'database_container=xp-whatsapp-database' \
  'database_format=postgresql-custom' \
  'media_volume=xp_whatsapp_media' \
  > "$BACKUP_DIR/manifest.txt"

chmod 0600 \
  "$BACKUP_DIR/database.dump" \
  "$BACKUP_DIR/database.dump.sha256" \
  "$BACKUP_DIR/media.tar.gz" \
  "$BACKUP_DIR/media.tar.gz.sha256" \
  "$BACKUP_DIR/manifest.txt"
trap - EXIT HUP INT TERM
cleanup

echo "Backup validado em: $BACKUP_DIR"
