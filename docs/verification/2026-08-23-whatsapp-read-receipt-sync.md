# Verificação — sincronização de leitura do WhatsApp

## Local

Em 2026-08-23, no Windows, passaram:

- `npm run db:validate`;
- `npm run lint`;
- `npm run typecheck`;
- 92 testes focados do provedor e consumidores;
- 80 testes focados da rota de leitura, worker, instrumentação, hook e tela;
- o contrato integrado de release, 2/2.

A primeira suíte-base foi executada antes de qualquer alteração e não chegou a coletar todos os arquivos porque esta worktree não possuía as variáveis locais. A configuração descartável existente aponta para o host Docker `database`, indisponível fora da rede do Compose; por isso os contratos PostgreSQL foram reservados para um runner isolado na KVM, sem uso do banco de produção.

## Banco de teste

Ainda não executado neste documento.

## Build

Com `WHATSAPP_PROVIDER=demo` e uma URL PostgreSQL descartável sintaticamente válida, passaram em sequência `npm run db:validate`, `npm run lint`, `npm run typecheck`, `npm run build` e `npm audit --omit=dev`. O Next.js 16.3.1 compilou e gerou 24 páginas; a auditoria encontrou 0 vulnerabilidades de produção.

## Integração paralela

Ainda não executada neste documento.

## Produção

Antes da integração, a inspeção somente leitura encontrou `xp-whatsapp-app` saudável, sem reinícios, na imagem `xp-whatsapp:8f223a77bc05c4a592991c34a2cd8d4c955984ae`.

## Rollback

As coordenadas definitivas serão registradas junto com o backup e a publicação.
