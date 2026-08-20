# XP Atendimento MVP — checklist de verificação local

Data da execução: 2026-08-20

Escopo: Task 12, ambiente local production-like.

Resultado: **aprovado localmente**; publicação externa não iniciada.

## Ambiente e limites

- A stack foi criada em Docker Compose com PostgreSQL e aplicação isolados, provider `demo`, origem local canônica e segredos de teste aleatórios em `.env` ignorado pelo Git.
- Antes de iniciar ou remover recursos, nomes, diretório do projeto e labels foram inspecionados. Nenhum container, rede, volume ou diretório fora do escopo `xp-whatsapp` / `task12-verification` foi alterado.
- Migrations e seed foram aplicados. As contas demo documentadas pelo seed foram usadas, sem criar ou inferir credenciais Meta.
- Porta local usada: `127.0.0.1:3187`. Banco sem porta publicada.
- Nenhuma conexão SSH, alteração DNS, configuração Meta ou deploy externo foi executado.

## Fluxos de aceitação

| Fluxo | Evidência | Resultado |
| --- | --- | --- |
| Login válido, senha errada e usuário inativo | Duas sessões independentes; erro genérico não revelou inatividade | PASS |
| Redirects SSR | Rota protegida sem sessão redirecionou a `/login`; usuário autenticado em `/login` foi a `/conversas`; atendente foi impedido de acessar administração | PASS |
| Lista e busca | 3 conversas do seed visíveis; busca por `Carlos` e pelo telefone `98765-1002` retornou apenas o contato esperado | PASS |
| Paginação | O seed tem apenas 3 conversas, portanto não apresenta botão de próxima página; cursor, append, reset de busca e descarte de página obsoleta passaram na suíte automatizada de `use-inbox` e serviços | PASS automatizado |
| Não lidas por usuário | Abrir Pedro como Victor zerou somente o contador de Victor; Marcos permaneceu com 2 não lidas em sessão separada | PASS |
| Responsável | Assumir, trocar para João, remover e assumir como Marcos; cada mudança apareceu na outra sessão via SSE | PASS |
| Texto | Mensagem `Verificação texto 2026-08-20 0716` enviada, persistida como `SENT` e recebida na segunda sessão | PASS |
| Documento | `text/plain`, 40 bytes, enviado com legenda, exibido e persistido como `SENT` | PASS |
| Imagem | PNG válido, 68 bytes, enviado, renderizado pelo endpoint autenticado e persistido como `SENT` | PASS |
| Áudio | MP3, 270 bytes, enviado, exibido e persistido como `SENT` | PASS |
| Vídeo | MP4, 64 bytes, enviado, exibido e persistido como `SENT` | PASS |
| Falha e retry | Provider fake rejeitou deterministicamente a primeira tentativa; testes comprovaram transição `FAILED` → `SENT`, retry somente do registro falho e ausência de mensagem duplicada. Nenhuma falha foi injetada no provider Meta | PASS automatizado |
| Autorização de mídia | Requisição sem sessão retornou 401; sessão autenticada recebeu e renderizou a mídia | PASS |
| Administração | Criar, editar, resetar senha e desativar usuário; novo login após reset retornou 200 e após desativação retornou 401 | PASS |
| Transições do próprio admin | Auto-desativação do último admin e rebaixamento do último admin retornaram 409 | PASS |
| SSE entre sessões | Mensagem e alterações de responsável chegaram à segunda sessão sem reload | PASS |
| Offline/reconexão | Aplicação local foi parada apenas após validar sua label; banner de reconexão apareceu e desapareceu após o health voltar a 200 | PASS |
| Logout | As duas sessões foram encerradas e o acesso posterior à rota protegida redirecionou a `/login` | PASS |

## API, banco e runtime

Consultas somente leitura após os fluxos:

| Entidade | Contagem |
| --- | ---: |
| Usuários | 4 total, 3 ativos, 1 inativo |
| Conversas | 3 |
| Mensagens | 14 total, 8 outbound, 0 falhas |
| Objetos de mídia | 7 total, 7 disponíveis |

Distribuição das mensagens: `TEXT` — 3 `RECEIVED`, 2 `SENT`, 1 `DELIVERED`, 1 `READ`; `IMAGE` — 1 `RECEIVED`, 1 `SENT`; `AUDIO` — 1 `RECEIVED`, 1 `SENT`; `VIDEO` — 1 `SENT`; `DOCUMENT` — 1 `RECEIVED`, 1 `SENT`.

- `/api/health`: HTTP 200; containers da aplicação e banco ficaram `healthy`.
- Runtime final: usuário `nextjs`, UID/GID 1001, servidor standalone e healthcheck presentes.
- A imagem `xp-whatsapp:verified` foi criada com ID `sha256:c31a441f4ac030deca73300c49255e9e300f76bfdfe4d046b376ebfabf21c998`.
- O artefato não contém testes da aplicação, cache de build ou configuração Vitest; dependências de runtime podem conter seus próprios fixtures/testes.
- Logs finais da aplicação e PostgreSQL: 0 linhas suspeitas e 0 valores de segredo detectados pela varredura; nenhum warning `pg@9` no runtime final.

### Investigação do warning `pg@9`

Um warning de depreciação (`client.query()` durante outra query) apareceu uma vez no primeiro runtime. Foi criado um container isolado com `NODE_OPTIONS=--trace-deprecation`, mesma imagem/configuração e label própria. Foram exercitados carregamento da inbox, transação de abertura e oito requests SSR concorrentes. O warning não reapareceu, não houve stack para atribuição e o runtime final também permaneceu limpo. Durante a investigação, um navegador ficou pendente; chamadas read-only simultâneas responderam em 3–10 ms, `pg_stat_activity` mostrou somente conexões `idle/ClientRead` e nenhuma espera por lock. O sinal não é reproduzível nesta execução; se reaparecer, deve ser capturado novamente com trace antes de qualquer alteração no pool.

