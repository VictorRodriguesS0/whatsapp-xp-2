# Verificação da reconexão Meta

Data: 10/09/2026. Branch: `codex/meta-reconnection`.

## Escopo entregue

- Estado de conexão independente da qualidade do número e bloqueio de envios após desconexão confirmada.
- Embedded Signup v4 para o mesmo app, negócio, WABA e número, com administração autenticada, tentativas temporárias e validação no servidor.
- Interface em `/configuracoes/meta`, aviso sobre aparelhos adicionais e consulta de progresso.
- Duas migrações aditivas, cliente Prisma regenerado e novas variáveis repassadas pelos dois Compose.
- [Runbook de configuração, uso e reversão](../meta-reconnection.md).

## Verificações locais

`npm test`: 232 arquivos aprovados, 2 opcionais ignorados; 2.068 testes aprovados e 3 opcionais ignorados. Houve um aviso de depreciação do driver `pg`, sem falhas.

- PostgreSQL 18 isolado para testes; nenhuma migração ou seed executada no banco da loja.
- Testes novos reproduziram os defeitos antes das correções. Cobertura de callbacks em ambas as ordens, concorrência de tentativas, sessão, expiração, seleção de ativos, cancelamento durante troca, ausência de assinaturas, webhook durante consulta e reação interrompida antes do provedor.
- Revisão independente encontrou quatro defeitos; todos corrigidos e revisados novamente sem bloqueios restantes.
- Build Next.js de produção, TypeScript, ESLint e validação do schema aprovados.
- Verificadores existentes `verify-kvm-deployment.ps1` e `test-deployment.ps1` aprovados.
- Migrações aplicadas no banco local; segunda execução não encontrou migrações pendentes.
- Navegador autenticado com dados fictícios: badge “WhatsApp desconectado”, qualidade “Normal” separada, reconexão desabilitada sem configuração e preservação da desconexão após falha de atualização. Sem erros de console.
- SDK/callbacks e jornada habilitada verificados com simulações em testes; o onboarding real ainda depende dos requisitos externos abaixo.

## Situação externa e limites

A leitura do ambiente existente confirmou acesso aos ativos e campos necessários do webhook. A consulta do número retornou `CONNECTED`, mas ainda com `platform_type=ON_PREMISE` e `is_on_biz_app=true`; isso não comprova a conexão da Cloud API.

A lista de configurações de Facebook Login for Business estava vazia. O assistente de criação ofereceu somente a variação “Geral”, sem a variação WhatsApp Embedded Signup. O rascunho foi cancelado; nenhuma configuração incompatível foi salva. É necessário habilitar o onboarding aplicável no mesmo app e concluir os requisitos de elegibilidade da Meta antes da ativação.

A flag de Embedded Signup no servidor existente permanece desabilitada, sem `config_id`. Não houve deploy desta branch, troca de token, assinatura nova, onboarding real, envio de mensagem a clientes ou reconexão de celular durante esta implementação. Não há alegação de que as desconexões diárias dos aparelhos adicionais foram resolvidas.
