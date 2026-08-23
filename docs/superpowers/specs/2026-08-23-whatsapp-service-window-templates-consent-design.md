# Janela de atendimento, templates e consentimento — Design

**Data:** 2026-08-23

**Status:** aprovado em conversa; aguardando revisão do documento

**Escopo:** aplicar as regras oficiais da janela de atendimento do WhatsApp, permitir a retomada de solicitações pendentes por template aprovado e registrar a base operacional de consentimento sem transformar o atendimento em ferramenta de marketing

## Objetivo

Impedir que atendentes tentem enviar mensagens livres fora da janela oficial de 24 horas e oferecer uma retomada segura para o caso principal da XP Eletrônicos: o cliente procura a loja enquanto ela está fechada e sua solicitação ainda não foi respondida quando a equipe retorna.

A solução usa como evidência operacional a mensagem iniciada pelo próprio cliente e ainda pendente de resposta. Essa autorização automática é restrita à continuidade daquele atendimento. Ela não autoriza campanhas, promoções, prospecção ou contato recorrente.

A Meta continua sendo a fonte autoritativa para criação, categoria, idioma, aprovação, qualidade e disponibilidade dos templates. O sistema apenas sincroniza, valida, seleciona e envia templates já aprovados.

Referências oficiais:

- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy): exige número e opt-in, respeito ao opt-out, template aprovado para conversas iniciadas pela empresa e mensagens livres somente durante a janela de 24 horas após a última mensagem do usuário;
- [WhatsApp Business Platform OpenAPI](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml): contratos oficiais da Graph API para consulta de templates e envio de mensagens por template.

## Fora do escopo

- Campanhas, listas de transmissão, promoções, prospecção ou envio em massa.
- Autorizar retomada de conversa já respondida com base no consentimento automático desta entrega.
- Criar, editar, traduzir, submeter ou excluir templates dentro do atendimento XP.
- Aprovar automaticamente um template pendente ou rejeitado pela Meta.
- Enviar mensagem automaticamente quando a janela vencer, a loja abrir ou um cliente entrar na fila.
- Templates com mídia, botões, carrossel, autenticação ou catálogo na primeira versão.
- Consentimento genérico ou permanente inferido de uma mensagem antiga.
- Alterar a regra de horário comercial já cadastrada na aplicação.

## Regras da janela de 24 horas

Cada mensagem válida recebida do cliente atualiza `lastCustomerMessageAt` com o timestamp autoritativo da Meta. Reentregas e eventos fora de ordem nunca fazem esse instante regredir.

A janela está aberta somente quando o instante do envio é estritamente anterior a `lastCustomerMessageAt + 24 horas`. Ao completar exatamente 24 horas, ela está encerrada. O cálculo ocorre no servidor usando horário absoluto; fuso horário e relógio do navegador não participam da decisão.

Dentro da janela, continuam disponíveis:

- texto;
- respostas rápidas internas;
- resposta citando mensagem;
- áudio gravado e arquivos de áudio;
- imagens, vídeos e documentos;
- reações e demais operações oficiais que não iniciem uma nova mensagem livre.

Fora da janela, texto, resposta rápida, áudio, imagem, vídeo e documento são bloqueados no servidor antes da chamada à Meta. A interface também os desabilita, mas nunca é a única proteção. Uma corrida em que a janela vence entre a renderização e o envio retorna erro estável e atualiza a conversa para o estado encerrado.

O erro oficial `131047`, caso a Meta ainda rejeite um envio por diferença de relógio ou estado, é tratado como janela encerrada, sem expor o payload da Graph API.

## Consentimento automático restrito

Uma conversa pode ser retomada automaticamente somente se todas as condições forem verdadeiras no instante do envio:

1. existe uma mensagem recebida do cliente identificável e persistida;
2. essa solicitação continua sem resposta posterior da empresa;
3. a janela oficial está encerrada;
4. o contato não está bloqueado, restrito nem marcado com opt-out;
5. o template de retomada está aprovado, suportado e selecionado pela administração;
6. nenhum outro atendente já retomou ou respondeu à mesma solicitação.

A mensagem recebida usada como evidência fica ligada à tentativa de retomada. Uma resposta enviada pelo WhatsApp Business no celular, refletida por `smb_message_echoes`, também encerra a pendência e remove a autorização automática. O estado é compartilhado por toda a empresa, não por usuário.

