# Mensagens recebidas enriquecidas do WhatsApp

**Data:** 22 de agosto de 2026  
**Status:** desenho aprovado pelo usuário

## Objetivo

Substituir o aviso genérico “Tipo de mensagem não compatível” por representações úteis e seguras das mensagens recebidas pelo WhatsApp Cloud API. O primeiro pacote cobre figurinhas, localização, contatos compartilhados e respostas de botões ou listas. Pedidos, eventos de sistema e tipos desconhecidos recebem descrições explícitas, sem expor o webhook bruto.

O pacote é somente de recebimento e visualização. Ele não adiciona envio de localização, contatos, figurinhas ou mensagens interativas.

## Abordagens consideradas

1. **Renderização tipada de ponta a ponta — escolhida.** Normalizar cada tipo no webhook, persistir seu conteúdo estruturado e renderizar um componente próprio. Exige migração e mais testes, mas preserva os dados, produz uma interface clara e permite evoluir cada tipo sem interpretar texto artificial.
2. **Converter tudo em texto.** Geraria frases como “Localização recebida: -15,7, -47,8” no campo `body`. É menor, porém perde estrutura, dificulta acessibilidade e mistura conteúdo real com texto criado pelo sistema.
3. **Guardar somente o payload bruto e interpretar na interface.** Evitaria tipos no domínio, mas levaria o formato externo e dados desnecessários da Meta até o navegador, aumentando acoplamento e risco de exposição.

## Escopo funcional

### Figurinhas

- Reconhecer `sticker` como tipo de mensagem próprio.
- Criar uma mídia pendente usando o ID fornecido pela Meta e reutilizar o fluxo atual de recuperação autenticada, tentativas e armazenamento local.
- Aceitar a ausência de `sha256` no webhook quando o identificador e o MIME forem válidos; a resposta de download da Meta continua sujeita às validações de tipo e tamanho do sistema.
- Exibir WEBP estático ou animado dentro do balão, preservando transparência e sem fundo de imagem artificial.
- Mostrar estados claros de download, indisponibilidade e nova tentativa.
- Não abrir figurinha em tela cheia, pois ela é um elemento compacto da conversa.

### Localização

- Reconhecer `location` e persistir somente latitude, longitude, nome e endereço normalizados.
- Validar latitude entre -90 e 90 e longitude entre -180 e 180; rejeitar valores não finitos.
- Exibir um cartão com nome/endereço quando presentes, coordenadas formatadas e a ação “Abrir no Google Maps”.
- Gerar a URL do mapa localmente a partir das coordenadas validadas, usando nova aba com proteção contra acesso à janela de origem.
- Não incorporar mapa, não chamar API de geocodificação e não rastrear o clique nesta entrega.

### Contatos compartilhados

- Reconhecer `contacts` e persistir uma lista limitada e normalizada de cartões.
- Exibir nome e telefones disponíveis. Campos ausentes são omitidos.
- Não cadastrar, mesclar ou alterar automaticamente o contato principal da conversa.
- Não oferecer importação para agenda nesta entrega.

### Botões e listas

- Normalizar `button` e respostas `interactive` para um tipo interno comum.
- Persistir o identificador da opção e o título ou texto exibível, dentro de limites definidos.
- Mostrar a escolha como mensagem legível, identificada como “Resposta de botão” ou “Resposta de lista”.
- O identificador técnico não aparece na interface, mas permanece disponível no conteúdo estruturado para futuras automações.

### Pedidos, sistema e desconhecidos

- Reconhecer `order` e `system` para que a interface mostre “Pedido recebido” ou uma descrição segura do evento de sistema quando disponível.
- Tipos não reconhecidos permanecem como `UNSUPPORTED`, com o tipo externo sanitizado quando for seguro: por exemplo, “Mensagem do tipo reação ainda não disponível”.
- Nunca exibir JSON bruto, tokens, IDs internos de infraestrutura, caminhos de arquivo ou detalhes de erro do provedor.

## Arquitetura e dados

### Normalização do webhook

O normalizador continua sendo a fronteira de confiança. Ele deve:

- validar a estrutura específica de cada mensagem;
- limitar quantidade e tamanho de strings e listas;
- remover caracteres de controle;
- converter somente os campos necessários para tipos internos;
- rejeitar mensagens malformadas sem comprometer os demais eventos válidos do webhook;
- preservar o tipo externo sanitizado apenas no fallback desconhecido.

Os eventos normalizados recebem um campo opcional de conteúdo estruturado. A camada de processamento não consulta novamente o payload bruto para decidir como apresentar uma mensagem.

### Persistência

