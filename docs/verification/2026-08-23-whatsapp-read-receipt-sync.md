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

Na KVM, a revisão integrada `00ef89a9d307f308885c7a6e580f168c3b79d389` foi executada em um container Node 22 limitado a 0,5 CPU, 2 GiB de memória e 3 GiB de memória mais swap. `DATABASE_URL` e `TEST_DATABASE_URL` apontaram exclusivamente para `xp_read_sync_00ef89a9d307_test`.

O `prisma migrate deploy` aplicou 17/17 migrations em um banco vazio, incluindo conversas fixadas, contatos do aplicativo WhatsApp e `202608230002_whatsapp_read_receipts`. A suíte completa aprovou 1.259 testes em 138 arquivos; dois testes de integração FFmpeg permaneceram ignorados porque a flag opcional não foi habilitada. O banco descartável foi removido automaticamente e a consulta de controle posterior retornou zero bancos `xp_read_sync_%_test`.

## Build

Com `WHATSAPP_PROVIDER=demo` e uma URL PostgreSQL descartável sintaticamente válida, passaram em sequência `npm run db:validate`, `npm run lint`, `npm run typecheck`, `npm run build` e `npm audit --omit=dev`. O Next.js 16.3.1 compilou e gerou 24 páginas; a auditoria local encontrou 0 vulnerabilidades de produção.

O mesmo lint, typecheck, `db:validate` e build passaram novamente no runner Linux integrado. A repetição remota de `npm audit --omit=dev` não alcançou `registry.npmjs.org` por `EAI_AGAIN`; isso ocorreu depois de todos os gates locais e do build e não alterou a lockfile.

## Integração paralela

Foram auditadas e integradas as worktrees limpas:

- `codex/pinned-conversations` em `f1954d5`, cujo código de produção já estava em `8f223a7`;
- `codex/whatsapp-quoted-replies`, sincronização de contatos, inicialmente em `8616cd5` e depois publicada em `c049e0e`;
- `codex/xp-atendimento-mvp` em `6737abe`, somente para preservar a verificação histórica.

Os conflitos gerados do Prisma foram resolvidos regenerando o cliente a partir do schema combinado. Os conflitos de webhook preservaram simultaneamente mensagens, reações, ecos e `contactSyncBatch`. A busca de conversas mantém nome preferido, nome de perfil, telefone e nome sincronizado do WhatsApp. O gate completo descrito acima foi executado depois dessas resoluções.

## Produção

O rollout paralelo publicou exatamente o mesmo código verificado, em `c049e0e18f61431ae8104c00d598bc942a24873f`; a única diferença até o HEAD local posterior é documentação de release. A release ativa é `/opt/apps/example-app/releases/c049e0e18f61431ae8104c00d598bc942a24873f`, imagem `xp-whatsapp:c049e0e18f61431ae8104c00d598bc942a24873f`, image ID `sha256:c34ffce1665b4ee8d1d3b081efe4bd2ac8e0cadc66720aafb594f6f233b8bc37` e container `73effe3fa4b92b2342b794369e3555d7877b47a769d862222a73d01b992f43c1`.

Os healthchecks local e público retornaram `{"status":"ok"}`; o container ficou `healthy`, com zero reinícios. O banco registrou 17 migrations concluídas, zero incompletas e zero revertidas, e listou `202608230002_whatsapp_read_receipts` como a mais recente. A varredura dos logs não encontrou `Unhandled`, `FATAL`, `panic`, token ou cabeçalho Bearer.

Antes do teste manual, `whatsapp_read_sync` tinha zero linhas: nenhuma conversa elegível havia sido aberta após o rollout.

## Rollback

O backup pré-rollout está em `/srv/backups/example-app/example-backup`, diretório de 18 MiB com dump do banco, arquivo de mídia, manifesto e checksums. O rollback app-only aponta para a release e imagem anteriores `8f223a77bc05c4a592991c34a2cd8d4c955984ae`; as migrations são aditivas e devem permanecer.
