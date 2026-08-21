# Shared Inbox State — checkpoint A de produção

Data: 2026-08-21

Status: **DONE_WITH_CONCERNS** — a release `ef61c05` está ativa e saudável, sem regressão de runtime ou infraestrutura. O audit exato encontrou duas conversas com estado derivado histórico incorreto, criado pela versão anterior; durante uma janela posterior com atividade inbound legítima a contagem global caiu para uma linha, sem migration ou SQL mutável da operação. A aceitação continua pausada até a migration versionada de backfill ser publicada.

Este relatório contém somente contagens, hashes, timestamps e estados operacionais. Não registra credenciais, identificadores Meta, telefones, conteúdo de mensagens, payloads, nomes de clientes ou outros dados pessoais.

## Escopo publicado

O checkpoint A entrega o estado compartilhado de leitura, marcação manual de não lida e necessidade de resposta, incluindo API, SSE e interface. Recuperação de mídia do checkpoint B não faz parte desta publicação.

- Commit: `ef61c053eb228ef237b12bbd58ad035784efbafa`.
- Imagem: `xp-whatsapp:ef61c05`.
- ID imutável da imagem: `sha256:0778e0539b01001923819a715931e2f3ede8fa4e67020f586399c022fb03f7cf`.
- SHA-256 do Git archive LF bruto: `475aec3943c1c88038c695619bae861a4fb127bd11640dde450d624d51b524e9`.
- SHA-256 do archive de imagem transferido: `8760be37d9b468bfa8c3133ba5651b515fd9f4c01f352990b6f1b380c5dbacdf`.
- SHA-256 do Compose canônico: `8ae98c2ca3c6092ed36d02ff1e4658c941e9d46475ec5bf6b53ff91369fe86d2`.
- SHA-256 do Compose resolvido para a candidata: `94bbaad46fd5cc1d705ba5b370a79cfbab3461bedd4dad9eabf1555230bd2f0d`.
- Release: `/opt/apps/example-app/releases/ef61c05`.
- Rollback preservado: `xp-whatsapp:2088a7d`, ID `sha256:4caadd7149d8baef49317cd29417a3c5a416cb44eb3be850fd156485287fa474`.

O archive continha 258 arquivos rastreados. A release inativa recebeu marcadores de revisão, source, imagem e Compose; nenhum arquivo da release ficou gravável. A imagem roda em UID 1001, usa a saída standalone, contém FFmpeg/FFprobe e não contém `.env`, variável sensível incorporada ou teste da aplicação.

## Gates de pré-deploy

O runner foi construído do mesmo Git archive em Linux, com Node 22, FFmpeg 5.1.9 e FFprobe 5.1.9. Ele usou somente o PostgreSQL 18 efêmero `xp_checkpoint_a_20260821_test`; `DATABASE_URL` e `TEST_DATABASE_URL` apontaram para esse banco terminado em `_test`, e `NEXT_PUBLIC_APP_URL` foi `http://localhost:3000`.

- Seis migrations aplicadas no banco isolado.
- Suíte completa: 74 arquivos, 674 testes, zero falhas ou skips.
- PostgreSQL focado: 5 arquivos e 54 testes, duas execuções aprovadas.
- Checkpoint UI/API: 12 arquivos e 124 testes aprovados.
- ESLint, TypeScript, Prisma validate/generate e build de produção: aprovados.
- Auditoria de produção e auditoria completa: zero vulnerabilidades.
- `git diff --check`, verificador de Compose, verificador KVM e mutation tests de deployment: aprovados.

A primeira chamada do checkpoint UI/API foi recusada pelo guard de banco porque o comando forneceu `DATABASE_URL` sem o `TEST_DATABASE_URL` idêntico. A causa foi isolada no ambiente do comando; nenhuma mudança de código foi feita. A repetição exata com ambos apontando ao banco descartável passou 124/124.

## Preflight, Meta e backup

O preflight confirmou 34 containers, app `2088a7d` e banco saudáveis, UID 1001, redes 3/1, revisão/digest conhecidos e Compose canônico. O snapshot exato dos 33 containers non-app teve SHA-256 `468a674b78d14381c28594a16998b5da3647aabf39b634a65a19b30d314d35bc`.

O readback Meta foi exclusivamente GET, com credenciais mantidas em memória e no header. Ele confirmou um objeto ativo, 11 campos únicos, exatamente uma ocorrência de `smb_message_echoes`, callback inalterado e o hash anterior `b60043f2797332ff1937aab7e08c47f07772c20565832ab334c16e3e09ec075e`. Nenhum campo Meta foi escrito.