Se a solicitação já foi respondida, não há botão de retomada automática. Para outro contato fora da janela será necessário um fundamento separado e um template compatível, que não fazem parte desta entrega.

O opt-out prevalece sobre qualquer mensagem anterior e impede novas retomadas. A remoção futura do opt-out exige uma nova manifestação válida do próprio cliente ou um procedimento administrativo separado e auditável; não ocorre silenciosamente.

O painel do contato oferece **Não contatar** a usuários autorizados, com confirmação e motivo operacional. A marcação passa a valer imediatamente em todas as sessões. A primeira versão não interpreta palavras isoladas automaticamente como opt-out, pois contexto e falsos positivos podem bloquear um atendimento legítimo; quando o cliente pedir para não receber mensagens, o atendente registra a restrição explicitamente.

## Estados apresentados ao atendente

O cabeçalho da conversa exibe um dos estados autoritativos:

- **Janela aberta — _N_ restantes:** envio livre disponível;
- **Janela encerrada — use um template:** envio livre indisponível;
- **Aguardando cliente:** template de retomada enviado e nenhuma nova mensagem recebida;
- **Retomada indisponível:** janela encerrada sem solicitação pendente, com opt-out ou sem template aprovado.

O tempo restante é apenas informativo e pode ser atualizado no navegador. A decisão de envio sempre é recalculada pelo servidor.

Quando a janela está encerrada e existe solicitação elegível, a área de composição mostra **Retomar atendimento**. Antes de confirmar, o atendente vê o texto final, o idioma, o template e os parâmetros preenchidos. Após a confirmação, a interface bloqueia nova tentativa até receber o resultado autoritativo.

Quando o cliente responde ao template, a janela normal reabre e a composição completa volta a ficar disponível. O template, sozinho, não abre a janela para mensagens livres.

## Template inicial

A primeira versão aceita somente um template de texto em português do Brasil, destinado à continuidade de atendimento. Nome técnico proposto:

`retomar_atendimento`

Texto proposto para submissão à Meta:

> Olá, {{1}}! A XP Eletrônicos está retomando o atendimento que você iniciou. Podemos continuar por aqui?

O parâmetro `{{1}}` recebe o nome resolvido do contato somente quando válido. Se o template aprovado exigir o parâmetro e não houver nome seguro, a aplicação usa uma saudação neutra previamente validada na configuração; ela nunca envia telefone ou texto arbitrário como nome.

A categoria final, o nome final e a redação efetivamente utilizável são os aprovados pela Meta. A aplicação não pressupõe aprovação. O administrador seleciona explicitamente, entre os templates sincronizados e aprovados, qual exerce a função `SERVICE_RESUMPTION`.

Templates com componentes desconhecidos, status diferente de aprovado, idioma incompatível ou quantidade/tipo de parâmetros incompatível ficam visíveis para diagnóstico administrativo, mas não podem ser selecionados nem enviados.

## Modelo de dados

O schema recebe estruturas aditivas para separar estado oficial, configuração e auditoria:

- `Conversation.lastCustomerMessageAt`: último timestamp recebido do cliente, monotônico;
- `Conversation.lastCustomerMessageId`: mensagem que sustenta o timestamp e permite rastrear a solicitação;
- `Conversation.awaitingCustomerSince`: instante do template de retomada confirmado;
- `Conversation.serviceWindowStateVersion`: versão usada no controle de concorrência;
- `Contact.messagingOptOutAt`: instante do opt-out, anulável;
- `Contact.messagingRestrictionReason`: motivo operacional seguro, anulável;
- `WhatsAppTemplate`: cache do identificador Meta, nome, idioma, categoria, status, qualidade, componentes normalizados, hash da definição, sincronização e atualização da fonte;
- `WhatsAppTemplateAssignment`: associação administrativa única entre a função `SERVICE_RESUMPTION` e um template elegível;
- `WhatsAppPolicyConfiguration`: configuração única com modo `INACTIVE` ou `ACTIVE`, versão, ativação/desativação, usuário executor e timestamps;
- `ConversationResumption`: solicitação fonte, template/idioma/definição usados, parâmetros seguros, atendente, `clientRequestId`, identificador da mensagem Meta, estado e timestamps.

O histórico conserva exatamente qual definição e quais parâmetros foram usados, mesmo que o template seja alterado ou deixe de ser aprovado. Tokens, payloads brutos, telefone e segredos nunca são copiados para esse histórico.

