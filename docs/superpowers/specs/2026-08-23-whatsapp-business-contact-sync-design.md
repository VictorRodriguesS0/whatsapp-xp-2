# Sincronização de nomes do WhatsApp Business — Design

**Data:** 2026-08-23

**Status:** aprovado em conversa; aguardando revisão do documento

**Escopo:** sincronização oficial e unidirecional dos nomes salvos no WhatsApp Business App para o atendimento XP

## Objetivo

Usar a coexistência oficial da WhatsApp Business Platform para refletir, no atendimento web, os nomes que a loja salvou no WhatsApp Business do celular. A solução deve importar contatos que ainda não conversaram, receber inclusões/edições/remoções futuras e nunca substituir silenciosamente um nome definido manualmente pela equipe.

O número de produção já foi confirmado como `is_on_biz_app=true` e `platform_type=CLOUD_API`. A assinatura atual possui 11 campos e ainda não contém `smb_app_state_sync`; o backend atual processa `messages` e `smb_message_echoes`, mas ignora esse novo campo.

Referência oficial: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

## Fora do escopo

- Ler a agenda pessoal completa do aparelho fora do WhatsApp Business App.
- Enviar ou editar contatos no celular a partir do atendimento web.
- Criar conversas artificiais para contatos que nunca falaram com a loja.
- Excluir conversas, mensagens, etiquetas, tipos ou responsáveis quando um contato for removido no celular.
- Reconectar ou refazer o onboarding da coexistência sem nova autorização do usuário.
- Criar uma tela administrativa específica para a sincronização nesta entrega.

## Regra de exibição

O nome resolvido segue esta precedência, sem exceções:

1. `preferredName`: nome manual definido pela equipe;
2. nome ativo salvo no WhatsApp Business App;
3. `profileName`: nome público recebido nos webhooks de mensagens;
4. telefone formatado.

Limpar o nome manual faz a interface voltar imediatamente para o nome do WhatsApp Business App, quando ativo. Remover o contato no celular desativa e limpa apenas a fonte sincronizada; o atendimento volta ao nome público ou telefone e preserva todos os dados operacionais.

Um `full_name` que, depois da limpeza de caracteres de controle e formatação, represente apenas o próprio telefone não é considerado nome. Nesse caso a apresentação usa o fallback de telefone mascarado.

## Modelo de dados

Será criada uma fonte autoritativa separada, `WhatsAppAppContact`, mapeada para `whatsapp_app_contacts`:

- `id`: UUID;
- `phone`: telefone canônico em dígitos, único;
- `fullName`: nome salvo, anulável;
- `active`: indica se o contato continua presente na agenda;
- `sourceTimestamp`: instante informado pela Meta;
- `sourceVersionKey`: chave determinística e sem PII usada para desempatar eventos no mesmo instante;
- `createdAt` e `updatedAt` em `timestamptz`.

`Contact` recebe `whatsappAppContactId`, anulável e único, com `onDelete: SetNull`. A relação não cria uma `Conversation`; ela somente permite que um contato real do atendimento encontre a fonte de nome importada. A tabela separada conserva contatos que ainda não conversaram sem transformar a agenda em uma fila de atendimento.

A migration aditiva será `202608230001_whatsapp_app_contacts`. Ela cria somente a nova tabela, a relação anulável, constraints e índices; não altera nem backfilla nomes existentes. Em produção, o agregado esperado avança de `13|0|0` para `14|0|0`.

O telefone permanece na linha inativa porque é necessário para correlacionar uma futura readição e impedir que eventos antigos restaurem nomes removidos. O nome é limpo na remoção. Essa retenção deve constar na política de privacidade como dado operacional da agenda comercial.

## Normalização do webhook

O envelope assinado existente passa a reconhecer `changes[].field === "smb_app_state_sync"`. Cada mudança produz um `NormalizedContactSyncBatchEvent` com itens de contato e uma contagem de itens isolados.

Para cada item:

- `type` deve ser `contact`;
- `action` aceita somente `add` ou `remove`;
- `phone_number` é normalizado para 1–32 dígitos;
- `add` exige `full_name` válido com no máximo 256 caracteres;
- `remove` não exige nome;
- `metadata.timestamp` aceita o formato Unix documentado, incluindo `0` para tombstone histórico;
- nomes removem controles invisíveis/bidirecionais perigosos antes de serem persistidos;
- campos opcionais futuros não são enviados ao navegador nem registrados em logs.

Cada `state_sync` aceita no máximo 5.000 itens. Envelope inválido ou lote acima desse limite continua recebendo resposta segura de erro. Um item individual inválido é isolado, contado sem PII e não impede o processamento dos demais itens válidos do lote; um lote sem nenhum item válido responde 200 com a contagem isolada para não provocar repetição infinita de dados impossíveis de correlacionar.

## Persistência, ordenação e idempotência

O processador trata contatos em blocos de no máximo 250 itens dentro de transações serializáveis. Cada item usa uma chave de deduplicação derivada por SHA-256 de telefone, ação, timestamp e nome normalizado; a chave contém somente o digest hexadecimal, nunca telefone ou nome em texto.

A versão autoritativa é comparada por `(sourceTimestamp, actionRank, sourceVersionKey)`:

- timestamp posterior vence;
- no mesmo timestamp, `remove` vence `add`;
- conflitos `add`/`add` no mesmo timestamp convergem de forma determinística por `sourceVersionKey`;
- `remove` com timestamp `0` cria tombstone quando não existe versão positiva e nunca sobrescreve uma versão positiva posterior;
- duplicatas e reentregas não alteram o resultado.

