# Alertas operacionais e de qualidade da Meta

## Contexto

A aplicação recebe mensagens e atualizações de entrega pela WhatsApp Cloud API, mas ignora campos operacionais como `phone_number_quality_update`, `account_update`, `account_review_update`, `phone_number_name_update` e `message_template_status_update`. Assim, uma restrição, queda de qualidade ou rejeição pode existir na Meta sem ficar visível dentro do atendimento.

Esta entrega adiciona monitoramento administrativo sem alterar o compositor, a renderização de mídia ou os fluxos de atendimento. A implementação deve permanecer isolada da frente paralela de imagens e vídeos.

Fontes oficiais de referência:

- Webhooks e campos operacionais: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Qualidade dos números: https://www.postman.com/meta/whatsapp-business-platform/request/86mq7mn/get-phone-numbers
- Consulta de templates: https://www.postman.com/meta/whatsapp-business-platform/request/f7o759z/fetch-message-templates

## Objetivos

- Mostrar a administradores o estado atual da integração com a Meta.
- Registrar um histórico imutável das mudanças operacionais relevantes.
- Destacar situações que exigem atenção sem poluir a rotina dos atendentes.
- Combinar webhooks em tempo real com reconciliação periódica da Graph API.
- Permitir que um administrador marque um alerta como tratado sem falsificar o estado real da Meta.
- Preservar a segurança, a idempotência e o processamento normal de mensagens.

## Fora do escopo

- Corrigir automaticamente qualidade, bloqueios ou rejeições na Meta.
- Criar, editar ou enviar templates.
- Enviar notificações por e-mail, SMS ou WhatsApp.
- Exibir alertas para atendentes.
- Substituir o Meta Business Manager.
- Alterar os fluxos de imagens, vídeos, áudio ou documentos.

## Abordagem

Será usada uma arquitetura híbrida:

1. Webhooks operacionais atualizam o estado e o histórico imediatamente.
2. A aplicação consulta periodicamente os recursos que a Graph API permite reconciliar.
3. Um snapshot persistido fornece leitura rápida para o label e para a página administrativa.
4. Uma trava com prazo no banco impede consultas concorrentes à Meta.
5. A indisponibilidade da Meta preserva o último estado conhecido e produz um estado explícito de dados desatualizados.

Não haverá processo ou contêiner adicional na KVM. O cliente administrativo consulta o resumo em intervalos leves e solicita uma reconciliação quando o snapshot estiver vencido. A primeira solicitação adquire a trava; as demais reutilizam o snapshot.

## Fontes e cobertura dos dados

### Webhooks

O normalizador aceitará, além dos campos de mensagens já existentes:

- `phone_number_quality_update`
- `account_update`
- `account_review_update`
- `phone_number_name_update`
- `message_template_status_update`

Campos desconhecidos continuam sendo ignorados com segurança. Um campo conhecido com payload inválido é rejeitado ou colocado em quarentena conforme o contrato existente, sem impedir o processamento independente de eventos válidos do mesmo lote.

### Reconciliação pela Graph API

A reconciliação consultará:

- o número configurado, incluindo `display_phone_number`, `verified_name` e `quality_rating`;
- a WABA configurada, incluindo `account_review_status`;
- os templates da WABA e seus estados atuais.

Eventos de conta que não possuam um estado consultável equivalente permanecem orientados pelo webhook. A página deixará claro a origem e a data da última informação, evitando sugerir que um campo foi reconciliado quando não foi.

## Modelo de dados

### Snapshot de saúde

Um registro por número configurado armazenará:

- ID do número e ID da WABA;
- número de exibição e nome verificado;
- classificação de qualidade conhecida;
- estado de revisão da WABA;
- estado operacional de conta conhecido por webhook;
- limite ou faixa informada pela Meta, quando disponível;
- instante da última tentativa de sincronização;
- instante da última sincronização bem-sucedida;
- código público e sanitizado da última falha;
- trava de sincronização e prazo de expiração;
- data de criação e atualização.

O snapshot nunca armazenará token de acesso.

