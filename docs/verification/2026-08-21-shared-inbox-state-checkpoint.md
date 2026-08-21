# Shared Inbox State — checkpoint A de produção

Data: 2026-08-21

Status: **DONE_WITH_CONCERNS** — a release final `cd61d93b66597d35c00394aca6ebe5d722ba7e74` está ativa e saudável. A migration versionada de backfill foi aplicada com writers drenados e o audit exato terminou em zero. Os gates técnicos, runtime, Meta e infraestrutura passaram; resta somente o aceite humano em duas sessões autenticadas.

Este relatório contém somente contagens, hashes, timestamps e estados operacionais. Não registra credenciais, identificadores Meta, telefones, conteúdo de mensagens, payloads, nomes de clientes ou outros dados pessoais.

## Primeira publicação do checkpoint

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

## Release final com backfill

- Commit de código: `cd61d93b66597d35c00394aca6ebe5d722ba7e74`.
- HEAD documental/runbook: `b86f30d2758bdcdc86bbcd0f5d1414a2e700cbdb`.
- Imagem: `xp-whatsapp:cd61d93b66597d35c00394aca6ebe5d722ba7e74`.
- ID imutável: `sha256:c074995e840877357666192499eaf83a98cd9113cd80290037bd6cbac96d57a9`.
- SHA-256 do Git archive LF bruto: `a8fa14616c26ae56414d3f589b6f22c67218b68f3884ae108710436ec73fe1e7`.
- SHA-256 do image archive gzip: `4dc0c778611e56e6a40507ee5fe0849e89f6c7a20f4a57ba7234f23803b4dbf3`.
- SHA-256 do image tar descompactado: `081f264e7614f9cb79e60d9017127e1d805c44b9aaa9e8c9bcf2f48ea3db4e6d`.
- SHA-256 do Compose canônico: `8ae98c2ca3c6092ed36d02ff1e4658c941e9d46475ec5bf6b53ff91369fe86d2`.
- SHA-256 do Compose resolvido com a tag completa: `e0358096ddafb01b6a9269e8379227937929dee5a9423f0efa6bdbfb8dd63e09`.
- Release: `/opt/apps/example-app/releases/cd61d93b66597d35c00394aca6ebe5d722ba7e74`.
- Rollback preservado: `xp-whatsapp:ef61c05`, ID `sha256:0778e0539b01001923819a715931e2f3ede8fa4e67020f586399c022fb03f7cf`.

O archive final contém 268 arquivos rastreados. A imagem e a release remotas repetiram revisão, source hash e image ID locais; os arquivos da release ficaram não graváveis. O probe confirmou UID/GID 1001, standalone, FFmpeg/FFprobe, health local 200, migration 004 embutida, zero `.env`, zero teste da aplicação e zero chave de ambiente sensível incorporada.

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

### Gates adicionais do backfill e do runbook

- Contrato PostgreSQL RED/GREEN: seis fixtures divergentes antes da 004, audit zero depois, somente seis linhas alvo alteradas e segunda execução idempotente.
- PostgreSQL focado: 7 arquivos e 59 testes, duas execuções aprovadas.
- Linux/amd64: 75 arquivos, 676 testes, zero falhas e zero skips, com PostgreSQL 18 novo `_test`, FFmpeg/FFprobe 5.1.9 e origem `http://localhost:3000`.
- Parser `backup.sh --env-file`, classificador dos cinco estados P3009, restore/helper safety, Compose, KVM e mutation tests: aprovados.
- Prisma validate/generate, typecheck, lint, build, auditoria de produção/completa e `git diff --check`: aprovados.
- O contrato estático do runbook passou no HEAD documental `b86f30d`; os scripts executáveis, Compose e KVM passaram no archive do candidato `cd61d93`.

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

Antes do backfill, o bloco final do runbook criou e validou outro backup real usando o helper da candidata e somente o caminho do env-file canônico:

- Caminho: `/srv/backups/example-app/example-backup`.
- SHA-256 do dump: `6b2b276e93d3575064e1aa358521dd2a7d7c5d88767a9ef264087b34c1f19573`.
- SHA-256 da mídia: `7f4ba263741225cbc1e4c05e80585f55e092dbfbfc9a28ced3a0f63a6fc2469d`.
- SHA-256 do manifesto: `d538b56500b8179f8d24ad06e3585244b7bb9b4f9ab4854e515fa8f85b764355`.
- Cinco arquivos 0600, sidecars válidos, 69 entradas úteis de `pg_restore --list` e archive de mídia validado integralmente.

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

