# WhatsApp Business Contact Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal**

Sincronizar, pela API oficial da Meta, os nomes salvos no catálogo de contatos do WhatsApp Business App com a caixa compartilhada, sem criar conversas artificiais e preservando nomes manuais, classificações e histórico.

**Architecture**

O webhook `smb_app_state_sync` será normalizado como um lote validado e processado em blocos transacionais de 250 itens. Uma tabela própria manterá contatos ativos e tombstones, vinculando-os por telefone aos contatos da caixa quando existirem. A apresentação aplicará a precedência `preferredName > whatsappAppName > profileName > phone`; o navegador receberá apenas um evento SSE sem PII e refará a consulta autorizada.

**Tech Stack**

Next.js 16, TypeScript, Prisma 7/PostgreSQL, Zod, Vitest, Docker Compose, WhatsApp Cloud API/Graph API.

## Global Constraints

- Desenvolver em `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\whatsapp-quoted-replies`, já um worktree Git isolado.
- Aplicar TDD estrito: observar o teste novo falhar antes de alterar código de produção.
- Não registrar nomes, telefones, payloads ou tokens; métricas e erros devem conter apenas contagens/categorias.
- Aceitar no máximo 5.000 itens por lote, validar cada item isoladamente e processar válidos em blocos de 250.
- Uma remoção limpa apenas o nome sincronizado, preservando contato, conversa, nome manual, tipo e etiquetas.
- Não criar `Contact` nem `Conversation` para entradas que só existem no catálogo do WhatsApp.
- Antes do deploy, auditar obrigatoriamente todos os worktrees/branches paralelos e a revisão ativa em produção; nunca substituir uma revisão mais nova às cegas.
- O deploy não altera Caddy, DNS ou outros sistemas da KVM e possui rollback somente do aplicativo/assinatura do webhook.

---

### Task 1: Add the additive contact-sync schema

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230001_whatsapp_app_contacts/migration.sql`
- Test: `src/modules/webhooks/process.integration.test.ts`

**Step 1: Write the failing schema integration test**

Adicionar um teste que insere uma linha em `whatsapp_app_contacts`, vincula um `Contact` existente e verifica unicidade do telefone, `ON DELETE SET NULL` e ausência de criação de conversa.

**Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/modules/webhooks/process.integration.test.ts --testTimeout=15000`

Expected: falha porque a tabela/modelo ainda não existe.

**Step 3: Add the Prisma model and relation**

Adicionar ao `Contact`:

```prisma
whatsappAppContactId String?             @unique @map("whatsapp_app_contact_id") @db.Uuid
whatsappAppContact   WhatsAppAppContact? @relation(fields: [whatsappAppContactId], references: [id], onDelete: SetNull)
```

Adicionar o modelo:

```prisma
model WhatsAppAppContact {
  id               String    @id @default(uuid()) @db.Uuid
  phone            String    @unique
  fullName         String?   @map("full_name")
  active           Boolean   @default(true)
  sourceTimestamp  DateTime  @map("source_timestamp") @db.Timestamptz(3)
  sourceVersionKey String    @map("source_version_key")
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  contact          Contact?

  @@index([active, phone])
  @@map("whatsapp_app_contacts")
}
```

A migração cria a tabela, constraints e a coluna/FK aditiva, sem backfill nem remoção de dados.

**Step 4: Generate and validate**

Run: `npm run db:generate && npm run db:validate`

Expected: ambos encerram com código 0.

**Step 5: Run the focused test and verify GREEN**

Run: `npx vitest run src/modules/webhooks/process.integration.test.ts --testTimeout=15000`

Expected: teste novo e testes existentes passam.

**Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/202608230001_whatsapp_app_contacts/migration.sql src/modules/webhooks/process.integration.test.ts
git commit -m "feat: add WhatsApp app contact storage"
```

---

### Task 2: Normalize official `smb_app_state_sync` batches safely

**Files:**

- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`

**Step 1: Add failing normalization tests**

Cobrir `add`, `remove`, edição representada por novo `add`, timestamp `0`, lote misto, sanitização de controles/bidi, telefone de 1–32 dígitos, nome obrigatório e limitado a 256, item inválido em quarentena, envelope inválido e lote com 5.001 itens recusado.

O tipo esperado é:

