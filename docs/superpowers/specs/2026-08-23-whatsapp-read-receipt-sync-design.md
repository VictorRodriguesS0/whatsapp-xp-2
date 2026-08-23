# Confirmação de leitura e sincronização compartilhada do WhatsApp

## Objetivo

Quando qualquer atendente abrir uma conversa e visualizar sua mensagem recebida mais recente, o sistema deve marcar essa mensagem como lida pela API oficial do WhatsApp. O cliente passa a ver os dois tiques azuis e o estado de leitura permanece único para todos os usuários do painel.

## Escopo e limites oficiais

- A integração usará exclusivamente a WhatsApp Cloud API oficial.
- A confirmação será enviada por `POST /<PHONE_NUMBER_ID>/messages` com `messaging_product: "whatsapp"`, `status: "read"` e a `wamid` da mensagem recebida em `message_id`.
- Conforme a documentação da Meta, só mensagens recebidas nos últimos 30 dias podem ser marcadas como lidas. Marcar uma mensagem recebida também marca as anteriores da mesma conversa como lidas.
- Mensagens enviadas pelo aplicativo WhatsApp Business ou por dispositivos adicionais compatíveis continuarão sendo sincronizadas no painel por `smb_message_echoes`.
- A Meta não fornece um webhook para o ato isolado de abrir ou ler uma conversa no aplicativo WhatsApp Business. Portanto, uma leitura feita somente no celular não pode marcar o painel como lido de forma confiável. Quando houver uma mensagem enviada pelo celular, o eco oficial continuará atualizando a conversa e seu estado compartilhado.
- Não serão usados WhatsApp Web automatizado, bibliotecas de protocolo não oficial ou inferências que possam gerar confirmações falsas.

## Comportamento para os atendentes

- Abrir uma conversa mantém o comportamento atual de rolar para o fim e considerar visível a mensagem confirmada mais recente.
- A leitura local compartilhada avança até essa mensagem, como já ocorre, e todos os atendentes recebem a atualização em tempo real.
- Para a Meta, o sistema escolhe a mensagem recebida mais recente que esteja no limite visualizado, tenha uma `whatsappMessageId` válida e esteja dentro do prazo oficial de 30 dias.
- Mensagens enviadas, mensagens otimistas e registros sem `wamid` nunca são usados como alvo da confirmação.
- Se o limite visualizado terminar em uma mensagem enviada pela empresa, o sistema procura a mensagem recebida elegível imediatamente anterior.
- A operação não depende do atendente responsável pela conversa. Qualquer usuário ativo do painel pode provocar a leitura compartilhada.
- A ação continua silenciosa na interface: não haverá botão adicional nem bloqueio da conversa enquanto a Meta responde.

## Arquitetura

### Estado compartilhado local

O fluxo existente de `advanceSharedRead` continua sendo a fonte de verdade para contadores, destaque de não lidas e sincronização entre atendentes. A atualização local ocorre em transação e não fica condicionada à disponibilidade da Meta.

O evento em tempo real `conversation.updated` continua sem dados pessoais e faz as outras sessões reconciliarem lista e conversa. Uma falha externa não pode fazer uma conversa já lida reaparecer como pendente para outro atendente.

### Sincronizador persistente

Será criada uma entidade persistente com uma linha por conversa para controlar:

- a mensagem recebida mais recente que o painel precisa confirmar na Meta;
- a mensagem recebida mais recente cuja confirmação foi aceita pela Meta;
- quantidade de tentativas e próximo horário de tentativa;
- posse e expiração de uma concessão curta de processamento;
- categoria segura da última falha, sem token, payload completo ou mensagem privada.

O alvo e a confirmação serão referências a mensagens da conversa. A comparação usará o mesmo par ordenável `externalTimestamp` e `id` já empregado pela leitura compartilhada, evitando regressão quando duas mensagens tiverem o mesmo horário.

Ao avançar a leitura local, a mesma transação atualiza o alvo do sincronizador apenas quando existir uma mensagem recebida elegível mais nova. Assim, um encerramento do processo entre o commit local e a chamada externa não perde a confirmação pendente.

### Entrega para a Meta

O contrato `WhatsAppProvider` ganhará uma operação específica para marcar uma mensagem recebida como lida. O provedor Meta validará uma resposta de sucesso no formato `{ "success": true }`; o provedor de demonstração confirmará localmente sem rede.

Depois do commit e da publicação da leitura compartilhada, a rota tenta entregar imediatamente o alvo pendente. O navegador não bloqueia a conversa enquanto essa chamada termina. A resposta da rota sempre representa a leitura local persistida e informa separadamente se a confirmação externa foi aceita ou continua pendente.