### Segundo rollout app-only

O drain começou em `2026-08-21T21:29:06Z`. Somente `xp-whatsapp-app` foi parado; o estado `exited` e zero client sessions no banco do app foram exigidos antes do start. A candidata subiu pelo entrypoint com `--wait`, ficou healthy no primeiro start e aplicou `202608210004_backfill_response_state` no estado limpo `1/0/0`. Nenhum ramo P3009, resolve, retry ou rollback foi acionado.

O app final tem `StartedAt=2026-08-21T21:29:08.234541794Z`, UID/GID `1001:1001`, três redes e restart count zero. O ponteiro `current` e o env canônico foram promovidos somente depois dos primeiros gates verdes.

- Migrations: 7 aplicadas, zero falhas, zero rolled back, 004 exatamente uma vez e `migrate status` atual.
- Audit exato `(external_timestamp,id)`: zero divergências.
- Contagens antes/depois: 62 conversas, 403 mensagens, 62 contatos, 66 leituras individuais e 39 audits.
- Hash dos campos não alvo de `conversations`, comparado ao backup: `63734cd78035ddc5cb5917654da23807fc74884178138d5720873f36c8e62bc0`, igual.
- Hash integral de `messages`, comparado ao backup: `71924883f4287935bb589154672b0dd0c157e1911aba55cb6bfdaf9d068061b5`, igual.
- Health, login, privacidade e exclusão: HTTP 200; webhook GET 200 com challenge exato; assinatura inválida 401.
- Meta: um objeto, 11 campos/11 únicos, `smb_message_echoes=1`, callback exato e hash `b60043f2797332ff1937aab7e08c47f07772c20565832ab334c16e3e09ec075e`; zero writes.
- Snapshot dos 33 containers non-app antes/depois: `468a674b78d14381c28594a16998b5da3647aabf39b634a65a19b30d314d35bc`, byte a byte igual.
- Logs: zero erro, `webhook.processing_failed`, crítico ou nome de chave sensível.
- Caddy: zero 5xx durante o segundo rollout. Não chegou POST de webhook durante o drain; portanto não houve callback a recuperar nem evento recebido sem persistência.

O monitor final somente leitura de `2026-08-21T21:40:02Z` repetiu health local/público e login `200`, app healthy/restart zero, migrations `7/0/0/1`, índice válido/pronto, audit zero, contagens exatas, Meta `1/11/11/echo1` com hash anterior, snapshot non-app igual, logs da aplicação sem falha/crítico/segredo e zero 5xx do domínio ou dos demais sistemas Caddy. Nenhuma escrita foi feita nesse monitor.

## Concern histórico, agora reconciliado

O sanity check global encontrou duas conversas nas quais `awaiting_response_since` ainda aponta para `t10`, embora a fronteira estável correta seja `t12`. O conjunto de IDs não foi exposto; seu hash sanitizado é `d8ae326f00e5f8fabd5163d9df69ccc4381920cb2086422e8c16877076c216b0`.

A investigação somente leitura fechou a causa:

- ambas seguem a ordem estável `inbound t10 → outbound normal t11 → inbound t12`;
- os outbounds têm ator e client request, e foram persistidos depois da migration compartilhada e antes da candidata;
- toda a história de mensagens dessas duas conversas antecede a migration de índice;
- `2088a7d` persistia o outbound normal sem atualizar o estado de resposta;
- o inbound seguinte usava o algoritmo anterior, que preservava o `awaiting_response_since` não nulo, deixando `t10` em vez de `t12`;
- a migration 003 faz apenas `CREATE INDEX` e, portanto, não podia reparar dados existentes;
- nenhuma conversa que recebeu mensagem após a candidata apresenta divergência.

Não houve mutação ad hoc dessas linhas. O follow-up versionado recalculou todas as conversas pela fronteira `(external_timestamp, id)` e atualizou apenas valores `IS DISTINCT FROM` o esperado. O audit inicial encontrou duas linhas; antes do backfill, atividade legítima já havia reduzido a contagem para uma, sem SQL mutável da operação. Depois da migration 004 a contagem terminou em zero.

## Follow-up versionado e publicado

O follow-up foi implementado sem alterar migrations aplicadas:

