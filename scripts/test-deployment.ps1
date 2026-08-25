[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Read-NormalizedText {
  param([Parameter(Mandatory)] [string] $Path)

  return (Get-Content -Raw -LiteralPath $Path).Replace("`r`n", "`n")
}

$GitAttributes = Read-NormalizedText (Join-Path $ProjectRoot '.gitattributes')
if ($GitAttributes -notmatch '(?m)^\*\.sh text eol=lf$') {
  throw 'Scripts POSIX devem ser normalizados como LF no Git para releases Linux.'
}
$EnvExample = Read-NormalizedText (Join-Path $ProjectRoot '.env.example')
$Dockerfile = Read-NormalizedText (Join-Path $ProjectRoot 'Dockerfile')
$RecordingConverter = Read-NormalizedText (Join-Path $ProjectRoot 'src/modules/recordings/converter.ts')
$NginxFinal = Read-NormalizedText (Join-Path $ProjectRoot 'deploy/nginx/whatsapp.xpeletronicos.com.conf')
if ($EnvExample -notmatch '(?m)^NEXT_PUBLIC_APP_URL=https://whatsapp\.xpeletronicos\.com$') {
  throw 'NEXT_PUBLIC_APP_URL do ambiente versionado deve usar a origem HTTPS aprovada.'
}
if ($Dockerfile -notmatch '(?ms)apt-get install -y --no-install-recommends\s+openssl\s+ffmpeg(?:\s|\\)') {
  throw 'O runtime final deve instalar openssl e o pacote Debian ffmpeg, que fornece ffmpeg e ffprobe.'
}
if ($Dockerfile -notmatch '(?ms)apt-get install -y --no-install-recommends\s+openssl\s+ffmpeg\s+poppler-utils(?:\s|\\)') {
  throw 'O runtime final deve instalar poppler-utils para miniaturas PDF.'
}
if (
  $RecordingConverter -notmatch 'spawn\(command, args, \{ shell: false,' -or
  $RecordingConverter -match '(?m)\b(exec|execFile)\s*\('
) {
  throw 'A conversão de gravações deve executar ffmpeg/ffprobe sem shell.'
}
if (
  $NginxFinal -match 'microphone=\(\)' -or
  ([regex]::Matches($NginxFinal, 'microphone=\(self\)')).Count -lt 2
) {
  throw 'O proxy HTTPS documentado deve permitir microfone somente para a própria origem.'
}

$BackupShell = Read-NormalizedText (Join-Path $ProjectRoot 'scripts/backup.sh')
$RestoreShell = Read-NormalizedText (Join-Path $ProjectRoot 'scripts/restore.sh')
$BackupPowerShell = Read-NormalizedText (Join-Path $ProjectRoot 'scripts/backup.ps1')
$HelperShell = Read-NormalizedText (Join-Path $ProjectRoot 'scripts/docker-helper-lib.sh')
$HelperPowerShell = Read-NormalizedText (Join-Path $ProjectRoot 'scripts/docker-helper-lib.ps1')
$Readme = Read-NormalizedText (Join-Path $ProjectRoot 'README.md')
$MigrationHeading = '### Migration de dados com writers drenados'
$MigrationStart = $Readme.IndexOf($MigrationHeading, [StringComparison]::Ordinal)
$RollbackStart = $Readme.IndexOf("`n## Rollback", $MigrationStart, [StringComparison]::Ordinal)
if ($MigrationStart -lt 0 -or $RollbackStart -lt 0) {
  throw 'Runbook de migration/rollback não pôde ser delimitado para verificação.'
}
$MigrationRunbook = $Readme.Substring($MigrationStart, $RollbackStart - $MigrationStart)

function Assert-AppOnlyRecreationCommand {
  param([Parameter(Mandatory)] [string] $Command)

  if ($Command -cne 'compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app') {
    throw "Deploy deve recriar somente xp-whatsapp-app; comando recusado: $Command"
  }
}

$AppRecreationCommands = [regex]::Matches(
  $MigrationRunbook,
  '(?m)^compose up -d .*?app$'
)
foreach ($Match in $AppRecreationCommands) {
  Assert-AppOnlyRecreationCommand $Match.Value
}
foreach ($ForbiddenCommand in @(
  'compose up -d --force-recreate --wait database app',
  'compose up -d --no-deps --force-recreate --wait --wait-timeout 120 database app',
  'compose up -d --force-recreate'
)) {
  $Rejected = $false
  try {
    Assert-AppOnlyRecreationCommand $ForbiddenCommand
  } catch {
    $Rejected = $true
  }
  if (-not $Rejected) {
    throw "Mutation test aceitou recriação non-app: $ForbiddenCommand"
  }
}

if (
  $BackupShell -notmatch 'docker compose --project-directory "\$PROJECT_ROOT" --env-file "\$ENV_FILE" -f "\$COMPOSE_FILE"' -or
  $BackupShell -match '(?m)^\s*(?:\.|source|eval)\s+.*ENV_FILE'
) {
  throw 'backup.sh deve encaminhar somente o caminho de ENV_FILE como opção global do Compose, sem carregar o segredo no shell.'
}
if (
  $MigrationRunbook -notmatch '(?m)^set -eu$' -or
  $MigrationRunbook -notmatch "APP_ROOT='/opt/apps/example-app'" -or
  $MigrationRunbook -notmatch 'ENV_FILE="\$APP_ROOT/\.env\.production"' -or
  $MigrationRunbook -notmatch 'COMPOSE_FILE="\$CANDIDATE_RELEASE/deploy/kvm/docker-compose\.yml"' -or
  $MigrationRunbook -notmatch '"\$CANDIDATE_RELEASE/scripts/backup\.sh" /srv/backups/example-app --env-file "\$ENV_FILE"' -or
  $MigrationRunbook -match 'docker compose --env-file \.env\.production' -or
  $MigrationRunbook -match '(?m)^\s*\.\s+.*ENV_FILE|(?m)^\s*(?:source|eval|cp|cat)\s+.*ENV_FILE'
) {
  throw 'O runbook de migration deve falhar fechada com paths absolutos e não pode carregar, copiar ou expor ENV_FILE.'
}

$DirectComposeCalls = [regex]::Matches($MigrationRunbook, '(?m)^\s*docker compose').Count
if (
  $DirectComposeCalls -ne 1 -or
  $MigrationRunbook -notmatch 'docker compose --project-directory "\$CANDIDATE_RELEASE" --env-file "\$ENV_FILE" -f "\$COMPOSE_FILE" "\$@"' -or
  $MigrationRunbook -notmatch 'compose stop app' -or
  $MigrationRunbook -notmatch 'compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app' -or
  $MigrationRunbook -notmatch 'migration_state\(\)' -or
  $MigrationRunbook -notmatch 'migration_recovery_state_name\(\)' -or
  $MigrationRunbook -notmatch 'migration-runbook-state\.sh' -or
  $MigrationRunbook -notmatch 'assert_failed_or_incomplete_zero' -or
  $MigrationRunbook -notmatch 'assert_migration_applied_resolved_clean' -or
  $MigrationRunbook -notmatch 'migrate resolve --rolled-back "\$MIGRATION_NAME"' -or
  $MigrationRunbook -notmatch 'migrate deploy' -or
  $MigrationRunbook -notmatch 'migrate status'
) {
  throw 'O runbook precisa usar somente o wrapper Compose e validar backup/drain/P3009/rollback em cada ramo.'
}
if (
  ([regex]::Matches($MigrationRunbook, '(?m)^set -eu$').Count -lt 6) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^compose stop app$').Count -ne 5) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^assert_app_exited$').Count -ne 5) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^assert_app_sessions_drained$').Count -ne 5) -or
  ([regex]::Matches($MigrationRunbook, '--wait --wait-timeout 120 app').Count -ne 5) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^assert_migration_applied_clean$').Count -ne 2) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^assert_migration_applied_resolved_clean$').Count -ne 2) -or
  ([regex]::Matches($MigrationRunbook, '(?m)^XP_WHATSAPP_IMAGE="\$CANDIDATE_IMAGE"\s*\\\r?\n\s*compose up').Count -ne 2) -or
  $MigrationRunbook -notmatch "assert_recovery_state 'initial-failed'" -or
  $MigrationRunbook -notmatch "assert_recovery_state 'retry-server-only'" -or
  $MigrationRunbook -notmatch '(?ms)case "\$recovery_state" in.*?retry-failed\).*?migrate resolve --rolled-back "\$MIGRATION_NAME".*?retry-not-applied\).*?initial-failed\).*?exit 65.*?retry-server-only\).*?exit 65.*?esac'
) {
  throw 'Cada ramo deve falhar fechado: stop, estado de sessões, migration e start --wait precisam estar completos.'
}
$ResolvedServerOnlyBlock = [regex]::Match(
  $MigrationRunbook,
  '(?ms)assert_recovery_state ''retry-server-only''.*?```'
)
if (-not $ResolvedServerOnlyBlock.Success) {
  throw 'O estado 1/0/1 deve validar status somente com a candidata e subir ef61 sem migration extra.'
}
if ($ResolvedServerOnlyBlock.Value -notmatch '(?s)CANDIDATE_IMAGE.*?migrate status') {
  throw 'O estado 1/0/1 precisa executar migrate status com a candidata.'
}
if ($ResolvedServerOnlyBlock.Value -match '(?s)ROLLBACK_IMAGE.*?migrate (?:deploy|status)') {
  throw 'O estado 1/0/1 não pode executar migration com a imagem de rollback.'
}

