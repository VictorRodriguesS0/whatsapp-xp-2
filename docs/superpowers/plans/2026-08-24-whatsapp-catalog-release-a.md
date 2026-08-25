# WhatsApp Catalog Release A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are explicitly forbidden for this project.

**Goal:** Conectar a aplicação, em modo somente leitura, ao catálogo oficial já mantido pela XP na Meta, disponibilizar diagnóstico administrativo e pesquisa segura de produtos aos atendentes, sem habilitar envio ainda.

**Architecture:** Um cliente server-only consulta somente o catálogo configurado em `WHATSAPP_CATALOG_ID`, normaliza dados e os entrega por serviços com cache curto, limites e erros públicos. Rotas autenticadas expõem DTOs sanitizados; imagens passam por um resolvedor restrito. A interface administrativa mostra saúde e a conversa abre um seletor somente leitura. Texto, mídia, áudio e demais fluxos continuam independentes do catálogo.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Zod 4, Vitest 4, Prisma/PostgreSQL existentes, WhatsApp Cloud Graph API v23.

## Global Constraints

- Executar sem subagentes.
- Usar TDD: escrever o teste que falha, executar somente esse teste, implementar o mínimo, executar novamente e só então ampliar.
- A Meta/Commerce Manager é a única fonte de produto, preço e disponibilidade; não criar tabela de produtos.
- Não aceitar `catalog_id`, URL Graph ou URL de imagem fornecida pelo navegador.
- Nunca imprimir token, segredo, arquivo de ambiente, payload integral da Graph ou conteúdo real de clientes.
- `WHATSAPP_CATALOG_ID` é opcional; sua ausência não pode impedir o app de iniciar nem afetar mensagens comuns.
- O seletor deve preservar rascunho, resposta rápida, anexo, gravação e resposta citada.
- Antes de qualquer deploy, auditar produção, todas as worktrees, branches, commits e árvores sujas; integrar somente commits concluídos, revisados e testados.
- O deploy pode recriar apenas `xp-whatsapp-app`; não reiniciar/recriar PostgreSQL, Caddy, redes, volumes ou outros sistemas da KVM.
- Criar commits pequenos após cada task verde; antes de commitar, confirmar que HEAD não avançou em paralelo e revisar o diff.

---

### Task 1: Add optional catalog configuration and stable contracts

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Create: `src/modules/catalog/types.ts`
- Create: `src/modules/catalog/schemas.ts`
- Create: `src/modules/catalog/schemas.test.ts`

- [x] **Step 1: Write failing environment tests**

Cover these contracts:

- Meta provider starts when `WHATSAPP_CATALOG_ID` is absent.
- A non-empty catalog ID is normalized and kept server-only.
- Empty/oversized/control-character IDs are rejected.
- No `NEXT_PUBLIC_WHATSAPP_CATALOG_ID` exists in the schema or example.

Run:

    npx vitest run src/lib/env.test.ts

Expected: FAIL because the field is not modeled yet.

- [x] **Step 2: Add the optional environment field**

Add a bounded Meta identifier to the Zod schema and an empty documented entry to `.env.example`. Do not add it to `metaRequiredFields`.

- [x] **Step 3: Define catalog DTOs and raw-normalized boundaries**

Define:

    CatalogAvailability =
      | "IN_STOCK"
      | "OUT_OF_STOCK"
      | "PREORDER"
      | "AVAILABLE_FOR_ORDER"
      | "DISCONTINUED"
      | "UNKNOWN";

    CatalogProductDto = {
      retailerId: string;
      name: string;
      description: string | null;
      priceText: string | null;
      availability: CatalogAvailability;
      availableToSend: boolean;
      imagePath: string | null;
    };

    CatalogPageDto = {
      products: CatalogProductDto[];
      nextCursor: string | null;
      freshness: "FRESH" | "STALE";
      fetchedAt: string;
    };

    CatalogStatusDto = {
      configured: boolean;
      ready: boolean;
      catalog: { idSuffix: string; name: string; productCount: number | null } | null;
      commerce: { catalogVisible: boolean; cartEnabled: boolean } | null;
      freshness: "FRESH" | "STALE" | "UNAVAILABLE";
      lastSuccessAt: string | null;
      errorCode: string | null;
    };

