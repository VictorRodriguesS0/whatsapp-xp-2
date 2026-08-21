[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvExample = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot '.env.example')
$Dockerfile = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'Dockerfile')
$RecordingConverter = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'src/modules/recordings/converter.ts')
$NginxFinal = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'deploy/nginx/whatsapp.xpeletronicos.com.conf')
if ($EnvExample -notmatch '(?m)^NEXT_PUBLIC_APP_URL=https://whatsapp\.xpeletronicos\.com$') {
  throw 'NEXT_PUBLIC_APP_URL do ambiente versionado deve usar a origem HTTPS aprovada.'
}
if ($Dockerfile -notmatch '(?ms)apt-get install -y --no-install-recommends\s+openssl\s+ffmpeg(?:\s|\\)') {
  throw 'O runtime final deve instalar openssl e o pacote Debian ffmpeg, que fornece ffmpeg e ffprobe.'
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

$BackupShell = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'scripts/backup.sh')
$RestoreShell = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'scripts/restore.sh')
$BackupPowerShell = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'scripts/backup.ps1')
$HelperShell = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'scripts/docker-helper-lib.sh')
$HelperPowerShell = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'scripts/docker-helper-lib.ps1')
$Readme = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'README.md')

if (
  $BackupShell -notmatch 'docker compose --project-directory "\$PROJECT_ROOT" --env-file "\$ENV_FILE" -f "\$COMPOSE_FILE"' -or
  $BackupShell -match '(?m)^\s*(?:\.|source|eval)\s+.*ENV_FILE'
) {
  throw 'backup.sh deve encaminhar somente o caminho de ENV_FILE como opção global do Compose, sem carregar o segredo no shell.'
}
if (
  $Readme -notmatch "APP_ROOT='/opt/apps/example-app'" -or
  $Readme -notmatch 'ENV_FILE="\$APP_ROOT/\.env\.production"' -or
  $Readme -notmatch 'COMPOSE_FILE="\$CANDIDATE_RELEASE/deploy/kvm/docker-compose\.yml"' -or
  $Readme -notmatch '"\$CANDIDATE_RELEASE/scripts/backup\.sh" /srv/backups/example-app --env-file "\$ENV_FILE"' -or
  $Readme -match 'docker compose --env-file \.env\.production'
) {
  throw 'O runbook de migration deve usar APP_ROOT/ENV_FILE/COMPOSE_FILE absolutos e não pode depender de .env.production relativo.'
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
  & pwsh -NoProfile -File $Verifier *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'A configuração original deveria passar antes dos mutation tests.'
  }

  $OriginalCompose = Get-Content -Raw -LiteralPath (Join-Path $TemporaryRoot 'docker-compose.yml')

  function Assert-MutationFails {
    param(
      [Parameter(Mandatory)] [string] $Name,
      [Parameter(Mandatory)] [string] $MutatedCompose
    )

    if ($MutatedCompose -eq $OriginalCompose) {
      throw "Mutation test inválido, não alterou o Compose: $Name"
    }

    Set-Content -LiteralPath (Join-Path $TemporaryRoot 'docker-compose.yml') -Value $MutatedCompose -Encoding utf8NoBOM
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
