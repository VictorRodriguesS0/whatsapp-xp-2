# Quick Replies and Meta Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let employees insert company-managed text shortcuts with `/` while enforcing the Meta customer-service window and offering approved WABA templates when free-form messaging is unavailable.

**Architecture:** Persist and audit corporate quick replies locally, render their allowlisted variables on the server, and keep them separate from a read-only cache of Meta template metadata. Materialize the latest inbound customer time on each conversation; all non-template sends pass a server window guard, while template sends reuse the existing idempotent outbound/status pipeline through an extended provider interface.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7, Prisma 7.9.1, PostgreSQL 18, Zod 4.4.3, WhatsApp Graph API v23.0, Vitest/Testing Library, SSE.

## Global Constraints

- Releases 0–2 must be deployed and verified first.
- Quick replies are shared by the company; only administrators create, edit, order, activate, or deactivate them.
- Quick replies are text-only in this release and may use only `{{nome_cliente}}`, `{{nome_atendente}}`, and `{{telefone_loja}}`.
- Employees always preview/edit inserted quick-reply text before sending; no shortcut sends automatically.
- The WhatsApp Business app's local quick replies/labels are not imported or represented as synchronized.
- Free-form text, attachment, and recorded audio sends are blocked server-side when the 24-hour customer-service window is closed.
- Approved Meta templates are a distinct feature and may be sent inside or outside the service window.
- Meta remains authoritative for template status and delivery; a local cache never overrides a provider rejection.
- Tokens, WABA IDs, raw Graph bodies, provider URLs, and diagnostic text never reach browser DTOs or logs.
- Template/quick-reply variables are bounded, validated, escaped as data, and never interpreted as code/HTML.
- Existing outbound idempotency, delivery lease, outcome-unknown handling, status webhooks, and retry rules remain mandatory.

---

## File Structure

- `prisma/schema.prisma`: last inbound time, quick replies, Meta template cache, and outbound template metadata.
- `prisma/migrations/202608210004_quick_replies_and_templates/migration.sql`: additive tables/columns/backfill/indexes.
- `src/modules/messaging-window/service.ts`: window calculation and send guard.
- `src/modules/quick-replies/types.ts`, `schemas.ts`, `service.ts`: CRUD, placeholder parser, and server render.
- `src/modules/templates/types.ts`, `schemas.ts`, `service.ts`: cache sync, supported-template analysis, and send workflow.
- `src/modules/whatsapp/provider.ts`: list/send template contracts.
- `src/modules/whatsapp/meta-provider.ts`: bounded Graph template pagination and send payload.
- `src/modules/whatsapp/demo-provider.ts`: deterministic template behavior.
- `src/modules/whatsapp/factory.ts`: WABA config wiring.
- `src/modules/messages/service.ts`, `schemas.ts`: service-window guard and template send persistence.
- `src/modules/webhooks/process.ts`: monotonic `lastInboundAt` update.
- `src/app/api/quick-replies/**`: employee list/render and admin CRUD.
- `src/app/api/meta/templates/**`: authenticated list/admin sync.
- `src/app/api/conversations/[id]/templates/route.ts`: template send.
- `src/components/settings/quick-replies-screen.tsx`: admin library.
- `src/components/inbox/quick-reply-palette.tsx`: keyboard `/` palette.
- `src/components/inbox/template-picker.tsx`: closed-window approved template UI.
- `src/components/inbox/message-composer.tsx`: window-aware composition.
- `src/hooks/use-inbox.ts`: library/template loading and template send.
- `deploy/kvm/docker-compose.yml`, `.env.example`, `README.md`: `XP_STORE_PHONE` and template operations.

### Task 1: Add quick-reply, template-cache, and messaging-window persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608210004_quick_replies_and_templates/migration.sql`
- Modify: `prisma/temporal-contract.test.ts`
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed.test.ts`

**Interfaces:**
- Produces `Conversation.lastInboundAt`.
- Produces `QuickReply` and `MetaMessageTemplate`.
- Produces `Message.metaTemplateName` and `metaTemplateLanguage`.

- [ ] **Step 1: Write RED migration/backfill tests**

Assert timezone-aware `last_inbound_at`, creator/editor FKs, unique shortcut, unique `(name,language)`, JSON components, and backfill from maximum inbound `(externalTimestamp,id)`:

```ts
expect(await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { lastInboundAt: true } }))
  .toMatchObject({ lastInboundAt: latestInbound.externalTimestamp });
