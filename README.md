# XP Atendimento — WhatsApp

Central interna da XP Eletrônicos para atendimento compartilhado pela API oficial do WhatsApp Business da Meta. O MVP reúne interface, API, webhook e Server-Sent Events (SSE) em uma única aplicação Next.js, com PostgreSQL e mídia local persistente.

Produção: `https://whatsapp.xpeletronicos.com`

Raiz exclusiva de deploy: `/opt/example-app`

Este projeto não usa WhatsApp Web, QR Code, automação de navegador ou bibliotecas não oficiais. Ele também não compartilha processo, banco, volume, diretório, proxy ou ciclo de atualização com o site principal da empresa.

## Requisitos manuais

Para desenvolvimento:

- Node.js 22 e npm compatível com o `package-lock.json`;
- PostgreSQL 18 acessível apenas localmente;
- Git;
- PowerShell 7 no Windows ou shell POSIX no Linux/macOS.

Para produção:

- KVM Linux com acesso SSH administrativo;
- Docker Engine recente e plugin Docker Compose;
- Nginx, Certbot e o plugin/webroot do Certbot;
- DNS do domínio `xpeletronicos.com`;
- portas públicas 80/TCP e 443/TCP, além da porta SSH administrativa;
- acesso administrativo ao Meta Business, aplicativo Meta, WABA e número comercial verificado;
- local externo, restrito e preferencialmente criptografado para backups.

Não publique 3000, 3100 ou 5432 no firewall. O Compose publica a aplicação somente em `127.0.0.1:3100`; o PostgreSQL não publica porta.

## Ambiente

Copie `.env.example` para `.env` e preencha os campos vazios. Nunca versionar `.env`.
O arquivo versionado usa a origem HTTPS aprovada de produção para falhar de forma segura se for implantado sem revisão. Em desenvolvimento local, altere somente a cópia `.env` para `NEXT_PUBLIC_APP_URL=http://localhost:3000`; em produção mantenha `https://whatsapp.xpeletronicos.com`. A URL deve sempre coincidir com a origem usada pelo navegador.

```powershell
Copy-Item .env.example .env
```

```sh
cp .env.example .env
chmod 600 .env
```

Variáveis principais:

| Chave | Uso |
| --- | --- |
| `APP_PORT` | Porta loopback do host; padrão operacional 3100. |
| `POSTGRES_DB` / `POSTGRES_USER` | Banco e usuário do container PostgreSQL. |
| `POSTGRES_PASSWORD` | Senha forte e exclusiva do banco; obrigatória no Compose. |
| `DATABASE_URL` | URL Prisma. No Compose, use host `database` e aplique URL encoding à senha. |
| `TEST_DATABASE_URL` | Banco descartável exclusivo para testes de integração. Nunca aponte para produção. |
| `AUTH_SECRET` | Segredo aleatório com no mínimo 32 caracteres. |
| `NEXT_PUBLIC_APP_NAME` | Nome exibido pela interface. |
| `NEXT_PUBLIC_APP_URL` | URL absoluta; em produção, `https://whatsapp.xpeletronicos.com`. |
| `WHATSAPP_PROVIDER` | `demo` ou `meta`. Comece com `demo`. |
| `META_GRAPH_API_VERSION` | Versão suportada da Graph API, por exemplo `v23.0`; revise antes de upgrades. |
| `META_HTTP_TIMEOUT_MS` | Timeout das chamadas Meta, entre 100 e 60000 ms. |
| `META_APP_ID` / `META_APP_SECRET` | Identificação e segredo do aplicativo Meta. |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número na Cloud API. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID da conta WhatsApp Business. |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente do System User. |
| `WHATSAPP_VERIFY_TOKEN` | Valor aleatório escolhido para validar o webhook. |
| `MEDIA_ROOT` | Diretório local de mídia; em container é sempre `/data/media`. |

Gere `POSTGRES_PASSWORD`, `AUTH_SECRET` e `WHATSAPP_VERIFY_TOKEN` de forma independente com um gerenciador de segredos ou gerador criptográfico. Não use os valores demonstrativos como segredos de produção. Se a senha do banco contiver caracteres reservados (`@`, `:`, `/`, `%`, `#`), codifique-a no componente de senha de `DATABASE_URL`.

## Desenvolvimento local

