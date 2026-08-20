[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'docker-helper-lib.ps1')

$SentinelRunId = 'sentinel-not-owned'
$SentinelName = "xp-whatsapp-helper-sentinel-$([Guid]::NewGuid().ToString('N'))"
$SentinelId = $null

try {
  $SentinelId = (& docker create `
    --name $SentinelName `
    --label "$DockerHelperLabel=$SentinelRunId" `
    alpine:3.22 true).Trim()
  if ($LASTEXITCODE -ne 0 -or $SentinelId -notmatch '^[0-9a-f]{64}$') {
    throw 'Não foi possível criar o sentinela do teste PowerShell.'
  }

  try {
    Remove-DockerHelperByIdentity -Id $SentinelId -ExpectedRunId $DockerHelperRunId
    throw 'Cleanup aceitou sentinela com run-id divergente.'
  } catch {
    if ($_.Exception.Message -eq 'Cleanup aceitou sentinela com run-id divergente.') { throw }
  }
  & docker inspect $SentinelId *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Sentinela foi removido por engano.' }

  try {
    New-OwnedDockerHelper -Purpose 'create-failure' -CreateArguments @(
      '--mount', 'type=volume,source=invalid/name,target=/source',
      'alpine:3.22', 'true'
    )
    throw 'docker create inválido deveria falhar.'
  } catch {
    if ($_.Exception.Message -eq 'docker create inválido deveria falhar.') { throw }
  }
  if ($DockerHelperId) { throw 'ID foi capturado apesar da falha de docker create.' }
  & docker inspect $SentinelId *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Create failure removeu o sentinela.' }

  New-OwnedDockerHelper -Purpose 'safety' -CreateArguments @('alpine:3.22', 'true')
  $OwnedId = $DockerHelperId
  if ((Get-DockerHelperIdentity -Id $OwnedId) -ne "$OwnedId|$DockerHelperRunId") {
    throw 'Helper próprio não recebeu identidade exclusiva.'
  }
  Remove-OwnedDockerHelper
  & docker inspect $OwnedId *> $null
  if ($LASTEXITCODE -eq 0) { throw 'Helper próprio não foi removido.' }
} finally {
  if ($DockerHelperId) {
    Remove-OwnedDockerHelper
  }
  if ($SentinelId) {
    $Identity = (& docker inspect --format "{{.Id}}|{{ index .Config.Labels `"$DockerHelperLabel`" }}" $SentinelId 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $Identity -eq "$SentinelId|$SentinelRunId") {
      & docker rm -f $SentinelId *> $null
    }
  }
}

Write-Host 'PowerShell Docker helper ownership tests passed.'
