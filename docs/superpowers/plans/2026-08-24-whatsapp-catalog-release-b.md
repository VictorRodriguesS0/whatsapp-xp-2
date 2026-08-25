# WhatsApp Catalog Release B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are explicitly forbidden for this project.

**Goal:** Permitir que atendentes enviem, dentro da janela autorizada pela Meta, um produto, uma lista revisada de até 30 produtos ou o catálogo completo, com idempotência, revalidação e histórico local auditável.

**Architecture:** O provedor WhatsApp recebe operações tipadas e constrói os três payloads interativos oficiais usando somente o catálogo server-only. O serviço de mensagens ganha um caminho estruturado que reaproveita conversa, restrições, janela, rate limit, lease, idempotência, estados e realtime já existentes. O navegador envia apenas tipo da operação, retailer IDs e UUID; o servidor revalida os produtos antes de persistir e novamente antes da tentativa ao provedor.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Zod 4, Vitest 4, Prisma/PostgreSQL existentes, WhatsApp Cloud Graph API v23.

## Global Constraints

- Release A deve estar saudável e ser ancestral desta candidata.
- Executar sem subagentes e com TDD em passos pequenos.
- Nunca aceitar catálogo, preço, disponibilidade, imagem ou texto arbitrário de produto do navegador.
- Não criar tabela de produtos e não copiar o catálogo da Meta.
- Envio é permitido somente em modo `FREE_FORM` dentro da janela vigente; fora dela bloquear e manter o fluxo de template aprovado existente.
- Lista usa uma seção e no máximo 30 produtos distintos.
- Todo envio precisa de `clientRequestId` UUID e semântica idempotente; retry revalida janela e produto.
- Falha de catálogo não pode interromper texto, áudio, anexos, templates, reações ou leitura.
- Antes do deploy, auditar todos os trabalhos paralelos e a revisão viva; não copiar mudanças não commitadas.
- Deploy substitui somente `xp-whatsapp-app`.

---

### Task 1: Extend structured message content without breaking old rows

**Files:**
- Modify: `src/modules/messages/content.ts`
- Modify: `src/modules/messages/content.test.ts`
- Modify: `src/modules/messages/content.server.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Create: `src/modules/catalog/message-content.ts`
- Create: `src/modules/catalog/message-content.test.ts`

- [ ] **Step 1: Write compatibility tests**

Keep every current content variant valid, especially old `{ kind: "order", catalogId, productCount }`. Add invalid-input tests for more than 30 products, duplicate/unsafe retailer IDs, oversized strings, unsupported availability and browser-supplied catalog ID.

- [ ] **Step 2: Add sanitized snapshot variants**

Add these discriminants to the existing content union:

    { kind: "catalog"; body: string; thumbnailRetailerId: string | null }

    {
      kind: "catalogProduct";
      product: CatalogProductSnapshot;
    }

    {
      kind: "catalogProductList";
      body: string;
      products: CatalogProductSnapshot[];
    }

Snapshot fields are bounded `retailerId`, `name`, optional short description, display-only `priceText`, normalized availability and no raw remote image URL. Images are resolved later through the internal retailer route.

- [ ] **Step 3: Prove Prisma/DTO round trips**

Require `messageContentForPrisma`, `parseMessageContent` and conversation DTO serialization to retain the new variants exactly and reject malformed stored JSON safely.

- [ ] **Step 4: Run and commit**

    npx vitest run src/modules/messages/content.test.ts src/modules/catalog/message-content.test.ts src/modules/conversations/service.test.ts
    git add src/modules/messages src/modules/conversations src/modules/catalog/message-content.ts src/modules/catalog/message-content.test.ts
    git commit -m "feat: model outbound catalog messages"

### Task 2: Add official provider operations

**Files:**
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`
- Modify: `src/modules/whatsapp/demo-provider.test.ts`
- Modify: `src/modules/whatsapp/factory.ts`
- Modify: `src/modules/whatsapp/factory.test.ts`

- [ ] **Step 1: Write exact payload tests**

