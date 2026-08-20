[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ComposePath = Join-Path $ProjectRoot 'docker-compose.yml'
$DockerfilePath = Join-Path $ProjectRoot 'Dockerfile'
$EntrypointPath = Join-Path $ProjectRoot 'docker-entrypoint.sh'
$NginxPath = Join-Path $ProjectRoot 'deploy/nginx/whatsapp.xpeletronicos.com.conf'
$EnvExamplePath = Join-Path $ProjectRoot '.env.example'

function Assert-Match {
  param(
    [Parameter(Mandatory)] [string] $Content,
    [Parameter(Mandatory)] [string] $Pattern,
    [Parameter(Mandatory)] [string] $Message
  )

  if ($Content -notmatch $Pattern) {
    throw $Message
  }
}

function Assert-NotMatch {
  param(
    [Parameter(Mandatory)] [string] $Content,
    [Parameter(Mandatory)] [string] $Pattern,
    [Parameter(Mandatory)] [string] $Message
  )

  if ($Content -match $Pattern) {
    throw $Message
  }
}

foreach ($RequiredPath in @(
  $ComposePath,
  $DockerfilePath,
  $EntrypointPath,
  $NginxPath,
  $EnvExamplePath
)) {
  if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
    throw "Arquivo obrigatório ausente: $RequiredPath"
  }
}

$Compose = Get-Content -Raw -LiteralPath $ComposePath
$Dockerfile = Get-Content -Raw -LiteralPath $DockerfilePath
$Entrypoint = Get-Content -Raw -LiteralPath $EntrypointPath
$Nginx = Get-Content -Raw -LiteralPath $NginxPath
$EnvExample = Get-Content -Raw -LiteralPath $EnvExamplePath

Assert-Match $Compose '(?m)^\s{2}database:\s*$' 'O serviço database é obrigatório.'
Assert-Match $Compose '(?m)^\s{2}app:\s*$' 'O serviço app é obrigatório.'
Assert-Match $Compose 'container_name:\s*xp-whatsapp-database' 'Nome exigido do container database ausente.'
Assert-Match $Compose 'container_name:\s*xp-whatsapp-app' 'Nome exigido do container app ausente.'
Assert-Match $Compose 'image:\s*postgres:18-alpine' 'Use a imagem oficial postgres:18-alpine.'
Assert-Match $Compose '127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000' 'A aplicação deve publicar somente no loopback.'
Assert-NotMatch $Compose '(?m)^\s{4,}ports:\s*\r?\n(?:\s{6,}.*\r?\n)*?\s{2}app:' 'O banco não pode publicar portas.'
Assert-NotMatch $Compose '5432:5432' 'O banco não pode publicar PostgreSQL.'
Assert-Match $Compose 'xp_whatsapp_postgres:/var/lib/postgresql(?:\s|$)' 'PostgreSQL 18 deve montar o volume em /var/lib/postgresql.'
Assert-NotMatch $Compose 'xp_whatsapp_postgres:/var/lib/postgresql/data' 'Não monte PostgreSQL 18 em /var/lib/postgresql/data.'
Assert-Match $Compose 'xp_whatsapp_media:/data/media' 'Volume de mídia ausente.'
Assert-Match $Compose 'condition:\s*service_healthy' 'A aplicação deve aguardar o banco saudável.'
Assert-Match $Compose '(?m)^\s{4}internal:\s*true\s*$' 'A rede do projeto deve ser interna.'
Assert-Match $Compose 'restart:\s*unless-stopped' 'Os serviços devem reiniciar unless-stopped.'
Assert-Match $Compose 'stop_grace_period:' 'Defina stop_grace_period para encerramento seguro.'
Assert-Match $Compose 'healthcheck:' 'Healthchecks são obrigatórios.'
Assert-Match $Compose 'POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?' 'POSTGRES_PASSWORD deve falhar quando não fornecido.'
Assert-Match $Compose 'AUTH_SECRET:\s*\$\{AUTH_SECRET:\?' 'AUTH_SECRET deve falhar quando não fornecido.'
Assert-NotMatch $Compose '(?i)(password|secret|token):\s*(xp|password|secret|changeme)\s*$' 'Não use segredo padrão no Compose.'