```

- [ ] **Step 2: Run DB tests to verify RED**

Run: `npm run test:db -- prisma/temporal-contract.test.ts prisma/seed.test.ts`

Expected: FAIL because the columns/tables do not exist.

- [ ] **Step 3: Add exact Prisma models**

```prisma
model Conversation {
  lastInboundAt DateTime? @map("last_inbound_at") @db.Timestamptz(3)
  @@index([lastInboundAt])
}

model QuickReply {
  id              String   @id @default(uuid()) @db.Uuid
  shortcut        String   @unique
  title           String
  body            String
  position        Int
  active          Boolean  @default(true)
  createdByUserId String   @map("created_by_user_id") @db.Uuid
  updatedByUserId String   @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdByUser   User     @relation("QuickReplyCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  updatedByUser   User     @relation("QuickReplyEditor", fields: [updatedByUserId], references: [id], onDelete: Restrict)

  @@index([active, position, shortcut])
  @@map("quick_replies")
}

model MetaMessageTemplate {
  id         String   @id @default(uuid()) @db.Uuid
  metaId     String?  @map("meta_id")
  name       String
  language   String
  category   String
  status     String
  components Json
  bodyText   String   @map("body_text")
  supported  Boolean
  syncedAt   DateTime @map("synced_at") @db.Timestamptz(3)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([name, language])
  @@index([status, supported, name])
  @@map("meta_message_templates")
}

model Message {
  metaTemplateName     String? @map("meta_template_name")
  metaTemplateLanguage String? @map("meta_template_language")
}
```

Add inverse user relations. Backfill `last_inbound_at` with `MAX(external_timestamp) FILTER (WHERE direction='INBOUND')` grouped by conversation. Do not seed business quick replies as if the company had approved their wording; seed tests may create fixtures only.

- [ ] **Step 4: Generate/migrate and verify GREEN**

Run: `npm run db:generate; npm run db:validate; npm run db:deploy; npm run test:db -- prisma/temporal-contract.test.ts prisma/seed.test.ts`

Expected: PASS; rerunning seed does not alter administrator-owned quick replies/templates.

- [ ] **Step 5: Commit persistence**

```bash
git add prisma src/generated/prisma
git commit -m "feat: add quick reply and template data"
```

### Task 2: Enforce the Meta customer-service window for all free-form sends

**Files:**
- Create: `src/modules/messaging-window/service.ts`
- Create: `src/modules/messaging-window/service.test.ts`
- Create: `src/modules/messaging-window/service.integration.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`

**Interfaces:**
- Produces `customerServiceWindow(actorConversationId, now): CustomerServiceWindowDto`.
- Produces `assertFreeFormWindowOpen(conversationId, now): Promise<void>`.
- DTO: `{ status: "OPEN" | "CLOSED"; closesAt: string | null }`.

- [ ] **Step 1: Write RED boundary and integration tests**

Cover no inbound, exactly before 24h, exactly at 24h closed, future/older webhook ordering, text/media/recording blocked before message creation/provider call, and template workflow exempt.

```ts
await expect(sendMessage(actor, conversation.id, textInput, depsAt(exactly24h)))
  .rejects.toMatchObject({ status: 409, code: "CUSTOMER_SERVICE_WINDOW_CLOSED" });
expect(provider.calls).toBe(0);
expect(await prisma.message.count()).toBe(0);
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/messaging-window/service.test.ts src/modules/messaging-window/service.integration.test.ts src/modules/webhooks/process.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts "src/app/api/conversations/[id]/recordings/route.test.ts"`

Expected: FAIL because no server window guard/materialized last inbound exists.

- [ ] **Step 3: Implement monotonic inbound update**

Inside the same webhook transaction as inbound message creation, use one parameterized conditional update so older webhooks cannot regress it:

```sql
UPDATE conversations
SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, $timestamp), $timestamp)
WHERE id = $conversation_id;
```

- [ ] **Step 4: Implement exact window semantics and guard**

```ts
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function toWindow(lastInboundAt: Date | null, now: Date): CustomerServiceWindowDto {
  if (!lastInboundAt) return { status: "CLOSED", closesAt: null };
  const closesAt = new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
  return { status: now.getTime() < closesAt.getTime() ? "OPEN" : "CLOSED", closesAt: closesAt.toISOString() };
}
```

Call `assertFreeFormWindowOpen` in `sendMessageOnce` before file validation, message creation, quota debit, or provider calls. Recordings and attachments flow through the same service and inherit the guard.

- [ ] **Step 5: Return window state in conversation detail/list DTOs**

Compute against dependency-injected `now` for tests. The browser receives status/closesAt, never the raw policy implementation.

- [ ] **Step 6: Run focused tests twice and commit**

Run Step 2 twice. Expected: PASS, zero provider/database side effects when closed.

```bash
git add src/modules/messaging-window src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/messages src/modules/conversations src/app/api/conversations/[id]/recordings/route.test.ts
git commit -m "fix: enforce Meta service window"
```

### Task 3: Implement quick-reply CRUD and server-side rendering

**Files:**
- Create: `src/modules/quick-replies/types.ts`
- Create: `src/modules/quick-replies/schemas.ts`
- Create: `src/modules/quick-replies/service.ts`
- Create: `src/modules/quick-replies/service.test.ts`
- Create: `src/modules/quick-replies/service.integration.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`

**Interfaces:**
- Produces `listActiveQuickReplies`, `listAllQuickReplies`, `createQuickReply`, `updateQuickReply`, and `renderQuickReply`.
- Produces `QuickReplyDto` and `RenderedQuickReplyDto { id, shortcut, body, revision }`.

- [ ] **Step 1: Write RED schema/render/concurrency tests**

Cover shortcut normalization, duplicate 409, body/title/position bounds, only allowlisted placeholders, inactive render rejection, admin CRUD, attendant active list/render, variable fallback, HTML treated as plain text, and two-admin equivalent shortcut race.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/modules/quick-replies/service.test.ts src/modules/quick-replies/service.integration.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement schemas and placeholder parser**

```ts
const shortcut = z.string().trim().toLowerCase().regex(/^\/[a-z0-9_-]{2,32}$/);
const ALLOWED_VARIABLES = new Set(["nome_cliente", "nome_atendente", "telefone_loja"]);