```ts
export type NormalizedContactSyncItem = {
  action: "ADD" | "REMOVE";
  phone: string;
  fullName: string | null;
  sourceTimestamp: Date;
  sourceTimestampRaw: string;
  sourceVersionKey: string;
};

export type NormalizedContactSyncBatchEvent = {
  kind: "contactSyncBatch";
  items: NormalizedContactSyncItem[];
  quarantined: number;
};
```

**Step 2: Verify RED**

Run: `npx vitest run src/modules/webhooks/normalize.test.ts`

Expected: falhas mostram que `smb_app_state_sync` ainda é ignorado.

**Step 3: Implement strict parsing and PII-free version keys**

Reconhecer apenas o formato oficial do campo, recusar envelope/lote acima do limite e validar cada entrada. Remover caracteres de controle e bidi do nome. Gerar `sourceVersionKey` com SHA-256 sobre uma representação canônica da ação, telefone, nome sanitizado e timestamp; a chave armazenada não contém PII legível.

**Step 4: Verify GREEN and regression**

Run: `npx vitest run src/modules/webhooks/normalize.test.ts src/modules/webhooks/signature.test.ts`

Expected: todos passam.

**Step 5: Commit**

```bash
git add src/modules/webhooks/types.ts src/modules/webhooks/normalize.ts src/modules/webhooks/normalize.test.ts src/test/fixtures/meta-webhooks.ts
git commit -m "feat: normalize WhatsApp app contact sync"
```

---

### Task 3: Persist batches with deterministic ordering and linking

**Files:**

- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`

**Step 1: Add failing unit and integration tests**

Cobrir criação/edição/remoção, idempotência, `remove > add` no mesmo timestamp, desempate determinístico entre dois `add`, eventos antigos ignorados, `timestamp=0` sem sobrescrever registro positivo, tombstone inicial, chunks 250, falha parcial e retry, vínculo a contato existente, vínculo futuro no primeiro evento de mensagem/echo e preservação durante merge de identidades.

**Step 2: Verify RED**

Run: `npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts --testTimeout=15000`

Expected: testes novos falham sem processador do lote.

**Step 3: Implement the processor**

Adicionar comparação da tupla `(sourceTimestamp, actionRank, sourceVersionKey)`, sendo `REMOVE=1`, `ADD=0`. Processar cada bloco numa transação serializável. Em `ADD`, fazer upsert, marcar ativo, gravar nome e vincular `Contact` por telefone. Em `REMOVE`, manter telefone/tombstone, limpar `fullName`, marcar inativo e não remover o vínculo. Um remove de timestamp zero só cria tombstone quando não existe estado positivo.

Estender os caminhos de identidade de mensagem e echo para procurar uma entrada ativa por telefone e preencher `whatsappAppContactId`, sem alterar as regras existentes de convergência/merge.

**Step 4: Emit only PII-free realtime events**

Acumular um único evento `contacts.synced` por processamento com `revision` opaco; nenhuma carga contém nomes ou telefones.

**Step 5: Verify GREEN**

Run: `npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts --testTimeout=15000`

Expected: todos passam, inclusive os testes de echo/merge existentes.

**Step 6: Commit**

```bash
git add src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts
git commit -m "feat: persist WhatsApp app contact sync"
```

---

### Task 4: Apply name precedence to authorized contact and conversation views

**Files:**

- Modify: `src/lib/contact-display.ts`
- Modify: `src/lib/contact-display.test.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/service.integration.test.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Modify: `src/modules/contacts/service.integration.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/contacts/types.ts`

**Step 1: Add failing precedence, DTO and search tests**

Verificar `preferredName > whatsappAppName > profileName > phone`, queda automática após remove, resposta dos DTOs e busca case-insensitive pelo nome ativo do WhatsApp App. Confirmar que nome inativo não aparece nem é pesquisável.

**Step 2: Verify RED**

Run: `npx vitest run src/lib/contact-display.test.ts src/modules/conversations/service.test.ts src/modules/contacts/service.test.ts`

Expected: falha pela ausência de `whatsappAppName`.

**Step 3: Implement projection and search**

Alterar a assinatura para:

```ts
type ContactNameSource = {
  preferredName?: string | null;
  whatsappAppName?: string | null;
  profileName?: string | null;
  phone?: string | null;
};
```

Selecionar a relação `whatsappAppContact` apenas quando ativa, incluir o nome no cálculo dos DTOs e adicionar a relação ativa ao filtro de busca. Não expor tombstones.

