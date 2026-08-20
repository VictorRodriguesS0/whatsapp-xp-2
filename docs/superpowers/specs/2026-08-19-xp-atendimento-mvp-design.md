# XP Atendimento MVP — Design

**Data:** 19 de agosto de 2026

**Produto:** XP Atendimento — WhatsApp

**Destino:** `https://whatsapp.xpeletronicos.com`
**Empresa:** XP Eletrônicos

## 1. Resultado esperado

Construir uma central interna de atendimento conectada exclusivamente à WhatsApp Business Platform / Cloud API oficial da Meta. Vários funcionários autenticados devem visualizar e responder às mesmas conversas simultaneamente, identificar o funcionário que enviou cada resposta, organizar um responsável por conversa e receber atualizações sem recarregar a página.

O MVP deve funcionar em modo demonstrativo antes da criação da conta Meta e entrar em produção na KVM da Hostinger sem compartilhar processo, container, banco, diretório, volume ou ciclo de deploy com `xpeletronicos.com`.

## 2. Decisões arquiteturais

### 2.1 Aplicação

Será utilizado um monólito modular em Next.js, TypeScript e App Router, executado no runtime Node.js. O mesmo artefato conterá interface, autenticação, rotas HTTP, webhook, integração Meta e endpoint SSE. As responsabilidades ficarão separadas por módulos internos, sem criar microsserviços no MVP.

### 2.2 Persistência

PostgreSQL será executado em container próprio. Prisma será o ORM, responsável por schema, migrations e acesso tipado. IDs internos serão UUIDs. Datas serão armazenadas em UTC e apresentadas no fuso do navegador.

### 2.3 Tempo real

Server-Sent Events será usado por ser suficiente para eventos unidirecionais do servidor para os navegadores. O servidor publicará eventos de invalidação depois da confirmação da transação no banco. O cliente recarregará somente a lista ou conversa afetada.

O MVP terá uma única instância do container da aplicação. O broadcaster poderá permanecer em memória porque mensagens e leituras continuarão persistidas no PostgreSQL. Ao reconectar, o cliente sempre sincronizará o estado atual, portanto a perda de um evento transitório não perde dados. Escala horizontal futura exigirá substituir o broadcaster por PostgreSQL `LISTEN/NOTIFY`, Redis ou outro barramento.

### 2.4 Integração WhatsApp

Uma interface interna `WhatsAppProvider` separará dois provedores:

- `demo`: grava mensagens simuladas e transições de status sem chamar serviços externos;
- `meta`: usa a Graph API oficial para texto, imagem, áudio, vídeo e documentos.

O provedor será selecionado por `WHATSAPP_PROVIDER=demo|meta`. A versão da Graph API será configurável por `META_GRAPH_API_VERSION`, inicialmente `v23.0`, evitando versão fixa no código.

Não serão utilizadas bibliotecas ou técnicas que emulem WhatsApp Web, QR Code, sessão de navegador ou protocolos não oficiais.

### 2.5 Mídia

Arquivos serão armazenados por uma abstração `MediaStorage`. O MVP implementará `LocalMediaStorage` em volume persistente, com chaves geradas pelo servidor e sem confiar em nomes de arquivo fornecidos pelo usuário.

Mídia recebida será registrada como pendente junto com o Media ID da Meta. Depois da resposta do webhook, o servidor tentará baixar e persistir o arquivo. Se isso não concluir, a rota autenticada de mídia fará recuperação sob demanda antes de responder. Assim a URL temporária da Meta nunca será tratada como armazenamento permanente.

A interface mostrará estados de processamento e falha. O desenho permitirá adicionar S3, Cloudflare R2 ou outro armazenamento sem alterar regras de conversa.

## 3. Componentes principais

### 3.1 Rotas de interface

- `/login`: formulário de autenticação.
- `/`: redireciona usuários autenticados para `/conversas`.
- `/conversas`: central com lista, histórico e painel do cliente.
- `/configuracoes/usuarios`: administração de usuários, somente para administradores.