Raw types must remain module-private. Product DTOs may expose only internal image paths.

- [x] **Step 4: Write schema tests and implement bounded parsers**

Test maximum query/cursor lengths, whitespace normalization, availability fallback, malformed Graph records, max page size and removal of control characters.

Run:

    npx vitest run src/modules/catalog/schemas.test.ts src/lib/env.test.ts

Expected: PASS.

- [x] **Step 5: Commit**

    git add .env.example src/lib/env.ts src/lib/env.test.ts src/modules/catalog
    git commit -m "feat: define catalog configuration contracts"

### Task 2: Build a constrained Meta catalog Graph client

**Files:**
- Create: `src/modules/catalog/graph-client.ts`
- Create: `src/modules/catalog/graph-client.test.ts`
- Modify: `src/modules/catalog/types.ts`

- [x] **Step 1: Write HTTP contract tests**

Use injected `fetch`, fake timers and sanitized fixtures. Require:

- URLs are built only from `https://graph.facebook.com/{version}/{configured-id}`.
- Catalog details, product page, exact retailer lookup and commerce settings request only documented minimal fields.
- Cursor is reapplied as an opaque bounded parameter; arbitrary `paging.next` URLs are never followed.
- Response is aborted after the configured timeout.
- JSON larger than 2 MiB, too many items/pages, invalid content type and malformed records fail closed.
- Graph errors map to stable codes such as `CATALOG_PERMISSION_REQUIRED`, `CATALOG_NOT_FOUND`, `META_RATE_LIMITED`, `META_UNAVAILABLE`; token and raw error are absent.

Run:

    npx vitest run src/modules/catalog/graph-client.test.ts

Expected: FAIL because the client does not exist.

- [x] **Step 2: Implement the client**

Model `MetaCatalogClient` with:

    getCatalogSummary(): Promise<CatalogSummary>
    listProducts(input: { query: string; cursor: string | null; limit: number }): Promise<CatalogProductPage>
    getProductsByRetailerIds(ids: readonly string[]): Promise<CatalogProduct[]>
    getCommerceSettings(): Promise<CatalogCommerceSettings>