$CandidateMatch = [regex]::Match($MigrationRunbook, "(?m)^CANDIDATE_REVISION='([0-9a-f]{7,40})'$")
if (-not $CandidateMatch.Success -or $CandidateMatch.Groups[1].Value -eq 'b638f187fd325c88936c6a351f91ddd91304de73') {
  throw 'CANDIDATE_REVISION deve ser um commit novo, explícito e diferente do HEAD documental b638.'
}
$CandidateRevision = $CandidateMatch.Groups[1].Value
$CandidateBackup = (& git -C $ProjectRoot show "$($CandidateRevision):scripts/backup.sh" 2>$null) -join [Environment]::NewLine
$CandidateBackupStatus = $LASTEXITCODE
$CandidateMigration = (& git -C $ProjectRoot show "$($CandidateRevision):prisma/migrations/202608210004_backfill_response_state/migration.sql" 2>$null) -join [Environment]::NewLine
$CandidateMigrationStatus = $LASTEXITCODE
$CandidateStateLibrary = (& git -C $ProjectRoot show "$($CandidateRevision):scripts/migration-runbook-state.sh" 2>$null) -join [Environment]::NewLine
$CandidateStateLibraryStatus = $LASTEXITCODE
if (
  $CandidateBackupStatus -ne 0 -or
  $CandidateMigrationStatus -ne 0 -or
  $CandidateStateLibraryStatus -ne 0 -or
  $CandidateBackup -notmatch 'ENV_FILE_SEEN=0' -or
  $CandidateBackup -notmatch 'PATH_FILE_SEEN=0' -or
  $CandidateMigration -notmatch 'awaiting_response_since' -or
  $CandidateStateLibrary -notmatch 'initial-failed' -or
  $CandidateStateLibrary -notmatch 'retry-failed' -or
  $CandidateStateLibrary -match 'failed-or-incomplete'
) {
  throw 'CANDIDATE_REVISION deve conter migration 004, parser --env-file endurecido e classificador P3009.'
}
if ($MigrationRunbook -match '<(?:commit|migration|release|tag|image)[^>]*>') {
  throw 'O runbook de migration não pode conter placeholders executáveis.'
}

