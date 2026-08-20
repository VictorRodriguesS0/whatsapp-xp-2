#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
HELPER_LIB="$SCRIPT_DIR/docker-helper-lib.sh"

[ -f "$HELPER_LIB" ] || {
  echo 'RED: docker-helper-lib.sh ainda não existe.' >&2
  exit 1
}
. "$HELPER_LIB"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

TEST_ID=$(new_docker_helper_random_id)
SENTINEL_NAME="xp-whatsapp-helper-sentinel-$TEST_ID"
SENTINEL_LABEL='sentinel-not-owned'
SENTINEL_ID=

cleanup() {
  if [ -n "$DOCKER_HELPER_ID" ]; then
    remove_active_docker_helper >/dev/null 2>&1 || true
  fi
  if [ -n "$SENTINEL_ID" ]; then
    actual=$(docker inspect --format "{{.Id}}|{{ index .Config.Labels \"$DOCKER_HELPER_LABEL\" }}" "$SENTINEL_ID" 2>/dev/null || true)
    if [ "$actual" = "$SENTINEL_ID|$SENTINEL_LABEL" ]; then
      docker rm -f "$SENTINEL_ID" >/dev/null
    fi
  fi
}
trap cleanup EXIT HUP INT TERM

SENTINEL_ID=$(docker create \
  --name "$SENTINEL_NAME" \
  --label "$DOCKER_HELPER_LABEL=$SENTINEL_LABEL" \
  alpine:3.22 true)

if remove_docker_helper_by_identity "$SENTINEL_ID" "$DOCKER_HELPER_RUN_ID" >/dev/null 2>&1; then
  fail 'cleanup aceitou container com run-id divergente'
fi
docker inspect "$SENTINEL_ID" >/dev/null 2>&1 || fail 'sentinela foi removido por engano'

DOCKER_HELPER_ID=
if create_owned_docker_helper create-failure \
  --mount 'type=volume,source=invalid/name,target=/source' \
  alpine:3.22 true >/dev/null 2>&1; then
  fail 'docker create inválido deveria falhar'
fi
[ -z "$DOCKER_HELPER_ID" ] || fail 'ID foi capturado apesar da falha de docker create'
docker inspect "$SENTINEL_ID" >/dev/null 2>&1 || fail 'create failure removeu o sentinela'

create_owned_docker_helper safety alpine:3.22 true
OWNED_ID=$DOCKER_HELPER_ID
OWNED_LABEL=$(docker inspect --format "{{ index .Config.Labels \"$DOCKER_HELPER_LABEL\" }}" "$OWNED_ID")
[ "$OWNED_LABEL" = "$DOCKER_HELPER_RUN_ID" ] || fail 'helper próprio não recebeu o run-id exclusivo'
remove_active_docker_helper
if docker inspect "$OWNED_ID" >/dev/null 2>&1; then
  fail 'helper próprio não foi removido'
fi

echo 'Docker helper ownership tests passed.'
