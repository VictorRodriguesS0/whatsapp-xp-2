# WhatsApp Catalog Release C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are explicitly forbidden for this project.

**Goal:** Preservar e mostrar todos os detalhes úteis dos pedidos recebidos pelo WhatsApp — itens, quantidades, preço histórico, subtotais e totais por moeda — enriquecendo nomes/imagens de forma assíncrona sem atrasar nem perder o webhook.

**Architecture:** O normalizador transforma o pedido assinado em conteúdo estruturado e calcula dinheiro com decimal exato. A transação do webhook grava mensagem e um job durável, sem chamar a Graph. Um worker dentro do processo existente reivindica jobs com lease, consulta o catálogo com limites, atualiza somente o snapshot da mensagem e publica realtime. Falha de enriquecimento mantém SKU/quantidade/valor visíveis e tenta novamente com backoff; nenhuma fila externa ou tabela de produto é criada.

**Tech Stack:** Next.js 16 server runtime, TypeScript 7, Prisma 7/PostgreSQL 18, Zod 4, Vitest 4, React 19, WhatsApp Cloud webhooks e cliente de catálogo das Releases A/B.

## Global Constraints

- Releases A e B saudáveis devem ser ancestrais desta candidata.
- Executar sem subagentes e escrever teste RED antes de código.
- Validar assinatura e persistir o pedido antes de qualquer leitura da Meta.
- Não usar `Number` para multiplicação/soma monetária; trabalhar com decimal canônico e `BigInt` escalado.
- Nunca somar moedas diferentes.
- Preço do webhook é histórico e nunca é substituído pelo preço atual do catálogo.
- Pedidos antigos resumidos continuam válidos; não inventar linhas retroativas.
- O job durável não contém token, payload bruto nem cópia permanente do produto.
- Não criar container/serviço externo; worker roda no único processo da aplicação.
- Falha do worker nunca torna o webhook não-2xx depois que a transação foi persistida.
- Auditar trabalho paralelo e produção antes do deploy; substituir somente `xp-whatsapp-app`.

---

### Task 1: Normalize exact order money and detailed content

**Files:**
- Create: `src/modules/orders/money.ts`
- Create: `src/modules/orders/money.test.ts`
- Create: `src/modules/orders/types.ts`
- Modify: `src/modules/messages/content.ts`
- Modify: `src/modules/messages/content.test.ts`
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`

- [ ] **Step 1: Write decimal arithmetic tests**

Cover:

- canonical positive plain decimals with at most six fractional digits;
- zero, leading zeros and trailing-zero normalization;
- rejection of negative, NaN/infinity, exponent notation, excessive precision/length and unsafe quantity;
- exact multiplication such as `19.90 × 3 = 59.70`;
- exact addition preserving currency scale;
- very large bounded values without floating-point drift;
- totals grouped by uppercase ISO-4217-like three-letter code.

- [ ] **Step 2: Implement decimal primitives**

Represent:

    MoneyAmount = {
      currency: string;
      units: bigint;
      scale: number;
    };

Parse a bounded decimal lexeme, align scales using powers of ten and format deterministically. If JSON provided a finite numeric value, convert it once to a bounded plain decimal lexeme and never use that number in arithmetic. Reject scientific or lossy forms rather than guessing.

- [ ] **Step 3: Write detailed order normalization tests**

Use signed-webhook-shaped fixtures for:

- optional customer text;
- 1–100 order lines;
- bounded `catalog_id`, `product_retailer_id`, positive integer quantity, unit price and currency;
- duplicate retailer IDs as distinct historical lines;
- line subtotal and totals by currency;
- mixed currencies;
- missing/malformed fields quarantined according to current webhook rules;
- payload above 100 lines rejected/quarantined without partial silent truncation.

- [ ] **Step 4: Extend order content compatibly**

Keep the old shape valid and make details optional:

    {
      kind: "order";
      catalogId: string;
      productCount: number;
      text?: string | null;
      items?: OrderLineSnapshot[];
      totals?: OrderCurrencyTotal[];
      enrichment?: {
        status: "PENDING" | "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
        updatedAt: string | null;
      };
    }

Each item retains retailer ID, quantity, canonical unit/subtotal amount and currency. Optional enrichment fields are bounded name, short description, availability and internal image eligibility; never remote URL.

- [ ] **Step 5: Run and commit**

    npx vitest run src/modules/orders/money.test.ts src/modules/messages/content.test.ts src/modules/webhooks/normalize.test.ts
    git add src/modules/orders src/modules/messages/content.ts src/modules/messages/content.test.ts src/modules/webhooks src/test/fixtures/meta-webhooks.ts
    git commit -m "feat: preserve detailed WhatsApp orders"

### Task 2: Persist detailed orders before enrichment

**Files:**
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/modules/conversations/service.test.ts`