Prepare um PostgreSQL 18 local em `127.0.0.1:5432` e crie bancos separados para desenvolvimento e teste. Depois:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Antes de iniciar, confirme na cópia local `.env` que `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Acesse essa mesma origem no navegador. `npm run db:migrate` cria uma migration de desenvolvimento; revise o SQL antes de versioná-la. Para apenas aplicar migrations já existentes, use `npm run db:deploy`.

O seed é idempotente e cria o cenário demonstrativo. As três contas usam a senha `Senha-Demo-2026!`:

- `victor@xpatendimento.local` — administrador;
- `marcos@xpatendimento.local` — atendente;
- `joao@xpatendimento.local` — atendente.

Essas contas e a senha são somente para demonstração. Redefina ou desative todas antes de trocar `WHATSAPP_PROVIDER` para `meta`.

## Qualidade e build

```sh
npm test -- --run
npm run lint
npm run typecheck
npm run db:validate
npm run build
pwsh -NoProfile -File scripts/verify-compose.ps1
docker compose config
docker build -t xp-whatsapp:test .
```

Testes de integração com banco só executam quando `TEST_DATABASE_URL` aponta para um banco descartável. O guard de testes recusa uso fora de `NODE_ENV=test` e não deve receber a URL de produção.

### Confirmações de leitura

Abrir uma conversa avança primeiro a leitura compartilhada local e enfileira a mensagem recebida elegível mais recente. A aplicação envia `status: read` pela Cloud API oficial e o processador interno tenta novamente confirmações transitórias. Consulte somente contagem, horários, concessões e categoria da falha em `whatsapp_read_sync`; nunca copie tokens, corpos de mensagem ou respostas Graph completas para logs.

## Imagem e Compose

A imagem usa Node 22 em múltiplos estágios, `npm ci`, cliente Prisma gerado e saída standalone do Next. O runtime roda como usuário `nextjs` não-root. Antes de iniciar qualquer comando do container, o entrypoint executa o Prisma local da imagem com `migrate deploy`; ele não usa `npx` nem baixa pacotes da rede. Falha de migration impede o servidor de iniciar.

O Compose cria exatamente:

- `xp-whatsapp-app`;
- `xp-whatsapp-database`;
- volume `xp_whatsapp_postgres`, montado em `/var/lib/postgresql` conforme o layout do PostgreSQL 18;
- volume `xp_whatsapp_media`, montado em `/data/media`;
- rede interna `xp_whatsapp_internal`, usada pelo banco;
- rede `xp_whatsapp_egress`, usada pela aplicação para alcançar a Graph API.

Existe somente uma réplica de `app`. O SSE, o rate limiter e os limitadores de mídia mantêm estado em memória. Não use `--scale app`, réplicas de orquestrador ou dois processos Node para este MVP. Escala horizontal exige pub/sub compartilhado e limitador distribuído. Uma reinicialização pode perder eventos SSE transitórios, mas o cliente ressincroniza o estado persistido.

### Primeira inicialização em `/opt/example-app`

```sh
sudo install -d -m 0750 /opt/example-app
sudo chown "$USER":"$USER" /opt/example-app
cd /opt/example-app
# copie ou faça checkout somente deste repositório aqui
cp .env.example .env
chmod 600 .env
# edite .env e preencha todos os segredos
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail --silent http://127.0.0.1:3100/api/health
```

`depends_on: condition: service_healthy` aguarda o PostgreSQL. A aplicação também tem healthcheck; acompanhe a primeira subida porque migrations incompatíveis encerram o container em vez de servir uma versão parcialmente migrada.

Para carregar a demonstração dentro da rede isolada:

```sh
docker compose run --rm app npm run db:seed
```

Não execute o seed após habilitar dados reais.

## DNS, Nginx e HTTPS

Crie um registro DNS `A` para `whatsapp.xpeletronicos.com` apontando ao IPv4 público da KVM. Crie `AAAA` somente se o IPv6 estiver configurado e filtrado corretamente. Confirme a resolução antes do Certbot.

O fluxo usa dois arquivos para que `nginx -t` funcione tanto antes quanto depois da existência do certificado:

1. instale primeiro `deploy/nginx/whatsapp.xpeletronicos.com.bootstrap.conf`, que atende HTTP e o desafio ACME sem referenciar certificado ausente;
2. emita o certificado por webroot;
3. substitua pelo arquivo final `deploy/nginx/whatsapp.xpeletronicos.com.conf`, que referencia os caminhos reais do Certbot e redireciona HTTP para HTTPS.

```sh
sudo install -d -m 0755 /var/www/certbot
sudo install -m 0644 deploy/nginx/whatsapp.xpeletronicos.com.bootstrap.conf \
  /etc/nginx/sites-available/whatsapp.xpeletronicos.com.conf
sudo ln -s /etc/nginx/sites-available/whatsapp.xpeletronicos.com.conf \
  /etc/nginx/sites-enabled/whatsapp.xpeletronicos.com.conf
sudo nginx -t
sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot \
  -d whatsapp.xpeletronicos.com

sudo install -m 0644 deploy/nginx/whatsapp.xpeletronicos.com.conf \
  /etc/nginx/sites-available/whatsapp.xpeletronicos.com.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Se o link já existir, não o recrie. O certificado final deve existir em:

- `/etc/letsencrypt/live/whatsapp.xpeletronicos.com/fullchain.pem`;
- `/etc/letsencrypt/live/whatsapp.xpeletronicos.com/privkey.pem`.

