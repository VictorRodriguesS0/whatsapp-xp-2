Set-StrictMode -Version Latest

$script:DockerHelperLabel = 'com.xpeletronicos.xp-whatsapp.helper-run'
$script:DockerHelperRunId = [Guid]::NewGuid().ToString('N')
$script:DockerHelperId = $null

function Get-DockerHelperIdentity {
  param([Parameter(Mandatory)] [string] $Id)

  $Identity = (& docker inspect --format "{{.Id}}|{{ index .Config.Labels `"$DockerHelperLabel`" }}" $Id).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível inspecionar o helper Docker; cleanup recusado: $Id"
  }
  return $Identity
}

function New-OwnedDockerHelper {
  param(
    [Parameter(Mandatory)] [ValidatePattern('^[a-z0-9-]+$')] [string] $Purpose,
    [Parameter(Mandatory)] [string[]] $CreateArguments
  )

  if ($script:DockerHelperId) {
    throw 'Já existe um helper Docker ativo nesta execução.'
  }

  $HelperInstanceId = [Guid]::NewGuid().ToString('N')
  $HelperName = "xp-whatsapp-$Purpose-$DockerHelperRunId-$HelperInstanceId"
  $CreateOutput = & docker create `
    --name $HelperName `
    --label "$DockerHelperLabel=$DockerHelperRunId" `
    @CreateArguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker create falhou para o helper $Purpose."
  }

  $CreatedId = ($CreateOutput | Out-String).Trim()
  if ($CreatedId -notmatch '^[0-9a-f]{64}$') {
    throw 'docker create retornou ID inválido; cleanup recusado.'
  }
  if ((Get-DockerHelperIdentity -Id $CreatedId) -ne "$CreatedId|$DockerHelperRunId") {
    throw 'ID/label do helper recém-criado divergem; cleanup recusado.'
  }

  $script:DockerHelperId = $CreatedId
}

function Remove-DockerHelperByIdentity {
  param(
    [Parameter(Mandatory)] [string] $Id,
    [Parameter(Mandatory)] [string] $ExpectedRunId
  )

  if ((Get-DockerHelperIdentity -Id $Id) -ne "$Id|$ExpectedRunId") {
    throw "ID/label do helper Docker não conferem; cleanup recusado: $Id"
  }
  & docker rm -f $Id *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao remover helper Docker próprio: $Id"
  }
}

function Remove-OwnedDockerHelper {
  if (-not $script:DockerHelperId) { return }

  $ActiveId = $script:DockerHelperId
  Remove-DockerHelperByIdentity -Id $ActiveId -ExpectedRunId $DockerHelperRunId
  $script:DockerHelperId = $null
}
