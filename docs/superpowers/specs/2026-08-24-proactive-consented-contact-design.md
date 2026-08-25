# Contato proativo consentido e encerramento de alerta de template — Design

**Data:** 2026-08-24

**Status:** aprovado pelo usuário em 2026-08-24

**Escopo:** permitir que atendentes iniciem uma conversa fora da janela de 24 horas com qualquer contato que tenha consentimento explícito e auditável, usando um template aprovado adequado ao motivo do contato, e corrigir o alerta que permanece ativo depois da exclusão confirmada de um template

## Contexto e objetivo

A fiscalização da janela de atendimento está ativa em produção. Mensagens livres continuam disponíveis durante as 24 horas posteriores à última mensagem recebida. Fora desse período, a Meta aceita apenas mensagens por template aprovado.

O fluxo atual cobre somente a retomada de uma solicitação recebida e ainda não respondida. Por isso, uma conversa antiga já respondida exibe **Retomada indisponível — Não há solicitação pendente para retomar**. Esse bloqueio é correto para o template de retomada, mas não cobre o novo caso: iniciar um contato autorizado com um funcionário, avisar sobre um produto solicitado ou cumprir um retorno combinado.

Esta entrega adiciona esse fundamento separado sem enfraquecer a proteção existente. O sistema nunca transforma o tipo do contato, uma conversa antiga ou uma mensagem recebida no passado em consentimento genérico. O contato proativo exige consentimento explícito, motivo compatível e template aprovado.

Também será corrigido o alerta **Template está pendente de exclusão**. O alerta atual pertence ao template antigo `retomar_atendimento`, já removido da Meta. O evento terminal `DELETED` precisa encerrar o estado `TEMPLATE_PENDING_DELETION` do mesmo recurso.

Referências oficiais:

- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy): exige opt-in, respeito ao opt-out e uso de template aprovado para conversas iniciadas pela empresa;
- [coleção oficial da WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api): descreve o envio de mensagens e templates pela API oficial;
- [WhatsApp Business Platform OpenAPI](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml): contrato oficial da Graph API para consulta, criação, edição, exclusão e envio de templates.

## Decisões aprovadas

- O contato proativo poderá ser usado com qualquer contato que possua consentimento ativo, não apenas contatos do tipo **Equipe XP**.
- Qualquer atendente autenticado poderá registrar ou revogar o consentimento.
- A origem do consentimento será obrigatória: WhatsApp, loja física, telefone ou outro.
- O envio usará motivos e templates específicos; não haverá um template genérico único.
- Os três motivos iniciais serão **Equipe XP**, **Produto solicitado** e **Retorno ou lembrete combinado**.
- Cada etapa concluída será publicada e verificada separadamente em produção.

## Fora do escopo

- Campanhas, listas de transmissão, promoções, prospecção, disparos em massa ou importação de audiência.
- Inferir consentimento a partir do tipo do contato, da existência de conversa, da agenda do celular ou de uma mensagem antiga.
- Liberar texto, áudio ou mídia livre fora da janela de 24 horas.
- Enviar automaticamente ao registrar consentimento, criar lembrete, abrir a loja ou vencer a janela.
- Permitir que o navegador escolha um template arbitrário ou envie parâmetros não previstos.
- Aprovar, recorrer ou alterar a categoria decidida pela Meta dentro da aplicação.
- Substituir a funcionalidade de lembretes agendados; esta entrega apenas oferece o meio autorizado de iniciar o contato quando o atendente decidir agir.
- Remover histórico de templates, alertas, consentimentos ou tentativas de envio.

## Estados e experiência do atendente

Dentro da janela de 24 horas, a composição atual permanece inalterada e permite mensagens livres.

Fora da janela, o cabeçalho da conversa segue esta precedência:

1. contato com opt-out ou restrição: **Contato bloqueado para mensagens**;
2. tentativa por template já enviada e ainda sem resposta: **Aguardando cliente**;
3. solicitação recebida e ainda pendente: **Retomar atendimento** com o template de retomada existente;
4. nenhuma solicitação pendente e consentimento ativo: **Iniciar contato**;
5. nenhuma solicitação pendente e sem consentimento: **Contato fora da janela — registre o consentimento antes de iniciar**.

O texto **Não há solicitação pendente para retomar** deixa de ser a única orientação para o terceiro e o quarto casos. Ele continua válido como diagnóstico interno do fluxo de retomada, mas a interface oferece a ação correta para contato proativo.