O bloco final atende somente `whatsapp.xpeletronicos.com`, usa `X-Real-IP $remote_addr` para o rate limiter de autenticação, preserva `Host` e `X-Forwarded-*`, limita uploads a 105 MB e define timeouts de requisição. `/api/realtime` desativa buffering/cache, usa `no-store` e timeout longo. WebSocket não é necessário.

## Gravação e envio de áudio

A caixa de atendimento permite gravar uma mensagem de voz, ouvir uma prévia, apagar e enviar. A gravação só começa depois do clique em **Gravar áudio** e exige HTTPS (ou `localhost`) e permissão de microfone. O limite é de cinco minutos e 16 MiB antes da conversão; a aplicação interrompe automaticamente no tempo máximo.

O navegador homologado para operação é Chromium atual (Chrome ou Edge) em desktop e Android. Outros navegadores funcionam apenas quando oferecem `navigator.mediaDevices.getUserMedia`, `MediaRecorder` e geram `audio/webm`, `audio/ogg` ou `audio/mp4`. Quando a gravação não estiver disponível ou a permissão for recusada, o atendente ainda pode usar **Anexar arquivo** para enviar um áudio já salvo.

No servidor, FFprobe valida a entrada e o FFmpeg converte a gravação para OGG/Opus mono, 48 kHz e aproximadamente 24 kbit/s. O arquivo bruto fica apenas em staging temporário e é removido em sucesso ou falha; somente o OGG validado entra no armazenamento comum. A imagem de produção deve conter `ffmpeg` e `ffprobe`, e o processo continua rodando como UID 1001 sem shell ou volume adicional para o conversor.

Se o microfone falhar, confira nesta ordem: HTTPS válido, permissão do site no navegador, dispositivo de entrada selecionado e se outra aplicação está usando o microfone. Não habilite captura automática nem relaxe os limites de upload para contornar uma falha.

## Configuração oficial da Meta

Realize estes passos no Meta for Developers e no Business Manager com uma conta autorizada:

1. crie um aplicativo do tipo apropriado para negócios e adicione o produto WhatsApp;
2. associe a WhatsApp Business Account e conclua a verificação/registro do número comercial;
3. registre `META_APP_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` e `WHATSAPP_PHONE_NUMBER_ID` no `.env`;
4. em Configurações do negócio, crie um System User dedicado, conceda a ele os ativos estritamente necessários e gere token permanente com `whatsapp_business_messaging` e `whatsapp_business_management`; a segunda permissão também é necessária para consultar qualidade do número, revisão da conta e templates;
5. guarde o token em `WHATSAPP_ACCESS_TOKEN`; nunca o coloque em Git, shell history, ticket ou log;
6. defina um `WHATSAPP_VERIFY_TOKEN` aleatório e configure a callback como `https://whatsapp.xpeletronicos.com/api/webhooks/meta`;
7. assine `messages`, `phone_number_quality_update`, `account_update`, `account_review_update`, `phone_number_name_update` e `message_template_status_update` no webhook e associe/subscreva o aplicativo à WABA; em coexistência com o WhatsApp Business App, preserve todos os campos já assinados e acrescente também `smb_message_echoes`;
8. preencha `META_APP_SECRET`, altere `WHATSAPP_PROVIDER=meta` e reinicie somente a aplicação;
9. confirme no painel Meta que a verificação do webhook passou e que eventos chegam com assinatura válida.

Permissões, versões da Graph API, revisão do app e nomenclatura do painel mudam ao longo do tempo. Antes da ativação, confira a documentação oficial vigente da Meta e a data de expiração de todos os ativos. Planeje rotação de token e segredo.

### Saúde e alertas operacionais da Meta

Administradores veem um status discreto no cabeçalho e os detalhes em `/configuracoes/meta`. A tela reúne qualidade do número, nome verificado, revisão da conta, limite informado e o histórico recebido pelos cinco campos operacionais do webhook. Atendentes não consultam nem recebem essa área.

O estado é atualizado pelo webhook e reconciliado pela Graph API quando os dados passam de 15 minutos sem uma consulta bem-sucedida. O navegador verifica o resumo a cada 60 segundos; o servidor limita atualizações manuais e usa uma trava curta para impedir consultas concorrentes. Falhas preservam o último estado conhecido e exibem somente códigos públicos, sem corpo da Meta, token ou identificadores técnicos.

**Marcar como tratado** registra qual administrador conferiu o evento, mas não encerra uma restrição, rejeição ou queda de qualidade. O alerta só deixa de estar ativo após uma transição positiva da Meta. O histórico não é apagado.

Este MVP não envia alertas por e-mail, SMS, Slack ou outro canal externo. A equipe acompanha o label dentro da aplicação. Mantenha a WABA inscrita nos cinco campos operacionais acima; remover uma inscrição interrompe a atualização correspondente mesmo que a reconciliação ainda consiga consultar parte do estado.

### Coexistência com o WhatsApp Business App