### 3.2 Módulos do servidor

- `auth`: senha, sessão, cookie e autorização por perfil.
- `users`: criação, edição, redefinição de senha e ativação.
- `contacts`: busca e atualização de contatos.
- `conversations`: listagem, leitura e responsável.
- `messages`: persistência, envio, status e tentativa novamente.
- `media`: validação, armazenamento, upload e download.
- `whatsapp`: contrato do provedor, implementação demo e cliente Meta.
- `webhooks`: validação, normalização, idempotência e processamento.
- `realtime`: conexões SSE e publicação de eventos.
- `logging`: logs estruturados e redação de dados secretos.

### 3.3 Rotas HTTP principais

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/read`
- `PATCH /api/conversations/:id/responsible`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/reset-password`
- `GET /api/media/:id`
- `GET /api/realtime`
- `GET /api/webhooks/meta`
- `POST /api/webhooks/meta`
- `GET /api/health`

Todos os endpoints internos exigirão sessão ativa e autorização no servidor. O webhook e o healthcheck terão políticas públicas específicas.

## 4. Modelo de dados

### 4.1 `users`

- `id`
- `name`
- `email` único, normalizado em minúsculas
- `password_hash`
- `role`: `ADMIN` ou `ATTENDANT`
- `active`
- `created_at`
- `updated_at`

Usuários com mensagens vinculadas nunca serão excluídos pelo MVP.

### 4.2 `sessions`

- `id`
- `user_id`
- `token_hash` único
- `expires_at`
- `created_at`
- `last_seen_at`

O navegador receberá somente o token opaco. O banco armazenará seu hash. Desativar um usuário invalidará o acesso mesmo que ainda exista cookie.

### 4.3 `contacts`

- `id`
- `whatsapp_id` único
- `phone` único
- `name`
- `profile_picture_url`
- `created_at`
- `updated_at`

### 4.4 `conversations`

- `id`
- `contact_id` único no MVP
- `responsible_user_id` opcional
- `last_message_at`
- `created_at`
- `updated_at`

O responsável é somente organizacional. Nenhuma consulta de autorização filtrará conversas por responsável.

### 4.5 `messages`

- `id`
- `conversation_id`
- `whatsapp_message_id` único e opcional até a resposta da Meta
- `client_request_id` único e opcional, usado para idempotência de envio pela interface
- `direction`: `INBOUND` ou `OUTBOUND`
- `type`: `TEXT`, `IMAGE`, `AUDIO`, `VIDEO`, `DOCUMENT` ou `UNSUPPORTED`
- `body` opcional
- `media_object_id` opcional
- `sent_by_user_id` opcional para recebidas, obrigatório para respostas internas
- `status`: `PENDING`, `RECEIVED`, `SENT`, `DELIVERED`, `READ` ou `FAILED`
- `failure_reason` sanitizado e opcional
- `external_timestamp`
- `created_at`
- `updated_at`

### 4.6 `media_objects`

- `id`
- `storage_provider`
- `storage_key` opcional enquanto pendente
- `original_filename` sanitizado
- `mime_type`
- `size_bytes`
- `sha256` opcional
- `meta_media_id` opcional
- `status`: `PENDING`, `AVAILABLE` ou `FAILED`
- `failure_reason` sanitizado e opcional
- `created_at`
- `updated_at`

### 4.7 `conversation_reads`

- `id`
- `conversation_id`
- `user_id`
- `last_read_message_id` opcional
- `last_read_at`
- restrição única para `(conversation_id, user_id)`

O contador de não lidas considera mensagens recebidas posteriores à leitura daquele usuário. Abrir uma conversa não muda o estado dos colegas.

### 4.8 `webhook_events`

- `id`
- `deduplication_key` único
- `event_type`
- `status`: `PROCESSING`, `PROCESSED` ou `FAILED`
- `error_summary` sanitizado e opcional
- `processed_at` opcional
- `created_at`

O conteúdo integral do webhook não será duplicado nessa tabela. Mensagens e status normalizados serão a fonte de verdade.