As migrations são aditivas. Conversas antigas sem uma mensagem recebida correlacionável não ganham autorização automática por backfill. Quando for possível derivar com segurança o último evento recebido a partir das mensagens existentes, um backfill monotônico e idempotente preenche apenas o estado da janela; ele não cria consentimento nem retomadas.

## Sincronização de templates

Uma rota administrativa autenticada solicita à Graph API os templates da conta de WhatsApp Business, percorre a paginação com limites e timeout, normaliza somente os campos necessários e faz upsert transacional no cache.

O cache anterior continua disponível se a Graph API falhar. A interface informa que a sincronização está desatualizada e não transforma erro remoto em remoção de templates. Um template só é marcado como ausente depois de uma sincronização completa e bem-sucedida.

Os webhooks oficiais `message_template_status_update` e `message_template_quality_update`, já assinados na conta, passam a atualizar rapidamente status e qualidade. Um evento de indisponibilidade revoga a elegibilidade para novos envios sem apagar o histórico.

Somente usuários com permissão administrativa podem sincronizar ou alterar a associação de retomada. Atendentes podem consultar a prévia final e usar apenas a associação ativa.

## Envio, idempotência e concorrência

Toda tentativa recebe um `clientRequestId` opaco e único. A combinação entre conversa, solicitação fonte e função de template impede duas retomadas bem-sucedidas para a mesma pendência.

O servidor, dentro de controle transacional:

1. autentica o atendente e valida a conversa;
2. recalcula a janela e a elegibilidade;
3. carrega a definição aprovada e valida os parâmetros;
4. reserva de forma exclusiva a retomada para a solicitação fonte;
5. chama a Meta uma única vez para aquele `clientRequestId`;
6. persiste o identificador Meta e publica o estado compartilhado.

Se dois atendentes confirmarem juntos, um reserva a retomada e o outro recebe **Atendimento já retomado**. Repetir a mesma requisição devolve o resultado existente e não gera novo envio.

Uma rejeição confirmada pela Meta marca a tentativa como falha e libera uma nova tentativa controlada; ela não marca a conversa como aguardando cliente. Timeout ou queda após o envio produzem `OUTCOME_UNKNOWN`: o sistema não repete cegamente a chamada e aguarda webhook/reconciliação pelo identificador conhecido ou investigação administrativa. Esse estado impede duplicidade.

Somente a aceitação da Meta leva a conversa para **Aguardando cliente**. Falhas de entrega posteriores aparecem no estado da mensagem e na auditoria, sem abrir a composição livre.

## API e tempo real

O DTO de conversa inclui apenas o estado calculado necessário à interface: janela aberta, vencimento, código do motivo de bloqueio, elegibilidade de retomada e resumo seguro do template ativo. O navegador não recebe tokens, payloads Meta, critérios internos de opt-out ou componentes não utilizados.

As rotas de envio existentes retornam HTTP `409` quando a janela está fechada, com o código estável `WHATSAPP_SERVICE_WINDOW_CLOSED`. A rota de retomada é separada da rota de texto livre e aceita somente identificadores validados, parâmetros previstos e `clientRequestId`.

Mudanças de mensagem recebida, eco do aplicativo, opt-out, associação de template e estado de retomada disparam invalidação SSE sem PII. Todas as sessões autenticadas refazem a leitura autoritativa e convergem para o mesmo estado.

## Segurança, privacidade e observabilidade

- Todas as rotas exigem autenticação, autorização por função, proteção de origem e os limites de requisição já adotados pelo projeto.
- O token permanente da Meta permanece somente no servidor e nunca é devolvido por DTO, SSE ou mensagem de erro.
- Logs não contêm payload bruto, corpo de mensagem, nome, telefone, parâmetros do template ou token.
- Logs e métricas usam request ID, `clientRequestId`, IDs internos opacos, código de estado, latência e contagens.
- Erros da Graph API são traduzidos para códigos internos e mensagens seguras.
- Opt-out, tentativa, usuário executor, template e resultado são auditáveis.
- A função automática é descrita como continuidade de solicitação iniciada pelo cliente, nunca como consentimento para marketing.

## Ativação em produção

A publicação ocorre em duas etapas para não deixar a equipe sem atendimento caso a aprovação externa ainda esteja pendente.

### Etapa 1 — infraestrutura inativa