Mensagens enviadas pelo WhatsApp Business App ou por aparelhos vinculados só aparecem na central quando a assinatura do objeto `whatsapp_business_account` mantém `messages` e inclui `smb_message_echoes`. Trate a lista de campos como configuração preservada: leia a assinatura vigente sem exibir identificadores, salve a lista anterior em memória, acrescente somente `smb_message_echoes` e confirme por nova leitura que todos os campos anteriores continuam presentes, que o novo campo aparece exatamente uma vez e que nenhum outro campo mudou.

Faça essa alteração somente depois de a imagem nova estar saudável. App Secret, access token e verify token devem permanecer no ambiente do servidor; não os interpole em argumentos, histórico de shell, arquivos versionados, relatórios ou logs. O callback continua sendo o endpoint HTTPS de webhook já configurado, sem alteração de DNS, número, revisão do aplicativo ou outros ativos Meta.

Se a assinatura não convergir ou se a release apresentar falha, execute o rollback nesta ordem:

1. restaure a lista anterior exata de campos, removendo `smb_message_echoes`;
2. faça o readback e confirme que a assinatura voltou integralmente ao estado anterior;
3. recrie somente `xp-whatsapp-app` com a imagem de compatibilidade imutável previamente testada contra o schema migrado;
4. confirme health local e público, rotas críticas, webhook e invariantes dos demais containers.

A imagem genérica anterior às identidades de contato anuláveis não é um alvo válido de rollback. Registre antes do deploy o digest da imagem de compatibilidade aprovada; não recrie PostgreSQL, Caddy, volumes, redes ou outros serviços durante esse procedimento.

O registro sanitizado da implantação e do aceite de produção de 21 de agosto de 2026 está em `docs/verification/2026-08-21-whatsapp-business-app-message-echoes.md`. O registro inclui o rollback intermediário, sua investigação causal e a reativação final controlada.

### Respostas citadas

A central envia respostas citadas pela referência oficial `context.message_id` da WhatsApp Cloud API. O webhook recebe a mesma referência pelos eventos já assinados em `messages` e, na coexistência com o aplicativo WhatsApp Business, em `smb_message_echoes`. Não acrescente campo à assinatura Meta nem altere callback, número ou permissões para habilitar essa função.

A mensagem original precisa pertencer à mesma conversa e já ter identificador oficial. Se a original ainda não chegou, o processamento preserva a referência oficial e liga as duas mensagens quando ela for persistida. Se foi removida ou não estiver disponível localmente, a conversa continua exibindo `Mensagem original indisponível`, sem expor IDs do provedor.

Citar uma mensagem não amplia a janela de atendimento: texto livre, mídia e áudio continuam sujeitos às mesmas 24 horas e às demais políticas da Meta. Uma tentativa fora da janela pode ser recusada e deve seguir o fluxo normal de template aprovado ou aguardar nova mensagem do cliente.

O rollback desta função recria somente `xp-whatsapp-app` com a imagem anterior compatível. A migration aditiva `202608220004_quoted_replies` permanece aplicada; não reverta colunas, referências, PostgreSQL, mídia, Caddy, redes, assinatura Meta nem outros serviços.

### Janela de atendimento de 24 horas

Mensagens livres de atendimento só podem ser enviadas dentro da janela de 24 horas após a última mensagem do cliente. A aplicação considera a janela aberta somente enquanto o instante do envio é estritamente anterior a `lastCustomerMessageAt + 24 horas`; no instante exato do limite ela está encerrada. O servidor calcula essa decisão com o timestamp autoritativo recebido da Meta. Texto, resposta rápida, resposta citada, áudio, imagem, vídeo e documento passam pelo mesmo bloqueio servidor quando a proteção está ativa.

Fora da janela, a continuação usa exclusivamente um template aprovado pela Meta. O template não reabre sozinho a janela para mensagens livres: é necessário o cliente responder. A retomada automática desta aplicação é deliberadamente restrita a uma solicitação recebida do cliente que continua sem resposta da empresa. Uma resposta pela central ou pelo aplicativo WhatsApp Business no celular encerra essa pendência para todos os atendentes. Isso não constitui autorização para marketing, campanha, prospecção ou contato recorrente.

Crie manualmente no Gerenciador do WhatsApp da Meta um template de texto compatível com a finalidade de continuidade de atendimento. Configuração inicial esperada:

- nome técnico: `retomar_atendimento`;
- idioma: `pt_BR`;
- texto: `Olá, {{1}}! A XP Eletrônicos está retomando o atendimento que você iniciou. Podemos continuar por aqui?`;
- uma única variável textual no corpo, usada para o nome seguro do contato.