Antes da migration, a release nova e ainda inativa criou o backup real:

- Caminho: `/srv/backups/example-app/example-backup`.
- SHA-256 do dump: `5623a5555fe55d5ead42de2d041d052ce1d60b0340b9cc86461bfd2b6141be99`.
- SHA-256 da mídia: `57c4bb25cd36b7e858b4b6d8fb45f7692327d1adad005b1e8b8b13ecfc4794db`.
- SHA-256 do manifesto: `64803b0bfc77094e2e2c373ebb0d48e79ac35fb6d7ab86362a67a0aa3d493698`.
- Cinco arquivos, todos em modo 0600.
- Sidecars, manifesto, `pg_restore --list` com 68 entradas e validação integral do archive de mídia com 51 entradas: aprovados.

## Migration e deploy app-only

A migration one-off da imagem candidata executou antes do recreate do app. O banco passou de 5 para 6 migrations, aplicando `202608210003_response_state_index`; o índice `messages_response_state_idx` está `valid` e `ready`, e existem zero migrations falhas. O app antigo permaneceu saudável durante essa etapa.

O recreate começou em `2026-08-21T20:07:10Z` e a candidata ficou saudável a partir de `2026-08-21T20:07:42Z`. Somente `xp-whatsapp-app` mudou de ID e `StartedAt`. O snapshot completo dos 33 containers non-app permaneceu byte a byte igual; PostgreSQL, Caddy, volumes, redes e os outros sistemas não foram recriados.

- Health local e público: HTTP 200.
- Login, privacidade e exclusão de dados: HTTP 200.
- Verificação GET do webhook: HTTP 200.
- POST com assinatura inválida: HTTP 401.
- UID e redes: `1001:1001`, app 3 e banco 1.
- Logs da candidata: zero erros, falhas de processamento, ocorrências críticas ou nomes de chaves sensíveis.
- Caddy responsável pelo domínio: zero respostas 5xx depois do log `Ready`; três reconnects SSE da janela de startup foram classificados causalmente abaixo.
- Readback Meta pós-deploy: exatamente igual ao preflight.
- Rollback automático: não acionado.

Até `2026-08-21T20:13:27Z`, houve sete eventos de webhook novos, todos `PROCESSED`: zero `FAILED`, zero falha de echo/control e zero retry de status órfão. Cinco mensagens novas alcançaram três conversas; as três apresentaram estado de resposta derivado correto. Também foram registrados 34 eventos agregados de leitura e uma marcação manual de não lida. Essas contagens provam atividade estrutural, mas não substituem o aceite humano em duas sessões.

## Concern: duas linhas históricas sem backfill

O sanity check global encontrou duas conversas nas quais `awaiting_response_since` ainda aponta para `t10`, embora a fronteira estável correta seja `t12`. O conjunto de IDs não foi exposto; seu hash sanitizado é `d8ae326f00e5f8fabd5163d9df69ccc4381920cb2086422e8c16877076c216b0`.

A investigação somente leitura fechou a causa:

- ambas seguem a ordem estável `inbound t10 → outbound normal t11 → inbound t12`;
- os outbounds têm ator e client request, e foram persistidos depois da migration compartilhada e antes da candidata;
- toda a história de mensagens dessas duas conversas antecede a migration de índice;
- `2088a7d` persistia o outbound normal sem atualizar o estado de resposta;
- o inbound seguinte usava o algoritmo anterior, que preservava o `awaiting_response_since` não nulo, deixando `t10` em vez de `t12`;
- a migration nova faz apenas `CREATE INDEX` e, portanto, não podia reparar dados existentes;
- nenhuma conversa que recebeu mensagem após a candidata apresenta divergência.

Não houve mutação ad hoc dessas linhas. O follow-up correto é uma migration TDD idempotente que recalcule todas as conversas pela fronteira `(external_timestamp, id)` e atualize apenas valores `IS DISTINCT FROM` o esperado. Ela deve cobrir pelo menos `t10 → t11 outbound → t12`, inbound atrasado, outbound atrasado e empate de UUID. Para uma publicação desse backfill, `ef61c05` deve ser o rollback app-only preferido: `2088a7d` aceita o schema aditivo, mas pode voltar a materializar estado incorreto em tráfego novo.

## Follow-up versionado e condição de publicação

