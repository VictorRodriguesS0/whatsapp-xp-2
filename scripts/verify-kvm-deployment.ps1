$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path $root "deploy/kvm/docker-compose.yml"
$caddyPath = Join-Path $root "deploy/caddy/whatsapp.xpeletronicos.com.caddy"

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

Assert-True (Test-Path -LiteralPath $composePath -PathType Leaf) "Compose isolado da KVM ausente."
Assert-True (Test-Path -LiteralPath $caddyPath -PathType Leaf) "Site do Caddy para o WhatsApp ausente."

$previousEnvironment = @{}
$testEnvironment = @{
    XP_WHATSAPP_IMAGE = "xp-whatsapp:test-immutable"
    POSTGRES_PASSWORD = "test-only-password"
    DATABASE_URL = "postgresql://xp_whatsapp:test-only-password@database:5432/xp_atendimento"
    AUTH_SECRET = "test-only-auth-secret-with-more-than-32-characters"
}

foreach ($entry in $testEnvironment.GetEnumerator()) {
    $previousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

try {
    $json = & docker compose -f $composePath config --format json 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "docker compose config falhou: $($json -join [Environment]::NewLine)"
    $config = ($json -join [Environment]::NewLine) | ConvertFrom-Json
} finally {
    foreach ($entry in $previousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
}

$serviceNames = @($config.services.PSObject.Properties.Name | Sort-Object)
Assert-True (($serviceNames -join ",") -eq "app,database") "A KVM deve criar somente app e database."

$app = $config.services.app
$database = $config.services.database
Assert-True ($app.image -eq "xp-whatsapp:test-immutable") "O app deve usar imagem pré-construída e imutável."
Assert-True ($null -eq $app.build) "A KVM não pode compilar a aplicação."
Assert-True ($app.user -eq "1001:1001") "O app deve executar explicitamente sem root."
Assert-True ([int64]$app.mem_limit -eq 402653184) "O app deve ficar limitado a 384 MiB."
Assert-True ([double]$app.cpus -eq 0.4) "O app deve ficar limitado a 0,40 CPU."
Assert-True ([int64]$database.mem_limit -eq 268435456) "O PostgreSQL deve ficar limitado a 256 MiB."
Assert-True ([double]$database.cpus -eq 0.2) "O PostgreSQL deve ficar limitado a 0,20 CPU."

$appNetworks = @($app.networks.PSObject.Properties.Name | Sort-Object)
$databaseNetworks = @($database.networks.PSObject.Properties.Name | Sort-Object)
Assert-True (($appNetworks -join ",") -eq "shared_gateway,xp_whatsapp_egress,xp_whatsapp_internal") "O app deve entrar somente nas três redes previstas."
Assert-True (($databaseNetworks -join ",") -eq "xp_whatsapp_internal") "O banco deve permanecer somente na rede interna."
Assert-True ([bool]$config.networks.shared_gateway.external) "A rede shared_gateway deve ser externa e reutilizada."
Assert-True ($config.networks.shared_gateway.name -eq "shared_gateway") "A rede externa deve manter o nome do gateway existente."

Assert-True ($null -eq $database.ports) "O banco não pode publicar portas."
$publishedPorts = @($app.ports)
Assert-True ($publishedPorts.Count -eq 1) "O app deve publicar uma única porta de diagnóstico."
Assert-True ($publishedPorts[0].host_ip -eq "127.0.0.1") "A porta de diagnóstico deve aceitar somente loopback."
Assert-True ([int]$publishedPorts[0].published -eq 3100) "A porta de diagnóstico deve ser 3100."
Assert-True ([int]$publishedPorts[0].target -eq 3000) "A porta interna do app deve ser 3000."

$caddy = Get-Content -Raw -LiteralPath $caddyPath
Assert-True ($caddy -match "(?m)^whatsapp\.xpeletronicos\.com\s*\{") "O site deve atender somente whatsapp.xpeletronicos.com."
Assert-True ($caddy -match "reverse_proxy\s+xp-whatsapp-app:3000") "O Caddy deve encaminhar para o app pela rede compartilhada."
Assert-True ($caddy -match "max_size\s+105MB") "O limite de upload deve ser 105 MB."
Assert-True ($caddy -match "flush_interval\s+-1") "O proxy deve entregar SSE sem buffering."
Assert-True ($caddy -match "header_up\s+-X-Forwarded-For") "Cabeçalhos de IP forjáveis devem ser removidos."
Assert-True ($caddy -match "header_up\s+X-Real-IP\s+\{remote_host\}") "O Caddy deve fornecer ao app o IP real confiável."
Assert-True ($caddy -match 'Permissions-Policy\s+"[^\"]*microphone=\(self\)') "O microfone deve ser permitido apenas para a própria aplicação."
Assert-True ($caddy -match 'Cache-Control\s+"no-store"') "Conteúdo autenticado não pode ser armazenado em cache."
Assert-True ($caddy -match "(?m)^\s*-X-Powered-By\s*$") "O proxy deve ocultar a tecnologia do servidor de aplicacao."
Assert-True ($caddy -match '(?ms)@pdfPreview\s*\{.*?path\s+/api/media/\*.*?query\s+preview=1.*?\}') "O Caddy deve limitar a exceção de iframe ao preview autenticado de mídia."
Assert-True ($caddy -match '(?ms)header\s+@pdfPreview\s*\{.*?X-Frame-Options\s+"SAMEORIGIN".*?Content-Security-Policy\s+"[^"]*frame-ancestors ''self''[^"]*".*?\}') "O preview de PDF deve poder ser incorporado somente pela própria origem."
Assert-True ($caddy -match 'X-Frame-Options\s+"DENY"') "As demais respostas devem continuar protegidas contra incorporação."
Assert-True ($caddy -match 'Content-Security-Policy\s+"[^"]*frame-ancestors ''none''[^"]*"') "As demais respostas devem manter frame-ancestors none."
Assert-True ($caddy -notmatch "(?i)(password|secret|access[_-]?token)\s+[=:]\s*\S+") "O site do Caddy não pode conter segredos."

Write-Host "KVM deployment verification passed."