`add` faz upsert da fonte e tenta associá-la a um `Contact` já existente pelo telefone canônico. `remove` define `active=false`, limpa `fullName` e mantém a relação. Quando uma mensagem futura cria ou converge um `Contact`, o fluxo de identidade procura a fonte ativa pelo telefone e associa a relação na mesma transação. Mesclagens de contatos preservam a relação compatível com o telefone final.

Blocos já confirmados permanecem gravados se um bloco posterior falhar. Na repetição da Meta, a deduplicação ignora os blocos concluídos e retoma o restante.

## API, busca e tempo real

Os DTOs de contato incluem o nome sincronizado somente na forma segura necessária para resolver a apresentação. Tokens, identificadores Meta, chaves de versão e timestamps internos permanecem no servidor.

As consultas de conversas carregam a relação ativa, aplicam a nova precedência e incluem `WhatsAppAppContact.fullName` na busca textual. Filtros, paginação, estados de leitura e estados de resposta não mudam.

Após um lote confirmado, o servidor publica uma única invalidação PII-free `contacts.synced`. Todas as sessões autenticadas refazem a leitura autoritativa das conversas; não são transmitidos nomes ou telefones por SSE. Eventos de mensagem e `contact.updated` existentes permanecem compatíveis.

## Privacidade e observabilidade

- Nenhum payload bruto, nome, telefone, token, segredo ou identificador de contato Meta é escrito em logs.
- Logs contêm somente request ID opaco, quantidade válida, isolada, aplicada, removida, duplicada e falha.
- A política pública de privacidade explica que a agenda comercial do WhatsApp Business pode ser sincronizada para identificação no atendimento e que a remoção limpa o nome importado.
- Pedidos de exclusão existentes abrangem também a linha sincronizada associada ao contato.
- Métricas e relatórios de produção usam apenas agregados.

## Ativação oficial na Meta

A ativação ocorre somente depois de migração, testes, imagem imutável, backup e saúde da candidata:

1. fazer readback da assinatura atual e exigir exatamente `account_alerts`, `account_review_update`, `account_update`, `calls`, `message_template_quality_update`, `message_template_status_update`, `messages`, `phone_number_name_update`, `phone_number_quality_update`, `security` e `smb_message_echoes`;
2. preservar todos os campos e acrescentar somente `smb_app_state_sync`;
3. fazer novo readback e exigir 12 campos únicos, um callback, um `smb_message_echoes` e um `smb_app_state_sync`;
4. solicitar uma vez `POST /{PHONE_NUMBER_ID}/smb_app_data` com `messaging_product=whatsapp` e `sync_type=smb_app_state_sync`;
5. monitorar entrega assinada, agregados processados, aplicação saudável e ausência de eventos pendentes/falhos;
6. pedir ao usuário que altere um nome no WhatsApp Business e confirme a atualização no atendimento.

Se a Meta indicar que a carga inicial já foi consumida, a operação para sem offboarding. A assinatura permanece disponível para alterações futuras somente se o backend estiver saudável; qualquer novo onboarding exige autorização separada.

## Falhas e rollback

Antes de solicitar a carga inicial, qualquer falha restaura o conjunto exato de 11 campos e recria somente a imagem anterior da aplicação. Depois da solicitação, os dados já processados permanecem na migration aditiva; para rollback, remove-se primeiro `smb_app_state_sync`, confirma-se o readback e só então recria-se a aplicação anterior.

Não há rollback de schema, restauração de backup, reinício do PostgreSQL, alteração de Caddy/DNS, exclusão de contatos ou mutação de outros sistemas da KVM. A versão anterior ignora a nova tabela e as colunas anuláveis.

## Estratégia de testes

O desenvolvimento segue TDD com evidência RED/GREEN para:

- normalização de `add`, `remove`, lote misto, timestamp `0`, caracteres invisíveis, telefone inválido e item isolado;
- contrato da migration e dupla aplicação em PostgreSQL 18;
- upsert, edição, remoção, deduplicação, atraso, empate e retomada após falha parcial;
- contato importado antes da primeira conversa;
- convergência e mesclagem de identidades sem violar unicidade;
- precedência manual → agenda → perfil → telefone;
- busca pelo nome da agenda;
- uma invalidação realtime por lote e reconciliação em duas sessões;
- limites de payload e ausência de PII em logs/DTOs;
- contrato append-only da assinatura Meta e rollback para os 11 campos;
- suíte completa Windows/Linux, lint, TypeScript, Prisma, build, auditoria, imagem Linux/amd64 e verificadores de deploy.

## Aceitação de produção

O rollout só é aceito quando:

- imagem/revisão exatas, UID/GID `1001:1001`, três redes, `healthy` e reinícios zero;
- banco mantém ID e `StartedAt`, migration aplicada uma vez e falhas zero;
- health local/público, login, páginas legais, rota protegida e assinatura inválida mantêm os códigos esperados;
- snapshot dos 33 contêineres non-app é byte a byte igual;
- assinatura Meta confirma os 12 campos sem perda dos 11 anteriores;
- carga inicial, quando aceita, termina sem evento `FAILED`/`PROCESSING`;
- três amostras de soak permanecem `200|200|healthy|0`;
- um nome adicionado/editado e uma remoção realizados no WhatsApp Business aparecem corretamente no atendimento, sem alterar um nome manual.