### 4.9 Índices

Serão criados índices para:

- `users.email`
- `sessions.token_hash` e `sessions.expires_at`
- `contacts.whatsapp_id` e `contacts.phone`
- `conversations.last_message_at`
- `messages.whatsapp_message_id`
- `messages.client_request_id`
- `messages.conversation_id, external_timestamp`
- `conversation_reads.conversation_id, user_id`
- `webhook_events.deduplication_key`

## 5. Fluxos funcionais

### 5.1 Login

1. Normalizar e validar e-mail e senha.
2. Buscar usuário ativo.
3. Verificar hash com `scrypt` e comparação em tempo constante.
4. Criar token aleatório, armazenar somente o hash e emitir cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
5. Redirecionar para `/conversas`.

### 5.2 Recebimento de webhook

1. Ler o corpo bruto.
2. Calcular HMAC SHA-256 com `META_APP_SECRET`.
3. Comparar com `X-Hub-Signature-256` em tempo constante.
4. Validar estrutura do payload.
5. Para cada mensagem, iniciar transação.
6. Reservar chave de idempotência e ignorar eventos já concluídos.
7. Encontrar ou criar contato e conversa.
8. Criar a mensagem pelo `whatsapp_message_id` único.
9. Atualizar `last_message_at`.
10. Confirmar a transação.
11. Publicar evento SSE.
12. Para mídia, iniciar persistência depois da resposta e manter recuperação sob demanda.

Uma falha antes da confirmação retornará erro para permitir nova tentativa da Meta. Duplicatas não criarão novas mensagens.

### 5.3 Atualização de status

1. Localizar a mensagem por `whatsapp_message_id`.
2. Aplicar somente progressões válidas de estado.
3. Registrar `FAILED` e motivo sanitizado quando fornecido.
4. Publicar evento SSE depois da transação.

Eventos atrasados não rebaixarão uma mensagem de `READ` para `DELIVERED` ou `SENT`.

### 5.4 Envio de texto

1. Autorizar usuário ativo.
2. Validar conversa, conteúdo e `client_request_id`.
3. Criar mensagem `PENDING` com o funcionário remetente.
4. Chamar o provedor selecionado.
5. Registrar ID externo e status retornado, ou `FAILED` com erro seguro.
6. Atualizar `last_message_at` e publicar SSE.

O nome do funcionário será metadado interno e não será acrescentado ao texto enviado ao cliente.

### 5.5 Envio de mídia

1. Validar autenticação, tipo MIME, extensão, tamanho e nome.
2. Persistir arquivo no volume local.
3. Enviar o arquivo ao endpoint de mídia da Meta.
4. Enviar a mensagem usando o Media ID.
5. Persistir IDs e status.
6. Em falha, manter a mensagem e o arquivo para uma tentativa explícita.

Os limites iniciais seguirão a documentação da Meta: imagem até 5 MB, áudio e vídeo até 16 MB e documentos até 100 MB. A configuração de Nginx suportará o maior limite permitido. Formatos e limites serão centralizados para atualização futura.

### 5.6 Leitura individual

Ao abrir a conversa, o cliente informará a última mensagem visível. O servidor verificará se ela pertence à conversa e atualizará a leitura com operação monotônica. Outros usuários não serão afetados.

### 5.7 Responsável

Qualquer administrador ou atendente ativo poderá assumir, trocar ou remover o responsável. A alteração será validada no servidor e publicada para todos. Usuário inativo não poderá ser escolhido como novo responsável.

## 6. Interface

### 6.1 Estrutura desktop

- Coluna esquerda: busca, conversas ordenadas, contato, resumo, horário, responsável e não lidas.
- Centro: cabeçalho do contato, histórico, estados de carregamento/erro/vazio e compositor.
- Direita: nome, telefone, responsável e ações de atribuição.

A tela usará uma paleta neutra e quente, tipografia legível e hierarquia por espaçamento, alinhamento e contraste. Não copiará identidade visual, ícones, assets ou aparência proprietária do WhatsApp.