Reuse the bounded-response and sanitized-error principles from `src/modules/meta-health/graph-client.ts\), not its health-specific types. Deduplicate retailer IDs and keep at most 30 per exact lookup.

- [x] **Step 3: Prove search behavior against the pinned Graph version**

Create tests for the exact documented filtering supported by v23. If the endpoint cannot search name/description/code reliably, fetch only a bounded number of pages, filter normalized cached pages locally and return a continuation cursor. Never implement an unbounded full-catalog scan.

- [x] **Step 4: Run focused tests**

    npx vitest run src/modules/catalog/graph-client.test.ts src/modules/meta-health/graph-client.test.ts

Expected: PASS with no regression in Meta health.

- [x] **Step 5: Commit**

    git add src/modules/catalog
    git commit -m "feat: read products from Meta catalog"

### Task 3: Add bounded single-flight cache and catalog service

**Files:**
- Create: `src/modules/catalog/cache.ts`
- Create: `src/modules/catalog/cache.test.ts`
- Create: `src/modules/catalog/service.ts`
- Create: `src/modules/catalog/service.test.ts`
- Create: `src/modules/catalog/factory.ts`
- Create: `src/modules/catalog/factory.test.ts`

- [x] **Step 1: Write cache tests**

Require five-minute default TTL, maximum entry/product counts, LRU-style eviction, one in-flight promise per normalized key, stale fallback only after a previous success, explicit invalidation and no cache sharing across catalog IDs.

- [x] **Step 2: Implement the in-process cache**

The cache stores sanitized normalized products only. It never stores tokens, raw Graph payloads or arbitrary image URLs in client DTOs.

- [x] **Step 3: Write service tests**

Cover:

- unconfigured status without creating a Graph client;
- ready and stale states;
- search by normalized name, description or code;
- deterministic code tie-break;
- stale search response on transient Meta failure;
- no stale success on permission/not-found errors;
- admin refresh rate limit;
- status masks catalog ID and error details.

- [x] **Step 4: Implement service and singleton factory**

Expose server-only functions:

    getCatalogStatus(actor): Promise<CatalogStatusDto>
    searchCatalogProducts(actor, input): Promise<CatalogPageDto>
    refreshCatalogStatus(actor): Promise<CatalogStatusDto>
    resolveKnownCatalogProduct(retailerId): Promise<CatalogProduct>

Authorization stays in the service as defense in depth. The factory returns an unavailable implementation when the ID is absent.

- [x] **Step 5: Run tests and commit**

    npx vitest run src/modules/catalog/cache.test.ts src/modules/catalog/service.test.ts src/modules/catalog/factory.test.ts
    git add src/modules/catalog
    git commit -m "feat: cache and expose catalog reads"

### Task 4: Implement a closed image resolver

**Files:**
- Create: `src/modules/catalog/image-proxy.ts`
- Create: `src/modules/catalog/image-proxy.test.ts`
- Create: `src/app/api/catalog/products/[retailerId]/image/route.ts`
- Create: `src/app/api/catalog/products/[retailerId]/image/route.test.ts`
- Create: `public/catalog-product-placeholder.svg`

- [x] **Step 1: Write SSRF and resource-bound tests**

Reject HTTP, credentials in URL, localhost, private/link-local/loopback/multicast IPv4 and IPv6, cloud metadata ranges, unsupported MIME, oversized response, slow response and too many redirects. Re-resolve and revalidate every redirect. Never attach Meta authorization to the image request.

- [x] **Step 2: Implement secure fetching**

Resolve the remote URL only through `resolveKnownCatalogProduct(retailerId)`. Use HTTPS, DNS/IP validation, three redirects maximum, a short timeout, bounded streaming bytes and an allow-list of JPEG/PNG/WebP. Return a same-origin placeholder on any unsafe or unavailable origin.

- [x] **Step 3: Implement the authenticated route**

The browser supplies only a bounded retailer ID. Return `Cache-Control: private, max-age=300, stale-while-revalidate=60`, `X-Content-Type-Options: nosniff`, no upstream URL and no Graph details.

- [x] **Step 4: Run and commit**

    npx vitest run src/modules/catalog/image-proxy.test.ts "src/app/api/catalog/products/[retailerId]/image/route.test.ts"
    git add src/modules/catalog src/app/api/catalog public/catalog-product-placeholder.svg
    git commit -m "feat: serve catalog images safely"

### Task 5: Add authenticated catalog APIs

**Files:**
- Create: `src/app/api/catalog/products/route.ts`
- Create: `src/app/api/catalog/products/route.test.ts`
- Create: `src/app/api/settings/whatsapp/catalog/route.ts`
- Create: `src/app/api/settings/whatsapp/catalog/route.test.ts`
- Create: `src/app/api/settings/whatsapp/catalog/refresh/route.ts`
- Create: `src/app/api/settings/whatsapp/catalog/refresh/route.test.ts`

- [x] **Step 1: Write route tests**

For every route test unauthenticated, inactive-user and method behavior. Product search allows active attendants/admins; status/refresh require admin. Refresh requires same origin and returns `429` when limited. Validate bounded query, cursor and limit. Responses contain no token, raw URL, full catalog ID or raw Graph error.

- [x] **Step 2: Implement thin routes**

Use the existing session/origin/error helpers. Routes parse input, call the service and serialize stable public errors only.

- [x] **Step 3: Run and commit**

    npx vitest run src/app/api/catalog/products/route.test.ts src/app/api/settings/whatsapp/catalog/route.test.ts src/app/api/settings/whatsapp/catalog/refresh/route.test.ts
    git add src/app/api/catalog src/app/api/settings/whatsapp/catalog
    git commit -m "feat: add catalog read APIs"

### Task 6: Add the admin catalog diagnostics page

**Files:**
- Create: `src/app/configuracoes/catalogo/page.tsx`
- Create: `src/app/configuracoes/catalogo/page.test.tsx`
- Create: `src/app/configuracoes/catalogo/loading.tsx`
- Create: `src/app/configuracoes/catalogo/error.tsx`
- Create: `src/components/catalog/catalog-settings-screen.tsx`
- Create: `src/components/catalog/catalog-settings-screen.test.tsx`
- Create: `src/hooks/use-catalog-status.ts`
- Create: `src/hooks/use-catalog-status.test.ts`
- Modify: `src/components/inbox/conversation-sidebar.tsx`
- Modify: `src/components/inbox/conversation-sidebar.test.tsx`
- Modify: `src/app/error-states.test.tsx`

- [x] **Step 1: Write page/component tests**

Require admin redirect behavior, masked ID, name/count, visible/cart status, freshness, last success, public remediation and rate-limited refresh. Prohibit product editing controls and secret/raw payload text. Add `Configurar catálogo` only for admins.

- [x] **Step 2: Implement with existing settings shell**

Follow `/configuracoes/meta` patterns. Use semantic status text plus a discreet visual state; color cannot be the sole indication. Refresh must preserve the previous successful summary while pending.

- [x] **Step 3: Run and commit**

    npx vitest run src/app/configuracoes/catalogo/page.test.tsx src/components/catalog/catalog-settings-screen.test.tsx src/hooks/use-catalog-status.test.ts src/components/inbox/conversation-sidebar.test.tsx src/app/error-states.test.tsx
    git add src/app/configuracoes/catalogo src/components/catalog src/hooks/use-catalog-status.ts src/hooks/use-catalog-status.test.ts src/components/inbox/conversation-sidebar.tsx src/components/inbox/conversation-sidebar.test.tsx src/app/error-states.test.tsx
    git commit -m "feat: show WhatsApp catalog diagnostics"

### Task 7: Add the read-only product picker to conversations

**Files:**
- Create: `src/components/catalog/catalog-picker.tsx`
- Create: `src/components/catalog/catalog-picker.test.tsx`
- Create: `src/hooks/use-catalog-products.ts`
- Create: `src/hooks/use-catalog-products.test.ts`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

- [x] **Step 1: Write behavior tests**

Require:

- `Produtos` appears only when catalog status is ready and free-form composition is allowed.
- Desktop uses a related side panel; mobile uses a full-height sheet.
- Search is debounced/cancelable and supports pagination/retry/stale labels.
- Cards show internal image, name, code, price and textual availability.
- Product actions are visibly marked `Disponível na próxima etapa`; no send request exists in Release A.
- Escape closes picker before quick replies/reply draft; browser back closes picker before the conversation.
- Opening/closing preserves text and reply state and returns focus to the trigger.

- [x] **Step 2: Implement hook and picker**

Keep query state scoped to the current conversation. Abort obsolete requests. Render empty/loading/stale/unavailable states accessibly.

- [x] **Step 3: Integrate history and Escape priority**

Use a dedicated history marker analogous to the media viewer marker. Do not reuse or overwrite media/reply markers. When multiple layers exist, the most recently opened layer closes first.

- [x] **Step 4: Run and commit**

    npx vitest run src/components/catalog/catalog-picker.test.tsx src/hooks/use-catalog-products.test.ts src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx
    git add src/components/catalog src/hooks/use-catalog-products.ts src/hooks/use-catalog-products.test.ts src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
    git commit -m "feat: browse Meta catalog in conversations"

### Task 8: Release A gates, Meta activation, deploy and evidence

**Files:**
- Modify: `README.md`
- Modify: `scripts/verify-kvm-deployment.ps1`
- Modify: `scripts/test-deployment.ps1`
- Create: `src/whatsapp-catalog-release-a.test.ts`
- Create: `docs/verification/2026-08-24-whatsapp-catalog-release-a.md`

- [ ] **Step 1: Add RED integrated/deployment contracts**

Require the optional server-only env mapping, read routes, admin page, safe image route and absence of client-exposed Meta variables/product tables. Deployment mutations must reject removal of existing env mappings or recreation of non-app services.

- [ ] **Step 2: Document the least-privilege Meta activation**

Document, without secret values:

1. grant the controlled system user access to the exact XP catalog;
2. validate exact currently documented read permissions, expected to include `business_management` and `catalog_management`;
3. generate/rotate the permanent token only after preserving WhatsApp permissions;
4. discover and positively identify the catalog by name/ID/association;
5. set `WHATSAPP_CATALOG_ID` only in the KVM secret environment;
6. set catalog visibility true while preserving cart true;
7. reread and require convergence.

Stop before mutation if IDs, association or permissions are ambiguous.

- [ ] **Step 3: Run full local gates**

    npm test
    npm run lint
    npm run typecheck
    npm run build
    npm audit --omit=dev
    pwsh -NoProfile -File scripts/test-deployment.ps1
    pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1

Expected: all exit zero, audit reports no production vulnerability and the tree contains only intentional changes.

- [ ] **Step 4: Verify the production-like image**

Build the exact clean revision, run its full suite against disposable PostgreSQL 18, verify non-root UID 1001, healthcheck, Meta credentials absent from layers/client chunks and catalog failure isolation. Perform browser verification with synthetic data for desktop and mobile.

- [ ] **Step 5: Mandatory concurrent-work and live-ancestry audit**

Immediately before deploy:

    git worktree list --porcelain
    git branch --all --verbose --no-abbrev
    git status --short --branch
    git log --all --graph --decorate --oneline -40

Read every worktree status and relevant diff. Obtain the running immutable revision from the app container label without printing environment. Require it to be an ancestor of the candidate. If production or another completed reviewed feature is newer, reconcile by normal Git integration and rerun every gate. Never copy uncommitted parallel files.

- [ ] **Step 6: Deploy only the app**

Use the immutable release procedure already validated in `README.md`:

- create `/opt/apps/example-app/releases/{full-revision}` from the exact Git archive;
- build/tag `xp-whatsapp:{full-revision}` with OCI revision label;
- back up and record current release/image plus database/non-app container invariants;
- atomically update `current` and only `XP_WHATSAPP_IMAGE`;
- run Compose with the canonical project directory, env file and candidate compose file;
- execute `up -d --no-deps app` only.

Abort/rollback if database container ID/StartedAt, non-app container snapshot, networks or volumes change.

- [ ] **Step 7: Verify and record production**

Verify health, login, conversations, text/audio/media regression, admin catalog page, product search, safe images, catalog visibility and cart preservation. Do not send product messages in Release A. Soak logs and restart count, then record sanitized commit/image/health/test/invariant evidence.

- [ ] **Step 8: Commit evidence**

    git add README.md scripts src/whatsapp-catalog-release-a.test.ts docs/verification/2026-08-24-whatsapp-catalog-release-a.md
    git commit -m "docs: verify catalog read release"

## Release A Done Criteria

- [ ] Existing XP catalog is positively identified and readable with least privilege.
- [ ] Catalog is visible in WhatsApp and cart remains enabled.
- [ ] Admin diagnostics and authenticated search work in production.
- [ ] Image route passes SSRF/resource-bound tests.
- [ ] No product/catalog send endpoint is active yet.
- [ ] All current message flows remain healthy.
- [ ] Candidate is a reviewed superset of live production and completed parallel work.
- [ ] Only `xp-whatsapp-app` was replaced.