export function variablesIn(body: string): string[] {
  const variables = [...body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]!);
  const unknown = variables.filter((variable) => !ALLOWED_VARIABLES.has(variable));
  if (unknown.length) throw new HttpError(400, "A resposta contém uma variável não permitida");
  return [...new Set(variables)];
}
```

Use title `1..80`, body `1..4096`, position `0..10_000`.

- [ ] **Step 4: Render with server-authoritative values**

Add optional, server-only `XP_STORE_PHONE` parsing to `src/lib/env.ts`; reject non-E.164-like configured values with `z.string().regex(/^\+[1-9]\d{7,14}$/).optional()`. Tests inject the parsed value into the service dependency rather than mutating process globals. Load contact resolved name, actor name, and the injected store phone. Replace exact placeholders as plain strings. Require the value when `{{telefone_loja}}` is used; otherwise return safe 409 rather than an empty number. Revision is `updatedAt.toISOString()`.

- [ ] **Step 5: Run tests twice and commit**

Run Step 2 twice. Expected: PASS with one duplicate winner.

```bash
git add src/modules/quick-replies src/lib/env.ts src/lib/env.test.ts
git commit -m "feat: add corporate quick replies"
```

### Task 4: Expose quick-reply APIs and admin UI

**Files:**
- Create: `src/app/api/quick-replies/route.ts`
- Create: `src/app/api/quick-replies/route.test.ts`
- Create: `src/app/api/quick-replies/[id]/route.ts`
- Create: `src/app/api/quick-replies/[id]/route.test.ts`
- Create: `src/app/api/quick-replies/[id]/render/route.ts`
- Create: `src/app/api/quick-replies/[id]/render/route.test.ts`
- Create: `src/components/settings/quick-replies-screen.tsx`
- Create: `src/components/settings/quick-replies-screen.test.tsx`
- Modify: `src/app/configuracoes/atendimento/page.tsx`
- Modify: `src/app/configuracoes/atendimento/page.test.tsx`
- Modify: `src/modules/realtime/events.ts`

**Interfaces:**
- GET active list is available to any employee; POST/PATCH/list-all are admin-only.
- Render requires `{ conversationId: uuid }` and returns resolved text.
- Produces SSE `{ type: "settings.updated"; scope: "quick-replies" }`.

- [ ] **Step 1: Write RED route/UI tests**

Assert permission/order/envelopes, no raw env leakage, inactive render 409, admin create/edit/deactivate, variable help text, duplicate copy, focus restoration, and safe malformed/network errors.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/app/api/quick-replies src/components/settings/quick-replies-screen.test.tsx src/app/configuracoes/atendimento/page.test.tsx`