### 6.2 Responsividade

Desktop será a experiência principal. Em notebooks estreitos, o painel do cliente poderá recolher. Em tablet e celular, lista, conversa e detalhes funcionarão como vistas sucessivas, sem eliminar funcionalidades essenciais.

### 6.3 Estados e erros

A interface terá estados claros para:

- carregamento inicial e incremental;
- lista vazia e busca sem resultados;
- falha ao carregar;
- conexão SSE perdida e reconexão;
- envio pendente, enviado, entregue, lido e com falha;
- mídia em processamento, indisponível ou não suportada;
- sessão expirada;
- erro da Meta, incluindo janela de atendimento encerrada.

### 6.4 Presença e digitação

Indicadores de presença e digitação não serão implementados no MVP. Eles exigiriam estado efêmero adicional e não melhoram a confiabilidade das mensagens. O protocolo SSE poderá receber novos tipos de evento em uma versão posterior.

## 7. Segurança

- Autorização server-side em toda operação interna.
- Cookie de sessão seguro e token opaco revogável.
- Hash de senha com `scrypt`, salt aleatório e parâmetros versionados.
- Validação de entrada com schemas tipados.
- Segredos apenas no servidor e em variáveis de ambiente.
- Verificação HMAC do corpo bruto do webhook.
- Comparações de tokens em tempo constante.
- Proteção contra path traversal no armazenamento local.
- Limites de tamanho e lista permitida de tipos de arquivo.
- Headers básicos de segurança no proxy e na aplicação.
- Rate limit simples para login e endpoints de envio.
- Mensagens de erro sem tokens, senhas, App Secret ou resposta integral sensível.
- Queries feitas pelo Prisma e sem SQL construído com entrada do usuário.

## 8. Logs e observabilidade

Logs estruturados conterão nível, evento, request ID e IDs internos necessários. Serão registrados:

- inicialização e modo do provedor;
- webhook aceito, rejeitado ou duplicado;
- falha de processamento;
- envio e falha da Meta;
- falha de armazenamento ou banco;
- erro interno inesperado.

Tokens, senhas, App Secret, cookies, corpos integrais de mensagens e binários não serão registrados. O healthcheck verificará processo e conectividade com o banco, sem testar a Meta em toda chamada.

## 9. Demonstração

O seed criará:

- administrador `Victor`;
- atendentes `Marcos` e `João`;
- contatos `Carlos`, `Maria` e `Pedro`;
- conversas com texto e exemplos de mídia;
- responsabilidades e leituras individuais diferentes.

Credenciais demonstrativas serão documentadas e deverão ser alteradas ou removidas antes de ativar o provedor Meta em produção.

## 10. Deploy isolado na KVM

### 10.1 Containers

- `xp-whatsapp-app`: build standalone do Next.js.
- `xp-whatsapp-database`: PostgreSQL.

O banco não publicará porta para a internet. A aplicação publicará somente `127.0.0.1:3100`. Os containers usarão rede e nomes próprios, volume PostgreSQL próprio e volume de mídia próprio.

### 10.2 Diretório e configuração

O deploy recomendado ficará em `/opt/example-app`, com `.env` exclusivo e permissões restritas. Nenhum comando de atualização apontará para o diretório do site principal.

### 10.3 Reverse proxy e HTTPS

Um arquivo de servidor Nginx independente atenderá apenas `whatsapp.xpeletronicos.com`, fará proxy para `127.0.0.1:3100`, desabilitará buffering no endpoint SSE, aceitará uploads dentro dos limites da Meta e usará certificados Let's Encrypt obtidos por Certbot.

Adicionar esse bloco exigirá apenas validar e recarregar o Nginx; não reiniciará containers ou processos de `xpeletronicos.com`.

### 10.4 Atualização e rollback

O procedimento de atualização será:

1. Fazer backup do PostgreSQL e, quando necessário, da mídia.
2. Obter a nova versão no diretório exclusivo.
3. Construir a nova imagem.
4. Executar migrations compatíveis.
5. Reiniciar somente os serviços `xp-whatsapp-*`.
6. Conferir healthcheck e logs.

