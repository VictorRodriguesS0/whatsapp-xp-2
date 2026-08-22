# Respostas citadas do WhatsApp — design

Data: 2026-08-22
Status: aprovado para planejamento

## Objetivo

Permitir que um atendente selecione uma mensagem específica e responda a ela como no WhatsApp oficial. A resposta citada deve funcionar para texto, imagem, vídeo, documento e áudio, permanecer correta após recarregar a página e aparecer para todos os atendentes. Respostas citadas pelo cliente ou pelo aplicativo WhatsApp Business também devem entrar na central com o mesmo contexto.

## Contrato oficial da Meta

A especificação oficial da WhatsApp Cloud API v23.0 envia uma resposta contextual acrescentando ao payload raiz:

```json
{
  "context": {
    "message_id": "wamid.exemplo-da-mensagem-original"
  }
}
```

O mesmo objeto é documentado nos exemplos oficiais de texto, áudio, imagem, vídeo, documento e outros tipos. Em webhooks, uma mensagem recebida que responde a outra contém `context.id`; esse valor identifica a mensagem original, mas não inclui uma cópia do conteúdo original. A aplicação precisa resolver a prévia a partir do próprio histórico.

Fonte primária: [Meta Business Messaging OpenAPI v23.0](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml).

A citação não cria uma exceção às regras de envio da Meta. A janela de atendimento, templates, limites, permissões e demais políticas existentes continuam valendo.

## Escopo aprovado

- Responder citando qualquer mensagem conhecida que já possua um identificador oficial da Meta.
- Enviar respostas citadas de texto, imagem, vídeo, documento e áudio.
- Interpretar citações em mensagens recebidas pelo webhook `messages`.
- Interpretar citações em mensagens enviadas pelo aplicativo WhatsApp Business e recebidas por `smb_message_echoes`.
- Exibir a citação nas mensagens recebidas e enviadas, inclusive depois de recarregar ou abrir outra sessão.
- Permitir navegação até a mensagem original quando ela existir no histórico.
- Exibir `Mensagem original indisponível` quando a referência oficial não puder ser resolvida localmente.
- Preservar exatamente a citação durante retentativas idempotentes.

Não fazem parte deste recorte reações, encaminhamento, edição, revogação, templates novos ou mudanças na assinatura de webhooks da Meta.

## Modelo de dados

`Message` receberá dois campos opcionais:

- `replyToMessageId`: UUID da mensagem original conhecida localmente;
- `replyToWhatsappMessageId`: identificador oficial exato da mensagem original, limitado a 512 caracteres pela mesma validação usada para IDs de webhook.

Haverá uma autorrelação opcional de `Message` para `Message`, com `onDelete: SetNull`, índice em `replyToMessageId` e índice composto em `conversationId, replyToWhatsappMessageId`. A referência oficial continuará armazenada mesmo se o vínculo local deixar de existir, permitindo o fallback aprovado.

A migração será aditiva. Mensagens existentes recebem ambos os campos como `null`. Nenhuma mensagem, mídia, leitura ou classificação atual será reescrita.

O banco garante a integridade do UUID referenciado. O serviço e o processador de webhook garantem que a mensagem original pertença à mesma conversa; nunca haverá vínculo entre contatos diferentes.

Não será armazenada uma cópia do texto ou da mídia original. A prévia sempre será derivada do registro original e validada pelos DTOs públicos.

## Envio pelo sistema

O cliente nunca enviará um `wamid` fornecido pela interface. Ele enviará somente `replyToMessageId`, um UUID interno opcional, junto de `clientRequestId`.

O servidor executará esta sequência:

1. autenticar o atendente e validar mesma origem;
2. validar conversa, tipo de mensagem, arquivo e UUIDs;
3. localizar a mensagem original pelo UUID dentro da conversa atual;
4. exigir que a original possua `whatsappMessageId` válido;
5. criar a mensagem pendente com o vínculo local e o ID oficial da original;
6. enviar à Meta usando `context.message_id` no payload raiz;
7. confirmar o `whatsappMessageId` da nova mensagem e publicar apenas os eventos realtime já permitidos.

`sendText` e `sendMedia` receberão uma referência contextual opcional. O provedor Meta acrescentará `context` somente quando ela existir. O provedor demo aceitará o mesmo contrato para que persistência, interface e idempotência sejam exercitadas sem rede externa.

