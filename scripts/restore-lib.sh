#!/bin/sh

canonical_existing_file() {
  input_path=$1
  case "$input_path" in
    /*) ;;
    *) return 1 ;;
  esac

  input_directory=$(dirname -- "$input_path")
  input_basename=$(basename -- "$input_path")
  canonical_directory=$(CDPATH= cd -- "$input_directory" 2>/dev/null && pwd -P) || return 1
  canonical_path="$canonical_directory/$input_basename"
  [ -f "$canonical_path" ] || return 1
  printf '%s\n' "$canonical_path"
}

verify_checksum_sidecar() {
  artifact_path=$1
  expected_basename=$2
  sidecar_path="$artifact_path.sha256"

  [ "$(basename -- "$artifact_path")" = "$expected_basename" ] || return 1
  [ -f "$sidecar_path" ] || return 1
  [ "$(wc -l < "$sidecar_path" | tr -d ' ')" = '1' ] || return 1

  IFS= read -r checksum_line < "$sidecar_path" || return 1
  expected_hash=${checksum_line%%  *}
  referenced_basename=${checksum_line#*  }
  [ "$checksum_line" = "$expected_hash  $referenced_basename" ] || return 1
  [ "$referenced_basename" = "$expected_basename" ] || return 1
  [ "${#expected_hash}" -eq 64 ] || return 1
  case "$expected_hash" in
    *[!0-9a-fA-F]*) return 1 ;;
  esac

  computed_hash=$(sha256sum "$artifact_path" | awk '{print $1}') || return 1
  [ "$(printf '%s' "$computed_hash" | tr 'A-F' 'a-f')" = "$(printf '%s' "$expected_hash" | tr 'A-F' 'a-f')" ]
}

manifest_value() {
  manifest_path=$1
  manifest_key=$2
  awk -v key="$manifest_key" '
    index($0, key "=") == 1 {
      count += 1
      value = substr($0, length(key) + 2)
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$manifest_path"
}

verify_backup_manifest() {
  backup_directory=$1
  database_hash=$2
  media_hash=$3
  manifest_path="$backup_directory/manifest.txt"

  [ -f "$manifest_path" ] || return 1
  [ "$(wc -l < "$manifest_path" | tr -d ' ')" = '10' ] || return 1
  awk -F= '
    $1 == "format" ||
    $1 == "application" ||
    $1 == "created_at_utc" ||
    $1 == "database_container" ||
    $1 == "database_format" ||
    $1 == "media_volume" ||
    $1 == "database_file" ||
    $1 == "database_sha256" ||
    $1 == "media_file" ||
    $1 == "media_sha256" {
      seen[$1] += 1
      if (seen[$1] != 1) exit 1
      next
    }
    { exit 1 }
  ' "$manifest_path" || return 1

  [ "$(manifest_value "$manifest_path" format)" = 'xp-whatsapp-backup-v1' ] || return 1
  [ "$(manifest_value "$manifest_path" application)" = 'xp-whatsapp' ] || return 1
  [ "$(manifest_value "$manifest_path" database_container)" = 'xp-whatsapp-database' ] || return 1
  [ "$(manifest_value "$manifest_path" database_format)" = 'postgresql-custom' ] || return 1
  [ "$(manifest_value "$manifest_path" media_volume)" = 'xp_whatsapp_media' ] || return 1
  [ "$(manifest_value "$manifest_path" database_file)" = 'database.dump' ] || return 1
  [ "$(manifest_value "$manifest_path" media_file)" = 'media.tar.gz' ] || return 1
  [ "$(manifest_value "$manifest_path" database_sha256)" = "$database_hash" ] || return 1
  [ "$(manifest_value "$manifest_path" media_sha256)" = "$media_hash" ] || return 1

  created_at=$(manifest_value "$manifest_path" created_at_utc) || return 1
  case "$created_at" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
}

verify_backup_bundle() {
  database_input=$1
  media_input=$2

  database_path=$(canonical_existing_file "$database_input") || return 1
  media_path=$(canonical_existing_file "$media_input") || return 1
  [ "$(basename -- "$database_path")" = 'database.dump' ] || return 1
  [ "$(basename -- "$media_path")" = 'media.tar.gz' ] || return 1

  backup_directory=$(dirname -- "$database_path")
  [ "$(dirname -- "$media_path")" = "$backup_directory" ] || return 1

  verify_checksum_sidecar "$database_path" database.dump || return 1
  verify_checksum_sidecar "$media_path" media.tar.gz || return 1
  database_hash=$(sha256sum "$database_path" | awk '{print $1}') || return 1
  media_hash=$(sha256sum "$media_path" | awk '{print $1}') || return 1
  verify_backup_manifest "$backup_directory" "$database_hash" "$media_hash"
}