Assert the provider posts only these server-constructed shapes:

    interactive.type = "product"
    interactive.action.catalog_id = configuredCatalogId
    interactive.action.product_retailer_id = validatedRetailerId

    interactive.type = "product_list"
    interactive.action.catalog_id = configuredCatalogId
    interactive.action.sections = [{ title, product_items: validatedProductItems }]

    interactive.type = "catalog_message"
    interactive.action.name = "catalog_message"

Require one section, 1–30 distinct IDs, official body/header/footer limits, configured recipient and configured catalog only. Verify no token appears in thrown/loggable errors.

- [ ] **Step 2: Extend the provider contract**

Add:

    sendProduct(input): Promise<SendMessageResult>
    sendProductList(input): Promise<SendMessageResult>
    sendCatalog(input): Promise<SendMessageResult>

Pass optional `catalogId` to the Meta provider factory. Calling catalog operations without it returns a sanitized permanent configuration error. Demo provider returns deterministic IDs and captures validated input.

- [ ] **Step 3: Preserve provider outcome semantics**

Use the same timeout, bounded JSON parsing and classification as text/media:

- rejected before an accepted provider ID;
- accepted with provider message ID;
- outcome unknown after a possibly accepted network attempt.

- [ ] **Step 4: Run and commit**

    npx vitest run src/modules/whatsapp/meta-provider.test.ts src/modules/whatsapp/demo-provider.test.ts src/modules/whatsapp/factory.test.ts
    git add src/modules/whatsapp
    git commit -m "feat: send official catalog messages"

### Task 3: Add server-only send validation and preflight

**Files:**
- Create: `src/modules/catalog/send-schemas.ts`
- Create: `src/modules/catalog/send-schemas.test.ts`
- Create: `src/modules/catalog/send-service.ts`
- Create: `src/modules/catalog/send-service.test.ts`
- Modify: `src/modules/catalog/service.ts`
- Modify: `src/modules/catalog/service.test.ts`

- [ ] **Step 1: Write input tests**

Accepted browser input is exactly:

    {
      clientRequestId: string;
      kind: "PRODUCT" | "PRODUCT_LIST" | "CATALOG";
      retailerIds?: string[];
    }

Require UUID, no unknown keys, one ID for product, 1–30 distinct IDs for list and no IDs for catalog. Reject any catalog ID, product snapshot, price, remote URL or free-form Graph payload.

- [ ] **Step 2: Write revalidation tests**

Before persistence:

- resolve all selected IDs against the configured catalog;
- preserve submitted order;
- reject removed, invisible or unavailable products with stable `CATALOG_PRODUCT_UNAVAILABLE`;
- return an updated safe snapshot list for the UI;
- catalog send requires ready/associated/visible status;
- transient Meta failure returns retriable unavailability and creates no pending message.

- [ ] **Step 3: Implement preflight service**

Expose a server-only function that accepts actor/conversation/input, performs authorization/catalog validation and produces a typed `CatalogOutboundContent`. It must not call the provider and must not trust cached stale results.

- [ ] **Step 4: Run and commit**

    npx vitest run src/modules/catalog/send-schemas.test.ts src/modules/catalog/send-service.test.ts src/modules/catalog/service.test.ts
    git add src/modules/catalog
    git commit -m "feat: validate catalog sends server-side"

### Task 4: Reuse the message delivery state machine for catalog content

**Files:**
- Modify: `src/modules/messages/repository.ts`
- Modify: `src/modules/messages/repository.test.ts`
- Modify: `src/modules/messages/repository.integration.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`
- Modify: `src/modules/catalog/send-service.ts`
- Modify: `src/modules/catalog/send-service.test.ts`

- [ ] **Step 1: Write RED repository tests**

Extend `PendingMessageInput` with validated `content`. Require the JSON snapshot and deterministic `body/searchText` preview to be persisted atomically with `type=INTERACTIVE`, `direction=OUTBOUND`, actor and client request ID. Same ID/same operation returns the existing row; same ID/different kind or IDs returns conflict.

- [ ] **Step 2: Extract one internal outbound creation primitive**

Refactor `sendMessageOnce` only enough to share:

- active actor/conversation/contact restriction checks;
- free-form policy check;
- rate limit;
- idempotent pending creation;
- lease/attempt marking;
- provider outcome transitions;
- realtime publication and response-state refresh.