Ao selecionar **Iniciar contato**, o atendente escolhe um motivo disponível, preenche somente os campos definidos para aquele motivo e vê antes da confirmação:

- texto final;
- nome técnico e idioma do template;
- categoria decidida pela Meta;
- indicação de que a mensagem usa um template fora da janela;
- aviso adicional se a categoria final for marketing.

Após a aceitação da Meta, a conversa passa para **Aguardando cliente**. O template enviado não abre a janela de mensagens livres. Somente uma nova mensagem recebida do contato reabre as 24 horas.

## Consentimento explícito e auditável

O painel do contato terá a seção **Consentimento para mensagens da XP pelo WhatsApp**. Qualquer atendente poderá conceder ou revogar o consentimento.

Ao conceder, serão obrigatórios:

- origem: `WHATSAPP`, `LOJA_FISICA`, `TELEFONE` ou `OUTRO`;
- confirmação consciente do atendente;
- observação quando a origem for `OUTRO`.

O servidor registra usuário, instante e origem. A revogação também cria evento permanente com usuário e instante. O estado atual fica materializado no contato para leitura rápida, enquanto uma tabela de eventos preserva o histórico.

O consentimento está ativo somente quando existe concessão atual não revogada e o contato não possui opt-out ou restrição de mensageria. Registrar opt-out revoga imediatamente a elegibilidade proativa. Remover uma restrição não restaura silenciosamente consentimento anterior; uma nova concessão explícita é necessária.

O cliente e o navegador nunca enviam o usuário executor nem o timestamp como autoridade. Esses valores vêm da sessão autenticada e do relógio do servidor.

## Motivos e templates iniciais

Templates continuam sendo recursos autoritativos da Meta. A aplicação sincroniza status, idioma, categoria, componentes e disponibilidade, e o administrador associa um template aprovado a cada função.

### Equipe XP

- Função: `TEAM_CONTACT`.
- Visível somente quando o contato estiver categorizado como **Equipe XP** e tiver consentimento ativo.
- Parâmetro inicial: nome seguro do contato.
- Texto proposto para submissão:

> Olá, {{1}}. A XP Eletrônicos precisa falar com você sobre uma questão da equipe. Responda a esta mensagem quando puder.

### Produto solicitado

- Função: `REQUESTED_PRODUCT_UPDATE`.
- Disponível para qualquer contato com consentimento ativo.
- Parâmetros: nome seguro e produto informado pelo atendente.
- Texto proposto para submissão:

> Olá, {{1}}. Você pediu para receber uma atualização sobre {{2}}. A XP Eletrônicos tem uma informação para você. Responda a esta mensagem para continuarmos.

### Retorno ou lembrete combinado

- Função: `AGREED_FOLLOW_UP`.
- Disponível para qualquer contato com consentimento ativo.
- Parâmetros: nome seguro e referência curta do compromisso informado pelo atendente.
- Texto proposto para submissão:

> Olá, {{1}}. Este é o retorno combinado sobre {{2}}. Responda a esta mensagem para continuarmos.

Os campos livres têm limite pequeno, normalização de espaços e bloqueio de controle, URLs e conteúdo incompatível. Não serão usados para promoções ou para transformar um template transacional em mensagem arbitrária.

A categoria final é decidida pela Meta. Templates `UTILITY` e `MARKETING` podem ser elegíveis para estas funções proativas quando aprovados e quando o consentimento explícito estiver ativo. `AUTHENTICATION` e componentes incompatíveis ficam bloqueados. Se a Meta pausar, rejeitar, desativar, excluir ou tornar incompatível um template associado, novos envios daquele motivo são interrompidos imediatamente.

O template `SERVICE_RESUMPTION` continua separado e só pode ser usado para a solicitação recebida que permanece pendente. Consentimento explícito não converte uma conversa respondida em retomada.

## Modelo de dados

As alterações são aditivas:

- `Contact.messagingConsentGrantedAt`: instante da concessão atual, anulável;
- `Contact.messagingConsentSource`: origem enumerada da concessão atual, anulável;
- `Contact.messagingConsentGrantedByUserId`: atendente que registrou a concessão atual, anulável;
- `Contact.messagingConsentNote`: observação curta e segura, anulável;
- `ContactMessagingConsentEvent`: contato, ação `GRANTED` ou `REVOKED`, origem, observação, usuário e timestamp imutáveis;
- `WhatsAppTemplateFunction`: novas funções `TEAM_CONTACT`, `REQUESTED_PRODUCT_UPDATE` e `AGREED_FOLLOW_UP` além de `SERVICE_RESUMPTION`;
- `ConversationTemplateInitiation`: conversa, função, snapshot do consentimento, template/idioma/categoria/definição, parâmetros seguros, atendente, `clientRequestId`, estado, resultado Meta e timestamps.

