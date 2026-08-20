[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)]
  [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ComposeFile = Join-Path $ProjectRoot 'docker-compose.yml'
$OutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$FilesystemRoot = [IO.Path]::GetPathRoot($OutputRoot)

if ($OutputRoot -eq $FilesystemRoot -or $OutputRoot -eq $ProjectRoot -or $OutputRoot.StartsWith("$ProjectRoot$([IO.Path]::DirectorySeparatorChar)")) {
  throw 'Use um diretório de backup dedicado fora do deploy /opt/example-app.'
}

$null = New-Item -ItemType Directory -Path $OutputRoot -Force
$OutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$Timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$BackupDirectory = Join-Path $OutputRoot "xp-whatsapp-$Timestamp"

if (Test-Path -LiteralPath $BackupDirectory) {
  throw "O diretório de backup já existe: $BackupDirectory"
}
$null = New-Item -ItemType Directory -Path $BackupDirectory

$ComposeArguments = @('compose', '--project-directory', $ProjectRoot, '-f', $ComposeFile)
function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] [string[]] $Arguments)
  & docker @ComposeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose falhou: $($Arguments -join ' ')"
  }
}

$DatabaseContainer = (& docker @ComposeArguments ps -q database).Trim()
if ($LASTEXITCODE -ne 0 -or -not $DatabaseContainer) {
  throw 'O container database precisa estar em execução.'
}
$DatabaseName = (& docker inspect --format '{{.Name}}' $DatabaseContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $DatabaseName -ne '/xp-whatsapp-database') {
  throw "Container database inesperado: $DatabaseName"
}
$MediaVolume = (& docker volume inspect --format '{{.Name}}' xp_whatsapp_media).Trim()
if ($LASTEXITCODE -ne 0 -or $MediaVolume -ne 'xp_whatsapp_media') {
  throw 'O volume xp_whatsapp_media não pertence ao alvo esperado.'
}
$MediaProject = (& docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' xp_whatsapp_media).Trim()
if ($LASTEXITCODE -ne 0 -or $MediaProject -ne 'xp-whatsapp') {
  throw 'O volume xp_whatsapp_media não pertence ao workspace Compose xp-whatsapp.'
}

$TemporaryDatabase = "/tmp/xp-whatsapp-backup-$Timestamp-$PID.dump"
try {
  Invoke-Compose exec -T database sh -ceu 'umask 077; pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file="$1"; pg_restore --list "$1" >/dev/null' sh $TemporaryDatabase
  & docker cp "${DatabaseContainer}:$TemporaryDatabase" (Join-Path $BackupDirectory 'database.dump')
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível copiar o dump PostgreSQL.' }

  & docker run --rm `
    --mount 'type=volume,source=xp_whatsapp_media,target=/source,readonly' `
    --mount "type=bind,source=$BackupDirectory,target=/backup" `
    alpine:3.22 sh -ceu 'umask 077; tar -C /source -czf /backup/media.tar.gz .'
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível arquivar o volume de mídia.' }

  & docker run --rm `
    --mount "type=bind,source=$BackupDirectory,target=/backup,readonly" `
    alpine:3.22 sh -ceu 'test -s /backup/database.dump; test -s /backup/media.tar.gz; tar -tzf /backup/media.tar.gz >/dev/null'
  if ($LASTEXITCODE -ne 0) { throw 'A validação dos artefatos de backup falhou.' }

  foreach ($FileName in @('database.dump', 'media.tar.gz')) {
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BackupDirectory $FileName)).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $BackupDirectory "$FileName.sha256") -Value "$Hash  $FileName" -Encoding utf8NoBOM
  }

  @(
    'application=xp-whatsapp'
    "created_at_utc=$Timestamp"
    'database_container=xp-whatsapp-database'
    'database_format=postgresql-custom'
    'media_volume=xp_whatsapp_media'
  ) | Set-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.txt') -Encoding utf8NoBOM
} finally {
  & docker @ComposeArguments exec -T database rm -f -- $TemporaryDatabase *> $null
}

Write-Host "Backup validado em: $BackupDirectory"