Um processador leve iniciado com o mesmo processo Node da aplicação verifica confirmações vencidas a cada cinco segundos e garante recuperação após falha de rede ou reinicialização. Isso preserva a topologia atual de uma única instância e não adiciona outro serviço à KVM.

Cada entrega recebe uma concessão persistida. A finalização só pode ser feita pelo proprietário da concessão. Se um alvo mais novo surgir durante a chamada, o sucesso confirma apenas o alvo efetivamente enviado e o alvo novo permanece pendente.

## Falhas e novas tentativas

- Timeout, limite de taxa, erro `5xx` ou resposta perdida são tratados como resultado desconhecido. As novas tentativas aguardam 2 segundos, 10 segundos, 30 segundos, 2 minutos e 10 minutos; tentativas posteriores ficam limitadas a uma a cada 30 minutos enquanto o alvo permanecer dentro da janela oficial.
- Repetir `status: read` para a mesma `wamid` é tratado como reconciliação idempotente; a verdade final é a resposta aceita pela Meta.
- Rejeição definitiva, como `wamid` inválida, bloqueia novas tentativas para aquele alvo e registra somente uma categoria segura. Um alvo recebido mais novo reabre automaticamente o fluxo.
- Mensagens fora da janela de 30 dias não são enviadas e não geram uma fila sem fim.
- A confirmação externa nunca desfaz a leitura compartilhada local.
- Logs operacionais incluem identificadores internos, estado e categoria da falha, mas não incluem token da Meta, corpo da mensagem ou resposta externa integral.

## Concorrência e idempotência

- Duas sessões abrindo a mesma conversa podem avançar a leitura local concorrentemente sem regredir o limite compartilhado.
- A linha do sincronizador mantém somente o alvo mais novo e impede que uma confirmação atrasada substitua outra mais avançada.
- A concessão persistente evita chamadas simultâneas normais para a mesma conversa.
- Se o processo cair depois de a Meta aceitar a solicitação e antes de registrar o sucesso, a concessão expira e a chamada pode ser repetida com segurança.
- Eventos em tempo real continuam sendo invalidações sem conteúdo sensível; não é necessário publicar a `wamid` para os navegadores.

## Migração e compatibilidade

- A nova tabela será adicionada sem alterar mensagens ou conversas existentes.
- A migração não fará um envio retroativo em massa para conversas já lidas. Uma abertura real depois da publicação poderá criar um alvo se a mensagem ainda estiver no prazo oficial.
- A migração terá chaves estrangeiras, unicidade por conversa e índice para localizar tentativas pendentes ou com concessão expirada.
- A leitura manual como não lida continua sendo apenas uma organização interna. Ela não tenta desfazer uma confirmação de leitura já enviada ao WhatsApp, pois a plataforma não oferece essa reversão.
- A sincronização existente de `smb_message_echoes`, busca, respostas, reações, mídia e etiquetas não será alterada.

## Testes

- Provedor Meta: corpo exato, endpoint e cabeçalhos; aceita somente `{ success: true }`; timeout, resposta grande, JSON inválido e erros Graph permanecem sanitizados.
- Seleção do alvo: última mensagem recebida até o limite visualizado; ignora mensagens enviadas, sem `wamid`, com `revokedAt` preenchido ou fora de 30 dias.
- Persistência: cria e avança o alvo sem regressão; preserva alvo mais novo durante uma entrega concorrente.
- Entrega: sucesso, falha transitória, rejeição definitiva, concessão expirada, resposta perdida e recuperação após reinicialização.
- API: autenticação e origem antes do corpo, leitura local independente da Meta e evento em tempo real publicado após persistência.
- Interface: abrir uma conversa continua marcando o limite visível uma vez; eventos de outra sessão reconciliam o contador sem oscilação.
- Regressão: marcar como não lida, ecos do aplicativo oficial, mensagens enviadas pelo painel, pesquisa, respostas citadas e reações continuam funcionando.

## Critérios de aceite

- Ao abrir uma conversa com mensagem recebida elegível, o cliente vê os dois tiques azuis no WhatsApp.
- Todos os atendentes conectados deixam de ver a mesma conversa como não lida, sem depender de quem a abriu.
- Uma indisponibilidade temporária da Meta não reverte a leitura no painel e a confirmação é reenviada posteriormente.
- Abrir repetidamente a mesma conversa não produz chamadas externas desnecessárias depois da confirmação.
- Nenhuma leitura exclusiva do aplicativo oficial é falsamente atribuída ao painel.
- O deploy em produção ocorre somente após integrar as mudanças paralelas, executar testes, gerar backup e verificar saúde, migração, logs e possibilidade de rollback.

## Referências oficiais

- [Meta — Como marcar mensagens como lidas](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/)
- [Meta — Integração de usuários do WhatsApp Business App e `smb_message_echoes`](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Meta — Especificação OpenAPI da Business Messaging API](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml)