### Alertas operacionais

Cada mudança relevante criará um alerta com:

- categoria;
- gravidade;
- campo e código do evento da Meta;
- resumo e detalhes sanitizados;
- identificador do recurso afetado, quando houver;
- origem `WEBHOOK` ou `RECONCILIATION`;
- chave idempotente determinística para webhooks, formada pelo identificador da WABA, horário da entrada, campo, recurso afetado e código normalizado do evento;
- instante informado pela Meta ou observado na reconciliação;
- estado ativo ou resolvido;
- reconhecimento administrativo, com usuário e horário;
- data de criação e atualização.

Reconhecimento e resolução são conceitos separados. “Marcar como tratado” preenche o reconhecimento, mas somente uma mudança posterior do estado da Meta resolve o problema.

Transições descobertas por consulta são serializadas pela trava e comparadas ao snapshot anterior dentro de transação. Uma consulta repetida sem mudança não cria novo alerta. Se o estado melhorar e depois piorar novamente, a nova transição cria um novo evento.

## Gravidade e estado do label

O label calcula o pior estado vigente, não apenas a quantidade de itens não tratados:

- `NORMAL`: qualidade alta e nenhum problema ativo conhecido.
- `ATTENTION`: qualidade média, `FLAGGED`, redução de limite, nome rejeitado, revisão pendente ou template individual rejeitado, sinalizado ou desativado.
- `CRITICAL`: qualidade baixa, conta desativada/bloqueada ou outro evento que impeça o uso do número.
- `STALE`: a consulta está vencida e não há confirmação recente suficiente. Um estado crítico conhecido continua crítico mesmo que a sincronização também esteja vencida.

Eventos positivos como aprovação, melhoria, `UNFLAGGED` ou restabelecimento resolvem os alertas correspondentes e permanecem no histórico como informação.

O número exibido no label representa alertas ativos ainda não tratados. Tratar todos os alertas reduz o contador, mas não troca amarelo ou vermelho por verde enquanto o estado da Meta continuar degradado.

## Interface

### Label administrativo

Somente usuários `ADMIN` verão um label compacto nos cabeçalhos autenticados:

- `Meta normal`
- `Meta atenção`
- `Meta crítica`
- `Meta desatualizada`

O label terá cor discreta, ícone acessível, texto visível e contador apenas quando houver alertas ativos não tratados. Ele será um link para `/configuracoes/meta`. A cor nunca será o único indicador.

Atualizações de webhook publicarão um evento interno de tempo real para atualizar o label sem recarregar a página. Como fallback, o componente refaz a leitura do resumo periodicamente.

### Página de configurações

A página exclusiva para administradores exibirá:

- cartão do número e nome comercial;
- qualidade do número;
- revisão e estado conhecido da conta;
- limite conhecido;
- última atualização bem-sucedida;
- alerta de dados desatualizados ou falha de sincronização;
- lista de alertas ativos;
- histórico em ordem cronológica reversa;
- ação `Marcar como tratado` por alerta;
- ação `Atualizar agora` com limitação de frequência.

O histórico terá paginação. O primeiro recorte não terá filtros avançados, edição, exclusão ou observações manuais.

## APIs e serviços

As rotas serão exclusivas para `ADMIN`:

- `GET /api/meta-health/summary`: snapshot, gravidade calculada, contador e vencimento.
- `GET /api/meta-health/alerts`: alertas ativos e histórico paginado.
- `POST /api/meta-health/alerts/:id/acknowledge`: registra quem tratou e quando.
- `POST /api/meta-health/sync`: tenta adquirir a trava e executar a reconciliação.

O label consulta o resumo a cada 60 segundos. Se o resumo tiver mais de 15 minutos, solicita sincronização e refaz a leitura ao terminar. `Atualizar agora` usa a mesma trava e possui intervalo mínimo de 60 segundos para impedir abuso. A trava expira após 60 segundos, acima do timeout configurado da Graph API, permitindo recuperação automática após encerramento inesperado.

