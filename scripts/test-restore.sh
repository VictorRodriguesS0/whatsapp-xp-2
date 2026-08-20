#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
RESTORE_LIB="$SCRIPT_DIR/restore-lib.sh"
ARCHIVE_VALIDATOR="$SCRIPT_DIR/validate-media-archive.sh"

[ -f "$RESTORE_LIB" ] || {
  echo 'RED: restore-lib.sh com validadores estritos ainda não existe.' >&2
  exit 1
}
. "$RESTORE_LIB"

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/xp-restore-tests.XXXXXX")
cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/xp-restore-tests.*) rm -rf -- "$TEST_ROOT" ;;
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
  if "$@" >/dev/null 2>&1; then
    fail "$description"
  fi
}

expect_failure 'backup.sh aceitou path-file arbitrário' \
  "$SCRIPT_DIR/backup.sh" "$TEST_ROOT/output" --path-file "$TEST_ROOT/arbitrary"

printf '%s' 'database-content' > "$TEST_ROOT/database.dump"
printf '%s' 'media-content' > "$TEST_ROOT/media.tar.gz"
DATABASE_HASH=$(sha256sum "$TEST_ROOT/database.dump" | awk '{print $1}')
MEDIA_HASH=$(sha256sum "$TEST_ROOT/media.tar.gz" | awk '{print $1}')
printf '%s  %s\n' "$DATABASE_HASH" 'database.dump' > "$TEST_ROOT/database.dump.sha256"
printf '%s  %s\n' "$MEDIA_HASH" 'media.tar.gz' > "$TEST_ROOT/media.tar.gz.sha256"

write_manifest() {
  database_file=$1
  media_file=$2
  printf '%s\n' \
    'format=xp-whatsapp-backup-v1' \
    'application=xp-whatsapp' \
    'created_at_utc=20260820T000000Z' \
    'database_container=xp-whatsapp-database' \
    'database_format=postgresql-custom' \
    'media_volume=xp_whatsapp_media' \
    "database_file=$database_file" \
    "database_sha256=$DATABASE_HASH" \
    "media_file=$media_file" \
    "media_sha256=$MEDIA_HASH" \
    > "$TEST_ROOT/manifest.txt"
}

write_manifest database.dump media.tar.gz
verify_backup_bundle "$TEST_ROOT/database.dump" "$TEST_ROOT/media.tar.gz"

printf '%s' 'other-content' > "$TEST_ROOT/other.dump"
OTHER_HASH=$(sha256sum "$TEST_ROOT/other.dump" | awk '{print $1}')
printf '%s  %s\n' "$OTHER_HASH" 'other.dump' > "$TEST_ROOT/database.dump.sha256"
expect_failure 'checksum que referencia outro basename foi aceito' \
  verify_backup_bundle "$TEST_ROOT/database.dump" "$TEST_ROOT/media.tar.gz"

printf '%s  %s\n' "$DATABASE_HASH" 'database.dump' > "$TEST_ROOT/database.dump.sha256"
write_manifest other.dump media.tar.gz
expect_failure 'manifest que referencia outro dump foi aceito' \
  verify_backup_bundle "$TEST_ROOT/database.dump" "$TEST_ROOT/media.tar.gz"
write_manifest database.dump media.tar.gz

[ -x "$ARCHIVE_VALIDATOR" ] || fail 'validate-media-archive.sh não existe ou não é executável'

mkdir -p "$TEST_ROOT/archive-good/safe"
printf '%s' 'safe' > "$TEST_ROOT/archive-good/safe/file.txt"
tar -C "$TEST_ROOT/archive-good" -czf "$TEST_ROOT/good.tar.gz" .
"$ARCHIVE_VALIDATOR" "$TEST_ROOT/good.tar.gz"

mkdir -p "$TEST_ROOT/archive-link"
ln -s /etc/passwd "$TEST_ROOT/archive-link/link"
tar -C "$TEST_ROOT/archive-link" -czf "$TEST_ROOT/symlink.tar.gz" .
expect_failure 'arquivo com symlink foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/symlink.tar.gz"

mkdir -p "$TEST_ROOT/archive-hardlink"
printf '%s' 'hard' > "$TEST_ROOT/archive-hardlink/original"
ln "$TEST_ROOT/archive-hardlink/original" "$TEST_ROOT/archive-hardlink/linked"
tar -C "$TEST_ROOT/archive-hardlink" -czf "$TEST_ROOT/hardlink.tar.gz" .
expect_failure 'arquivo com hardlink foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/hardlink.tar.gz"

tar -C "$TEST_ROOT/archive-good" --transform='s|^\./safe|../escape|' -czf "$TEST_ROOT/traversal.tar.gz" .
expect_failure 'arquivo com traversal foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/traversal.tar.gz"

tar -C "$TEST_ROOT/archive-good" --transform='s|^\./safe|/absolute|' -czf "$TEST_ROOT/absolute.tar.gz" .
expect_failure 'arquivo com caminho absoluto foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/absolute.tar.gz"

mkdir -p "$TEST_ROOT/archive-device"
if mknod "$TEST_ROOT/archive-device/device" c 1 3 2>/dev/null; then
  tar -C "$TEST_ROOT/archive-device" -czf "$TEST_ROOT/device.tar.gz" .
  expect_failure 'arquivo com device foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/device.tar.gz"
fi

cp "$TEST_ROOT/good.tar.gz" "$TEST_ROOT/truncated.tar.gz"
GOOD_SIZE=$(wc -c < "$TEST_ROOT/truncated.tar.gz")
dd if="$TEST_ROOT/truncated.tar.gz" of="$TEST_ROOT/truncated.tmp" bs=1 count=$((GOOD_SIZE / 2)) 2>/dev/null
mv "$TEST_ROOT/truncated.tmp" "$TEST_ROOT/truncated.tar.gz"
expect_failure 'gzip truncado foi aceito' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/truncated.tar.gz"

mkdir -p "$TEST_ROOT/destination"
printf '%s' 'unchanged' > "$TEST_ROOT/destination/marker"
expect_failure 'symlink malicioso foi aceito antes da mutação' "$ARCHIVE_VALIDATOR" "$TEST_ROOT/symlink.tar.gz"
[ "$(cat "$TEST_ROOT/destination/marker")" = 'unchanged' ] || fail 'destino foi alterado durante validação defensiva'

if grep -q 'readlink -m' "$SCRIPT_DIR/restore.sh"; then
  fail 'restore.sh ainda depende de readlink -m'
fi

echo 'Restore artifact tests passed.'