O envio multipart de mídia e a rota de gravações aceitarão `replyToMessageId`. Texto, upload de mídia e gravação usarão o mesmo caminho de autorização e persistência.

## Idempotência, falhas e retentativa

A citação faz parte da identidade lógica do envio. Ao reutilizar um `clientRequestId`, conversa, atendente, tipo e `replyToMessageId` devem coincidir. Qualquer divergência retorna conflito sem chamar o provedor.

Depois que a mensagem pendente foi criada, toda retentativa usa `replyToWhatsappMessageId` persistido; ela não volta a depender do estado atual da mensagem original. Isso impede que uma corrida, desativação de usuário ou futura remoção altere o payload repetido.

Mensagens sem ID oficial, ainda pendentes ou com falha local antes do provedor não serão oferecidas como alvo de citação. Se a Meta rejeitar o contexto, o fluxo normal de falha segura permanece: mensagem visível, motivo público genérico, referência preservada e nenhuma duplicação.

## Recebimento e mensagens do aplicativo oficial

O normalizador adicionará `replyToWhatsappMessageId` opcional a mensagens normais e ecos. `context.id` será validado como identificador exato, sem trim, com no máximo 512 caracteres e sem espaços ou caracteres de controle. Se `context` estiver presente com estrutura ou ID inválido, o evento inteiro será rejeitado sem persistência parcial. Um ID válido, mas ainda desconhecido localmente, será aceito e produzirá o fallback aprovado.

Dentro da transação serializável do webhook, depois de identificar a conversa, o processador:

1. procura a original por `whatsappMessageId` e pela mesma conversa;
2. persiste o vínculo local quando encontrar;
3. preserva apenas o ID externo quando não encontrar;
4. ao inserir qualquer nova mensagem com `whatsappMessageId`, reconcilia respostas ainda sem vínculo cujo `replyToWhatsappMessageId` corresponda a ela na mesma conversa.

Essa reconciliação torna a ordem de entrega irrelevante: se a resposta chegar antes da original, o vínculo será completado quando a original aparecer. Duplicatas e reentregas continuam protegidas pelas reservas de webhook e pela unicidade de `whatsappMessageId`.

Ecos que coincidam com uma mensagem criada pela API não sobrescrevem a citação já persistida. Ecos realmente originados no aplicativo oficial preservam o contexto recebido e continuam sem atribuir falsamente um atendente interno.

## DTO e prévia segura

Cada `MessageDto` terá:

- `canReply`: booleano derivado no servidor, sem expor o ID oficial;
- `replyTo`: `null`, uma prévia disponível ou o fallback indisponível.

A prévia disponível contém somente ID interno, direção, tipo, autor seguro e um resumo limitado. O resumo será produzido por um helper único:

- texto: trecho inicial em texto puro;
- imagem ou vídeo: legenda limitada ou o nome do tipo;
- documento: nome seguro e legenda limitada;
- áudio: `Áudio`;
- figurinha: `Figurinha`;
- localização: nome/endereço seguro ou `Localização`;
- contato compartilhado: nome seguro ou `Contato`;
- botão/lista: texto seguro da resposta;
- conteúdo desconhecido: `Mensagem`.

HTML, IDs da Meta, caminhos de mídia, payload bruto e telefone nunca entram na prévia. DTOs validam novamente o conteúdo antes de responder.

## Interface e interação

Mensagens com `canReply: true` oferecem a ação `Responder`:

- desktop: botão revelado por hover e por foco de teclado;
- celular: gesto horizontal para a direita com limiar definido e cancelamento ao detectar rolagem vertical;
- ambos: ação acessível alternativa, sem depender exclusivamente do gesto.

Ao selecionar uma mensagem, o compositor mostra uma faixa compacta acima do campo com autor, tipo, resumo e botão de fechar. A seleção acompanha texto, arquivo e gravação. Trocar ou fechar a conversa cancela uma seleção ainda não enviada.

No desktop, `Esc` segue esta prioridade:

1. fechar um overlay ativo;
2. cancelar a resposta citada selecionada;
3. fechar a conversa.

Depois de enviar, a citação passa a pertencer ao balão otimista e não ao compositor. Falha ou retentativa mantém a mesma citação no balão. Confirmação do servidor substitui o estado otimista sem perder a referência.

Dentro de um balão, a citação aparece antes do conteúdo principal. Clicar nela desloca o histórico, que atualmente é carregado por inteiro, até a mensagem original e aplica um destaque curto. Se a relação não estiver disponível, o componente mostra `Mensagem original indisponível` sem ação de navegação.

