# Sincronização oficial entre XP Atendimento e WhatsApp Business

**Data:** 2026-08-23
**Status:** desenho aprovado para planejamento
**Base documental:** `c2cfd268d7848637e8a6c4eb3d3dd2153b3fb2de`

## Contexto

A XP Eletrônicos usa o mesmo número em coexistência oficial na WhatsApp Cloud API e no WhatsApp Business App. O objetivo é deixar o atendimento consistente entre o XP Atendimento, o telefone principal e os dispositivos vinculados suportados pela Meta, sem emular WhatsApp Web, sem QR Code não oficial e sem protocolos privados.

A expressão “100% sincronizado” significa, neste desenho, **sincronizar todo estado que a Meta expõe oficialmente para conversas individuais**. Estado que a Meta não expõe continua sendo controlado exclusivamente pelo XP Atendimento.

Referências oficiais:

- [Onboarding de usuários do WhatsApp Business App e coexistência](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Envio de mensagens e confirmações de leitura](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)
- [Especificação OpenAPI oficial da Meta](https://github.com/facebook/openapi)

## Estado confirmado antes do desenho

Em 2026-08-23, a aplicação em produção executava a imagem imutável `xp-whatsapp:2f8f865aa9a70047fbb5223dbef146bc3d41e0cf`. O Caddy possuía o hotfix equivalente a `2c1ef9f0f8a18431144134e9bf2ee963a5cced16` para permitir a visualização de PDF somente no preview autenticado e de mesma origem. O container estava saudável, sem reinicializações, e as 17 migrations estavam concluídas.

O readback vivo da Meta confirmou uma inscrição ativa para `whatsapp_business_account`, callback correto e 12 campos, incluindo `messages`, `smb_message_echoes` e `smb_app_state_sync`. O campo `history` não estava inscrito. O número respondeu `is_on_biz_app=true`, `platform_type=CLOUD_API` e qualidade `GREEN` tanto na Graph v23 quanto em uma leitura de compatibilidade v26.

O banco de produção continha:

- 1.973 eventos persistidos, todos processados e nenhum em estado `FAILED`;
- 816 eventos de mensagem recebida;
- 399 ecos de mensagens enviadas pelo WhatsApp Business App;
- 754 mudanças de status;
- 24 alvos de confirmação de leitura, todos confirmados e sem falha;
- zero contatos importados do WhatsApp Business App;
- três controles de edição do app oficial que foram aceitos, mas não aplicados;
- um controle de revogação aplicado;
- duas edições recebidas de clientes armazenadas como mensagem não compatível;
- 23 conversas respondidas pelo app oficial que continuavam com mensagens não lidas no painel.

A tentativa anterior de carga inicial de contatos retornou Meta `OAuthException` código `131000` e não foi repetida. Como a Meta permite iniciar contatos e histórico apenas uma vez, dentro da janela do onboarding, uma nova carga completa exige offboarding e um novo Embedded Signup controlado.

## Limites oficiais

### Suportado

- conversas individuais, incluindo espelhamento de mensagens novas nos dois sentidos;
- texto, imagens, áudios, vídeos, documentos, figurinhas e tipos estruturados expostos nos webhooks;
- respostas contextuais quando o payload oficial inclui a referência;
- reações, edições e revogações expostas pela Meta;
- status de envio, entrega, leitura pelo cliente e falha;
- contatos da agenda do WhatsApp Business App;
- até seis meses de histórico, quando o estabelecimento autoriza o compartilhamento durante o onboarding;
- telefone principal e dispositivos vinculados suportados.

### Não suportado ou não observável

- grupos, chamadas, canais, catálogo e outras ferramentas comerciais não são sincronizados pela coexistência;
- etiquetas, respostas rápidas, mensagem de ausência e demais ferramentas locais do WhatsApp Business App não são expostas para sincronização pela Cloud API;
- WhatsApp para Windows e WearOS são dispositivos vinculados não suportados na coexistência documentada;
- a Meta não fornece um evento de coexistência que informe que um funcionário apenas abriu uma conversa no WhatsApp Business App sem responder;
- não será atribuída a um funcionário específico uma ação feita no app oficial, pois o eco identifica o canal empresarial, não a pessoa que usou o telefone.

## Modelo de autoridade

| Estado | Autoridade |
| --- | --- |
| Mensagem individual, `wamid`, mídia, reação, edição, revogação e status de provedor | Meta |
| Mensagem criada no painel antes da confirmação externa | XP Atendimento, reconciliada com a Meta |
| Mensagem enviada pelo app oficial | Webhook `smb_message_echoes` |
| Leitura explícita no painel | XP Atendimento e `status: read` enviado à Meta |
| Leitura no app oficial seguida de resposta | Inferência segura a partir do eco da resposta |
| Abertura no app oficial sem resposta | Desconhecida no XP Atendimento |
| Não lida manual, responsável, categoria, etiquetas, lembretes e fixação | XP Atendimento |
| Nome apresentado | Nome manual, depois agenda sincronizada, perfil do WhatsApp e telefone |

Um estado local não deve sobrescrever silenciosamente um fato posterior da Meta. Um evento da Meta não deve apagar estado operacional que não pertence à Meta.

## Arquitetura

O trabalho será entregue em quatro releases independentes. Cada unidade tem uma responsabilidade clara, usa transações idempotentes e publica eventos em tempo real somente depois do commit.

### 1. Leitura compartilhada inferida por resposta oficial

O processador de `messageEcho` continuará persistindo a mensagem enviada pelo WhatsApp Business App. Na mesma transação serializável, depois de criar o eco, ele localizará a mensagem recebida mais recente que não seja posterior ao eco e avançará `teamLastReadMessageId` e `teamLastReadAt` até esse limite.

Regras:

- a leitura compartilhada nunca regride;
- somente um eco empresarial persistido pode produzir essa inferência;
- não será criada uma leitura individual para nenhum funcionário;
- `manualUnreadAt` e `manualUnreadByUserId` permanecem inalterados;
- a própria mensagem empresarial é a evidência de auditoria, sem inventar identidade de atendente;
- o mesmo commit atualiza o estado de resposta, de modo que todas as sessões vejam a conversa como respondida e lida pela equipe;
- o evento em tempo real contém somente IDs e faz cada navegador buscar novamente o estado autorizado.

Haverá um backfill idempotente para conversas existentes. Antes de alterar dados, ele executará um modo de simulação e calculará novamente o total; o número observado de 23 conversas não será codificado no script. Uma conversa só será corrigida quando:

- possuir mensagens recebidas depois do limite compartilhado atual;
- não estiver aguardando resposta;
- sua resposta empresarial oficial mais recente for posterior à mensagem recebida mais recente;
- a origem da resposta for um eco do app oficial, e não uma mensagem interna do painel.

Para o backfill, “eco do app oficial” exige uma mensagem `OUTBOUND` sem `sentByUserId` e sem `clientRequestId`, com `wamid` associado a um `WebhookEvent` processado do tipo `messageEcho`. A ausência de qualquer uma dessas evidências exclui a conversa da correção.

O backfill preserva a marca manual de não lida e executa em uma transação limitada. Uma segunda execução não produz mudanças.

### 2. Edições e revogações

O normalizador reconhecerá controles oficiais em `messages` e `smb_message_echoes`. Edições recebidas deixam de criar uma nova mensagem `UNSUPPORTED`; elas passam a apontar para o `original_message_id` e carregar o novo conteúdo validado. Revogações apontam para a mensagem original e a transformam em tombstone.

Será adicionado um modelo `MessageRevision` e campos de mutação em `Message`:

- `Message.editedAt`, anulável;
- `Message.lastMutationAt`, anulável, usado para precedência monotônica;
- `MessageRevision.id`;
- `MessageRevision.messageId`;
- `MessageRevision.providerEventId`, único;
- `MessageRevision.action`, com `EDIT` ou `REVOKE`;
- `MessageRevision.providerTimestamp`;
- cópia interna do corpo e conteúdo anteriores somente para revisões de edição;
- `createdAt`.

O conteúdo atual permanece em `Message`. Uma edição salva primeiro a revisão anterior e depois aplica corpo, conteúdo, legenda e texto de busca novos. O ativo de mídia não é substituído por uma edição de legenda. Uma revogação preenche `revokedAt`; o DTO público não expõe o conteúdo revogado e a interface mostra `Mensagem apagada`.

As revisões são evidência interna de integridade. Este projeto não cria endpoint nem interface para consultar textos anteriores; nenhum DTO de conversa, busca, SSE ou log expõe esse conteúdo.

Eventos repetidos são deduplicados por ID oficial. Eventos mais antigos não desfazem uma edição mais nova. Se o alvo ainda não existir e o evento for recente, a rota responde como falha transitória para permitir retry da Meta. Histórico é processado em ordem e reconcilia a versão final.

A interface mostra `editada` ao lado do horário. Busca e prévias citadas usam o conteúdo atual. Reações podem continuar registradas em uma mensagem editada; uma mensagem revogada não oferece novas ações.

Os cinco eventos de edição já observados em produção não possuem payload bruto persistido e não podem ser reconstruídos com segurança a partir da tabela de eventos. Eles serão reconciliados apenas se o histórico oficial posterior fornecer o estado final; nenhum texto será inventado.

### 3. Controle de saúde da coexistência

O backend passará a processar `account_update` para reconhecer `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED` e `ACCOUNT_RECONNECTED`, incluindo a categoria de desconexão disponibilizada pela Meta. Também registrará sinais operacionais de mensagens não suportadas com o código oficial `131060`.

Um modelo singleton por número, `WhatsAppCoexistenceState`, guardará apenas estado operacional:

- `phoneNumberId`;
- `connectionStatus`: `UNKNOWN`, `CONNECTED`, `DISCONNECTED` ou `RECONNECTING`;
- instante do último evento de mensagem recebida, eco, status, contato e histórico;
- instante e categoria da última falha sanitizada;
- situação da carga inicial de contatos e histórico;
- `historyCutoverAt`, capturado imediatamente antes de solicitar a carga inicial;
- `updatedAt`.

Tokens, corpos de mensagens, nomes e telefones não entram nessa tabela nem nos logs. O painel administrativo mostrará conexão, último evento por canal, atraso, cargas iniciais e uma orientação segura. A desconexão não apaga mensagens nem contatos. O envio pelo painel fica bloqueado com explicação pública quando a Meta confirmar que a conexão foi removida.

Os desenhos paralelos de alertas de qualidade da Meta serão auditados antes deste release. Conceitos compatíveis podem ser integrados, mas nenhuma branch antiga será mesclada por inteiro sobre a base atual.

A Graph v23 continuará durante os dois primeiros releases para não combinar mudança funcional e mudança de versão. A compatibilidade v26 será verificada neste release; a alteração de ambiente somente ocorrerá se todos os contratos e probes oficiais passarem. Caso contrário, a atualização de versão será um rollout separado.

### 4. Histórico e contatos iniciais

O código para `history` será publicado **antes** de qualquer mudança na Meta. O normalizador aceitará somente o envelope oficial, imporá limites por lote e transformará mensagens históricas no mesmo contrato canônico usado pelos eventos em tempo real.

O importador:

- processa lotes em blocos limitados e transações curtas;
- deduplica por `wamid` e pelas chaves existentes de webhook;
- resolve direção, contato, conversa, resposta contextual, mídia, reação, edição e revogação quando presentes;
- não regride status nem timestamps já conhecidos em tempo real;
- preserva nomes manuais, responsáveis, categorias, etiquetas, lembretes, fixações e marcações manuais de não lida;
- não duplica conversas que possuam telefone e identificadores equivalentes;
- reaproveita o pipeline seguro de recuperação de mídia;
- registra somente contagens agregadas e erros sanitizados na saúde da sincronização.

`historyCutoverAt` separa baseline histórico de operação em tempo real. Mensagens importadas com timestamp igual ou anterior a esse corte servem como contexto e não criam uma fila artificial de conversas pendentes. Para uma conversa que exista apenas no histórico, o limite compartilhado inicia na mensagem histórica mais recente e `awaitingResponseSince` fica vazio. Para uma conversa já ativa no XP Atendimento, `teamLastReadMessageId`, `teamLastReadAt`, `manualUnreadAt` e `awaitingResponseSince` permanecem inalterados durante o baseline; somente um evento em tempo real posterior ao corte pode avançar esses estados.

A sincronização de contatos reutiliza o modelo e a precedência já publicados. A carga inicial e as alterações futuras não criam conversas artificiais.

Depois que o receptor estiver saudável em produção, a operação externa exige nova autorização do proprietário:

1. fazer backup e readback exato da inscrição atual;
2. acrescentar somente `history`, preservando os 12 campos existentes;
3. confirmar o novo readback antes de prosseguir;
4. executar offboarding e novo Embedded Signup de coexistência;
5. o estabelecimento escolhe compartilhar o histórico e mantém o WhatsApp Business App aberto;
6. dentro de 24 horas, solicitar uma única vez `smb_app_state_sync` e uma única vez `history`;
7. guardar os `request_id` somente em registro operacional protegido;
8. acompanhar lotes, deduplicação, mídia, saúde e ausência de falhas;
9. religar manualmente os dispositivos vinculados suportados que o onboarding desconectar;
10. validar telefone principal, um dispositivo vinculado suportado e duas sessões do painel.

Nenhuma chamada inicial será repetida automaticamente. Uma resposta de erro interrompe a operação e preserva o estado para diagnóstico.

## Fluxos principais

### Mensagem recebida

1. Meta assina e envia `messages`.
2. A rota valida assinatura antes de JSON e normaliza o evento.
3. Uma transação reserva a chave idempotente, resolve contato e conversa e persiste a mensagem.
4. O estado de resposta passa a aguardar a equipe.
5. O commit ocorre.
6. SSE publica apenas IDs; todas as sessões refazem a consulta autorizada.

### Resposta enviada pelo app oficial

1. Meta envia `smb_message_echoes`.
2. O backend deduplica e persiste a mensagem empresarial.
3. Na mesma transação, limpa a espera de resposta e avança a leitura da equipe até a última entrada anterior.
4. A marca manual de não lida permanece.
5. Depois do commit, todas as sessões recebem a atualização.

### Resposta enviada pelo painel

O fluxo atual permanece: criação idempotente local, chamada oficial, reconciliação por `wamid`, status monotônicos e aparecimento no WhatsApp Business App por coexistência. A janela de atendimento e templates pertencem a um projeto paralelo e não serão implementados implicitamente por este desenho.

### Edição ou revogação

1. O controle é validado e correlacionado ao original por `wamid`.
2. Identidade da conversa e precedência temporal são verificadas.
3. A revisão é salva e o estado atual é alterado atomicamente.
4. Busca, prévia e UI passam a refletir o estado atual.
5. Um evento de status sem conteúdo faz os navegadores refazerem a consulta.

## Falhas e recuperação

- assinatura inválida, payload acima do limite ou estrutura inválida são rejeitados sem gravação parcial;
- duplicatas retornam sucesso sem repetir efeito;
- alvo recente ausente, conflito serializável, indisponibilidade de banco ou Graph e falha transitória de mídia pedem retry;
- identidade incompatível é colocada em quarentena sem associar dados ao cliente errado;
- eventos antigos fora de ordem nunca fazem status, leitura ou conteúdo regredir;
- dados históricos malformados são isolados por item quando for seguro continuar; corrupção do envelope interrompe o lote;
- erros públicos ficam em português e não expõem Graph, stack, token, telefone, corpo, caminho ou payload bruto;
- o worker de mídia e o worker de confirmação de leitura continuam com concessão, retry limitado e recuperação após reinicialização.

## Integração entre worktrees

Nenhum deploy usa uma branch por nome como prova de que ela é atual. A revisão candidata é construída somente depois de uma auditoria repetida imediatamente antes de cada release.

Gate obrigatório:

1. listar todas as worktrees, branches e HEADs;
2. registrar `git status` de cada uma, incluindo arquivos não rastreados;
3. comparar commits exclusivos e diffs contra a candidata e contra a revisão viva da KVM;
4. classificar cada diferença como código, teste, migration, infraestrutura ou documentação;
5. não editar, descartar, mover ou sobrescrever trabalho paralelo não commitado;
6. integrar alterações compatíveis de forma explícita, nunca mesclar por inteiro uma branch antiga e divergente;
7. regenerar Prisma a partir do schema combinado quando necessário;
8. executar todos os gates depois da integração;
9. repetir a auditoria imediatamente antes do build;
10. construir a imagem a partir de um arquivo Git limpo do SHA exato.

Na criação deste documento, `codex/media-gallery` possuía mudanças paralelas não commitadas em rota/teste de mídia, conversor de gravação e thumbnail de PDF. Elas permaneceram intocadas. A especificação foi criada em uma worktree isolada a partir de `c2cfd26`.

O desenvolvimento será conduzido sem subagentes, conforme restrição do usuário.

## Estratégia de testes

### Release 1

- RED/GREEN para eco que avança leitura compartilhada;
- não regressão, concorrência, duplicata e timestamp empatado;
- preservação de `manualUnreadAt`;
- nenhuma leitura individual inventada;
- simulação, aplicação e segunda execução vazia do backfill;
- duas sessões do painel atualizadas pela mesma resposta oficial.

### Release 2

- fixtures oficiais para edição e revogação recebidas e ecoadas;
- texto e legenda de mídia;
- alvo ausente, identidade errada, duplicata e eventos fora de ordem;
- revisão persistida antes da mutação;
- busca atualizada, citação, reação e tombstone acessível;
- DTO sem conteúdo revogado ou revisão interna.

### Release 3

- todos os eventos de conexão e motivos de desconexão documentados;
- estado monotônico, alerta administrativo e bloqueio de envio desconectado;
- ausência de PII e segredo em banco de saúde, SSE e logs;
- contratos Graph v23 e v26 antes de qualquer mudança de ambiente.

### Release 4

- payloads de histórico vazios, parciais, grandes, duplicados e fora de ordem;
- sobreposição com mensagens em tempo real sem duplicação;
- contatos adicionados, editados e removidos;
- mídia recuperável e indisponível;
- conversa exclusivamente histórica sem gerar pendência artificial;
- preservação integral do estado operacional local;
- erro de histórico não compartilhado `2593109`;
- operação inicial chamada uma única vez.

### Gates de cada release

- validação do schema e migrations;
- lint e typecheck;
- testes focados;
- suíte completa em PostgreSQL isolado e descartável;
- build de produção;
- auditoria de dependências de produção;
- imagem Linux imutável do SHA exato;
- teste do container candidato antes de promover;
- verificação autenticada no navegador e teste manual no telefone quando o release envolver coexistência.

## Deploy incremental e rollback

Cada release é publicado separadamente e fica disponível ao usuário antes do próximo:

1. leitura inferida e backfill;
2. edições e revogações;
3. saúde e ciclo de conexão;
4. receptor de histórico/contatos e, depois de nova autorização, operação Meta.

Antes de cada deploy:

- backup validado de banco e mídia;
- confirmação da revisão e containers vivos;
- hash dos containers não relacionados;
- migration aditiva;
- troca somente do container `xp-whatsapp-app`;
- PostgreSQL, Caddy e demais sistemas da KVM não são recriados.

Depois de cada deploy:

- migrations completas e sem rollback;
- health local e público;
- container saudável e sem reinício;
- logs sem falha fatal, 5xx inesperado ou segredo;
- agregados de webhook sem pendência permanente;
- teste funcional correspondente ao release;
- registro do SHA, imagem, backup e caminho de rollback.

O rollback de aplicação recria somente a imagem anterior. Migrations aditivas permanecem. Se `history` já tiver sido acrescentado à assinatura e o receptor apresentar problema, remove-se apenas esse campo e confirma-se o readback dos campos anteriores. Eventos históricos já persistidos não são apagados automaticamente. Offboarding e re-onboarding não são tratados como reversíveis e exigem confirmação separada imediatamente antes da operação.

## Critérios de aceitação

- uma mensagem enviada pelo painel aparece no app oficial e uma mensagem enviada pelo app oficial aparece uma vez no painel;
- uma resposta oficial remove `aguardando resposta` e avança a leitura compartilhada em todas as sessões;
- uma marca manual de não lida sobrevive à inferência por resposta;
- abrir no app sem responder continua explicitamente tratado como estado não observável;
- edições futuras atualizam a mensagem e mostram `editada` sem perder auditoria;
- revogações futuras mostram `Mensagem apagada` e não expõem o conteúdo no DTO;
- status e reações não regressam nem duplicam;
- desconexão e reconexão ficam visíveis ao administrador;
- histórico autorizado de até seis meses é importado sem duplicar o período já existente;
- contatos iniciais e futuros seguem a precedência de nomes e não criam conversas artificiais;
- grupos, chamadas, etiquetas e respostas rápidas do app oficial não são apresentados como sincronizados;
- cada release é auditado contra todas as worktrees imediatamente antes do deploy e não sobrescreve trabalho paralelo.
