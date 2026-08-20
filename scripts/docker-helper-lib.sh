#!/bin/sh

DOCKER_HELPER_LABEL='com.xpeletronicos.xp-whatsapp.helper-run'
DOCKER_HELPER_ID=

new_docker_helper_random_id() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    tr -d '-' < /proc/sys/kernel/random/uuid
    return
  fi

  od -An -N16 -tx1 /dev/urandom | tr -d ' \n'
}

DOCKER_HELPER_RUN_ID=$(new_docker_helper_random_id)
case "$DOCKER_HELPER_RUN_ID" in
  ''|*[!0-9a-f]*)
    echo 'Não foi possível gerar run-id aleatório seguro para o helper Docker.' >&2
    return 70 2>/dev/null || exit 70
    ;;
esac
[ "${#DOCKER_HELPER_RUN_ID}" -ge 32 ] || {
  echo 'Run-id aleatório do helper Docker é curto demais.' >&2
  return 70 2>/dev/null || exit 70
}

inspect_docker_helper_identity() {
  helper_id=$1
  docker inspect --format "{{.Id}}|{{ index .Config.Labels \"$DOCKER_HELPER_LABEL\" }}" "$helper_id"
}

create_owned_docker_helper() {
  helper_purpose=$1
  shift

  case "$helper_purpose" in
    ''|*[!a-z0-9-]*)
      echo "Purpose inválido para helper Docker: $helper_purpose" >&2
      return 64
      ;;
  esac
  [ -z "$DOCKER_HELPER_ID" ] || {
    echo 'Já existe um helper Docker ativo nesta execução.' >&2
    return 70
  }

  helper_instance_id=$(new_docker_helper_random_id)
  helper_name="xp-whatsapp-$helper_purpose-$DOCKER_HELPER_RUN_ID-$helper_instance_id"
  created_id=
  created_id=$(docker create \
    --name "$helper_name" \
    --label "$DOCKER_HELPER_LABEL=$DOCKER_HELPER_RUN_ID" \
    "$@") || return $?

  case "$created_id" in
    ''|*[!0-9a-f]*)
      echo 'docker create retornou um ID inválido; cleanup recusado.' >&2
      return 70
      ;;
  esac
  [ "${#created_id}" -eq 64 ] || {
    echo 'docker create retornou um ID com tamanho inesperado; cleanup recusado.' >&2
    return 70
  }

  created_identity=$(inspect_docker_helper_identity "$created_id") || {
    echo 'Não foi possível confirmar ownership do helper recém-criado; cleanup recusado.' >&2
    return 70
  }
  [ "$created_identity" = "$created_id|$DOCKER_HELPER_RUN_ID" ] || {
    echo 'ID/label do helper recém-criado divergem; cleanup recusado.' >&2
    return 70
  }

  DOCKER_HELPER_ID=$created_id
}

remove_docker_helper_by_identity() {
  helper_id=$1
  expected_run_id=$2
  [ -n "$helper_id" ] && [ -n "$expected_run_id" ] || return 64

  actual_identity=$(inspect_docker_helper_identity "$helper_id") || {
    echo "Helper Docker não pôde ser inspecionado; cleanup recusado: $helper_id" >&2
    return 70
  }
  [ "$actual_identity" = "$helper_id|$expected_run_id" ] || {
    echo "ID/label do helper Docker não conferem; cleanup recusado: $helper_id" >&2
    return 70
  }

  docker rm -f "$helper_id" >/dev/null
}

remove_active_docker_helper() {
  [ -n "$DOCKER_HELPER_ID" ] || return 0
  active_id=$DOCKER_HELPER_ID
  remove_docker_helper_by_identity "$active_id" "$DOCKER_HELPER_RUN_ID" || return $?
  DOCKER_HELPER_ID=
}