Expected: FAIL because routes/UI do not exist.

- [ ] **Step 3: Implement route factories and settings section**

Follow existing user/settings patterns. The editor shows the exact allowed variables as insertion buttons, validates shortcut with leading `/`, and deactivates rather than deletes.

- [ ] **Step 4: Run route/UI tests and commit**

Run Step 2 plus `npx eslint src/app/api/quick-replies src/components/settings src/app/configuracoes/atendimento`.

Expected: PASS with zero warnings.

```bash
git add src/app/api/quick-replies src/components/settings/quick-replies-screen.tsx src/components/settings/quick-replies-screen.test.tsx src/app/configuracoes/atendimento src/modules/realtime/events.ts
git commit -m "feat: manage shared quick replies"
```

### Task 5: Build the keyboard `/` quick-reply palette

**Files:**
- Create: `src/components/inbox/quick-reply-palette.tsx`
- Create: `src/components/inbox/quick-reply-palette.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes active list and render API.
- `MessageComposer` receives `quickReplies`, `onRenderQuickReply(id)`, and `windowState`.

- [ ] **Step 1: Write RED palette tests**

Cover `/` at start/after whitespace, no palette for URLs/middle of words, search by shortcut/title/body, arrow/Home/End/Escape/Enter, click selection, active descendant, server render, insertion at token range, editable result, stale conversation render rejection, and disabled behavior outside the window.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/components/inbox/quick-reply-palette.test.tsx src/components/inbox/message-composer.test.tsx src/hooks/use-inbox.test.tsx`

Expected: FAIL because palette/contracts do not exist.

- [ ] **Step 3: Implement a controlled listbox palette**

Keep the textarea value/selection in `MessageComposer`. Parse only the token from the nearest whitespace to the caret. Render a `role="listbox"` anchored above the composer with options and `aria-activedescendant`; do not move DOM focus away from the textarea during arrow navigation.

- [ ] **Step 4: Resolve and insert from the server**

On selection, call render with the current conversation ID. Re-check scope before replacing the slash token. Announce “Resposta rápida inserida”; leave the text editable and require the normal send action.

- [ ] **Step 5: Run focused tests, React review, and commit**

Run Step 2 and `npx eslint src/components/inbox/message-composer.tsx src/components/inbox/quick-reply-palette.tsx src/hooks/use-inbox.ts`.

Expected: PASS with zero warnings or focus loss.

```bash
git add src/components/inbox/quick-reply-palette.tsx src/components/inbox/quick-reply-palette.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: insert quick replies with slash"
```

### Task 6: Extend the provider with bounded Meta template sync and send