O README documentará como voltar para uma imagem/tag anterior quando não houver migration destrutiva.

### 10.5 Backup

Serão documentados comandos para:

- `pg_dump` em formato customizado;
- restauração com `pg_restore`;
- compactação e cópia do volume/diretório de mídia;
- validação periódica dos arquivos gerados.

## 11. Configuração manual da Meta

O proprietário da conta deverá:

1. Registrar ou usar uma conta Meta Developer.
2. Criar um app com o caso de uso WhatsApp.
3. Criar ou vincular o Business Portfolio e a WhatsApp Business Account.
4. Usar primeiro o número de teste da Meta.
5. Guardar Phone Number ID e WhatsApp Business Account ID.
6. Criar um System User e token permanente com `business_management`, `whatsapp_business_messaging` e `whatsapp_business_management`.
7. Configurar callback `https://whatsapp.xpeletronicos.com/api/webhooks/meta`.
8. Informar o mesmo Verify Token configurado no servidor.
9. Assinar o campo de mensagens da conta WhatsApp.
10. Configurar o App Secret e token permanente somente no `.env` da KVM.
11. Testar envio, resposta, status e mídia com o número de teste.
12. Adicionar e verificar o número comercial definitivo quando os testes estiverem concluídos.

Mensagens livres enviadas pela empresa serão limitadas à janela de atendimento iniciada pelo cliente. Templates e campanhas não fazem parte do MVP.

## 12. Testes e validação

### 12.1 Testes automatizados prioritários

- autenticação, expiração e usuário inativo;
- autorização de administrador;
- validação de assinatura do webhook;
- normalização de payload de texto e mídia;
- idempotência por `whatsapp_message_id`;
- criação atômica de contato, conversa e mensagem;
- progressão monotônica de status;
- leitura individual;
- assumir, trocar e remover responsável;
- envio com `client_request_id` duplicado;
- seleção entre provedor demo e Meta.

### 12.2 Verificações de entrega

Antes da conclusão serão executados:

- testes automatizados;
- lint;
- typecheck;
- geração do Prisma Client e validação das migrations;
- build de produção;
- build do Docker Compose;
- smoke test de login, lista, conversa, envio demo, responsável, usuários e SSE;
- inspeção responsiva das telas principais.

O fluxo real da Meta só poderá ser validado depois que o usuário fornecer as credenciais e concluir as etapas manuais da conta.

## 13. Fora do escopo

Não serão implementados no MVP: distribuição automática, filas, inbox privado, chatbot, IA, respostas automáticas ou rápidas, tags, CRM avançado, notas, catálogo, orçamento, carrinho, checkout, pagamentos, motoboy, ERP, campanhas, dashboard comercial, relatórios, comissões, presença, indicador de digitação, templates e histórico de responsáveis.

O schema e os módulos evitarão bloquear essas extensões, mas nenhum código especulativo será criado para elas.

## 14. Critérios de aceite

O MVP será aceito quando:

1. Usuários ativos fizerem login e usuários inativos forem bloqueados.
2. Administradores gerenciarem usuários sem exclusão destrutiva.
3. Todos visualizarem todas as conversas.
4. Lista e histórico atualizarem sem refresh.
5. Leituras e contadores forem individuais.
6. Funcionários enviarem texto e mídia e forem identificados internamente.
7. Texto, imagem, áudio, vídeo e documento forem recebidos e exibidos.
8. Status da Meta forem persistidos e exibidos.
9. Responsável puder ser assumido, trocado e removido sem restringir acesso.
10. Busca funcionar por nome e telefone.
11. Webhook for autenticado e idempotente.
12. O modo demo funcionar sem credenciais Meta.
13. O Compose subir app e banco isolados.
14. O subdomínio operar com HTTPS sem reiniciar ou acoplar o site principal.
15. Testes, lint, typecheck e build terminarem sem erro.