Existing text/media/template behavior must remain byte-for-byte compatible at the route boundary.

- [ ] **Step 3: Add catalog delivery branch**

Before the provider attempt, revalidate current service window and selected products. Dispatch by content kind to `sendProduct`, `sendProductList` or `sendCatalog`. Do not treat an INTERACTIVE catalog message as media.

If revalidation fails before provider attempt, mark a safe local failure and do not create a possible duplicate. If the provider result is outcome unknown, preserve the existing lease/reconciliation semantics and never blindly resend.

- [ ] **Step 4: Extend retry behavior**

Retry permits failed catalog messages only when:

- the actor remains active and allowed;
- free-form window is open;
- catalog remains ready;
- every selected product is live and sendable.

A new retry attempt uses the stored snapshot identity but refreshes the displayed snapshot before provider dispatch. Existing client idempotency remains authoritative.

- [ ] **Step 5: Run focused and integration tests**

    npx vitest run src/modules/messages/repository.test.ts src/modules/messages/service.test.ts src/modules/catalog/send-service.test.ts
    npm run test:db -- src/modules/messages/repository.integration.test.ts src/modules/messages/service.integration.test.ts

Expected: PASS. Integration database must be disposable and guarded by `NODE_ENV=test`.

- [ ] **Step 6: Commit**

    git add src/modules/messages src/modules/catalog/send-service.ts src/modules/catalog/send-service.test.ts
    git commit -m "feat: deliver catalog messages idempotently"

### Task 5: Add the dedicated conversation send route

**Files:**
- Create: `src/app/api/conversations/[id]/catalog-messages/route.ts`
- Create: `src/app/api/conversations/[id]/catalog-messages/route.test.ts`
- Modify: `src/app/api/messages/[id]/retry/route.test.ts`

- [ ] **Step 1: Write route tests**

Cover same-origin, session, active user, UUID conversation, bounded JSON, unknown keys, contact restriction, closed window, unconfigured catalog, stale/removed product, success, same-request replay, conflicting replay, provider rejection/outcome unknown and no raw Graph details.

- [ ] **Step 2: Implement a thin POST route**

Parse input, call the catalog send service and return the standard message DTO/status codes. The route never reads catalog ID from the request.

- [ ] **Step 3: Prove retry route compatibility**

Add catalog retry success/blocked cases while keeping text/media tests unchanged.

- [ ] **Step 4: Run and commit**

    npx vitest run "src/app/api/conversations/[id]/catalog-messages/route.test.ts" "src/app/api/messages/[id]/retry/route.test.ts"
    git add src/app/api/conversations src/app/api/messages
    git commit -m "feat: expose catalog message sending"

### Task 6: Complete picker selection and review UX

