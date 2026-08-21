# Sincronização das mensagens enviadas pelo WhatsApp Business

**Data:** 21 de agosto de 2026

**Status:** desenho aprovado em conversa; aguardando revisão deste documento

**Aplicação:** XP Atendimento

**Produção:** `https://whatsapp.xpeletronicos.com`

## Objetivo

Fazer toda mensagem enviada pelo WhatsApp Business da loja ou por um aparelho vinculado aparecer na conversa correspondente do XP Atendimento, em tempo real e sem duplicar mensagens enviadas pela Cloud API. Essas mensagens são respostas reais da empresa e, portanto, também encerram corretamente o estado compartilhado **Aguardando resposta**.

## Diagnóstico confirmado

O número comercial está em coexistência: a consulta oficial retornou `is_on_biz_app=true` e `platform_type=CLOUD_API`. O aplicativo está associado à WABA, mas sua assinatura de webhooks não contém `smb_message_echoes`; contém apenas o fluxo padrão `messages` e outros campos administrativos.

Um envio real feito pelo usuário no WhatsApp Business do celular chegou ao destinatário, mas não produziu webhook no servidor. Além disso, o normalizador atual ignora explicitamente qualquer `changes[].field` diferente de `messages`. Portanto existem duas causas independentes e comprovadas:

1. a Meta ainda não foi instruída a enviar `smb_message_echoes` para o callback;
2. a aplicação ainda não sabe normalizar nem persistir esse campo.

Nenhum conteúdo, telefone, token ou payload bruto foi gravado durante o diagnóstico. Foram observados somente estado de coexistência, nomes dos campos de assinatura, contagens agregadas e logs técnicos já sanitizados.

## Fonte oficial e limite do recurso

`smb_message_echoes` é o webhook da WhatsApp Business Platform destinado às mensagens que a empresa envia pelo WhatsApp Business App ou por um dispositivo vinculado em modo de coexistência. O evento usa o envelope assinado habitual da Meta e traz as mensagens em `value.message_echoes`.

Referências:

