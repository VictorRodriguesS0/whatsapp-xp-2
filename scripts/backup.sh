#!/bin/sh
set -eu

usage() {
  echo "Uso: $0 /caminho/absoluto/para/backups [--env-file /caminho/absoluto/.env] [--path-file /tmp/caminho]" >&2
  exit 64
}

[ "$#" -ge 1 ] || usage
OUTPUT_ROOT=$1
shift

PATH_FILE=
ENV_FILE=
PATH_FILE_SEEN=0
ENV_FILE_SEEN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path-file)
      [ "$#" -ge 2 ] || usage
      [ "$PATH_FILE_SEEN" -eq 0 ] || usage
      PATH_FILE_SEEN=1
      PATH_FILE=$2
      [ -n "$PATH_FILE" ] || usage
      shift 2
      ;;
    --env-file)
      [ "$#" -ge 2 ] || usage
      [ "$ENV_FILE_SEEN" -eq 0 ] || usage
      ENV_FILE_SEEN=1
      ENV_FILE=$2
      [ -n "$ENV_FILE" ] || usage
      shift 2
      ;;
    *) usage ;;
  esac
done

if [ "$PATH_FILE_SEEN" -eq 1 ]; then
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

if [ "$ENV_FILE_SEEN" -eq 1 ]; then
  case "$ENV_FILE" in
    /*) ;;
    *) echo 'O arquivo de ambiente deve usar caminho absoluto.' >&2; exit 64 ;;
  esac
  if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
    echo 'O arquivo de ambiente deve ser um arquivo regular existente e não pode ser symlink.' >&2
    exit 64
  fi
fi

case "$OUTPUT_ROOT" in
  /*) ;;
  *) echo 'O diretório de backup deve ser um caminho absoluto explícito.' >&2; exit 64 ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
. "$SCRIPT_DIR/docker-helper-lib.sh"

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
  if [ "$ENV_FILE_SEEN" -eq 1 ]; then
    docker compose --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --project-directory "$PROJECT_ROOT" -f "$COMPOSE_FILE" "$@"
  fi
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
  remove_active_docker_helper || true
}
trap cleanup EXIT HUP INT TERM

compose exec -T database sh -ceu '
  umask 077
  pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file="$1"
  pg_restore --list "$1" >/dev/null
' sh "$TEMP_DATABASE"
docker cp "$DATABASE_CONTAINER:$TEMP_DATABASE" "$BACKUP_DIR/database.dump"

create_owned_docker_helper media-backup \
  --mount type=volume,source=xp_whatsapp_media,target=/source,readonly \
  alpine:3.22 sh -ceu "umask 077; tar -C /source --exclude='./.staging' --exclude='./.recordings' --exclude='./.pdf-thumbnails' -czf /tmp/media.tar.gz ."
docker start -a "$DOCKER_HELPER_ID" >/dev/null
docker cp "$DOCKER_HELPER_ID:/tmp/media.tar.gz" "$BACKUP_DIR/media.tar.gz"
remove_active_docker_helper

create_owned_docker_helper media-validation alpine:3.22 sh /validator /tmp/media.tar.gz
docker cp "$SCRIPT_DIR/validate-media-archive.sh" "$DOCKER_HELPER_ID:/validator"
docker cp "$BACKUP_DIR/media.tar.gz" "$DOCKER_HELPER_ID:/tmp/media.tar.gz"
docker start -a "$DOCKER_HELPER_ID" >/dev/null
remove_active_docker_helper

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

if [ "$PATH_FILE_SEEN" -eq 1 ]; then
  printf '%s\n' "$BACKUP_DIR" > "$PATH_FILE"
  chmod 0600 "$PATH_FILE"
fi
echo "Backup validado em: $BACKUP_DIR"