O cliente da Graph API será separado do provedor de envio de mensagens para que as consultas administrativas não ampliem a interface de envio nem gerem conflito com a frente de mídia.

## Segurança e privacidade

- Todas as páginas e rotas exigem sessão `ADMIN` no servidor.
- O token permanece apenas nas variáveis de ambiente e no cabeçalho enviado à Meta.
- Respostas e erros são transformados em códigos públicos antes da persistência ou exibição.
- O sistema não persiste o payload bruto completo dos eventos operacionais.
- Identificadores técnicos necessários podem ser persistidos; dados de clientes e conteúdo de mensagens não fazem parte deste módulo.
- Logs seguem o padrão estruturado atual e nunca incluem token ou corpo integral da Graph API.
- A assinatura do webhook continua obrigatória antes de qualquer normalização.

## Falhas e recuperação

- Falha de consulta: mantém o snapshot anterior, registra horário da tentativa e erro sanitizado, mostra `STALE` quando aplicável e permite nova tentativa posterior.
- Timeout ou limite da Meta: não dispara chamadas em cascata; a trava e o intervalo mínimo permanecem válidos.
- Webhook duplicado: a reserva idempotente existente impede duplicação.
- Payload operacional inválido: não cria estado falso e segue a estratégia de falha/quarentena existente.
- Evento desconhecido: é ignorado com resposta bem-sucedida, sem quebrar mensagens.
- Falha no tempo real: o polling do resumo converge a interface.
- Estado crítico anterior com sync vencido: continua crítico até evidência positiva da Meta.

## Testes

Serão exigidos:

- contratos de migração e integridade das novas tabelas;
- normalização de cada campo operacional suportado;
- validação e sanitização de payloads;
- mapeamento determinístico de gravidade;
- idempotência de webhooks;
- transições de abertura, reconhecimento e resolução;
- sincronização, trava concorrente, expiração e repetição sem mudança;
- falhas e timeouts do cliente Graph;
- proteção `ADMIN` em página e APIs;
- estados do label e acessibilidade sem depender apenas de cor;
- página detalhada, paginação, reconhecimento e atualização manual;
- atualização em tempo real e fallback por polling;
- regressão completa dos fluxos atuais de mensagens e mídia.

## Publicação segura com trabalho paralelo

Antes do deploy será obrigatório:

1. Ler a imagem e o commit efetivamente ativos na KVM.
2. Registrar o estado dos contêineres e confirmar saúde antes da mudança.
3. Auditar todas as worktrees, branches e alterações não commitadas do repositório.
4. Identificar as frentes paralelas, especialmente imagens e vídeos, e comparar ancestralidade e diffs.
5. Montar uma versão integrada que seja superset da produção e dos trabalhos concluídos; nenhum arquivo será substituído cegamente.
6. Executar testes focados, suíte completa, lint, typecheck, build e validação do Compose.
7. Fazer backup antes da migração aditiva.
8. Construir uma imagem imutável identificada pelo commit integrado.
9. Aplicar a migração e publicar sem remover volumes ou serviços de outros sistemas.
10. Validar saúde, login, conversas, envio e recebimento, mídia, label e página da Meta.
11. Confirmar ausência de reinícios inesperados e comparar a configuração dos demais serviços antes e depois.

Se uma frente paralela ainda estiver incompleta ou não puder ser integrada sem perda, o deploy será interrompido até que exista uma base segura. A implementação local pode continuar isoladamente.

## Critérios de aceitação

- Atendentes não veem o label, a página nem as APIs.
- Administradores veem o label discreto em todos os cabeçalhos autenticados.
- O label representa o pior estado atual e diferencia dados desatualizados.
- Webhooks operacionais suportados criam ou resolvem alertas sem duplicação.
- A reconciliação recupera qualidade, revisão da WABA e estados de templates consultáveis.
- Um alerta tratado permanece no histórico e não mascara um problema ativo.
- Erros nunca exibem segredos nem transformam estado desconhecido em normal.
- Mensagens e mídia continuam funcionando sem regressão.
- O deploy preserva todas as funcionalidades paralelas confirmadas antes da publicação.
