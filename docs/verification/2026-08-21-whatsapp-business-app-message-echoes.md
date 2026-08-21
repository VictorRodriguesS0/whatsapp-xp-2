# WhatsApp Business App Message Echoes — verificação de produção

Data: 2026-08-21

Resultado: **rollback de segurança concluído; funcionalidade não ativada em produção**.

Este relatório contém somente contagens, hashes, timestamps e status. Não registra credenciais, identificadores Meta, telefones, conteúdo de mensagens, nomes de arquivos, payloads ou outros dados pessoais.

## Artefatos aprovados

- Commit candidato limpo: `2088a7d6d46d85e824160c221be947491bbd1f68`.
- Imagem candidata: `sha256:4caadd7149d8baef49317cd29417a3c5a416cb44eb3be850fd156485287fa474`.
- Revisão OCI da candidata: igual ao commit candidato completo.
- SHA-256 do Git archive da candidata: `5ee9708fcc955bbc1130feb92c2de1d8529268040c889f420c614b4fbba9ef9b`.
- Commit de compatibilidade para rollback: `df73767bf40eed36271bdef84292ad78263202e0`.
- Imagem de rollback: `sha256:7407d208457bfca9e3b05d71535765f2f5c88eebb1e7e411f8057915156f0270`.
- Revisão OCI do rollback: igual ao commit de rollback completo.
- SHA-256 do Git archive do rollback: `45ea08447fd3412d34dd2ed02ed121dad43fd32e636badd64849ae6ca3236e46`.
- SHA-256 do Compose canônico: `8ae98c2ca3c6092ed36d02ff1e4658c941e9d46475ec5bf6b53ff91369fe86d2`.

Os dois archives foram extraídos em releases novas e inativas, com marcadores declarativos de revisão e origem. A candidata teve 254 arquivos e zero entradas graváveis depois da preparação. O rollback foi reconstruído de um archive bruto LF; 252 blobs rastreados corresponderam exatamente ao Git.

## Gates locais

Os gates usaram PostgreSQL de teste isolado em `127.0.0.1:55432` e um banco terminado em `_test`. O banco de desenvolvimento `xp-whatsapp-database` não foi usado.

- Migrações: 5 aplicadas no banco isolado.
- Vitest completo rastreado, excluindo `.superpowers/**`: 71 arquivos passaram, 2 foram ignorados; 645 testes passaram e 3 foram ignorados.
- ESLint, TypeScript, Prisma validate/generate e build de produção: passaram.
- Auditoria de produção e auditoria completa: zero vulnerabilidades.
- Verificações de Compose e deployment KVM: passaram.
- Imagem candidata em smoke test: saudável, HTTP interno/host 200, UID 1001 e zero testes da aplicação empacotados.

## Matriz de rollback

A imagem `df73767` foi executada contra uma cópia restaurada de banco sintético já migrado.

- Leituras de contato sem telefone e mensagem outbound sem ator: passaram.
- Envio para contato somente BSUID: HTTP 409, zero mutação, zero avanço da conversa e zero tentativa de provedor.
- Envio para contato com telefone: HTTP 201 e exatamente uma mensagem `SENT`.
- Health: saudável.
- Respostas 5xx: zero.

A imagem anterior à nulabilidade de contato permaneceu preservada como baseline histórico, mas não foi usada como rollback depois da migração.

## Preflight e backup

O preflight confirmou o baseline aprovado, revisão OCI conhecida, app e banco saudáveis, UID 1001, três redes no app, uma rede no banco, symlink atual e Compose válido.

Antes de alterar symlink, runtime ou Meta, foi criado um backup real de banco e mídia em `2026-08-21T17:37:13Z`.

- SHA-256 do dump: `2d561fa112593a940b180c2da5caaf0f00c7858714ae9dca1e148d0361df5e30`.
- SHA-256 da mídia: `b5bd425d8856bdd4b8d19bd10b9cdd4d64c315f0f91f7fd8fd7ec08422d1e6da`.
- SHA-256 do manifesto: `bcf0f4cb96efdbe8214f1f260962efb0345de15317feba05b7cff9942127404e`.
- Arquivos: 5, todos em modo 0600.
- Checksums, biblioteca de restore, validação da mídia e listagem do dump: passaram.