Assert-Match $Dockerfile '(?m)^FROM node:22-bookworm-slim AS base$' 'Dockerfile deve usar Node 22 bookworm-slim multi-stage.'
Assert-Match $Dockerfile 'apt-get install -y --no-install-recommends openssl' 'Runtime Prisma precisa de OpenSSL instalado explicitamente.'
Assert-Match $Dockerfile '(?m)^RUN npm ci$' 'Dockerfile deve instalar dependências de modo reprodutível.'
Assert-Match $Dockerfile 'npm run db:generate' 'Dockerfile deve gerar o cliente Prisma.'
Assert-Match $Dockerfile 'npm run build' 'Dockerfile deve compilar o Next.js.'
Assert-Match $Dockerfile 'COPY --from=builder .*\.next/standalone' 'Runtime deve usar o artefato standalone.'
Assert-Match $Dockerfile 'COPY --from=builder .*\.next/static' 'Runtime deve conter os assets estáticos.'
Assert-Match $Dockerfile 'COPY --from=builder .*prisma/migrations' 'Runtime deve conter as migrations.'
Assert-Match $Dockerfile '(?m)^USER nextjs$' 'Runtime deve executar como usuário não-root.'
Assert-Match $Dockerfile '(?m)^HEALTHCHECK ' 'A imagem deve ter healthcheck próprio.'
Assert-Match $Dockerfile 'ENTRYPOINT \["/app/docker-entrypoint\.sh"\]' 'A imagem deve usar o entrypoint versionado.'

Assert-Match $Entrypoint 'node_modules/prisma/build/index\.js migrate deploy' 'Migrações devem usar o Prisma local, sem download de rede.'
Assert-NotMatch $Entrypoint '(?m)\bnpx\b' 'O entrypoint não pode usar npx.'
Assert-Match $Entrypoint 'exec "\$@"' 'O comando deve substituir o entrypoint e permanecer como processo único.'
Assert-Match $Dockerfile 'CMD \["node", "server\.js"\]' 'O comando padrão deve iniciar somente o servidor standalone.'

Assert-Match $Nginx 'server_name\s+whatsapp\.xpeletronicos\.com;' 'Nginx deve atender somente o subdomínio dedicado.'
Assert-Match $Nginx 'proxy_set_header\s+X-Real-IP\s+\$remote_addr;' 'X-Real-IP deve ser derivado de remote_addr.'
Assert-Match $Nginx 'location\s+=\s+/api/realtime' 'SSE deve ter location dedicado.'
Assert-Match $Nginx 'proxy_buffering\s+off;' 'SSE deve desabilitar buffering.'
Assert-Match $Nginx 'proxy_cache\s+off;' 'SSE deve desabilitar cache.'
Assert-Match $Nginx 'client_max_body_size\s+105m;' 'Nginx deve aceitar o maior upload suportado.'
Assert-NotMatch $Nginx '(?i)upgrade|connection_upgrade' 'WebSocket não é necessário para SSE.'

Assert-Match $EnvExample '(?m)^POSTGRES_PASSWORD=$' 'O exemplo de ambiente não pode fornecer senha de produção.'
Assert-Match $EnvExample '(?m)^AUTH_SECRET=$' 'O exemplo de ambiente não pode fornecer AUTH_SECRET.'
Assert-NotMatch $EnvExample '(?i)(access_token|app_secret|verify_token)=\S+' 'O exemplo não pode conter tokens ou segredos Meta.'

