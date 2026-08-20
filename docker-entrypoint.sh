#!/bin/sh
set -eu

echo 'Aplicando migrations pendentes...'
node node_modules/prisma/build/index.js migrate deploy

echo 'Iniciando XP Atendimento...'
exec "$@"