- [Meta — referência de payloads de webhook da WhatsApp Business Platform](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference)
- [Meta — exemplos oficiais da WhatsApp Cloud API](https://github.com/fbsamples/whatsapp-api-examples)
- [Meta — onboarding de usuários do WhatsApp Business App](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)

Esta correção não tenta ler o banco local do celular nem usar automação não oficial. Ela depende exclusivamente do webhook oficial disponibilizado pela Meta para a coexistência já ativa.

## Comportamento aprovado

- Mensagens enviadas pelo celular aparecem como mensagens de saída.
- Quando a Meta não fornecer uma identidade interna que possa ser relacionada com segurança a um usuário do XP Atendimento, o autor exibido será **WhatsApp**.
- Nenhuma mensagem será atribuída por inferência a Victor, Marcos ou outro funcionário.
- A mensagem participa da mesma ordenação estável `(externalTimestamp, id)` usada pelo restante da conversa.
- Uma resposta do celular limpa **Aguardando resposta** para toda a equipe, desde que seja a mensagem relevante mais recente.
- Todas as sessões recebem a atualização por SSE e reconciliam a conversa pelo servidor.
- Reentregas ou sobreposição com uma mensagem já conhecida são idempotentes pelo `wamid`.
- Textos e as mídias já suportadas — imagem, vídeo, áudio e documento — entram no mesmo fluxo seguro da aplicação.
- Tipos desconhecidos são preservados como mensagem não suportada, sem descartar silenciosamente a atividade da conversa.
- Edições e exclusões feitas no aplicativo serão reconhecidas e confirmadas ao webhook, mas não alterarão o histórico nesta correção urgente. Elas terão evento técnico deduplicado e poderão ser implementadas em uma evolução específica.

## Arquitetura

### Assinatura da Meta

Depois que a nova imagem estiver saudável, a implantação fará uma leitura da assinatura atual do objeto `whatsapp_business_account`, preservará integralmente os campos existentes e acrescentará somente `smb_message_echoes`.

A atualização usará o App ID e App Secret somente no servidor para chamar o endpoint oficial de assinaturas do aplicativo, fornecendo:

- objeto `whatsapp_business_account`;
- callback `https://whatsapp.xpeletronicos.com/api/webhooks/meta`;
- lista anterior de campos mais `smb_message_echoes`;
- verify token lido diretamente do ambiente da KVM.

Segredos não serão interpolados em linha de comando, arquivo temporário, relatório ou log. Após a escrita, uma nova leitura deverá comprovar que todos os campos anteriores continuam presentes e que `smb_message_echoes` foi acrescentado. Se a leitura não convergir, a assinatura anterior será reaplicada e a release será considerada incompleta.

### Normalização

`normalizeWebhook` continuará validando o envelope e roteará por `changes[].field`:

- `messages`: comportamento atual;
- `smb_message_echoes`: normalização dos itens de `value.message_echoes`;
- demais campos: comportamento atual de reconhecimento sem processamento de mensagem.

Um eco normalizado contém somente:

- `kind: "messageEcho"`;
- `whatsappMessageId` limitado, validado e preservado exatamente, sem trim ou remoção de controles;
- telefone legado `to` canônico com dígitos quando presente, ou `null` quando omitido;
- `toUserId` no formato BSUID `<ISO alpha-2>.<1-128 alfanuméricos>` quando presente, ou `null` no payload oficial legado que fornece apenas `to`;
- `toParentUserId` separado no formato parent BSUID `<ISO alpha-2>.ENT.<1-128 alfanuméricos>` quando presente, ou `null` quando omitido;
- timestamp válido;
- tipo permitido/`UNSUPPORTED`;
- texto ou metadados de mídia sanitizados;
- origem constante `WHATSAPP_BUSINESS_APP`.

O número de origem da loja não será usado como contato. Para ecos, o destinatário precisa fornecer pelo menos um entre o telefone legado `to` e o BSUID `to_user_id`; qualquer campo declarado é validado estritamente. O payload oficial legado com somente `to` permanece aceito, assim como o payload sem telefone que fornece BSUID válido. Não há inferência de uma identidade a partir da outra. Esta Task 1 apenas preserva as duas identidades no contrato normalizado e não altera schema nem persistência. A Task 2 deverá reconciliar BSUID e telefone, quando ambos existirem, para convergir no mesmo contato sem criar duplicata. Texto mantém o mesmo limite de 4.096 caracteres; nomes de arquivo, MIME, hash e IDs de mídia reutilizam os limites e limpadores existentes. Um item suportado malformado rejeita o payload com erro público seguro para que a Meta possa tentar novamente, sem registrar o conteúdo.

Eventos `edit` e `revoke` exigem `id`, timestamp e referência original válidos, são deduplicados e marcados como processados sem alterar a mensagem original nesta versão. O ID do evento e a referência original também são preservados exatamente; whitespace, controles C0/C1 e valores acima do limite são rejeitados em vez de sanitizados. A mesma validação exata passa a proteger os IDs de mensagens e statuses padrão usados nas chaves de deduplicação, sem alterar payloads válidos.

### Persistência

O processador reservará cada eco por uma chave separada e estável, `message-echo:<wamid>`. Dentro da transação serializável existente ele:

1. procura uma mensagem pelo `whatsappMessageId`;
2. se já existir, conclui o evento como duplicado, preservando conteúdo, ator e estado atuais;
3. localiza ou cria um único contato pela identidade disponível (`to_user_id`, `to` ou ambas) e reconcilia as duas quando coexistirem, sem duplicar um contato já conhecido por qualquer chave;
4. cria ou localiza a conversa;
5. cria mídia pendente quando aplicável;
6. cria a mensagem com `direction=OUTBOUND`, `status=SENT`, `sentByUserId=null` e timestamp externo da Meta;
7. atualiza monotonicamente a atividade da conversa;
8. recalcula o estado compartilhado de resposta na mesma transação;
9. conclui a reserva do webhook.

O `wamid` continua sendo a proteção final única. Se um eco repetir uma mensagem que já entrou por outro caminho, não haverá segunda linha nem perda do usuário interno já associado.

### Mídia

Imagem, vídeo, áudio e documento reutilizam `MediaObject` pendente, validação de MIME/hash/tamanho/magic bytes, claim, lease, teto de tentativas, limitador e publicação `media.updated`. O webhook não espera o download terminar.

Um eco de mídia só é criado quando contém os metadados mínimos exigidos pelo pipeline atual. Falha transitória permanece recuperável; falha permanente para no teto. Nenhum provider URL ou storage key chega ao navegador.

### Interface e tempo real

Uma mensagem de saída sem `sentByUser` será apresentada como **WhatsApp**. Mensagens de saída criadas pelo XP Atendimento continuam exibindo o atendente real.

Depois do commit, o servidor publica `message.created`. O cliente refaz a lista e a conversa selecionada usando os guardas atuais de sequência/AbortController. O evento SSE não transporta corpo, telefone ou metadados da mídia.

## Concorrência e ordenação

- A reserva de webhook e a restrição única de `whatsappMessageId` impedem duplicidade.
- Duas entregas concorrentes produzem uma mensagem e um evento processado.
- Um eco antigo pode entrar no histórico, mas não pode mover `lastMessageAt` para trás nem limpar um estado aberto por uma entrada mais recente.
- Um eco mais recente que seja a última mensagem relevante limpa `awaitingResponseSince` e o futuro `responseDueAt`.
- Uma mensagem da API que já possua `sentByUserId` nunca perde esse ator quando um eco duplicado chega.

## Erros e segurança

- A assinatura `X-Hub-Signature-256`, limite de corpo, timeout de leitura e validação estrutural permanecem obrigatórios antes da normalização.
- Payload malformado retorna `400`; falha transitória de banco retorna `500` para retry; duplicata retorna `200`.
- Logs contêm somente nome técnico do evento, contagens, request ID e classe sanitizada do erro.
- Telefone, texto, legenda, filename, IDs da Meta, payload bruto, App Secret, token e verify token não entram em logs ou relatórios.
- O endpoint continua público apenas para a Meta autenticada por assinatura; nenhuma rota de navegador nova é criada.

## Testes

### Normalização

- payload oficial de texto;
- imagem, vídeo, áudio e documento;
- múltiplos ecos e múltiplas mudanças no mesmo envelope;
- `to`, `id`, timestamp, texto e mídia ausentes/malformados;
- tipo desconhecido;
- `edit` e `revoke` válidos/malformados;
- coexistência com o campo padrão `messages`;
- ausência de segredos/PII nos erros.

### Serviço e PostgreSQL

- eco cria mensagem de saída `SENT` sem ator interno;
- contato/conversa novos;
- duplicidade serial e concorrente;
- duplicidade com mensagem da API preserva ator/conteúdo;
- eco atrasado não regride atividade/estado;
- eco mais recente encerra resposta pendente;
- mídia agenda uma única recuperação;
- falha transacional não publica SSE nem deixa estado parcial.

### Produção

1. gates unitários, PostgreSQL real, lint, TypeScript, Prisma, build, audit e Docker;
2. backup validado antes de qualquer migração da release compartilhada;
3. imagem imutável e deploy somente de `xp-whatsapp-app`;
4. health, login, webhook GET, assinatura inválida e logs;
5. adição controlada de `smb_message_echoes`, com leitura antes/depois;
6. mensagem identificável enviada pelo WhatsApp Business do celular para contato de teste autorizado;
7. confirmação de uma única mensagem na interface, autor **WhatsApp**, atualização SSE e estado de resposta correto;
8. confirmação de nenhum 5xx, payload/PII ou segredo nos logs.

## Implantação incremental

Esta correção entra no primeiro checkpoint de produção solicitado pelo usuário, junto do estado operacional compartilhado. As etapas internas de schema/serviço não serão publicadas isoladamente. O primeiro deploy ocorrerá quando leitura compartilhada, resposta compartilhada, APIs/SSE e ecos do WhatsApp formarem um fluxo completo e revisado.

Falha antes da alteração da assinatura aciona rollback da imagem. Falha depois da assinatura remove somente `smb_message_echoes`, restaura a lista anterior de campos e então reverte a imagem. Banco, Caddy, volumes e demais sistemas da KVM não serão recriados.

## Fora de escopo

- identificar qual funcionário físico usou o celular sem dado confiável da Meta;
- importar todo o histórico anterior do WhatsApp Business;
- sincronizar contatos salvos no aparelho;
- aplicar edições ou exclusões feitas no celular;
- usar automação de tela, banco local do aparelho ou API não oficial;
- atribuir mensagens antigas por similaridade de texto/horário;
- mudar regras de cobrança, templates ou janela de 24 horas.

## Critérios de aceitação

- o envio pelo celular gera webhook `smb_message_echoes` e resposta HTTP 200;
- a aplicação cria exatamente uma mensagem de saída;
- o autor visual é **WhatsApp** quando não houver ator interno confiável;
- todas as sessões veem a mensagem sem recarregar;
- a conversa deixa de aguardar resposta quando o eco é a última mensagem relevante;
- texto e mídias suportadas funcionam no pipeline existente;
- eco atrasado, repetido ou concorrente não duplica nem regride estado;
- campos anteriores da assinatura Meta permanecem intactos;
- nenhum segredo, telefone, conteúdo ou payload bruto aparece em logs/evidências;
- produção permanece saudável e somente o container do app é recriado.