**Files:**
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`
- Modify: `src/modules/whatsapp/factory.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`

**Interfaces:**
- Produces provider methods:

```ts
listTemplates(): Promise<ProviderTemplate[]>;
sendTemplate(input: {
  to: string;
  name: string;
  language: string;
  components: TemplateSendComponent[];
}): Promise<SendResult>;
```

- [ ] **Step 1: Write RED Meta/demo/env tests**

Cover WABA ID required only for Meta template operations, bearer headers, v23 WABA endpoint, `limit=100`, cursor reconstruction (never follow arbitrary `paging.next`), max 20 pages/2,000 templates, timeout/64 KiB per response, malformed schema, 408/429/5xx unknown, definitive 4xx rejected, token redaction, template payload, and deterministic demo results.

- [ ] **Step 2: Run provider tests to verify RED**

Run: `npm test -- src/modules/whatsapp/meta-provider.test.ts src/lib/env.test.ts`

Expected: FAIL because provider contracts/config do not support templates.

- [ ] **Step 3: Implement bounded template listing**

Build every page URL locally:

```ts
const url = new URL(this.endpoint(`${encodeURIComponent(this.config.businessAccountId)}/message_templates`));
url.searchParams.set("fields", "id,name,status,category,language,components");
url.searchParams.set("limit", "100");
if (after) url.searchParams.set("after", after);
```

Read only `paging.cursors.after` matching a bounded opaque string; stop on missing/repeated cursor, 20 pages, or 2,000 items. Reuse operation timeout and JSON limit for every page.

- [ ] **Step 4: Implement template send**

```ts
return this.send({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: input.to,
  type: "template",
  template: {
    name: input.name,
    language: { code: input.language },
    components: input.components,
  },
});
```

Validate names/languages/components before constructing the payload; components are typed text parameters, never arbitrary browser JSON.

- [ ] **Step 5: Run provider tests and commit**

Run Step 2. Expected: PASS with no secret/raw Graph leakage.

```bash
git add src/modules/whatsapp src/lib/env.ts src/lib/env.test.ts
git commit -m "feat: support Meta message templates"
```

### Task 7: Implement template cache, synchronization, and idempotent send

**Files:**
- Create: `src/modules/templates/types.ts`
- Create: `src/modules/templates/schemas.ts`
- Create: `src/modules/templates/service.ts`
- Create: `src/modules/templates/service.test.ts`
- Create: `src/modules/templates/service.integration.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`

**Interfaces:**
- Produces `syncTemplates(actor)`, `listApprovedTemplates(actor)`, and `sendApprovedTemplate(actor, conversationId, input)`.
- Input: `{ templateId, clientRequestId, parameters: Array<{ component: "header"|"body"; index: number; text: string }> }`.

- [ ] **Step 1: Write RED sync/send tests**

Cover atomic upsert and stale status changes, unsupported media-header template flag, approved-only list, exact placeholder counts, parameter max 1024, no arbitrary components, template send both inside/outside window, idempotency, provider rejected/unknown states, status webhook, and rendered body stored for UI.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts`

Expected: FAIL because template service/send path do not exist.

- [ ] **Step 3: Implement template analysis and sync**

Mark supported only when status is `APPROVED`, header is absent or text-only, body exists, placeholders are contiguous `{{1}}..{{N}}`, and buttons require no dynamic URL/code parameter. Store the sanitized component model and public body text; never store the provider response wrapper.

Sync all returned templates in one transaction: upsert current rows and mark missing previously cached rows `status="UNAVAILABLE"`; set one `syncedAt` instant.

- [ ] **Step 4: Reuse the outbound state machine for template send**

Add a dedicated `sendTemplateOnce` that creates the outbound message with `metaTemplateName/language`, rendered body, client request ID, actor, and PENDING state. It uses the same delivery claim/quota/provider-attempt/markSent/unknown/rejected helpers; only the provider call differs. Publish normal `message.created`/`message.status`, so webhook statuses require no special path.

- [ ] **Step 5: Run focused tests twice and commit**

Run Step 2 twice. Expected: PASS with one message/provider call per request ID.

```bash
git add src/modules/templates src/modules/messages
git commit -m "feat: synchronize and send approved templates"
```

### Task 8: Expose template APIs and closed-window composer UI

**Files:**
- Create: `src/app/api/meta/templates/route.ts`
- Create: `src/app/api/meta/templates/route.test.ts`
- Create: `src/app/api/meta/templates/sync/route.ts`
- Create: `src/app/api/meta/templates/sync/route.test.ts`
- Create: `src/app/api/conversations/[id]/templates/route.ts`
- Create: `src/app/api/conversations/[id]/templates/route.test.ts`
- Create: `src/components/inbox/template-picker.tsx`
- Create: `src/components/inbox/template-picker.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/components/settings/quick-replies-screen.tsx`
- Modify: `src/lib/public-error.ts`

**Interfaces:**
- GET approved/supported templates: any active employee.
- POST sync: admin-only.
- POST conversation template send: any active employee, same-origin, idempotent.

- [ ] **Step 1: Write RED route and UI tests**