## Verificação visual e acessibilidade

- Desktop `1440×900`: três painéis sem overflow horizontal, overlay ou erro de console.
- Tablet `900×1100`: conteúdo dentro da viewport, sem overflow horizontal.
- Mobile `390×844`: lista, conversa, voltar, drawer de cliente e rolagem interna utilizáveis.
- O `Escape` fecha o drawer e devolve foco ao botão “Abrir dados do cliente”. Navegação por teclado, rótulos, dialogs e foco foram conferidos.
- Loading, empty e error states passaram nos testes; a busca vazia exibiu orientação ao operador.
- `prefers-reduced-motion: reduce`: transições/animações efetivas limitadas a `0.00001s`.
- Consoles das duas sessões e do navegador automatizado: 0 warnings/errors da aplicação. Nenhum overlay Next.js.

Capturas:

- [Desktop 1440×900](screenshots/task12-desktop-1440x900.png)
- [Tablet 900×1100](screenshots/task12-tablet-900x1100.png)
- [Mobile — conversa 390×844](screenshots/task12-mobile-thread-390x844.png)
- [Mobile — drawer 390×844](screenshots/task12-mobile-client-drawer-390x844.png)
- [Mobile — lista 390×844](screenshots/task12-mobile-list-390x844.png)

## Gates executados

O runner final usou exclusivamente `TEST_DATABASE_URL` e sobrescreveu a origem para `http://localhost:3000`, origem canônica esperada pelos testes HTTP isolados:

```text
docker run --rm --label com.xp.task12.run=task12-verification \
  --network xp_whatsapp_internal --env-file .env \
  -e NODE_ENV=test -e NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  --entrypoint sh xp-whatsapp:test-runner -lc \
  'export DATABASE_URL="$TEST_DATABASE_URL"; npm test -- --run && npm run lint && npm run typecheck && npm run db:validate && npm run build'
```

Resultados:

- Vitest: **58/58 arquivos, 407/407 testes aprovados**.
- ESLint: exit 0, sem erros.
- TypeScript: exit 0, sem erros.
- Prisma: schema válido.
- Next.js: build standalone concluído, 19 rotas geradas.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- `docker compose config --quiet`: PASS.
- `pwsh scripts/verify-compose.ps1`: PASS.
- `pwsh scripts/test-deployment.ps1`: PASS, incluindo mutations negativas.
- `pwsh scripts/test-helper-safety.ps1`: PASS, incluindo falha negativa esperada de nome Docker inválido.
- `scripts/test-restore.sh` em Debian/GNU tar: PASS.
- Backup PowerShell real: dump e mídia válidos, manifesto de 10 linhas, 2/2 checksums e ausência de `.staging` no tar.
- `docker build -t xp-whatsapp:verified .`: PASS.
- Runtime isolado da imagem verificada: healthcheck `healthy`, endpoint 200, UID 1001, standalone funcional e sem testes da aplicação.

Uma primeira execução da suíte, mantendo a origem externa da stack (`3187`), produziu 401/407 passes e seis respostas 403 nos testes que enviam requests canônicos para `localhost:3000`. A causa foi confirmada como configuração do runner, não defeito da aplicação; a execução final isolada acima corrigiu o ambiente e aprovou 407/407.

## Findings corrigidos com RED → GREEN

1. **SSE demorava até o heartbeat para abrir:** teste RED exigiu frame imediato; o hub agora emite `: connected` ao assinar. Testes relevantes e reload production-like passaram; o banner deixou de surgir no carregamento normal.
2. **Upload de mídia quebrava no standalone:** PNG/MP3/MP4 válidos retornavam 500 com `Cannot find module as expression is too dynamic`. Teste de configuração RED; `file-type` foi externalizado no servidor. A imagem reconstruída contém a dependência e todos os uploads passaram.
3. **Foco perdido ao fechar drawer mobile:** teste RED reproduziu foco no `body`; o trigger externo agora é restaurado em `onCloseAutoFocus`. Teste, navegador local e navegador automatizado passaram.
4. **Backup incluía `.staging`:** o validator de restore recusou corretamente o bundle. Mutation check RED; os backups shell e PowerShell agora excluem o diretório transitório. Backup e restore estritos passaram.

## Limpeza e estado final

- Containers diagnósticos/runner rotulados, helpers, diretórios de fixtures e diretórios de backup temporários desta execução foram removidos após validar seus alvos exatos.
- A stack local healthy, o `.env` ignorado e a imagem `xp-whatsapp:verified` foram preservados para inspeção/handoff.
- O usuário QA e as mensagens de verificação permanecem apenas no banco local da stack como evidência reproduzível; nenhum dado externo foi criado.
- Nenhum segredo foi adicionado a arquivo rastreado.

## Bloqueios externos restantes

A aprovação local não autoriza o deploy. Permanecem exatamente estes bloqueios externos:

1. acesso SSH ao KVM;
2. acesso ao DNS de `whatsapp.xpeletronicos.com`;
3. assets/configuração do Meta app;
4. token permanente de System User;
5. verificação do número comercial do WhatsApp.

Até esses itens serem fornecidos, não executar SSH/deploy, não instalar o bloco Nginx público, não solicitar certificado e não configurar callback/subscription Meta.