- implementation commit `b20cacd4efa0ca0524d7bc43e9bce4b7218c80d2`;
- HEAD documental candidato `b638f187fd325c88936c6a351f91ddd91304de73`;
- migration `202608210004_backfill_response_state`;
- contrato PostgreSQL RED com seis fixtures divergentes e GREEN com audit zero, somente seis linhas alvo atualizadas e segunda execução idempotente;
- PostgreSQL focado 59/59 duas vezes;
- Linux/amd64 completo: 75 arquivos, 676 testes, zero falhas e zero skips, PostgreSQL 18 novo `_test`, FFmpeg/FFprobe 5.1.9 e origem `http://localhost:3000`;
- Prisma validate/generate, typecheck, lint, build, duas auditorias de dependência e verificadores Compose/KVM/mutations: aprovados.

A revisão de concorrência encontrou uma precondição operacional importante: o `UPDATE` é transacional e idempotente, mas não é seguro executar contra writers ativos, porque seu snapshot pode anteceder uma mensagem concorrente cujo refresh ainda aguarda o lock da conversa. Por isso a segunda publicação usou drain explícito da única instância:

1. outro backup real foi criado e validado a partir da release nova ainda inativa;
2. somente `xp-whatsapp-app` foi parado e o estado `exited` foi comprovado;
3. `pg_stat_activity` retornou zero client sessions no banco do app, excluída a própria inspeção;
4. o entrypoint executou `migrate deploy` fail-fast antes do servidor;
5. a 004 concluiu, falhas ficaram em zero, o audit exato zerou e a candidata ficou healthy;
6. imagem/revisão/UID/redes, endpoints, logs, Meta e snapshot non-app foram confirmados novamente.

Não deve existir migration one-off enquanto `ef61c05` estiver ativa. O curto intervalo sem app pode gerar reconnects SSE e callbacks Meta com retry; Caddy, PostgreSQL, volumes, redes, outros containers e os campos Meta permanecem intocados.

### Recuperação P3009

Se o primeiro start falhar, o app permanece parado. A linha `202608210004_backfill_response_state` é inspecionada somente por contagens agregadas de `finished_at`, `rolled_back_at` e estado incompleto. O classificador aceita somente cinco estados:

- falha inicial `0/1/0`: usar a CLI Prisma **da imagem candidata** com `--entrypoint node` para `migrate resolve --rolled-back 202608210004_backfill_response_state`, confirmar zero linha falha e tentar iniciar a candidata exatamente mais uma vez;
- falha só de servidor inicial `1/0/0`: não resolver nem reverter a 004; confirmar `migrate status` limpo com a candidata e iniciar `ef61c05` diretamente;
- após resolve, falha só de servidor `1/0/1`: confirmar status limpo com a candidata e iniciar `ef61c05` sem executar migration adicional pela imagem de rollback;
- retry falho `0/1/1` ou não aplicado `0/0/1`: resolver novamente somente no primeiro caso, exigir zero falhas, executar `migrate deploy` e `migrate status` com `ef61c05` e só então iniciar o rollback;
- qualquer outro histórico ou contagem falha fechado.

O backfill aplicado não será revertido. Nenhum ramo autorizava `UPDATE` manual, restore, alteração Meta ou mudança de container non-app. Como o primeiro start concluiu em `1/0/0`, os ramos de recuperação permaneceram sem uso; `ef61c05` foi preservada como rollback compatível.

## Causalidade dos 5xx observados

O monitor da primeira publicação registrou três 502 do domínio, todos em `GET /api/realtime` às `20:07:43Z`, `20:07:46Z` e `20:07:51Z`. Eram `connection_refused` depois do `StartedAt` do container (`20:07:42.014Z`) e antes do log de prontidão do Next (`20:07:51.840Z`). Desde `20:08:00Z` a primeira release não teve outro 5xx. O segundo rollout teve zero 5xx em toda a janela; portanto não houve regressão nem callback Meta devolvido com 5xx.

## Aceite manual pendente

Sem usar ou criar credenciais, permanecem pendentes os testes humanos em duas sessões autenticadas:

- leitura por A limpa o não lido em B via SSE;
- B marca como não lida e A recebe o estado compartilhado;
- resposta por qualquer atendente limpa **Aguardando resposta** nas duas sessões;
- refresh/reconexão preserva a mesma verdade coletiva.

A release final ficou ativa e saudável. Nenhuma senha foi lida ou redefinida e nenhum usuário foi criado.