if ($BackupShell -notmatch 'docker-helper-lib\.sh' -or $RestoreShell -notmatch 'docker-helper-lib\.sh') {
  throw 'Backup/restore shell devem usar o protocolo comum de ownership de helpers.'
}
if ($BackupPowerShell -notmatch 'docker-helper-lib\.ps1') {
  throw 'Backup PowerShell deve usar o protocolo comum de ownership de helpers.'
}
foreach ($BackupScript in @($BackupShell, $BackupPowerShell)) {
  if ($BackupScript -notmatch "--exclude='\./\.staging'") {
    throw 'Backup deve excluir o diretório transitório .staging do arquivo restaurável.'
  }
  if ($BackupScript -notmatch "--exclude='\./\.recordings'") {
    throw 'Backup deve excluir o diretório transitório .recordings do arquivo restaurável.'
  }
  if ($BackupScript -notmatch "--exclude='\./\.pdf-thumbnails'") {
    throw 'Backup deve excluir miniaturas PDF regeneráveis.'
  }
}
if (
  $BackupPowerShell -notmatch 'validate-media-archive\.sh' -or
  $BackupPowerShell -notmatch 'docker cp \$ArchiveValidator'
) {
  throw 'Backup PowerShell deve executar o validator estrito versionado dentro do helper Alpine.'
}
foreach ($HelperLibrary in @($HelperShell, $HelperPowerShell)) {
  if ($HelperLibrary -notmatch 'com\.xpeletronicos\.xp-whatsapp\.helper-run') {
    throw 'Helper Docker deve receber label exclusiva de run-id.'
  }
  if ($HelperLibrary -notmatch 'docker inspect') {
    throw 'Cleanup do helper deve reinspecionar ID/label antes da remoção.'
  }
}
foreach ($OperationalScript in @($BackupShell, $RestoreShell, $BackupPowerShell)) {
  if ($OperationalScript -match '(?m)docker rm -f .*HELPER') {
    throw 'Scripts operacionais não podem remover helper por nome previsível.'
  }
}

$TemporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "xp-whatsapp-compose-tests-$([Guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path (Join-Path $TemporaryRoot 'scripts') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $TemporaryRoot 'deploy/nginx') -Force