## Deploy candidato

Somente `xp-whatsapp-app` foi recriado. O entrypoint aplicou as migrações de forma fail-fast.

- App saudável a partir de `2026-08-21T17:43:03Z`.
- Imagem, revisão OCI, provenance marker e Compose corresponderam aos hashes aprovados.
- UID: 1001.
- Redes: app 3; banco 1.
- Health local/público, login e páginas legais: HTTP 200.
- Verificação GET do webhook: HTTP 200.
- POST com assinatura inválida: HTTP 401.
- Snapshot: 34 containers antes e 34 depois; somente o app mudou. Banco, Caddy e os outros 31 containers mantiveram ID e `StartedAt`.
- Logs iniciais: zero ocorrências críticas e zero correspondências de chaves sensíveis.

## Assinatura Meta e acionamento do rollback

A leitura inicial encontrou um único objeto ativo com 10 campos e nenhuma ocorrência de `smb_message_echoes`. A escrita preservou todos os campos existentes e acrescentou somente o campo novo. O primeiro readback confirmou 11 campos, uma ocorrência do novo campo, callback inalterado, objeto ativo e nenhuma outra mudança; a verificação do callback também avançou uma ocorrência.

Antes de qualquer mensagem de teste do usuário, o monitor registrou uma ocorrência de `webhook.processing_failed`, tipo `WebhookProcessingError`, marcada como retryable. Pelo contrato da rota, esse caminho responde HTTP 500. A matriz operacional exigia rollback imediato diante de qualquer 5xx, por isso o teste de texto foi cancelado e nenhum teste de mídia foi solicitado.

Não foi possível atribuir a ocorrência a um echo específico: na janela da candidata houve zero novos registros agregados em `webhook_events`, zero novas mensagens agregadas e zero linhas 500 preservadas no recorte sanitizado do proxy. O evento de aplicação foi suficiente para acionar a política fail-safe, mas sua causa permanece indeterminada.

## Restauração e estado final

A restauração removeu seletivamente somente `smb_message_echoes`; o objeto inteiro nunca foi removido.

- DELETE seletivo: HTTP 200, `success=true`.
- Readback final: 10 campos únicos, zero ocorrências do campo novo.
- SHA-256 do conjunto de nomes ordenado: `a1bfb6d54a382d01512897813d778f09de380456adc01b212fe5bccd513731b7`.
- Conjunto anterior exato, callback e estado ativo: preservados.

Depois do readback, somente `xp-whatsapp-app` foi recriado com a imagem de compatibilidade `df73767`.

- App saudável a partir de `2026-08-21T17:53:16Z`.
- Digest e revisão OCI: iguais ao rollback aprovado.
- Compose config hash: `e348668f6c0128afbba6ea8f28e369e53b3e8039e50ef6d38767370cfc0e5f30`.
- UID: 1001.
- Redes: app 3; banco 1.
- Health, login e páginas legais local/público: HTTP 200.
- Verificação GET do webhook: HTTP 200.
- POST com assinatura inválida: HTTP 401.
- Logs após rollback: zero ocorrências críticas e zero correspondências de chaves sensíveis.
- Snapshot: 34 containers antes e depois; somente o app mudou. Nenhum container foi adicionado ou removido.
- Readback Meta independente após o rollback: 10 campos, hash acima, zero `smb_message_echoes`, callback correto e objeto ativo.

O banco migrado, o backup validado, as imagens candidata/rollback/baseline e a stack saudável foram preservados. PostgreSQL, Caddy, volumes, redes, DNS, número, revisão do app e outros serviços não foram alterados.

## Aceite pendente

- Texto real pelo WhatsApp Business App: **pendente; não executar enquanto a assinatura estiver restaurada e a release candidata estiver desativada**.
- Correlação agregada, ator `WhatsApp`, realtime, estado de resposta e duplicidade: **pendentes do texto estável**.
- Mídia: **pendente de estabilidade do texto e nova concordância do usuário**.

Uma nova tentativa exige investigação do `WebhookProcessingError`, nova autorização operacional, repetição dos gates afetados e outra janela controlada. Este relatório não autoriza reativação automática.