A categoria, o nome e o texto realmente utilizáveis continuam sujeitos à aprovação da Meta. A aplicação não cria nem presume aprovação. Depois da aprovação, um administrador acessa **Configurações > WhatsApp**, sincroniza os modelos da conta oficial, confere status, idioma, texto e quantidade de parâmetros, seleciona o modelo de retomada e só então ativa a proteção. A ativação falha fechada se a sincronização estiver ausente/desatualizada ou se o modelo estiver não aprovado, incompatível ou indisponível.

A publicação ocorre em duas etapas:

1. publique migration, APIs e interface com `WhatsAppPolicyConfiguration.mode=INACTIVE`; confirme health, webhooks, eco do celular, leitura compartilhada e ausência de impacto nos demais sistemas;
2. somente depois de sincronizar e selecionar um template `pt_BR` aprovado, ative manualmente o modo `ACTIVE` na tela administrativa e valide o fluxo com um contato controlado.

No modo `INACTIVE`, a nova proteção local ainda não bloqueia texto livre; isso não altera nem contorna uma eventual recusa da própria Meta. No modo `ACTIVE`, a interface remove o compositor fora da janela e o servidor continua sendo a barreira autoritativa. O comando **Não contatar** prevalece sobre qualquer elegibilidade e exige motivo auditável. A retirada da restrição também é uma ação administrativa explícita.

Se um envio tiver resultado desconhecido, investigue o webhook e a auditoria; não repita automaticamente nem faça retry cego, porque a Meta pode ter aceitado a primeira tentativa. Se a sincronização falhar, preserve o último cache válido e não ative com dados antigos. Para desarme imediato, volte a configuração a `INACTIVE`. Para rollback de código, recrie somente `xp-whatsapp-app` com a imagem anterior compatível; mantenha o schema aditivo, o histórico e as migrations aplicadas. Não recrie PostgreSQL, Caddy, volumes, redes, assinatura Meta ou containers de outros sistemas.

Antes de cada etapa, registre a auditoria dos trabalhos paralelos, revisão candidata, revisão atualmente implantada, digest das imagens e snapshot dos containers non-app. O registro preparatório e os campos de aceite da etapa 1 ficam em `docs/verification/2026-08-23-whatsapp-service-window-stage-1.md`.

### Testes reais mínimos

Use números autorizados e conteúdo não sensível. Verifique:

- entrada e resposta de texto;
- imagem JPEG/PNG;
- áudio suportado;
- vídeo MP4/3GPP;
- documento PDF/Office e limite de tamanho;
- status `sent`, `delivered`, `read` e falha;
- deduplicação de webhook;
- resposta citada iniciada pela central e pelo aplicativo WhatsApp Business;
- retry explícito de mensagem com falha;
- duas sessões de funcionários recebendo SSE;
- download autenticado de mídia após reiniciar o container;
- resposta dentro e fora da janela de 24 horas.

Não use o número comercial principal até concluir esses testes.

## Operação e logs

```sh
docker compose ps
docker compose logs --since=15m app
docker compose logs --since=15m database
docker inspect --format '{{json .State.Health}}' xp-whatsapp-app
curl --fail --silent https://whatsapp.xpeletronicos.com/api/health
```

Os logs são estruturados e redigem tokens, cookies e segredos. Mesmo assim, restrinja acesso ao grupo operacional e não habilite logs de corpo no Nginx. O healthcheck testa processo e banco, não a Meta.

Reinício controlado da aplicação:

```sh
docker compose restart app
docker compose ps
```

## Backup

O backup cria um subdiretório UTC com `database.dump` em formato custom do `pg_dump`, `media.tar.gz`, sidecars SHA-256 individuais e um manifesto estruturado que também fixa os nomes e hashes dos dois artefatos. O volume de mídia é montado somente leitura no container temporário Alpine. Use um diretório absoluto fora de `/opt/example-app` e copie o diretório completo, sem renomear seus arquivos, para armazenamento externo criptografado.

Os scripts criam helpers Alpine com nome aleatório e label exclusiva por execução. Cada helper é removido somente pelo ID retornado por `docker create`, depois de uma nova confirmação de ID e label; um container preexistente ou com ownership divergente nunca é removido. Tanto o fluxo shell quanto o PowerShell executam o mesmo `scripts/validate-media-archive.sh` antes de gerar hashes e manifesto. A imagem `alpine:3.22` deve estar disponível localmente ou ser obtida do registry antes da janela operacional.

Linux:

```sh
chmod 0750 scripts/backup.sh scripts/restore.sh
./scripts/backup.sh /srv/backups/example-app
```

PowerShell:

```powershell
pwsh -NoProfile -File scripts/backup.ps1 -OutputDirectory 'D:\Backups\xp-whatsapp'
```

Teste periodicamente o restore em ambiente isolado. Um backup não testado não é uma estratégia de recuperação. Defina retenção, monitore espaço e proteja os checksums junto dos artefatos.

## Restore

Restore é destrutivo e exige indisponibilidade. Avise os atendentes, interrompa `app`, mantenha apenas `database` em execução e forneça caminhos absolutos exatos. O script:

