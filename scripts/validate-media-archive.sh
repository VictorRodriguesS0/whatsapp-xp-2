#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo 'Uso: validate-media-archive.sh /caminho/media.tar.gz' >&2
  exit 64
fi

ARCHIVE_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd -P)
ARCHIVE="$ARCHIVE_DIRECTORY/$(basename -- "$1")"
VALIDATION_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xp-media-validation.XXXXXX")

cleanup() {
  case "$VALIDATION_ROOT" in
    "${TMPDIR:-/tmp}"/xp-media-validation.*) rm -rf -- "$VALIDATION_ROOT" ;;
    *) echo "Recusando limpeza de caminho temporário inesperado: $VALIDATION_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

gzip -t "$ARCHIVE"
tar -tzf "$ARCHIVE" > "$VALIDATION_ROOT/names"
tar -tvzf "$ARCHIVE" > "$VALIDATION_ROOT/verbose"

awk '
  $0 == "." || $0 == "./" { next }
  $0 !~ /^\.\/[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\/?$/ { exit 1 }
' "$VALIDATION_ROOT/names"

if sort "$VALIDATION_ROOT/names" | uniq -d | grep -q .; then
  echo 'Archive contém caminhos duplicados.' >&2
  exit 1
fi

awk '
  substr($0, 1, 1) != "d" && substr($0, 1, 1) != "-" { exit 1 }
' "$VALIDATION_ROOT/verbose"

mkdir -m 0700 "$VALIDATION_ROOT/extracted"
tar -C "$VALIDATION_ROOT/extracted" --no-same-owner -xzf "$ARCHIVE"
if find "$VALIDATION_ROOT/extracted" ! -type d ! -type f -print -quit | grep -q .; then
  echo 'Archive extraiu entrada que não é arquivo regular ou diretório.' >&2
  exit 1
fi

echo 'Media archive validated.'
