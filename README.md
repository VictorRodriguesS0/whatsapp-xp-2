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

Acesse `http://localhost:3000`. `npm run db:migrate` cria uma migration de desenvolvimento; revise o SQL antes de versioná-la. Para apenas aplicar migrations já existentes, use `npm run db:deploy`.

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

## Configuração oficial da Meta

Realize estes passos no Meta for Developers e no Business Manager com uma conta autorizada:

1. crie um aplicativo do tipo apropriado para negócios e adicione o produto WhatsApp;
2. associe a WhatsApp Business Account e conclua a verificação/registro do número comercial;
3. registre `META_APP_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` e `WHATSAPP_PHONE_NUMBER_ID` no `.env`;
4. em Configurações do negócio, crie um System User dedicado, conceda a ele os ativos estritamente necessários e gere token permanente com `whatsapp_business_messaging` e `whatsapp_business_management`;
5. guarde o token em `WHATSAPP_ACCESS_TOKEN`; nunca o coloque em Git, shell history, ticket ou log;
6. defina um `WHATSAPP_VERIFY_TOKEN` aleatório e configure a callback como `https://whatsapp.xpeletronicos.com/api/webhooks/meta`;
7. assine o campo `messages` no webhook e associe/subscreva o aplicativo à WABA;
8. preencha `META_APP_SECRET`, altere `WHATSAPP_PROVIDER=meta` e reinicie somente a aplicação;
9. confirme no painel Meta que a verificação do webhook passou e que eventos chegam com assinatura válida.

Permissões, versões da Graph API, revisão do app e nomenclatura do painel mudam ao longo do tempo. Antes da ativação, confira a documentação oficial vigente da Meta e a data de expiração de todos os ativos. Planeje rotação de token e segredo.

### Janela de atendimento de 24 horas

Mensagens livres de atendimento só podem ser enviadas dentro da janela de 24 horas após a última mensagem do cliente. Fora dela, a Meta exige template aprovado e pode recusar o envio. Este MVP registra a falha retornada, mas não implementa seleção/envio de templates. Não tente contornar a política; responda após nova mensagem do cliente ou implemente templates oficiais em uma evolução controlada.

### Testes reais mínimos

Use números autorizados e conteúdo não sensível. Verifique:

- entrada e resposta de texto;
- imagem JPEG/PNG;
- áudio suportado;
- vídeo MP4/3GPP;
- documento PDF/Office e limite de tamanho;
- status `sent`, `delivered`, `read` e falha;
- deduplicação de webhook;
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

O backup cria um subdiretório UTC com `database.dump` em formato custom do `pg_dump`, `media.tar.gz`, checksums SHA-256 individuais e manifesto. O volume de mídia é montado somente leitura no container temporário Alpine. Use um diretório absoluto fora de `/opt/example-app` e copie o resultado para armazenamento externo criptografado.

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

- valida checksums, formato do dump e caminhos do tar;
- confirma container, projeto Compose e volume alvo;
- recusa execução se `app` estiver rodando;
- cria automaticamente um backup preventivo no diretório informado;
- exige a frase exata `RESTORE-XP-WHATSAPP`;
- restaura banco e mídia, mas deixa a aplicação parada para validação.

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

Não renomeie o dump ou o arquivo de mídia sem atualizar os sidecars `.sha256`. Se qualquer etapa falhar, mantenha a aplicação parada e recupere o backup preventivo antes de aceitar novos atendimentos.

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