**Step 4: Verify GREEN**

Run: `npx vitest run src/lib/contact-display.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts --testTimeout=15000`

Expected: todos passam.

**Step 5: Commit**

```bash
git add src/lib/contact-display.ts src/lib/contact-display.test.ts src/modules/conversations src/modules/contacts
git commit -m "feat: display synced WhatsApp contact names"
```

---

### Task 5: Refresh clients through PII-free realtime and document privacy

**Files:**

- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/hub.test.ts`
- Modify: `src/hooks/use-realtime.ts`
- Modify: `src/hooks/use-realtime.test.ts`
- Modify: `src/app/privacidade/page.tsx`
- Modify: `src/app/api/webhooks/meta/route.test.ts`

**Step 1: Add failing realtime and route tests**

Adicionar o evento estrito `{ type: "contacts.synced", revision: string }`; verificar que ele dispara refetch das consultas autorizadas, não contém PII e que o webhook retorna 200 com `quarantined` para lote parcialmente inválido, mas 400 para envelope/oversize inválido.

**Step 2: Verify RED**

Run: `npx vitest run src/modules/realtime/hub.test.ts src/hooks/use-realtime.test.ts src/app/api/webhooks/meta/route.test.ts`

Expected: falha porque o schema/event handler ainda não reconhece o evento.

**Step 3: Implement event handling and privacy text**

Adicionar o evento ao schema e tratar no hook como invalidação/refetch de contatos/conversas. Atualizar a política para explicar que nomes e telefones do catálogo comercial podem ser sincronizados para atendimento, que remoções desativam o nome sincronizado e que o histórico operacional é preservado conforme necessidade legítima.

**Step 4: Verify GREEN**

Run: `npx vitest run src/modules/realtime/hub.test.ts src/hooks/use-realtime.test.ts src/app/api/webhooks/meta/route.test.ts`

Expected: todos passam.

**Step 5: Commit**

```bash
git add src/modules/realtime/events.ts src/modules/realtime/hub.test.ts src/hooks/use-realtime.ts src/hooks/use-realtime.test.ts src/app/privacidade/page.tsx src/app/api/webhooks/meta/route.test.ts
git commit -m "feat: refresh synced contacts securely"
```

---

### Task 6: Run complete local quality gates

**Files:**

- Modify only if a verified defect is found in files from Tasks 1–5.

**Step 1: Prepare an isolated disposable PostgreSQL test database**

Iniciar um container dedicado com nome explícito e banco terminado em `_test`; configurar `DATABASE_URL`, `TEST_DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `WHATSAPP_PROVIDER=demo` e um `MEDIA_ROOT` temporário validado.

**Step 2: Run migration and schema checks**

Run: `npm run db:generate && npm run db:validate && npm run db:deploy`

Expected: migração `202608230001_whatsapp_app_contacts` aplicada; nenhuma pendência.

**Step 3: Run all quality gates**

Run: `npm run lint && npm run typecheck && npx vitest run --testTimeout=15000 && npm run build`

Expected: código 0; nenhum teste novo ou existente falha.

**Step 4: Review scope and secrets**

Run: `git diff 119848c --check`, `git diff 119848c --stat` e `rg -n "TODO|TBD|FIXME"` limitado aos arquivos alterados. Revisar manualmente logs/erros para confirmar ausência de PII/tokens e conferir cobertura integral da especificação.

**Step 5: Commit any verified corrections**

Se houver correção, adicionar explicitamente apenas os arquivos corrigidos com `git add -- path/to/file` e executar `git commit -m "fix: harden WhatsApp contact sync"`. Se nenhuma correção for necessária, não criar commit vazio.

---

### Task 7: Mandatory parallel-work and production pre-deploy audit

**Files:**

- Create: `.superpowers/sdd/contact-sync-predeploy-audit.md`

**Step 1: Enumerate parallel work without mutating it**

Executar `git worktree list --porcelain`, `git branch -vv`, `git status --short` em cada worktree e registrar branch, HEAD e sujeira. Para cada branch paralela, calcular merge-base, commits exclusivos (`git log --left-right`) e arquivos exclusivos (`git diff --name-status <merge-base>..<head>`).

**Step 2: Inspect the active production revision**