`Conversation.awaitingCustomerSince` poderá representar a aceitação de qualquer template que aguarde resposta, sem alterar a regra da janela. A mensagem de template também é persistida na linha do tempo normal.

O histórico guarda a definição e os parâmetros realmente usados, mesmo que o template seja alterado posteriormente. Telefone, token, payload Graph bruto e observação interna de consentimento não são copiados para logs ou eventos de tempo real.

## API e regras do servidor

Uma rota de consentimento separada concede ou revoga autorização. Ela exige autenticação, mesma origem, validação estrita, contato existente e gravação transacional do estado atual com seu evento de auditoria.

Uma rota de iniciação por template recebe apenas:

- conversa;
- função permitida;
- parâmetros previstos para a função;
- `clientRequestId` opaco e único.

No instante da confirmação, o servidor:

1. autentica o atendente;
2. recalcula a janela e o estado compartilhado da conversa;
3. exige ausência de solicitação pendente elegível para retomada;
4. valida consentimento ativo, ausência de opt-out e, para `TEAM_CONTACT`, o tipo **Equipe XP**;
5. carrega a associação e exige template aprovado, sincronização recente, idioma e componentes compatíveis;
6. normaliza e valida os parâmetros;
7. reserva de forma exclusiva a tentativa pelo `clientRequestId`;
8. chama a Meta uma única vez;
9. persiste resultado, mensagem e estado compartilhado;
10. publica somente invalidação SSE sem PII.

Repetir a mesma requisição devolve o resultado existente. Uma segunda requisição concorrente para a mesma conversa e função não duplica o envio. Timeout depois da chamada produz `OUTCOME_UNKNOWN` e nunca é repetido cegamente.

Revogar consentimento entre a abertura do diálogo e a confirmação bloqueia o envio. Receber mensagem e reabrir a janela durante esse intervalo direciona o atendente de volta ao compositor normal, sem enviar o template desnecessariamente.

## Correção do alerta de exclusão

O mapeamento de transições de saúde da Meta será corrigido para que `message_template_status_update:DELETED` encerre `TEMPLATE_PENDING_DELETION` do mesmo `resourceId`.

O evento de resolução será informativo e permanecerá no histórico. Reconhecer um alerta continuará significando apenas que um atendente viu o aviso; reconhecimento não altera o estado operacional.

Para o alerta já existente em produção, a publicação executará reconciliação limitada ao recurso `2126281431294415`. Ela só o marcará como resolvido depois de uma leitura completa e bem-sucedida da Meta confirmar que esse identificador não existe mais. Nenhum outro alerta será alterado por essa reconciliação.

## Tratamento de falhas

- Sem consentimento: `409 WHATSAPP_PROACTIVE_CONSENT_REQUIRED`.
- Consentimento revogado ou opt-out concorrente: `409 WHATSAPP_PROACTIVE_CONSENT_REVOKED`.
- Motivo incompatível com o contato: `409 WHATSAPP_PROACTIVE_PURPOSE_NOT_ALLOWED`.
- Template ausente, pendente, pausado, rejeitado ou incompatível: `409 WHATSAPP_PROACTIVE_TEMPLATE_NOT_READY`.
- Janela reaberta antes da confirmação: resposta autoritativa orienta o envio livre, sem disparar template.
- Tentativa já reservada ou enviada: retorna o registro idempotente existente.
- Falha confirmada antes da chamada à Meta: libera nova tentativa controlada.
- Resultado remoto incerto: mantém bloqueio contra repetição até webhook ou reconciliação.
- Reclassificação para marketing: mantém a função disponível somente com consentimento ativo e mostra a categoria antes da confirmação.

Mensagens de erro não expõem telefone, conteúdo do consentimento, payload Graph, token ou detalhes internos.

## Permissões e segurança

- Atendentes ativos podem conceder, revogar e usar consentimento.
- Somente administradores podem sincronizar templates, alterar associações e ativar ou desativar funções.
- Todas as mutações exigem autenticação, proteção de origem e limites de requisição já adotados pelo projeto.
- Consentimento, revogação, associação, tentativa e resultado são auditáveis.
- O navegador recebe somente o estado necessário para apresentar ações; regras finais são recalculadas no servidor.
- A aplicação não oferece importação em massa, seleção arbitrária de contatos ou envio em lote.