try {
  foreach ($RelativePath in @(
    '.env.example',
    'Dockerfile',
    'docker-compose.yml',
    'docker-entrypoint.sh',
    'scripts/verify-compose.ps1',
    'deploy/nginx/whatsapp.xpeletronicos.com.conf'
  )) {
    $Destination = Join-Path $TemporaryRoot $RelativePath
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $RelativePath) -Destination $Destination
  }

  $Verifier = Join-Path $TemporaryRoot 'scripts/verify-compose.ps1'
  $OriginalVerifierOutput = & pwsh -NoProfile -File $Verifier 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "A configuração original deveria passar antes dos mutation tests:`n$($OriginalVerifierOutput -join [Environment]::NewLine)"
  }

  $OriginalCompose = Read-NormalizedText (Join-Path $TemporaryRoot 'docker-compose.yml')
  $OriginalDockerfile = Read-NormalizedText (Join-Path $TemporaryRoot 'Dockerfile')
  $OriginalEnvExample = Read-NormalizedText (Join-Path $TemporaryRoot '.env.example')

  function Assert-MutationFails {
    param(
      [Parameter(Mandatory)] [string] $Name,
      [Parameter(Mandatory)] [string] $MutatedCompose,
      [string] $MutatedDockerfile = $OriginalDockerfile,
      [string] $MutatedEnvExample = $OriginalEnvExample
    )

    if (
      $MutatedCompose -eq $OriginalCompose -and
      $MutatedDockerfile -eq $OriginalDockerfile -and
      $MutatedEnvExample -eq $OriginalEnvExample
    ) {
      throw "Mutation test inválido, não alterou artefato: $Name"
    }

    Set-Content -LiteralPath (Join-Path $TemporaryRoot 'docker-compose.yml') -Value $MutatedCompose -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $TemporaryRoot 'Dockerfile') -Value $MutatedDockerfile -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $TemporaryRoot '.env.example') -Value $MutatedEnvExample -Encoding utf8NoBOM
    & pwsh -NoProfile -File $Verifier *> $null
    if ($LASTEXITCODE -eq 0) {
      throw "O verificador aceitou mutação proibida: $Name"
    }
  }

  Assert-MutationFails 'remove app healthcheck' (
    [regex]::Replace(
      $OriginalCompose,
      '(?ms)(  app:.*?)(    healthcheck:\r?\n.*?)(    networks:)',
      '$1$3',
      1
    )
  )
  Assert-MutationFails 'remove app stop_grace_period' (
    $OriginalCompose -replace '(?m)^    stop_grace_period: 30s\r?\n', ''
  )
  Assert-MutationFails 'add extra public app port' (
    [regex]::Replace(
      $OriginalCompose,
      '(?m)^(      - "127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000")$',
      '${1}' + "`n      - `"0.0.0.0:3200:3000`"",
      1
    )
  )
  Assert-MutationFails 'expose Meta business account to browser' (
    [regex]::Replace(
      $OriginalCompose,
      '(?m)^(      WHATSAPP_BUSINESS_ACCOUNT_ID:.*)$',
      '${1}' + "`n      NEXT_PUBLIC_WHATSAPP_BUSINESS_ACCOUNT_ID: `${WHATSAPP_BUSINESS_ACCOUNT_ID:-}",
      1
    )
  )
  Assert-MutationFails 'remove existing Meta server wiring' (
    $OriginalCompose -replace '(?m)^      WHATSAPP_BUSINESS_ACCOUNT_ID:.*\r?\n', ''
  )
  Assert-MutationFails 'remove existing WhatsApp catalog server wiring' (
    $OriginalCompose -replace '(?m)^      WHATSAPP_CATALOG_ID:.*\r?\n', ''
  )
  Assert-MutationFails 'pass Meta token as Compose build argument' (
    [regex]::Replace(
      $OriginalCompose,
      '(?m)^(      dockerfile: Dockerfile)$',
      '${1}' + "`n      args:`n        WHATSAPP_ACCESS_TOKEN: `${WHATSAPP_ACCESS_TOKEN:-}",
      1
    )
  )
  $DockerfileWithCredentialArg = [regex]::Replace(
    $OriginalDockerfile,
    '(?m)^(FROM node:22-bookworm-slim AS base)$',
    '${1}' + "`nARG WHATSAPP_ACCESS_TOKEN",
    1
  )
  Assert-MutationFails 'pass Meta token as Dockerfile build argument' $OriginalCompose $DockerfileWithCredentialArg
} finally {
  if (Test-Path -LiteralPath $TemporaryRoot) {
    $CanonicalTemporaryRoot = (Resolve-Path -LiteralPath $TemporaryRoot).Path
    $CanonicalSystemTemp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd(
      [IO.Path]::DirectorySeparatorChar,
      [IO.Path]::AltDirectorySeparatorChar
    )
    $ExpectedPrefix = "$CanonicalSystemTemp$([IO.Path]::DirectorySeparatorChar)xp-whatsapp-compose-tests-"
    if (-not $CanonicalTemporaryRoot.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Recusando limpeza de diretório temporário inesperado: $CanonicalTemporaryRoot"
    }
    Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force
  }
}

Write-Host 'Deployment mutation tests passed.'