- exige no mesmo diretório os nomes exatos `database.dump` e `media.tar.gz`, seus sidecars e o manifesto, e compara todos os hashes e nomes entre si;
- valida o gzip/tar inteiro antes de qualquer mutação e rejeita caminho absoluto, travessia, nome fora da raiz, duplicata, link, device ou qualquer entrada que não seja arquivo regular/diretório;
- confirma container, projeto Compose e volume alvo;
- recusa execução se `app` estiver rodando;
- cria automaticamente um backup preventivo no diretório informado;
- exige a frase exata `RESTORE-XP-WHATSAPP`;
- restaura banco e mídia, mas deixa a aplicação parada para validação;
- se algo falhar depois do início da mutação, restaura automaticamente banco e mídia a partir do backup preventivo e continua com a aplicação parada.

```sh
cd /opt/example-app
docker compose stop app
docker compose up -d database

./scripts/restore.sh \
  --database /srv/backups/example-app/xp-whatsapp-AAAAMMDDTHHMMSSZ/database.dump \
  --media /srv/backups/example-app/xp-whatsapp-AAAAMMDDTHHMMSSZ/media.tar.gz \
  --pre-restore-backup-dir /srv/backups/example-app-before-restore \
  --confirm RESTORE-XP-WHATSAPP

docker compose run --rm app node node_modules/prisma/build/index.js migrate deploy
docker compose up -d app
docker compose ps
curl --fail --silent http://127.0.0.1:3100/api/health
```

Não renomeie nem separe nenhum arquivo do bundle: o restore falha de forma fechada se basename, sidecar, hash calculado ou manifesto divergirem. Se a execução falhar antes da mutação, nada é alterado. Se falhar depois dela, confira nos logs a mensagem `Rollback automático concluído`; se aparecer `FALHA NO ROLLBACK AUTOMÁTICO`, preserve a aplicação parada e use o caminho explícito do backup preventivo exibido no erro para recuperação manual. Em qualquer caso, só volte a aceitar atendimentos depois de validar banco, mídia e healthcheck e iniciar `app` manualmente.

## Atualização

Faça atualização somente neste diretório e registre o commit/tag anterior:

```sh
cd /opt/example-app
./scripts/backup.sh /srv/backups/example-app
git status --short
git rev-parse HEAD
git fetch --tags origin
# selecione explicitamente a release/commit aprovada
git checkout <release-ou-commit-aprovado>
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail --silent http://127.0.0.1:3100/api/health
```

O entrypoint aplica migrations antes do servidor. Nunca atualize simultaneamente o site principal e esta central, e nunca reutilize seus volumes ou `.env`.

### Migration de dados com writers drenados

Uma migration que recalcula dados derivados a partir de tabelas ainda escritas pelo app não deve executar enquanto o runtime anterior aceita mensagens. Um único `UPDATE` é transacional e pode ser idempotente, mas seu snapshot pode anteceder um writer concorrente que já inseriu uma mensagem e ainda aguarda o lock da conversa. Para esse tipo de release, use uma janela curta com a única instância de `app` parada. Caddy, PostgreSQL, volumes, redes, outros containers e a assinatura Meta permanecem intactos; callbacks recebidos na janela devem ser recuperados pelos retries da Meta.

Use uma sessão POSIX administrativa dedicada. Cada bloco usa `set -eu`: em um script, qualquer falha encerra o bloco antes do próximo passo; em um shell interativo, pare e investigue antes de colar o bloco seguinte. Não carregue, copie ou imprima `.env.production`; o Compose recebe apenas seu caminho. Nunca execute `docker compose config` nesta janela, pois a configuração resolvida contém segredos.

Primeiro declare os valores imutáveis, valide os caminhos e carregue as funções de verificação. A candidata é o commit que contém tanto a migration 004 quanto o parser de backup endurecido.