## Tempo real e uso em várias sessões

Concessão ou revogação de consentimento, alteração de tipo do contato, atualização de template, envio e nova mensagem recebida invalidam a conversa por SSE. Todas as sessões autenticadas refazem a leitura autoritativa e convergem para o mesmo estado.

Uma resposta enviada pelo WhatsApp Business no celular continua aparecendo na aplicação e encerra estados pendentes conforme as regras já existentes. O contato proativo pelo sistema não cria um estado de leitura separado por usuário.

## Publicação incremental

### Etapa 1 — alerta de template excluído

- criar teste de regressão para `PENDING_DELETION -> DELETED`;
- corrigir a transição;
- verificar ausência do template antigo na Meta;
- publicar;
- reconciliar somente o alerta antigo confirmado;
- verificar painel, aplicação, banco e reinícios.

### Etapa 2 — consentimento

- aplicar migration aditiva;
- publicar painel de concessão e revogação;
- verificar auditoria, permissões, SSE e celular;
- manter contato proativo ainda indisponível.

### Etapa 3 — templates e associações

- submeter os três templates à Meta;
- sincronizar categorias e status;
- associar somente templates aprovados e compatíveis;
- manter cada motivo indisponível enquanto sua aprovação estiver pendente.

### Etapa 4 — iniciação por template

- publicar seleção de motivo, prévia, confirmação e envio idempotente;
- liberar cada motivo somente se sua associação estiver pronta;
- verificar que mensagens livres continuam bloqueadas fora da janela.

### Etapa 5 — aceitação em produção

- usar um contato controlado do tipo Equipe XP com consentimento registrado;
- confirmar um único template enviado fora da janela;
- confirmar `Aguardando cliente`;
- responder pelo WhatsApp e confirmar a reabertura da janela em todas as sessões;
- verificar contêineres saudáveis, reinícios zero, webhooks e demais serviços da KVM sem alteração.

Cada etapa recebe backup e ponto de rollback proporcionais ao risco. PostgreSQL, DNS, proxy e contêineres de outros sistemas não serão reiniciados ou recriados.

## Estratégia de testes

O desenvolvimento seguirá TDD com evidência RED/GREEN para:

- concessão e revogação por qualquer atendente ativo;
- origem obrigatória e observação obrigatória para `OUTRO`;
- histórico imutável e estado atual transacional;
- opt-out prevalecendo e remoção de restrição sem restaurar consentimento;
- janela aberta, janela encerrada, solicitação pendente e aguardando cliente;
- precedência entre retomada e contato proativo;
- disponibilidade de `TEAM_CONTACT` somente para tipo Equipe XP;
- parâmetros, limites e normalização de produto e referência;
- template aprovado, pendente, rejeitado, pausado, excluído, desatualizado e incompatível;
- categorias Utility, Marketing e Authentication;
- revogação ou nova mensagem concorrente à confirmação;
- idempotência, clique duplo, dois atendentes e `OUTCOME_UNKNOWN`;
- webhook de status e reclassificação de template;
- resolução de `TEMPLATE_PENDING_DELETION` por `DELETED` do mesmo recurso, sem resolver alertas de outro template;
- SSE e convergência entre duas sessões;
- proteção de origem, autenticação e permissões administrativas;
- interface responsiva no computador e celular;
- migrations e rollback compatível;
- suíte completa, lint, TypeScript, Prisma, build e imagem Linux/amd64.

## Critérios de aceitação

- O alerta antigo de exclusão deixa de aparecer como ativo e permanece no histórico como resolvido.
- Nenhum alerta de outro recurso é encerrado pela correção.
- Qualquer atendente pode registrar consentimento com origem e revogá-lo.
- Sem consentimento, nenhum motivo proativo pode ser enviado.
- Opt-out bloqueia todos os motivos, mesmo com consentimento anterior.
- Uma solicitação pendente continua usando exclusivamente **Retomar atendimento**.
- Uma conversa respondida e fora da janela oferece **Iniciar contato** quando há consentimento.
- Equipe XP, produto solicitado e retorno combinado usam associações independentes.
- Somente templates aprovados e compatíveis chegam à Meta.
- A prévia mostra o texto e a categoria final antes da confirmação.
- Clique repetido ou concorrência não duplica mensagens.
- O envio aceito muda o estado para **Aguardando cliente**, mas não libera mensagem livre.
- A resposta do contato reabre a janela de 24 horas para todos os atendentes.
- Cada etapa é publicada e verificada separadamente sem impacto nos outros sistemas da KVM.