1. criar backup verificável do banco;
2. aplicar migrations aditivas;
3. publicar o código, cache, sincronização administrativa, observabilidade e interface de configuração;
4. manter a fiscalização nova em modo inativo até existir template elegível;
5. sincronizar a conta oficial e confirmar status, idioma e definição;
6. selecionar administrativamente o template de retomada;
7. verificar saúde, autenticação, filas, webhooks e ausência de impacto nos demais sistemas da KVM.

O modo inativo não promete que a Meta aceitará mensagens fora da janela; ele apenas evita que uma proteção incompleta bloqueie o atendimento antes de existir caminho de retomada.

### Etapa 2 — ativação atômica

Depois que a Meta aprovar o template e a aplicação validar a associação, a configuração de produção ativa simultaneamente:

- o bloqueio servidor de mensagens livres fora da janela;
- o estado visual da janela;
- o botão de retomada elegível;
- a auditoria e idempotência de retomadas.

A ativação é recusada se o template estiver ausente, desatualizado, não aprovado ou incompatível. Não será enviado teste real para cliente sem um número controlado ou contato explicitamente autorizado pelo usuário.

Cada etapa concluída é publicada e verificada separadamente, conforme o fluxo de upgrades em produção solicitado pela XP. A ativação não reinicia PostgreSQL, não altera DNS/Caddy de outros serviços e não recria contêineres fora da aplicação.

## Falhas e rollback

Se a sincronização falhar, o sistema mantém o último cache válido, registra somente diagnóstico seguro e mostra a idade da última sincronização. Se o template ativo perder aprovação ou ficar incompatível, novas retomadas são bloqueadas imediatamente.

Na etapa 1, rollback recria apenas a imagem anterior da aplicação; tabelas e colunas aditivas podem permanecer sem uso. Na etapa 2, o primeiro rollback é desativar atomicamente a fiscalização e a retomada, preservando histórico. Não se remove migration, não se restaura banco e não se altera outro sistema da KVM sem uma autorização separada.

Uma tentativa `OUTCOME_UNKNOWN` não é automaticamente reenviada durante rollback ou redeploy. Ela continua pendente de reconciliação para evitar mensagem duplicada ao cliente.

## Estratégia de testes

O desenvolvimento segue TDD com evidência RED/GREEN para:

- janela sem mensagem recebida, aberta antes de 24 horas e encerrada exatamente em 24 horas;
- timestamps fora de ordem, reentregas e relógio do navegador incorreto;
- bloqueio servidor para texto, resposta rápida, áudio, imagem, vídeo e documento;
- mensagem recebida concorrente ao envio e erro remoto `131047`;
- solicitação pendente versus já respondida pelo sistema ou pelo WhatsApp Business App;
- opt-out e restrições do contato;
- templates aprovado, pendente, rejeitado, pausado, ausente, desatualizado e incompatível;
- paginação, timeout e normalização da Graph API sem vazamento de token;
- validação de idioma, componentes e parâmetros;
- concorrência entre dois atendentes e idempotência de `clientRequestId`;
- rejeição confirmada, resultado desconhecido, webhook de status e reconciliação;
- convergência SSE entre duas sessões autenticadas;
- permissões administrativas e proteção das rotas;
- migration e backfill idempotentes em PostgreSQL;
- ativação recusada sem template elegível;
- interface em computador e celular;
- suíte completa, lint, TypeScript, Prisma, build, auditoria de dependências e imagem Linux/amd64.

## Aceitação de produção

A etapa 1 é aceita quando:

- migrations estão aplicadas uma vez e a aplicação permanece saudável;
- sincronização administrativa lista o estado oficial sem expor segredos;
- um template aprovado compatível pode ser selecionado e pré-visualizado;
- os fluxos atuais dentro da janela permanecem funcionais;
- webhooks, eco do celular e sincronização de leitura continuam convergindo entre usuários;
- os demais contêineres da KVM permanecem inalterados.

A etapa 2 é aceita quando:

- texto e mídia livres são aceitos dentro da janela e bloqueados exatamente no limite de 24 horas;
- somente uma solicitação recebida e não respondida oferece retomada automática;
- um template aprovado é enviado uma única vez mesmo com repetição ou concorrência;
- a conversa fica aguardando cliente após aceitação da Meta;
- uma resposta do cliente reabre a janela para todos os atendentes;
- uma resposta pelo celular remove a pendência para todos os atendentes;
- opt-out impede a retomada;
- três amostras de estabilidade mantêm health público/local, contêiner saudável e reinícios zero.