```sh
set -eu

APP_ROOT='/opt/apps/example-app'
ENV_FILE="$APP_ROOT/.env.production"
CANDIDATE_REVISION='cd61d93b66597d35c00394aca6ebe5d722ba7e74'
ROLLBACK_REVISION='ef61c05'
CANDIDATE_RELEASE="$APP_ROOT/releases/$CANDIDATE_REVISION"
CANDIDATE_IMAGE="xp-whatsapp:$CANDIDATE_REVISION"
ROLLBACK_IMAGE="xp-whatsapp:$ROLLBACK_REVISION"
MIGRATION_NAME='202608210004_backfill_response_state'
COMPOSE_FILE="$CANDIDATE_RELEASE/deploy/kvm/docker-compose.yml"

require_regular_file() {
  [ "$#" -eq 1 ]
  case "$1" in /*) ;; *) return 64 ;; esac
  [ -f "$1" ] && [ ! -L "$1" ]
}

require_regular_file "$ENV_FILE"
[ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ]
[ -f "$CANDIDATE_RELEASE/scripts/migration-runbook-state.sh" ] && [ ! -L "$CANDIDATE_RELEASE/scripts/migration-runbook-state.sh" ]
cd "$CANDIDATE_RELEASE/deploy/kvm"
. "$CANDIDATE_RELEASE/scripts/migration-runbook-state.sh"

compose() {
  docker compose --project-directory "$CANDIDATE_RELEASE" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

assert_app_exited() {
  app_status=$(docker inspect --format '{{.State.Status}}' xp-whatsapp-app)
  [ "$app_status" = 'exited' ]
}

assert_app_sessions_drained() {
  app_db_sessions=$(compose exec -T database sh -ceu \
    'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<'SQL'
SELECT count(*)
FROM pg_stat_activity
WHERE datname = current_database()
  AND backend_type = 'client backend'
  AND pid <> pg_backend_pid();
SQL
)
  [ "$app_db_sessions" = '0' ]
}

migration_state() {
  compose exec -T database sh -ceu \
    'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<SQL
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
       || ' ' || count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
       || ' ' || count(*) FILTER (WHERE rolled_back_at IS NOT NULL)
FROM _prisma_migrations
WHERE migration_name = '$MIGRATION_NAME';
SQL
}

read_migration_state() {
  raw_migration_state=$(migration_state)
  IFS=' ' read -r MIGRATION_APPLIED MIGRATION_FAILED MIGRATION_ROLLED_BACK <<EOF
$raw_migration_state
EOF
  for migration_count in "$MIGRATION_APPLIED" "$MIGRATION_FAILED" "$MIGRATION_ROLLED_BACK"; do
    case "$migration_count" in ''|*[!0-9]*) return 65 ;; esac
  done
}

assert_failed_or_incomplete_zero() {
  read_migration_state
  [ "$MIGRATION_FAILED" = '0' ]
}

migration_failed_or_incomplete_present() {
  read_migration_state
  [ "$MIGRATION_FAILED" -gt 0 ]
}

migration_recovery_state_name() {
  read_migration_state
  migration_recovery_state "$MIGRATION_APPLIED" "$MIGRATION_FAILED" "$MIGRATION_ROLLED_BACK"
}

assert_recovery_state() {
  expected_recovery_state=$1
  [ "$(migration_recovery_state_name)" = "$expected_recovery_state" ]
}

assert_migration_applied_clean() {
  read_migration_state
  [ "$MIGRATION_APPLIED" = '1' ]
  [ "$MIGRATION_FAILED" = '0' ]
  [ "$MIGRATION_ROLLED_BACK" = '0' ]
}

assert_migration_applied_resolved_clean() {
  read_migration_state
  [ "$MIGRATION_APPLIED" = '1' ]
  [ "$MIGRATION_FAILED" = '0' ]
  [ "$MIGRATION_ROLLED_BACK" = '1' ]
}
```

Com as funções ainda presentes na mesma sessão, crie e valide o backup, drene somente o app e inicie a candidata. O `--wait` é obrigatório: falha de migration, healthcheck ou timeout interrompe o bloco e não promove nada.

```sh
set -eu

"$CANDIDATE_RELEASE/scripts/backup.sh" /srv/backups/example-app --env-file "$ENV_FILE"
compose stop app
assert_app_exited
assert_app_sessions_drained

XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app
assert_migration_applied_clean
```

Não execute migration one-off enquanto o app anterior estiver ativo. Se o primeiro start candidato falhar, mantenha o app parado. Rode somente o primeiro ramo P3009 abaixo, depois de repetir o bloco de preparação acima caso esteja em uma nova sessão. Ele aceita exclusivamente o estado inicial `0/1/0`, resolve-o com a imagem candidata, confirma `failed_or_incomplete=0` e tenta a candidata **uma única vez** com health wait.

```sh
set -eu

compose stop app
assert_app_exited
assert_app_sessions_drained
assert_recovery_state 'initial-failed'

XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
  compose run --rm --no-deps --entrypoint node app \
  node_modules/prisma/build/index.js migrate resolve --rolled-back "$MIGRATION_NAME"
assert_failed_or_incomplete_zero

# Única tentativa de retry após resolve; não repita este comando automaticamente.
XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app
assert_migration_applied_resolved_clean
```

Se essa única repetição falhar, primeiro classifique o estado agregado. O estado `1/0/1` significa que a migration foi aplicada e somente o servidor/health falhou após o `resolve`; ele deve usar o ramo imediatamente abaixo e **não** pode cair no ramo de resolve/deploy secundário.

```sh
set -eu

compose stop app
assert_app_exited
assert_app_sessions_drained
assert_recovery_state 'retry-server-only'
assert_migration_applied_resolved_clean

# A candidata contém a migration 004; status limpo prova compatibilidade antes do rollback.
XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
  compose run --rm --no-deps --entrypoint node app \
  node_modules/prisma/build/index.js migrate status

# ef61 é compatível com o schema/dados já aplicados: não rode migrate deploy/status nela.
XP_WHATSAPP_IMAGE="$ROLLBACK_IMAGE" \
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app
```

