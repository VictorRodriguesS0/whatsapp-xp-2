#!/bin/sh
set -eu

if [ "$#" -ne 1 ] && { [ "$#" -ne 3 ] || [ "$2" != '--path-file' ]; }; then
  echo "Uso: $0 /caminho/absoluto/para/backups [--path-file /tmp/caminho]" >&2
  exit 64
fi

PATH_FILE=
if [ "$#" -eq 3 ]; then
  PATH_FILE=$3
  case "$PATH_FILE" in
    /*) ;;
    *) echo 'O arquivo de retorno deve usar caminho absoluto.' >&2; exit 64 ;;
  esac
  PATH_FILE_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$PATH_FILE")" 2>/dev/null && pwd -P) || {
    echo 'O diretório do arquivo de retorno não existe.' >&2
    exit 64
  }
  TEMP_DIRECTORY=$(CDPATH= cd -- "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P) || exit 64
  case "$(basename -- "$PATH_FILE")" in
    xp-restore-backup-path.*) ;;
    *) echo 'O arquivo de retorno é reservado ao restore interno.' >&2; exit 64 ;;
  esac
  if [ "$PATH_FILE_DIRECTORY" != "$TEMP_DIRECTORY" ] || [ ! -f "$PATH_FILE" ] || [ -L "$PATH_FILE" ]; then
    echo 'O arquivo de retorno deve ser um arquivo temporário regular criado pelo restore.' >&2
    exit 64
  fi
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
MEDIA_HELPER="xp-whatsapp-media-backup-$$"
cleanup() {
  compose exec -T database rm -f -- "$TEMP_DATABASE" >/dev/null 2>&1 || true
  docker rm -f "$MEDIA_HELPER" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

compose exec -T database sh -ceu '
  umask 077
  pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file="$1"
  pg_restore --list "$1" >/dev/null
' sh "$TEMP_DATABASE"
docker cp "$DATABASE_CONTAINER:$TEMP_DATABASE" "$BACKUP_DIR/database.dump"

docker create --name "$MEDIA_HELPER" \
  --mount type=volume,source=xp_whatsapp_media,target=/source,readonly \
  alpine:3.22 sh -ceu 'umask 077; tar -C /source -czf /tmp/media.tar.gz .' >/dev/null
docker start -a "$MEDIA_HELPER" >/dev/null
docker cp "$MEDIA_HELPER:/tmp/media.tar.gz" "$BACKUP_DIR/media.tar.gz"
docker rm -f "$MEDIA_HELPER" >/dev/null
docker create --name "$MEDIA_HELPER" alpine:3.22 sh /validator /tmp/media.tar.gz >/dev/null
docker cp "$SCRIPT_DIR/validate-media-archive.sh" "$MEDIA_HELPER:/validator"
docker cp "$BACKUP_DIR/media.tar.gz" "$MEDIA_HELPER:/tmp/media.tar.gz"
docker start -a "$MEDIA_HELPER" >/dev/null
docker rm -f "$MEDIA_HELPER" >/dev/null

[ -s "$BACKUP_DIR/database.dump" ]
[ -s "$BACKUP_DIR/media.tar.gz" ]

DATABASE_HASH=$(sha256sum "$BACKUP_DIR/database.dump" | awk '{print $1}')
MEDIA_HASH=$(sha256sum "$BACKUP_DIR/media.tar.gz" | awk '{print $1}')
printf '%s  %s\n' "$DATABASE_HASH" 'database.dump' > "$BACKUP_DIR/database.dump.sha256"
printf '%s  %s\n' "$MEDIA_HASH" 'media.tar.gz' > "$BACKUP_DIR/media.tar.gz.sha256"

printf '%s\n' \
  'format=xp-whatsapp-backup-v1' \
  'application=xp-whatsapp' \
  "created_at_utc=$TIMESTAMP" \
  'database_container=xp-whatsapp-database' \
  'database_format=postgresql-custom' \
  'media_volume=xp_whatsapp_media' \
  'database_file=database.dump' \
  "database_sha256=$DATABASE_HASH" \
  'media_file=media.tar.gz' \
  "media_sha256=$MEDIA_HASH" \
  > "$BACKUP_DIR/manifest.txt"

chmod 0600 \
  "$BACKUP_DIR/database.dump" \
  "$BACKUP_DIR/database.dump.sha256" \
  "$BACKUP_DIR/media.tar.gz" \
  "$BACKUP_DIR/media.tar.gz.sha256" \
  "$BACKUP_DIR/manifest.txt"
trap - EXIT HUP INT TERM
cleanup

if [ -n "$PATH_FILE" ]; then
  printf '%s\n' "$BACKUP_DIR" > "$PATH_FILE"
  chmod 0600 "$PATH_FILE"
fi
echo "Backup validado em: $BACKUP_DIR"