**Files:**
- Modify: `src/components/catalog/catalog-picker.tsx`
- Modify: `src/components/catalog/catalog-picker.test.tsx`
- Create: `src/components/catalog/catalog-selection-review.tsx`
- Create: `src/components/catalog/catalog-selection-review.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

- [ ] **Step 1: Write interaction tests**

Require:

- explicit `Enviar produto` sends one product immediately;
- `Enviar catálogo completo` has a clear confirmation;
- multiple selection shows count/30, prevents duplicates/unavailable products and opens review;
- review preserves order, allows removal/cancel and sends only after explicit confirmation;
- double click produces one request;
- conversation A→B while pending never sends to B;
- closed-window transition disables actions and points to existing template flow;
- server removal response updates selection and explains the item;
- Escape/back closes review, then picker, then conversation;
- text/reply draft remains intact and focus returns correctly.

- [ ] **Step 2: Extend inbox optimistic state**

Add a `PendingCatalog` variant and `sendCatalogMessage`. Generate/store `clientRequestId` before request, render a local structured snapshot with `PENDING`, reconcile by returned message ID and keep standard failed/retry state. Do not optimistically invent catalog/product data not present in the last safe DTO.

- [ ] **Step 3: Implement accessible selection/review**

All actions use 44px targets, names, focus trapping and announcements. Mobile respects safe-area; desktop keeps the conversation visible. Availability has icon/text, not color alone.

- [ ] **Step 4: Run and commit**

    npx vitest run src/components/catalog/catalog-picker.test.tsx src/components/catalog/catalog-selection-review.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/hooks/use-inbox.test.tsx
    git add src/components/catalog src/components/inbox src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
    git commit -m "feat: select and send catalog products"

### Task 7: Render outbound catalog cards and previews

**Files:**
- Modify: `src/components/inbox/message-rich-content.tsx`
- Modify: `src/components/inbox/message-rich-content.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`

- [ ] **Step 1: Write rendering tests**

Test product, multi-product and catalog cards with internal images, snapshot copy, 30-item bounds, narrow viewport wrapping and PENDING/SENT/DELIVERED/READ/FAILED statuses. Rich previews must say `Produto enviado`, `Lista de produtos` or `Catálogo enviado`.

- [ ] **Step 2: Implement cards**

Use the stored snapshot for stable history. Never fetch remote image URLs in React. Failed cards expose existing retry only when the server reports eligibility.

- [ ] **Step 3: Run and commit**

    npx vitest run src/components/inbox/message-rich-content.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-list.test.tsx
    git add src/components/inbox
    git commit -m "feat: render catalog messages in history"

### Task 8: Release B gates, controlled production acceptance and deploy

**Files:**
- Modify: `README.md`
- Modify: `scripts/test-deployment.ps1`
- Modify: `scripts/verify-kvm-deployment.ps1`
- Create: `src/whatsapp-catalog-release-b.test.ts`
- Create: `docs/verification/2026-08-24-whatsapp-catalog-release-b.md`

- [ ] **Step 1: Add integrated release contracts**

Require provider methods, dedicated route, server-only catalog ID, content variants, retry revalidation, picker/review and cards in one source tree. Mutation tests reject a client catalog ID, removal of free-form policy checks or deployment recreation of non-app services.

- [ ] **Step 2: Run complete local/image/browser gates**

    npm test
    npm run lint
    npm run typecheck
    npm run build
    npm audit --omit=dev
    pwsh -NoProfile -File scripts/test-deployment.ps1
    pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1

Also run disposable PostgreSQL integration tests and synthetic desktop/mobile/browser scenarios for product, list, catalog, failure, retry, Escape/back and draft preservation.

- [ ] **Step 3: Repeat mandatory parallel/live audit**

Repeat the complete worktree/branch/dirty-tree/recent-commit/live-revision audit from Release A. Candidate must contain Release A, current production and every completed reviewed parallel feature. Any newer production deploy or relevant dirty work stops this deployment until reconciled and all gates rerun.

- [ ] **Step 4: Build/deploy immutable app-only release**

Use the established `/opt/apps/example-app/releases/{revision}` runbook and `up -d --no-deps app` only. Snapshot and compare database ID/StartedAt, non-app containers, networks and volumes before/after. Keep the exact previous image/release for rollback.

- [ ] **Step 5: Perform one authorized acceptance**

Only in an open customer-service window and with an XP-controlled/explicitly authorized destination:

1. send one product;
2. send one two-product list;
3. send catalog complete;
4. verify local optimistic/final states and official WhatsApp rendering;
5. verify no duplicate on repeated same UUID;
6. verify text/audio/media still work.

Do not send test traffic to unrelated customers.

- [ ] **Step 6: Soak, record and commit evidence**

Check health, restart count, sanitized logs, Meta status transitions and invariant snapshots. Roll back only the app image/symlink if needed. Record exact revision/image/test counts without token, customer phone or message body.

    git add README.md scripts src/whatsapp-catalog-release-b.test.ts docs/verification/2026-08-24-whatsapp-catalog-release-b.md
    git commit -m "docs: verify catalog sending release"

## Release B Done Criteria

- [ ] Product, up-to-30 product list and catalog sends use official Meta payloads.
- [ ] Browser cannot choose catalog or forge product metadata.
- [ ] Window/contact restrictions, idempotency, lease and retry rules are preserved.
- [ ] History and previews are stable from sanitized snapshots.
- [ ] Authorized production test renders correctly on WhatsApp.
- [ ] Text/audio/media/templates/reactions/reads remain healthy.
- [ ] Candidate is a reviewed superset and only the app container changed.