Push-Location $ProjectRoot
try {
  $PreviousPostgresPassword = $env:POSTGRES_PASSWORD
  $PreviousDatabaseUrl = $env:DATABASE_URL
  $PreviousAuthSecret = $env:AUTH_SECRET
  $PreviousAppPort = $env:APP_PORT
  $env:POSTGRES_PASSWORD = 'compose-validation-only'
  $env:DATABASE_URL = 'postgresql://xp_whatsapp:compose-validation-only@database:5432/xp_atendimento'
  $env:AUTH_SECRET = 'compose-validation-only-00000000000000000000'
  $env:APP_PORT = '3100'

  $ResolvedJson = & docker compose --env-file .env.example config --format json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose config falhou:`n$($ResolvedJson -join [Environment]::NewLine)"
  }

  $Resolved = ($ResolvedJson -join [Environment]::NewLine) | ConvertFrom-Json
  $ServiceNames = @($Resolved.services.PSObject.Properties.Name | Sort-Object)
  if (($ServiceNames -join ',') -ne 'app,database') {
    throw "Compose deve resolver exatamente app,database; encontrado: $($ServiceNames -join ',')"
  }

  $Database = $Resolved.services.database
  $App = $Resolved.services.app

  if ($null -ne $Database.PSObject.Properties['ports'] -and @($Database.ports).Count -gt 0) {
    throw 'O serviço database resolveu uma porta publicada.'
  }

  $AppPorts = @($App.ports)
  if ($AppPorts.Count -ne 1) {
    throw "A aplicação deve resolver exatamente uma porta; encontrado: $($AppPorts.Count)"
  }
  $AppPort = $AppPorts[0]
  if (
    $AppPort.host_ip -ne '127.0.0.1' -or
    $AppPort.target -ne 3000 -or
    [string]$AppPort.published -ne '3100' -or
    $AppPort.protocol -ne 'tcp'
  ) {
    throw 'A porta resolvida deve ser exatamente 127.0.0.1:3100:3000/tcp.'
  }

  foreach ($Service in @($Database, $App)) {
    if ($null -eq $Service.PSObject.Properties['healthcheck'] -or @($Service.healthcheck.test).Count -eq 0) {
      throw 'Os serviços database e app precisam de healthcheck resolvido.'
    }
    if ($Service.restart -ne 'unless-stopped') {
      throw 'Os serviços database e app precisam de restart unless-stopped.'
    }
    if ($null -eq $Service.PSObject.Properties['stop_grace_period'] -or -not $Service.stop_grace_period) {
      throw 'Os serviços database e app precisam de stop_grace_period.'
    }
  }
  if ($Database.stop_grace_period -ne '1m0s' -or $App.stop_grace_period -ne '30s') {
    throw 'stop_grace_period deve resolver para database=1m e app=30s.'
  }

  if (
    $null -eq $App.PSObject.Properties['depends_on'] -or
    $null -eq $App.depends_on.PSObject.Properties['database'] -or
    $App.depends_on.database.condition -ne 'service_healthy'
  ) {
    throw 'A aplicação deve depender do database com condition service_healthy.'
  }

  $DatabaseNetworks = @($Database.networks.PSObject.Properties.Name | Sort-Object)
  $AppNetworks = @($App.networks.PSObject.Properties.Name | Sort-Object)
  if (($DatabaseNetworks -join ',') -ne 'xp_whatsapp_internal') {
    throw "Database deve usar somente xp_whatsapp_internal; encontrado: $($DatabaseNetworks -join ',')"
  }
  if (($AppNetworks -join ',') -ne 'xp_whatsapp_egress,xp_whatsapp_internal') {
    throw "App deve usar redes interna e egress; encontrado: $($AppNetworks -join ',')"
  }

  if ($Resolved.networks.xp_whatsapp_internal.internal -ne $true) {
    throw 'A rede resolvida xp_whatsapp_internal não está marcada como internal.'
  }

  $DatabaseVolumes = @($Database.volumes)
  $AppVolumes = @($App.volumes)
  if (
    $DatabaseVolumes.Count -ne 1 -or
    $DatabaseVolumes[0].type -ne 'volume' -or
    $DatabaseVolumes[0].source -ne 'xp_whatsapp_postgres' -or
    $DatabaseVolumes[0].target -ne '/var/lib/postgresql'
  ) {
    throw 'Database deve montar somente xp_whatsapp_postgres em /var/lib/postgresql.'
  }
  if (
    $AppVolumes.Count -ne 1 -or
    $AppVolumes[0].type -ne 'volume' -or
    $AppVolumes[0].source -ne 'xp_whatsapp_media' -or
    $AppVolumes[0].target -ne '/data/media'
  ) {
    throw 'App deve montar somente xp_whatsapp_media em /data/media.'
  }
  if (
    $Resolved.volumes.xp_whatsapp_postgres.name -ne 'xp_whatsapp_postgres' -or
    $Resolved.volumes.xp_whatsapp_media.name -ne 'xp_whatsapp_media'
  ) {
    throw 'Os volumes resolvidos precisam preservar os nomes explícitos.'
  }

  if ($App.environment.NEXT_PUBLIC_APP_URL -ne 'https://whatsapp.xpeletronicos.com') {
    throw 'NEXT_PUBLIC_APP_URL resolvida deve usar a origem HTTPS aprovada.'
  }
} finally {
  $env:POSTGRES_PASSWORD = $PreviousPostgresPassword
  $env:DATABASE_URL = $PreviousDatabaseUrl
  $env:AUTH_SECRET = $PreviousAuthSecret
  $env:APP_PORT = $PreviousAppPort
  Pop-Location
}

Write-Host 'Deployment configuration verified.'