Assert auth/role/origin/UUID/body ordering, sync error safety, closed window disables textarea/attachment/mic/quick replies, explanation copy, approved template picker, required parameter fields, preview, send confirmation, race A→B, duplicate response/SSE, provider error recovery, and open-window normal composer.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/app/api/meta/templates "src/app/api/conversations/[id]/templates/route.test.ts" src/components/inbox/template-picker.test.tsx src/components/inbox/message-composer.test.tsx src/hooks/use-inbox.test.tsx`

Expected: FAIL because routes/picker/window UI do not exist.

- [ ] **Step 3: Implement route factories and safe envelopes**

Publish normal message events through the service only. Sync route returns counts/status/syncedAt, not raw templates or Graph diagnostics. Map closed-window free-form rejection to stable code `CUSTOMER_SERVICE_WINDOW_CLOSED` and public 409 copy.

- [ ] **Step 4: Implement closed-window experience**

When `windowState.status === "CLOSED"`, disable text, attachment, and microphone controls and show: “A janela de atendimento terminou. Use um modelo aprovado pela Meta para falar com este cliente.” Provide **Escolher modelo**. The picker lists name/language/category/body, renders one text input per required placeholder, shows a plain-text preview, and requires an explicit send click.

- [ ] **Step 5: Add admin template refresh status**

In the settings page, show last synchronization, counts of approved/supported/unsupported, and a 44 px **Sincronizar modelos da Meta** button. Never expose tokens/WABA ID.

- [ ] **Step 6: Run UI/routes, React review, and commit**

Run Step 2 and `npx eslint src/app/api/meta src/app/api/conversations/[id]/templates src/components/inbox src/hooks/use-inbox.ts`.

Expected: PASS with zero warnings and no automatic send.

```bash
git add src/app/api/meta src/app/api/conversations/[id]/templates src/components/inbox src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/settings/quick-replies-screen.tsx src/lib/public-error.ts
git commit -m "feat: offer approved templates outside service window"
```

### Task 9: Configure operations, verify, and publish Release 3

**Files:**
- Modify: `.env.example`
- Modify: `deploy/kvm/docker-compose.yml`
- Modify: `scripts/verify-compose.ps1`
- Modify: `README.md`
- Create: `docs/verification/2026-08-21-quick-replies-templates-release.md`

**Interfaces:**
- Produces required production `XP_STORE_PHONE=+55 61 9514-9019` and verified WABA template operations.

- [ ] **Step 1: Write RED deployment mutation tests**

Extend `scripts/verify-compose.ps1`/deployment tests to require app-only `XP_STORE_PHONE`, keep secrets interpolated from production env, and reject moving WABA/token values into image/build args or client variables.

- [ ] **Step 2: Run deployment tests to verify RED**

Run: `pwsh -File scripts/test-deployment.ps1; pwsh -File scripts/verify-compose.ps1`

Expected: FAIL because `XP_STORE_PHONE` is not declared/validated.

- [ ] **Step 3: Add safe env wiring and README operations**

Add `XP_STORE_PHONE=${XP_STORE_PHONE:-+55 61 9514-9019}` to app runtime environment. Document quick-reply admin workflow, manual Meta sync, 24-hour behavior, template limitations, log checks, and rollback. Do not print token values in examples.

- [ ] **Step 4: Run all local gates**

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run db:generate
npm run build
npm audit --omit=dev
pwsh -File scripts/test-deployment.ps1
pwsh -File scripts/verify-compose.ps1
git diff --check
```

Expected: all exit 0; audit is 0; compose mutation tests remain fail-closed.

- [ ] **Step 5: Run Meta staging/sanitized acceptance before production**

With production credentials only on the KVM/server, list templates and record counts/statuses without names/body/PII in logs. Select one approved supported template authorized for testing, send to an opted-in controlled number with a unique request ID, verify SENT/DELIVERED webhook, and confirm text/media free-form rejection in an isolated fake-provider test rather than deliberately violating Meta policy.

- [ ] **Step 6: Back up and deploy app-only**

Create/validate backup, build immutable image, deploy additive migration, recreate only app, verify health/login/webhook, compare non-app containers, synchronize templates from the authenticated admin UI, and monitor Graph error/status counts without payload logging.

- [ ] **Step 7: Record evidence and commit**

Document commit/image/config hashes, migration, template sync aggregate counts, controlled send IDs only in a protected operational record (not Git), public health, two-session quick reply behavior, closed-window UI/API tests, logs, backup, and rollback.

```bash
git add .env.example deploy/kvm/docker-compose.yml scripts/verify-compose.ps1 README.md docs/verification/2026-08-21-quick-replies-templates-release.md
git commit -m "docs: verify quick replies and template release"
```