O enum `MessageType` ganha tipos explícitos para `STICKER`, `LOCATION`, `CONTACTS`, `INTERACTIVE`, `ORDER` e `SYSTEM`. A tabela de mensagens ganha um campo JSON opcional para conteúdo estruturado validado. Figurinhas continuam relacionadas a `MediaObject`; os outros novos tipos não criam mídia.

O JSON armazenado usa uma união discriminada controlada pela aplicação, e não uma cópia do objeto recebido da Meta. Os DTOs públicos repetem a validação da união antes de responder, de modo que dados antigos ou corrompidos resultem em fallback seguro.

A migração é aditiva e compatível com as mensagens existentes. Mensagens antigas marcadas como `UNSUPPORTED` só serão corrigidas quando o evento original retido contiver todos os campos necessários e puder ser reprocessado de forma idempotente. Sem esses dados, elas permanecem com o fallback; nenhuma informação é inventada.

### Interface

`MessageBubble` delega conteúdo não textual para renderizadores pequenos e tipados:

- mídia existente, incluindo figurinha;
- cartão de localização;
- lista de contatos compartilhados;
- escolha interativa;
- cartão informativo para pedido, sistema ou desconhecido.

A lista de conversas recebe prévias curtas: “Figurinha”, “Localização”, “Contato compartilhado”, “Resposta de lista”, “Pedido recebido” ou o fallback correspondente. Todos os controles terão nome acessível, foco visível e área de toque adequada no celular.

## Fluxo de dados

1. A Meta envia o webhook assinado.
2. A rota existente verifica a assinatura antes de normalizar o conteúdo.
3. O normalizador produz um evento tipado e sanitizado.
4. O processador persiste a mensagem idempotentemente pelo ID do WhatsApp.
5. Para figurinha, cria também a mídia pendente e agenda a recuperação existente.
6. A API de conversas devolve o tipo, o conteúdo estruturado seguro e o estado de mídia.
7. A interface seleciona o renderizador pelo tipo interno.
8. O realtime existente atualiza a conversa sem exigir recarga manual.

## Erros e degradação segura

- Uma figurinha com download pendente ou falho usa os mesmos estados e a mesma recuperação manual das demais mídias.
- Conteúdo estruturado inválido nunca quebra a conversa: aparece como “Conteúdo desta mensagem indisponível”.
- Localização inválida não produz link navegável.
- Contatos além do limite são descartados de forma determinística; a interface informa quando a lista foi reduzida.
- Duplicatas de webhook não criam mensagens, mídias ou cartões duplicados.
- Falhas internas continuam registradas com contexto sanitizado nos logs, sem alterar a resposta pública para detalhes sensíveis.

## Segurança, privacidade e regras da Meta

- Manter verificação de assinatura e autenticação das rotas de mídia e conversas.
- Aplicar os limites atuais de download, MIME e tamanho também às figurinhas.
- Armazenar apenas os campos necessários para atendimento e não fazer sincronização automática com agenda externa.
- Respeitar a janela de atendimento e templates aprovados nas respostas; esta entrega não altera as regras de envio.
- Não usar dados de localização ou contatos compartilhados para enriquecimento, perfilamento ou chamadas a terceiros.

## Testes e critérios de aceite

### Webhook e persistência

- Fixtures válidas e inválidas para figurinha, localização, contatos, botão, lista, pedido, sistema e desconhecido.
- Testes unitários de normalização, limites, sanitização e fallback.
- Testes de integração de persistência, idempotência, mídia da figurinha e DTO público.
- Contrato da migração e compatibilidade com mensagens existentes.

### Interface

- Renderização e acessibilidade de cada novo cartão.
- Figurinha estática e animada usando a rota autenticada de mídia.
- Estados pendente, falho, recuperado e sem fonte.
- Link de localização correto e não navegável quando inválido.
- Prévia correta na lista de conversas.
- Layout verificado em desktop e celular, sem estouro de balão.

### Regressão e produção

- Suíte completa, lint, verificação de tipos, geração Prisma e build de produção.
- Verificação manual com webhooks reais ou amostras oficiais representativas.
- Build e deploy pelo processo atual da KVM, seguidos de health check, verificação autenticada e inspeção dos logs.
- O deploy não exige parada prolongada nem remoção de dados existentes.

## Fora do escopo

- Enviar figurinhas, localização, contatos ou interações.
- Mapa incorporado ou geocodificação.
- Importar contato compartilhado para a base ou agenda.
- Automatizar ações a partir de botões, listas ou pedidos.
- Implementar uma tela completa de comércio/pedidos.
- Garantir reconstrução de mensagens antigas quando o payload original necessário não existir.