- [ ] **Step 1: Write transaction tests**

Require:

- detailed content is passed to `createMessage` exactly once;
- webhook event and message become complete without any Graph call;
- duplicate webhook returns existing result and does not duplicate message;
- realtime publishes only after commit;
- a catalog client outage cannot make order persistence fail;
- old summarized order rows still serialize.

- [ ] **Step 2: Persist normalized snapshots**

Use existing `messageContentForPrisma` and `Message.content`; no product table or message schema migration is required for the content itself. The conversation preview stays `Pedido recebido`.

- [ ] **Step 3: Run focused/integration tests**

    npx vitest run src/modules/webhooks/process.test.ts src/modules/conversations/service.test.ts
    npm run test:db -- src/modules/webhooks/process.integration.test.ts

Expected: PASS using only disposable test PostgreSQL.

- [ ] **Step 4: Commit**

    git add src/modules/webhooks src/modules/conversations/service.test.ts
    git commit -m "feat: persist order line snapshots"

### Task 3: Add an additive durable enrichment job

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608240001_catalog_order_enrichment/migration.sql`
- Create: `src/modules/catalog/order-enrichment-repository.ts`
- Create: `src/modules/catalog/order-enrichment-repository.test.ts`
- Create: `src/modules/catalog/order-enrichment-repository.integration.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`

- [ ] **Step 1: Write schema/repository RED tests**

Add one non-product job model keyed by message ID:

    CatalogOrderEnrichment {
      messageId       UUID primary key / FK Message on delete cascade
      attemptCount    Int default 0
      nextAttemptAt   timestamptz
      leaseId         UUID nullable
      leaseUntil      timestamptz nullable
      lastFailureCode String nullable
      completedAt     timestamptz nullable
      createdAt       timestamptz
      updatedAt       timestamptz
    }

Index due unfinished jobs by `completedAt, nextAttemptAt, leaseUntil`.

Repository tests require atomic enqueue, `FOR UPDATE SKIP LOCKED`-equivalent claim, lease ownership, expired lease reclamation, completion, bounded failure code and exponential backoff.

- [ ] **Step 2: Write the additive migration**

Migration must only create the new table/index/FK. It must not rewrite `messages`, lock conversations for a scan or modify existing migrations.

- [ ] **Step 3: Enqueue in the webhook transaction**

After a new detailed ORDER message is created, insert its job within the same serializable transaction. Creating the job performs no network work. Duplicate webhook/message leaves exactly one job.

- [ ] **Step 4: Validate migration and integration**

    npm run db:generate
    npm run db:validate
    npm run test:db -- src/modules/catalog/order-enrichment-repository.integration.test.ts src/modules/webhooks/process.integration.test.ts

Apply the migration twice to a disposable PostgreSQL 18 database; second deploy must report no pending migration and retain rows.

- [ ] **Step 5: Commit**

    git add prisma src/modules/catalog/order-enrichment-repository.ts src/modules/catalog/order-enrichment-repository.test.ts src/modules/catalog/order-enrichment-repository.integration.test.ts src/modules/webhooks
    git commit -m "feat: queue order catalog enrichment"

### Task 4: Process enrichment with leases, backoff and safe snapshots

**Files:**
- Create: `src/modules/catalog/order-enrichment-service.ts`
- Create: `src/modules/catalog/order-enrichment-service.test.ts`
- Create: `src/modules/catalog/order-enrichment-worker.ts`
- Create: `src/modules/catalog/order-enrichment-worker.test.ts`
- Modify: `src/modules/catalog/order-enrichment-repository.ts`
- Modify: `src/modules/catalog/service.ts`
- Modify: `src/modules/catalog/service.test.ts`
- Modify: `src/instrumentation.ts`
- Modify: `src/instrumentation.test.ts`

- [ ] **Step 1: Write service outcome tests**

Require:

- claim one due job and reread its current message content;
- ignore/complete deleted, non-order, old-summary or already-complete messages;
- lookup distinct retailer IDs in bounded batches;
- keep webhook unit price/currency/quantity/subtotal untouched;
- attach current name/description/availability and image eligibility only;
- mark `COMPLETE` if all found, `PARTIAL` if some missing;
- transient Meta failure schedules exponential backoff with jitter cap;
- permission/configuration failure stores a public code and long retry;
- maximum attempts leaves `UNAVAILABLE` content but a manual admin refresh can requeue;
- stale lease owner cannot update/complete a job.

- [ ] **Step 2: Implement transactional snapshot update**

The final update must verify lease ID and current message content, update JSON atomically, complete/reschedule job and publish one conversation/message realtime event after commit. Never overwrite edits/revocations or a newer enrichment.

- [ ] **Step 3: Write/implement worker lifecycle tests**

Mirror the read-receipt worker pattern:

- singleton start from `src/instrumentation.ts` only in Node runtime;
- five-second interval, at most ten jobs per drain;
- no overlapping drains;
- `unref` timer;
- caught failures do not crash Next;
- tests can `runNow` and `stop`.

- [ ] **Step 4: Make admin refresh requeue unfinished jobs**

After a successful catalog refresh, move only incomplete jobs to due now with a bounded update. Do not reset completed jobs or create duplicates. Return only counts/status, no order/customer data.

- [ ] **Step 5: Run and commit**

    npx vitest run src/modules/catalog/order-enrichment-service.test.ts src/modules/catalog/order-enrichment-worker.test.ts src/modules/catalog/service.test.ts src/instrumentation.test.ts
    npm run test:db -- src/modules/catalog/order-enrichment-repository.integration.test.ts
    git add src/modules/catalog src/instrumentation.ts src/instrumentation.test.ts
    git commit -m "feat: enrich WhatsApp orders asynchronously"

### Task 5: Render complete order cards

**Files:**
- Modify: `src/components/inbox/message-rich-content.tsx`
- Modify: `src/components/inbox/message-rich-content.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`

- [ ] **Step 1: Write rendering/accessibility tests**

Require:

- old summary card remains unchanged;
- detailed card shows optional customer text, each item/SKU, quantity, unit price and subtotal;
- totals are separated by currency;
- missing enrichment shows SKU without blocking price;
- partial/unavailable enrichment is discreet and has no dangerous retry action for attendants;
- narrow mobile layout wraps long names/codes and has no horizontal overflow;
- internal product image route only;
- `Responder ao cliente` does not send or confirm anything.

- [ ] **Step 2: Expose a composer focus handle**

Use `forwardRef` with:

    export type MessageComposerHandle = {
      focus(): void;
    };

`ConversationView` owns the ref and passes a narrow `onFocusComposer` callback through bubble/rich content. The action closes catalog/media layers in their established order, focuses the textarea, preserves draft/reply state and announces no automatic operation.

- [ ] **Step 3: Implement detailed card**

Format already-canonical amounts with `Intl.NumberFormat` only for display after safe conversion rules; if conversion would lose precision, render the canonical string with currency. Never recompute totals in React.

- [ ] **Step 4: Run and commit**

    npx vitest run src/components/inbox/message-rich-content.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-composer.test.tsx
    git add src/components/inbox
    git commit -m "feat: show detailed WhatsApp orders"

### Task 6: End-to-end webhook, retry and realtime verification

**Files:**
- Modify: `src/app/api/webhooks/meta/route.test.ts`
- Modify: `src/modules/realtime/events.test.ts`
- Create: `src/order-catalog-release.test.ts`
- Create: `docs/verification/2026-08-24-whatsapp-catalog-release-c-local.md`

- [ ] **Step 1: Add full-story tests**

Prove:

1. valid signed order webhook returns success and persists exact line values;
2. a down catalog API still returns webhook success;
3. job later enriches and emits realtime;
4. second webhook/job run does not duplicate;
5. mixed currency totals stay separate;
6. UI initially shows SKU fallback and updates to enriched names;
7. app restart can reclaim the durable job;
8. text/audio/media/catalog sends remain unaffected.

- [ ] **Step 2: Add security/regression cases**

Cover invalid signature, oversized lines/decimals, hostile names/URLs, revoked/deleted message race, stale lease, raw error/token redaction and SSRF image fallback.

- [ ] **Step 3: Run complete local gates**

    npm test
    npm run lint
    npm run typecheck
    npm run build
    npm audit --omit=dev
    pwsh -NoProfile -File scripts/test-deployment.ps1
    pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1

Run all integration tests against disposable PostgreSQL 18 and browser-test both immediate fallback and post-enrichment update with synthetic order data.

- [ ] **Step 4: Commit local evidence**

    git add src/app/api/webhooks/meta/route.test.ts src/modules/realtime/events.test.ts src/order-catalog-release.test.ts docs/verification/2026-08-24-whatsapp-catalog-release-c-local.md
    git commit -m "test: verify detailed order flow"

### Task 7: Release C production migration, deploy and acceptance

**Files:**
- Modify: `README.md`
- Modify: `scripts/test-deployment.ps1`
- Modify: `scripts/verify-kvm-deployment.ps1`
- Create: `src/whatsapp-catalog-release-c.test.ts`
- Create: `docs/verification/2026-08-24-whatsapp-catalog-release-c.md`

- [ ] **Step 1: Add migration/deployment contracts**

Require additive job migration, worker startup, no external queue/container, exact server-only env mapping and rollback compatibility. Mutation tests must reject edits to old migrations, removal of current services/env or Compose actions affecting database/non-app services.

- [ ] **Step 2: Repeat mandatory parallel/live audit**

Immediately before build/deploy inspect every worktree, branch, dirty file, recent commit and running revision. Candidate must be a clean reviewed superset of live production, Releases A/B and completed parallel work. If any parallel migration exists, compare names/schema/order, integrate normally and rerun generate/validate/integration/full gates. Never deploy two unreviewed migration histories.

- [ ] **Step 3: Build and test the immutable image**

Run full unit/integration/build/audit/deployment/browser gates on the exact revision. In a disposable PostgreSQL 18 container, deploy all migrations from zero and from the immediate production schema, then run a second no-op deploy. Verify worker, non-root runtime and no secret/test payload in image layers.

- [ ] **Step 4: Back up and snapshot invariants**

Create and validate a new database/media backup outside `/opt/apps/example-app`. Record current release/image, database ID/StartedAt, app restart count, non-app container snapshot, networks and volumes. Keep the exact compatible rollback image.

- [ ] **Step 5: Apply migration and replace only app**

Use the canonical immutable release and Compose paths. Because the migration only creates an unused additive job table, the current app remains schema-compatible; run `prisma migrate deploy` from the candidate and then `up -d --no-deps app`. Do not restart/recreate database, Caddy or other services. Require migration status clean and healthcheck green.

- [ ] **Step 6: Perform controlled order acceptance**

With an XP-controlled customer/session:

1. add one or more catalog products to the WhatsApp cart and send the order;
2. verify webhook acknowledgment and immediate SKU/quantity/price card;
3. verify worker enriches names/images and realtime updates without reload;
4. verify exact subtotal/total and currency;
5. click `Responder ao cliente` and confirm it only focuses the existing draft;
6. repeat delivery of the same webhook fixture only in a safe test harness and verify no duplicate;
7. verify text/audio/media and Release B sends.

- [ ] **Step 7: Soak, rollback decision and evidence**

Observe health/restarts, sanitized app logs, pending/due/failed job counts and non-app invariants. If runtime fails, roll back only app image/symlink; the additive unused table is compatible and remains. Do not delete migration/table during emergency rollback. Record exact revision/image/migration/test counts and sanitized acceptance without phone, message body, token or order payload.

- [ ] **Step 8: Commit production evidence**

    git add README.md scripts src/whatsapp-catalog-release-c.test.ts docs/verification/2026-08-24-whatsapp-catalog-release-c.md
    git commit -m "docs: verify detailed order release"

## Release C Done Criteria

- [ ] Signed orders persist detailed bounded lines before any Graph call.
- [ ] Decimal totals are exact and separated by currency.
- [ ] Enrichment is durable, leased, bounded, retriable and non-blocking.
- [ ] Old summary orders remain readable.
- [ ] Detailed cards work on mobile/desktop and reply action only focuses composer.
- [ ] Controlled production order updates from fallback to enriched view.
- [ ] Current message/catalog regressions pass.
- [ ] Candidate is a reviewed superset and only app container plus additive migration changed.