Via SSH somente leitura, registrar o target do symlink `/opt/apps/example-app/current`, label/revisão e digest da imagem, estado/health/restarts do container e migrações aplicadas. Comparar a revisão ativa com o ancestral do candidato.

**Step 3: Decide safely**

- Se o candidato contém a revisão ativa e nenhum paralelo tem mudança mais nova destinada à produção, prosseguir.
- Se um paralelo possui funcionalidade já publicada ou aprovada que o candidato não contém, integrar/rebasear/cherry-pickar após testes, sem alterar o worktree paralelo.
- Se houver conflito material ou não for possível determinar a intenção do paralelo, parar antes do deploy e solicitar decisão.
- Repetir os gates completos após qualquer integração.

**Step 4: Record evidence**

O relatório deve listar todos os paralelos, divergências, decisão e revisão candidata final. Não registrar tokens, variáveis de ambiente ou dados pessoais.

**Step 5: Commit the audit report with the candidate**

```bash
git add .superpowers/sdd/contact-sync-predeploy-audit.md
git commit -m "docs: audit parallel work before contact sync deploy"
```

---

### Task 8: Deploy application safely before changing Meta subscription

**Files:**

- Create: `.superpowers/sdd/contact-sync-release-report.md`

**Step 1: Snapshot production read-only state**

Registrar revisão ativa, image ID/digest, container ID, health/restarts, identidade do banco, migrações e estado dos demais containers. Criar backup consistente do banco conforme o procedimento existente, sem expor credenciais.

**Step 2: Build an immutable release**

Gerar artefato/release nomeado pelo SHA Git final, enviar somente os arquivos do aplicativo, construir imagem `xp-whatsapp:<sha>` e executar migração Prisma. Verificar exatamente 14 migrações aplicadas, 0 pendentes e 0 falhas.

**Step 3: Switch only the application**

Atualizar o symlink/recriar apenas o serviço do aplicativo. Não reiniciar banco, proxy ou outros sistemas. Aguardar health e verificar página de login, API autenticada relevante, logs sem erro e restart count zero.

**Step 4: Roll back on failure**

Antes de ativar a assinatura Meta, se houver falha, restaurar imediatamente a imagem/release anterior do aplicativo. Manter a migração aditiva; não executar downgrade de schema.

---

### Task 9: Activate official Meta contact sync once and verify production

**Files:**

- Modify: `.superpowers/sdd/contact-sync-release-report.md`

**Step 1: Read the existing subscription exactly**

Confirmar os 11 campos atuais: `account_alerts`, `account_review_update`, `account_update`, `calls`, `message_template_quality_update`, `message_template_status_update`, `messages`, `phone_number_name_update`, `phone_number_quality_update`, `security`, `smb_message_echoes`.

**Step 2: Append only the contact-sync field**

Adicionar `smb_app_state_sync` mantendo todos os 11 anteriores. Ler novamente e exigir exatamente 12 campos, um callback, uma assinatura de echo e uma assinatura de contact sync.

**Step 3: Trigger the one-time initial sync**

Fazer uma única chamada oficial `POST /{PHONE_NUMBER_ID}/smb_app_data` com `messaging_product=whatsapp` e `sync_type=smb_app_state_sync`. Se a Meta informar que a sincronização inicial já foi consumida, não repetir nem re-onboardar; manter apenas atualizações futuras se o backend estiver saudável.

**Step 4: Verify without exposing customer data**

Monitorar somente contagens agregadas, assinatura válida, `processed/duplicates/quarantined`, ausência de eventos falhos, saúde/restarts e migrações. Confirmar que não surgiram conversas artificiais.

**Step 5: Manual acceptance**

Solicitar que o usuário adicione/edite um nome no celular e confirme a atualização; depois remover o contato e confirmar a queda para o nome de perfil/telefone sem perder conversa, etiquetas, tipo ou nome manual.

**Step 6: Rollback subscription if needed**

Em falha após ativação, restaurar exatamente os 11 campos anteriores e voltar apenas o aplicativo. Dados aditivos já processados permanecem; não apagar tabela nem reiniciar banco/proxy.

**Step 7: Complete the release report**

Registrar SHA final, digest/imagem, migrações `14|0|0`, health/restarts, resultado agregado da Meta, verificação de paralelos, rollback disponível e pendência/resultado do teste manual. Sanitizar segredos e PII.