O follow-up foi implementado sem alterar migrations aplicadas:

- implementation commit `b20cacd4efa0ca0524d7bc43e9bce4b7218c80d2`;
- HEAD documental candidato `b638f187fd325c88936c6a351f91ddd91304de73`;
- migration `202608210004_backfill_response_state`;
- contrato PostgreSQL RED com seis fixtures divergentes e GREEN com audit zero, somente seis linhas alvo atualizadas e segunda execução idempotente;
- PostgreSQL focado 59/59 duas vezes;
- Linux/amd64 completo: 75 arquivos, 676 testes, zero falhas e zero skips, PostgreSQL 18 novo `_test`, FFmpeg/FFprobe 5.1.9 e origem `http://localhost:3000`;
- Prisma validate/generate, typecheck, lint, build, duas auditorias de dependência e verificadores Compose/KVM/mutations: aprovados.

A revisão de concorrência encontrou uma precondição operacional importante: o `UPDATE` é transacional e idempotente, mas não é seguro executar contra writers ativos, porque seu snapshot pode anteceder uma mensagem concorrente cujo refresh ainda aguarda o lock da conversa. Por isso a segunda publicação deve usar drain explícito da única instância:

1. criar e validar outro backup real a partir da release nova ainda inativa;
2. parar somente `xp-whatsapp-app` e provar estado `exited`;
3. consultar `pg_stat_activity` de forma agregada e exigir zero client sessions no banco do app, excluída a própria sessão de inspeção;
4. iniciar a candidata diretamente; seu entrypoint executa `migrate deploy` fail-fast antes do servidor;
5. exigir migration 004 concluída, zero migration falha, audit exato zero e candidata healthy antes da promoção;
6. confirmar novamente imagem/revisão/UID/redes, endpoints, logs, Meta e o snapshot byte a byte dos 33 containers non-app.

Não deve existir migration one-off enquanto `ef61c05` estiver ativa. O curto intervalo sem app pode gerar reconnects SSE e callbacks Meta com retry; Caddy, PostgreSQL, volumes, redes, outros containers e os campos Meta permanecem intocados.

### Recuperação P3009

Se o primeiro start falhar, o app permanece parado. A linha `202608210004_backfill_response_state` é inspecionada somente por contagens agregadas de `finished_at`, `rolled_back_at` e estado incompleto.

- Se estiver falha/incompleta: usar a CLI Prisma **da imagem candidata** com `--entrypoint node` para `migrate resolve --rolled-back 202608210004_backfill_response_state`; confirmar zero linha falha; tentar iniciar a candidata exatamente mais uma vez.
- Se a repetição falhar: parar o app, resolver novamente qualquer linha incompleta com a candidata e usar a CLI da imagem `ef61c05` para `migrate deploy` e `migrate status`. Somente depois de eliminar P3009, reativar `ef61c05` e manter a divergência histórica documentada.
- Se a migration 004 tiver concluído e somente o servidor falhar: não resolver nem reverter a migration; confirmar status limpo com a candidata e iniciar `ef61c05`, que é compatível com o schema e o dado recalculado.

O backfill aplicado nunca é revertido. Nenhum ramo autoriza `UPDATE` manual, restore, alteração Meta ou mudança de container non-app. Até a execução desse runbook, `ef61c05` permanece ativa, a migration 004 ausente e o status continua `DONE_WITH_CONCERNS`.

## Causalidade dos 5xx observados

O monitor histórico registrou três 502 do domínio, todos em `GET /api/realtime` às `20:07:43Z`, `20:07:46Z` e `20:07:51Z`. Eram `connection_refused` depois do `StartedAt` do container (`20:07:42.014Z`) e antes do log de prontidão do Next (`20:07:51.840Z`). Desde `20:08:00Z` o domínio ficou com zero 5xx; a rota SSE sem autenticação retorna 401 esperado, o restart count permaneceu zero e não houve erro da aplicação. Esses três eventos pertencem à janela de startup app-only, não a uma regressão da candidata.

## Aceite manual pendente

Sem usar ou criar credenciais, permanecem pendentes os testes humanos em duas sessões autenticadas:

- leitura por A limpa o não lido em B via SSE;
- B marca como não lida e A recebe o estado compartilhado;
- resposta por qualquer atendente limpa **Aguardando resposta** nas duas sessões;
- refresh/reconexão preserva a mesma verdade coletiva.

A release ficou ativa e saudável. Nenhuma senha foi redefinida e nenhum usuário foi criado.