Para uma única tentativa candidata, os únicos estados legítimos são: falha inicial `0/1/0`; após resolve, retry não aplicado `0/0/1`, retry falho `0/1/1`, ou retry aplicado com falha só de servidor `1/0/1`. Para `0/1/1` ou `0/0/1`, use o segundo ramo abaixo. Ele resolve novamente somente para `0/1/1`, prova estado sem falha, executa `migrate deploy` e `migrate status` com a imagem de rollback e só então sobe o rollback com health wait. Os estados `0/1/0` e `1/0/1` são recusados neste ramo: o primeiro precisa do único retry candidato acima, e o segundo pertence ao ramo server-only resolvido. Contagens maiores que uma em `failed` ou `rolled_back`, ou outro histórico inesperado, falham fechados. Não faça `UPDATE` manual.

```sh
set -eu

compose stop app
assert_app_exited
assert_app_sessions_drained
recovery_state=$(migration_recovery_state_name)
case "$recovery_state" in
  retry-failed)
    XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
      compose run --rm --no-deps --entrypoint node app \
      node_modules/prisma/build/index.js migrate resolve --rolled-back "$MIGRATION_NAME"
    ;;
  retry-not-applied) ;;
  initial-failed)
    echo 'Use o único ramo inicial 0/1/0 antes de considerar rollback.' >&2
    exit 65
    ;;
  retry-server-only)
    echo 'Use o ramo 1/0/1: migration aplicada, somente o servidor falhou.' >&2
    exit 65
    ;;
  *)
    echo "Estado de migration inesperado: $recovery_state" >&2
    exit 65
    ;;
esac
assert_failed_or_incomplete_zero

XP_WHATSAPP_IMAGE="$ROLLBACK_IMAGE" \
  compose run --rm --no-deps --entrypoint node app \
  node_modules/prisma/build/index.js migrate deploy
XP_WHATSAPP_IMAGE="$ROLLBACK_IMAGE" \
  compose run --rm --no-deps --entrypoint node app \
  node_modules/prisma/build/index.js migrate status
XP_WHATSAPP_IMAGE="$ROLLBACK_IMAGE" \
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app
```

Se a migration 004 tiver concluído e somente o servidor candidato falhar **sem** um `resolve` anterior, o estado deve ser exatamente `1/0/0`. Não resolva nem reverta a migration. O ramo abaixo exige esse estado inicial concluído/limpo, confirma `migrate status` com a candidata e inicia diretamente a imagem de rollback compatível com health wait.

```sh
set -eu

compose stop app
assert_app_exited
assert_app_sessions_drained
assert_migration_applied_clean

XP_WHATSAPP_IMAGE="$CANDIDATE_IMAGE" \
  compose run --rm --no-deps --entrypoint node app \
  node_modules/prisma/build/index.js migrate status
XP_WHATSAPP_IMAGE="$ROLLBACK_IMAGE" \
  compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app
```

Em nenhum ramo reverta dados já aplicados, execute restore, faça escrita Meta ou altere container non-app. Só encerre a janela depois de health local/público, revisão/digest/UID/redes, migrations, auditoria exata dos dados, logs, Meta e snapshot de todos os containers non-app estarem aprovados.

## Rollback

Rollback de código só é seguro quando a versão anterior aceita o schema já migrado:

```sh
cd /opt/example-app
git checkout <commit-anterior-validado>
docker compose build
docker compose up -d app
docker compose ps
```

Prisma migrations de produção são tratadas como progressivas; não edite ou apague migration já aplicada. Se o schema não for retrocompatível, faça downtime e restaure o par banco+mídia do backup anterior usando o procedimento de restore. Registre a causa e não volte a liberar tráfego até healthcheck e fluxos críticos passarem.

## Checklist de segurança

- `.env` com modo 0600 e acesso administrativo mínimo;
- segredos exclusivos, fortes, rotacionados e fora do Git;
- contas demonstrativas removidas/desativadas antes da Meta;
- SSH por chave, firewall permitindo somente SSH/80/443 e sistema atualizado;
- PostgreSQL sem porta publicada e app somente em loopback;
- backups externos, criptografados, com retenção e restore testado;
- token Meta de System User dedicado, permissões mínimas e rotação planejada;
- webhook HTTPS com assinatura HMAC e App Secret correto;
- revisão periódica da Graph API, formatos de mídia e política de 24 horas;
- monitoramento de health, reinícios, espaço dos volumes e falhas de webhook/envio;
- uma única instância da aplicação enquanto SSE e limitadores forem locais.

Dependências externas que não podem ser automatizadas pelo repositório: acesso à KVM, alteração DNS, instalação global do Nginx/Certbot, emissão do certificado, criação/verificação do app e número Meta, concessão de ativos, geração do token permanente e aprovação de eventuais templates.
