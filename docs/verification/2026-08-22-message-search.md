# Verificação de produção — pesquisa de mensagens

Data: 2026-08-22

Versão: `ed4aaecc02fb837f6d662988b6b8f3664de24334` (`xp-whatsapp:ed4aaec`)

## Escopo verificado

- Pesquisa global por conteúdo de mensagens.
- Pesquisa dentro da conversa aberta.
- Paginação estável, abertura do contexto exato e destaque temporário.
- Busca sem alterar o estado compartilhado de leitura ou resposta.
- Índice PostgreSQL `pg_trgm` e preenchimento retroativo do conteúdo pesquisável.

## Gate técnico

- Build Next.js de produção concluído.
- Suíte: 1.058 testes passaram na execução completa; um contrato excedeu por 96 ms o timeout de 5 s sob carga.
- Reexecução isolada do contrato lento: 12/12 testes passaram com margem de infraestrutura adequada.
- Total funcional coberto: 1.059 testes.
- ESLint: aprovado.
- TypeScript (`tsc --noEmit`): aprovado.
- Prisma validate: aprovado.
- Auditoria de dependências de produção: 0 vulnerabilidades.
- As 12 migrations foram aplicadas do zero em PostgreSQL 18 descartável.

O Docker local ficou indisponível após falta de espaço no disco do Windows. Para não reduzir a cobertura, o gate final foi executado na KVM em rede e banco temporários isolados, removidos após a validação. Nenhum dado de produção foi usado.

## Implantação

- Backup validado: `/srv/backups/example-app/example-backup`.
- Migration aplicada: `202608220003_message_search`.
- Banco permaneceu no mesmo container e com o mesmo `StartedAt`.
- Somente o container da aplicação foi recriado.
- Aplicação executando como `1001:1001`, nas redes esperadas, com zero reinícios.

## Pós-deploy

- `/api/health`: 200 local e público.
- `/login`: 200 local e público.
- `/conversas` sem sessão: 307.
- Webhook com assinatura inválida: 401.
- Prisma: 12 migrations, schema atualizado e nenhuma pendência.
- Três amostras de saúde espaçadas por 10 segundos: `healthy`, zero reinícios e resposta `ok`.
- Logs do novo container sem `error`, `exception`, `fatal` ou `panic` no intervalo verificado.

