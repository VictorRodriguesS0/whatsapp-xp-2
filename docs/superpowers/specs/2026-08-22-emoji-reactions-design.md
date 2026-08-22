# Reações com emoji no padrão do WhatsApp

Data: 2026-08-22

## Objetivo

Permitir que atendentes enviem, substituam e removam reações em mensagens e que todos os usuários vejam, em tempo real, reações do cliente, do sistema e do aplicativo WhatsApp Business oficial. A experiência deve se aproximar do WhatsApp oficial sem enfraquecer as regras compartilhadas de leitura e resposta da caixa de atendimento.

## Regras da Meta

A integração usa exclusivamente a WhatsApp Cloud API oficial. Uma reação é enviada ao endpoint de mensagens com `type: "reaction"`, `reaction.message_id` igual ao `wamid` da mensagem-alvo e exatamente um emoji em `reaction.emoji`. Emoji vazio remove a reação empresarial existente.

O sistema não oferece reação quando a mensagem:

- não possui um `wamid` confirmado;
- tem mais de 30 dias;
- foi apagada;
- é ela própria uma mensagem de reação.

O servidor repete essas validações mesmo quando a interface já ocultou o controle. Falhas e mudanças futuras da Meta são tratadas como resposta do provedor, nunca contornadas por WhatsApp Web, QR Code ou automação não oficial.

Referências primárias:

- [Meta OpenAPI — Business Messaging API](https://github.com/facebook/openapi)
- [Meta — WhatsApp Cloud API messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [Meta — webhook payloads](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payloads)

## Experiência de uso

### Abrir o seletor

No desktop, cada balão elegível revela uma ação de reação ao foco ou ao passar o mouse. No celular, toque longo abre o mesmo controle. A ação também é acessível por teclado e possui nome descritivo para leitor de tela.

O seletor inicial mostra `👍 ❤️ 😂 😮 😢 🙏` e uma ação `+`. O `+` abre um seletor amplo por categorias, carregado sob demanda para não aumentar o custo inicial da conversa. Busca e categorias do seletor usam rótulos em português.

### Enviar, substituir e remover

Escolher um emoji quando ainda não há reação empresarial cria a reação. Escolher outro emoji substitui a reação empresarial atual. Escolher novamente o mesmo emoji remove, enviando emoji vazio à Meta.

A interface mostra imediatamente uma prévia pendente. Quando a Meta confirma, ela se torna definitiva. Em falha conhecida, a prévia é revertida, aparece uma mensagem segura e o atendente pode tentar novamente. Enquanto a mesma mensagem possui uma operação pendente, novos cliques ficam bloqueados para evitar ordens concorrentes ambíguas.

### Exibição

As reações aparecem em cápsulas compactas abaixo do balão original, e não como novas mensagens no histórico. Uma cápsula pode representar a reação do cliente e outra a reação da empresa. Texto acessível e dica identificam `Cliente` ou `XP Eletrônicos`; quando a reação foi feita pelo sistema, o detalhe pode informar o nome do funcionário autenticado.

Reações não alteram o texto, anexo, status de entrega ou horário original da mensagem. Também não alteram conversa lida/não lida, `awaitingResponseSince`, destaque por atraso ou responsável.

`Escape` fecha primeiro o seletor e devolve foco ao botão da mensagem. No celular, voltar fecha primeiro o seletor antes de fechar a conversa. Áreas interativas têm pelo menos 44 px e estados não dependem apenas de cor.

## Modelo de dados

Uma tabela `message_reactions` mantém o estado atual, separada de `messages`.

Campos principais:

- `id` UUID;
- `message_id`, chave estrangeira para a mensagem-alvo;
- `reactor` com valores `CONTACT` ou `BUSINESS`;
- `emoji`, contendo um único grapheme de emoji ou vazio apenas durante uma remoção pendente;
- `status` com `PENDING`, `SENT` ou `FAILED` para operações empresariais;
- `provider_message_id`, o identificador da reação retornado pela Meta quando disponível;
- `sent_by_user_id`, preenchido quando um funcionário reagiu pelo sistema;
- `provider_timestamp`, `created_at` e `updated_at` com fuso horário.

A restrição única `(message_id, reactor)` representa o comportamento individual da conversa: no máximo uma reação vigente do cliente e uma da empresa em cada mensagem. Remoção confirmada exclui a linha atual; eventos e tentativas continuam observáveis nos logs estruturados e na deduplicação existente de webhook.

`messages` recebe `revoked_at` anulável. O controle oficial de revogação já normalizado pela aplicação passa a preencher esse instante na mensagem-alvo, permitindo ocultar seu conteúdo conforme a evolução futura e, neste incremento, impedir novas reações de forma verificável. Um controle de edição continua sem alterar a identidade da mensagem e não é ampliado por este escopo.

## Entrada por webhook

O normalizador reconhece `type: "reaction"` como evento de controle, valida `reaction.message_id` e aceita emoji vazio como remoção. Ele não cria uma mensagem de histórico para a reação.

O processador localiza a mensagem-alvo pelo `wamid` e confirma que ela pertence à mesma conversa/identidade. Uma reação do cliente atualiza a linha `CONTACT`. Um eco vindo do aplicativo WhatsApp Business oficial atualiza a linha `BUSINESS`, sem atribuir um funcionário quando essa informação não existe no payload. Um controle oficial `REVOKE` preenche `revoked_at` de forma idempotente.

Redelivery do mesmo webhook é idempotente. Evento cujo alvo não existe, pertence a outra identidade ou contém emoji inválido é preservado de forma segura como falha/quarentena operacional, sem alterar outra conversa. Após commit, o servidor publica um evento em tempo real por identificadores, e cada cliente busca novamente o estado autorizado.

## Saída para a Meta

O provedor recebe:

```ts
sendReaction(input: {
  to: string;
  targetWhatsappMessageId: string;
  emoji: string;
}): Promise<{ whatsappMessageId: string }>;
```

O serviço autenticado valida usuário ativo, conversa, alvo, prazo de 30 dias e emoji. Em seguida registra a intenção empresarial, chama o provedor e confirma o estado. A operação usa uma chave de solicitação do cliente e controle de concorrência para que repetição de rede não crie reações divergentes.

O eco oficial é a confirmação autoritativa mais recente. Quando sistema e celular reagem quase simultaneamente, a ordem de `provider_timestamp` e um desempate estável pelo identificador do evento definem o estado final. Eventos mais antigos não sobrescrevem um estado mais recente.

## Emoji e validação

O frontend envia somente a string escolhida; o servidor é a autoridade. A validação aceita um único grapheme classificado como emoji Unicode, incluindo sequência com modificador de pele, variação ou ZWJ. Rejeita texto, múltiplos emojis, controles, espaços e payload excessivo. String vazia é aceita somente como comando autenticado de remoção empresarial ou remoção válida recebida da Meta.

O seletor amplo usa dados Unicode mantidos por uma biblioteca cliente consolidada, carregada dinamicamente. Ele não transmite consultas ou dados de conversa a serviços externos.

## API e tempo real

O endpoint autenticado da mensagem aceita `PUT` com `emoji` e `clientRequestId`; emoji vazio remove. A resposta contém o estado empresarial seguro para a interface. Repetir o mesmo `clientRequestId` devolve o resultado existente.

DTOs de mensagem passam a incluir uma lista pequena de reações vigentes. O evento SSE `reaction.updated` contém somente `conversationId` e `messageId`. O hook da caixa refaz a conversa ativa e a lista apenas quando necessário, mantendo deduplicação de mensagens e reações.

## Falhas e recuperação

- Sem sessão ou usuário inativo: mesma política de autorização atual.
- Mensagem não encontrada ou de outra conversa: 404 seguro.
- Mensagem inelegível: 409 com explicação curta.
- Emoji inválido: 400 sem ecoar conteúdo bruto.
- Falha anterior ao contato com a Meta: intenção pode ser retomada com a mesma chave.
- Resultado desconhecido após contato com a Meta: estado permanece observável e não é reenviado cegamente; o eco/webhook pode reconciliar.
- Falha confirmada da Meta: estado `FAILED`, UI revertida e tentativa manual disponível.

## Testes e aceitação

A funcionalidade será aceita quando testes provarem:

- parsing de reação recebida e de eco oficial, incluindo remoção;
- rejeição de emoji inválido, alvo cruzado e evento antigo;
- idempotência de redelivery e de `clientRequestId`;
- criação, substituição, remoção e reconciliação por timestamp;
- bloqueios de 30 dias, mensagem apagada, reação sem `wamid` e alvo de tipo reação;
- nenhuma alteração nos estados compartilhados de leitura ou resposta;
- prévia otimista, rollback, nova tentativa e concorrência na interface;
- mouse, teclado, toque longo, `Escape`, voltar no celular, foco e leitor de tela;
- carregamento sob demanda do seletor completo e ausência de HTML executável;
- atualização em tempo real entre dois atendentes;
- suite completa, lint, tipos, Prisma, build e auditoria aprovados;
- backup validado, migração aplicada, health checks e rollback automático no deploy da KVM.