Todos os controles terão nome acessível, foco visível e alvo mínimo de 44 px. O destaque respeitará `prefers-reduced-motion`. O gesto não impedirá rolagem vertical, seleção de texto, abertura de mídia nem controles do reprodutor de áudio.

## Estado local e realtime

A seleção de resposta é um rascunho local por aba e não será transmitida. Depois do envio, a mensagem citada entra no mesmo fluxo autoritativo de `message.created` e `message.status` já existente.

O estado otimista carregará uma prévia derivada da mensagem selecionada. Atualizações, reconexões e uma segunda sessão sempre reconciliarão com o DTO do servidor. Eventos realtime continuarão transportando somente tipo de evento e IDs internos; nenhuma prévia ou conteúdo será publicado no canal.

## Tratamento de erros e privacidade

- UUID inválido, alvo ausente, alvo de outra conversa ou alvo sem ID oficial falham antes da chamada à Meta.
- Referência externa desconhecida recebida não bloqueia a mensagem; gera o fallback.
- Uma referência nunca é resolvida globalmente sem também restringir a conversa.
- Nenhum log inclui conteúdo, telefone, `wamid`, payload de contexto ou token.
- Erros públicos continuam genéricos e acionáveis.
- Nenhuma nova credencial, permissão ou assinatura da Meta é necessária.

## Estratégia de testes

### Banco e serviços

- migração aplica duas vezes sem alterar dados existentes;
- autorrelação, `SetNull` e índices são verificados;
- alvo correto, alvo de outra conversa, alvo ausente e alvo sem ID oficial;
- criação pendente persiste os dois campos atomicamente;
- mesmo `clientRequestId` repete a mesma citação e rejeita uma diferente;
- retentativa, concorrência, resultado desconhecido e falha local preservam contexto;
- entrega fora de ordem reconcilia a referência sem atravessar conversas.

### Meta e webhooks

- payload exato de `context.message_id` para texto, imagem, vídeo, documento e áudio;
- ausência de `context` em envios comuns;
- normalização de `context.id` válido e rejeição de IDs vazios, longos, com espaço ou controle;
- mensagens recebidas, ecos do aplicativo, duplicatas e corrida original/resposta;
- payload desconhecido não vaza dados nem cria vínculo incorreto.

### Interface

- botão por mouse/teclado, alternativa acessível e gesto móvel;
- faixa do compositor, cancelamento, troca de conversa e prioridade de `Esc`;
- texto, arquivo e áudio carregam a mesma referência;
- estado otimista, confirmação, falha e retentativa;
- clique, rolagem, foco/destaque e fallback indisponível;
- duas sessões e reconexão realtime;
- desktop, tablet, 390×844, movimento reduzido, sem overflow e sem erros no console.

## Publicação

Esta é uma fatia vertical única e visível. Depois de testes, revisão e imagem Linux imutável:

1. criar e validar backup de banco e mídias;
2. aplicar a migração aditiva pelo entrypoint existente;
3. recriar somente `xp-whatsapp-app` com rollback automático do app;
4. verificar banco, Caddy, redes, volumes e demais contêineres inalterados;
5. validar saúde, login, webhook com assinatura inválida, logs e assinatura Meta em modo somente leitura;
6. executar envio real controlado citando uma mensagem e confirmar a citação no telefone e na aplicação;
7. confirmar uma resposta citada enviada pelo aplicativo WhatsApp Business e recebida uma única vez na central.

Falha de schema, saúde, payload, persistência, duplicidade ou regressão de sistemas externos bloqueia a aceitação e aciona o rollback app-only previsto. A assinatura da Meta não será modificada por esta funcionalidade.

## Critérios de aceite

- O atendente responde a qualquer mensagem apta usando mouse, teclado ou gesto móvel.
- Texto e todas as mídias suportadas chegam ao WhatsApp como resposta oficial à mensagem escolhida.
- A aplicação mostra a mesma citação antes e depois de recarregar e em outra sessão.
- Respostas citadas pelo cliente e pelo aplicativo oficial aparecem com a original correta quando conhecida.
- Referências desconhecidas exibem o fallback sem perder a nova mensagem.
- Falha e retentativa não trocam nem duplicam a citação.
- Realtime, privacidade, acessibilidade, regras da Meta e isolamento da KVM permanecem preservados.
