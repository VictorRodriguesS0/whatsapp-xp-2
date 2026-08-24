# WhatsApp Service Window, Templates, and Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the official WhatsApp 24-hour customer-service window and let XP Eletrônicos resume one unanswered, customer-initiated request with one approved Meta template, shared safely by every attendant.

**Architecture:** Materialize the latest inbound customer boundary on each conversation, compute one server-authoritative policy DTO, and guard every free-form text/media/recording delivery before it reaches Meta. Keep Meta templates in a read-only local cache, reserve resumptions against the unanswered source message, and reuse the existing idempotent outbound message state machine for provider delivery, status webhooks, app echoes, and unknown outcomes. Ship additive storage and configuration inactive first, then activate enforcement atomically only after a fresh approved `pt_BR` template is synchronized and assigned.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Prisma 7.9.1, PostgreSQL 18, Zod 4.4.3, WhatsApp Graph API v23.0, Vitest, Testing Library, SSE, Docker Compose, Caddy.

## Global Constraints

- Work in `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\whatsapp-quoted-replies` on `codex/whatsapp-quoted-replies`.
- Follow TDD for every behavior change: write RED, run it, implement the minimum, run GREEN twice, then commit.
- The official window is open only while `now < lastCustomerMessageAt + 24 hours`; at exactly 24 hours it is closed.
- `WHATSAPP_SERVICE_WINDOW_CLOSED` is returned as HTTP `409` before a new free-form text, attachment, or recording is created when enforcement is active and the window is closed.
- A provider rejection or local failure must not consume the unanswered inbound request; `OUTCOME_UNKNOWN` remains non-retryable without reconciliation.
- Remove the current generic **Aguardando resposta** marker from the conversation list and browser DTOs; do not reuse `awaitingResponseSince` for the new policy.
- Automatic consent applies only to the latest unanswered inbound request and never authorizes marketing, campaigns, bulk sends, or prospecting.
- Only an approved, supported, `pt_BR`, body-text template assigned to `SERVICE_RESUMPTION` can resume a conversation.
- The first release supports one body parameter and fills it with the resolved contact name or the exact neutral fallback `cliente`.
- The browser never sends a template name, language, component tree, Meta ID, WABA ID, provider URL, token, or arbitrary template parameter.
- Meta remains authoritative for template status and quality. A failed sync preserves the last complete cache and records only a safe failure code.
- Opt-out is shared company state, wins over prior consent, and is changed only through an explicit authenticated action with an audit event.
- Logs, SSE, browser DTOs, and committed verification reports must not contain message bodies, contact names, phone numbers, template parameters, raw Graph bodies, or secrets.
- Stage 1 deploys the complete code and additive migration with policy mode `INACTIVE`; Stage 2 activates enforcement only after an approved template is freshly synchronized and assigned.
- Before every deploy or production activation, audit every worktree, branch, recent commit, dirty tree, current production revision, and candidate ancestry. Stop if parallel work could be overwritten or is not reviewed and integrated.
- Before every app replacement, create and validate a database/media backup, snapshot all non-app containers deterministically, and recreate only `xp-whatsapp-app`.
- PostgreSQL, Caddy, DNS, volumes, networks, Meta subscriptions, and unrelated KVM containers must not be restarted, recreated, or changed by this feature.

---

## File Structure

- `prisma/schema.prisma`: policy enums, materialized window state, opt-out audit, template cache/configuration, template metadata on outbound messages, and resumption attempts.
- `prisma/migrations/202608230003_whatsapp_service_window_templates/migration.sql`: additive schema, safe latest-inbound backfill, singleton inactive configuration, constraints, and partial concurrency index.
- `prisma/whatsapp-service-window-contract.test.ts`: migration, backfill, singleton, constraint, and idempotence contracts.
- `src/modules/messaging-policy/types.ts`: stable server/browser window and resumption types.
- `src/modules/messaging-policy/service.ts`: exact 24-hour calculation, policy snapshot, free-form guard, and activation validation.
- `src/modules/templates/analysis.ts`: normalized body-only template analysis, parameter counting, rendering, and definition hashing.
- `src/modules/templates/types.ts`, `schemas.ts`, `service.ts`: cache sync, assignment, activation dashboard, status webhook updates, and safe DTOs.
- `src/modules/resumptions/types.ts`, `schemas.ts`, `service.ts`: exclusive reservation and idempotent template delivery against one unanswered inbound message.
- `src/modules/whatsapp/provider.ts`, `meta-provider.ts`, `demo-provider.ts`, `factory.ts`: bounded template listing and typed template sending.
- `src/modules/webhooks/types.ts`, `normalize.ts`, `process.ts`: monotonic inbound boundary plus template status/quality updates.
- `src/modules/messages/service.ts`: free-form policy guard, template payload delivery, and response-state restoration after definitive failures.
- `src/modules/conversations/shared-state.ts`, `service.ts`, `types.ts`: explicit pending-message pointer and policy DTOs shared by every user; the generic `awaitingResponseSince` DTO is retired.
- `src/modules/contacts/schemas.ts`, `service.ts`, `types.ts`: explicit opt-out/opt-in mutation and audit.
- `src/app/api/settings/whatsapp/**`: admin dashboard, sync, assignment, and activation routes.
- `src/app/api/conversations/[id]/resumptions/route.ts`: attendant resumption endpoint that accepts only `clientRequestId`.
- `src/app/api/contacts/[id]/messaging-restriction/route.ts`: authenticated contact restriction endpoint.
- `src/app/configuracoes/whatsapp/page.tsx` and `src/components/settings/whatsapp-policy-screen.tsx`: admin template and policy UI.
- `src/components/inbox/service-window-banner.tsx`, `conversation-view.tsx`, `message-composer.tsx`, `customer-panel.tsx`: timer, closed-window state, resumption confirmation, and opt-out UI.
- `src/hooks/use-service-window.ts`, `use-inbox.ts`: client expiry, safe resumption mutation, cross-session reconciliation, and stable policy error handling.
- `src/lib/http.ts`, `src/app/api/conversations/route.ts`, `src/lib/public-error.ts`: stable domain error codes and safe public copy.
- `src/modules/realtime/events.ts`: PII-free `settings.updated` scope for WhatsApp policy changes.
- `README.md`, `.env.example`, deployment verifier/tests, and two verification reports: operation, parallel audit, rollout, activation, and rollback evidence.

### Task 1: Add additive policy, template, consent, and resumption persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230003_whatsapp_service_window_templates/migration.sql`
- Create: `prisma/whatsapp-service-window-contract.test.ts`
- Modify: `src/test/database.ts`

**Interfaces:**
- Produces enums `WhatsAppPolicyMode`, `WhatsAppTemplateFunction`, `WhatsAppTemplateSyncStatus`, `OutboundPayloadKind`, `ConversationResumptionStatus`, and `ContactMessagingRestrictionAction`.
- Produces the singleton `WhatsAppPolicyConfiguration` row with `id=1` and `mode=INACTIVE`.
- Produces monotonic conversation fields and auditable template/resumption/restriction relations consumed by every later task.

- [ ] **Step 1: Write the RED migration contract**

Create `prisma/whatsapp-service-window-contract.test.ts` with a disposable PostgreSQL test that applies all migrations twice and asserts the new catalog and backfill:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("./migrations/202608230003_whatsapp_service_window_templates/migration.sql", import.meta.url),
  "utf8",
);

describe("WhatsApp service-window migration contract", () => {
  it("is additive, inactive by default, and concurrency safe", () => {
    expect(migration).toContain("last_customer_message_at TIMESTAMPTZ(3)");
    expect(migration).toContain("last_customer_message_id UUID");
    expect(migration).toContain("INSERT INTO whatsapp_policy_configuration");
    expect(migration).toContain("'INACTIVE'");
    expect(migration).toContain("CREATE UNIQUE INDEX conversation_resumptions_active_source_idx");
    expect(migration).toContain("WHERE status IN ('RESERVED', 'SEND_IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SENT')");
    expect(migration).toContain("ROW_NUMBER() OVER");
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE/iu);
  });
});
```

Extend the existing disposable-database helper test to insert two inbound messages out of order, apply the migration, and assert that the conversation points to the maximum `(external_timestamp,id)` inbound. Assert that existing conversations with no inbound remain null, both `pending_customer_message_*` fields remain null for historical rows, and no `ConversationResumption` row is backfilled.

- [ ] **Step 2: Run the contract and verify RED**

Run:

```powershell
npx vitest run prisma/whatsapp-service-window-contract.test.ts
```

Expected: FAIL because the migration file and Prisma models do not exist.

- [ ] **Step 3: Add the exact Prisma domain**

Add these fields and models, including named reverse relations on `User`, `Contact`, `Conversation`, and `Message`:

```prisma
enum WhatsAppPolicyMode { INACTIVE ACTIVE }
enum WhatsAppTemplateFunction { SERVICE_RESUMPTION }
enum WhatsAppTemplateSyncStatus { NEVER SUCCEEDED FAILED }
enum OutboundPayloadKind { FREE_FORM TEMPLATE }
enum ConversationResumptionStatus { RESERVED SEND_IN_FLIGHT SENT FAILED OUTCOME_UNKNOWN }
enum ContactMessagingRestrictionAction { OPT_OUT OPT_IN }

model WhatsAppPolicyConfiguration {
  id                          Int                        @id
  mode                        WhatsAppPolicyMode         @default(INACTIVE)
  version                     Int                        @default(0)
  lastTemplateSyncStatus      WhatsAppTemplateSyncStatus @default(NEVER) @map("last_template_sync_status")
  lastTemplateSyncAt          DateTime?                  @map("last_template_sync_at") @db.Timestamptz(3)
  lastTemplateSyncSucceededAt DateTime?                  @map("last_template_sync_succeeded_at") @db.Timestamptz(3)
  lastTemplateSyncFailureCode String?                    @map("last_template_sync_failure_code")
  activatedAt                 DateTime?                  @map("activated_at") @db.Timestamptz(3)
  activatedByUserId           String?                    @map("activated_by_user_id") @db.Uuid
  updatedAt                   DateTime                   @updatedAt @map("updated_at") @db.Timestamptz(3)
  activatedByUser             User?                      @relation("WhatsAppPolicyActor", fields: [activatedByUserId], references: [id], onDelete: SetNull)

  @@map("whatsapp_policy_configuration")
}

model WhatsAppTemplate {
  id              String   @id @default(uuid()) @db.Uuid
  metaId          String?  @unique @map("meta_id")
  name            String
  language        String
  category        String
  status          String
  qualityScore    String?  @map("quality_score")
  components      Json
  bodyText        String   @map("body_text")
  parameterCount  Int      @map("parameter_count")
  supported       Boolean
  definitionHash  String   @map("definition_hash")
  syncedAt        DateTime @map("synced_at") @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  assignments     WhatsAppTemplateAssignment[]
  resumptions     ConversationResumption[]

  @@unique([name, language])
  @@index([status, supported, language])
  @@map("whatsapp_templates")
}

model WhatsAppTemplateAssignment {
  function         WhatsAppTemplateFunction @id
  templateId       String                    @unique @map("template_id") @db.Uuid
  assignedByUserId String                    @map("assigned_by_user_id") @db.Uuid
  createdAt        DateTime                  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime                  @updatedAt @map("updated_at") @db.Timestamptz(3)
  template         WhatsAppTemplate          @relation(fields: [templateId], references: [id], onDelete: Restrict)
  assignedByUser   User                      @relation("WhatsAppTemplateAssigner", fields: [assignedByUserId], references: [id], onDelete: Restrict)

  @@map("whatsapp_template_assignments")
}

model ConversationResumption {
  id                  String                       @id @default(uuid()) @db.Uuid
  conversationId      String                       @map("conversation_id") @db.Uuid
  sourceMessageId     String                       @map("source_message_id") @db.Uuid
  templateId          String                       @map("template_id") @db.Uuid
  messageId           String?                      @unique @map("message_id") @db.Uuid
  sentByUserId        String                       @map("sent_by_user_id") @db.Uuid
  clientRequestId     String                       @unique @map("client_request_id") @db.Uuid
  status              ConversationResumptionStatus
  renderedBody        String                       @map("rendered_body")
  templateName        String                       @map("template_name")
  templateLanguage    String                       @map("template_language")
  definitionHash      String                       @map("definition_hash")
  parameters          Json
  providerMessageId   String?                      @map("provider_message_id")
  providerAttemptedAt DateTime?                    @map("provider_attempted_at") @db.Timestamptz(3)
  reservationUntil    DateTime?                    @map("reservation_until") @db.Timestamptz(3)
  failureReason       String?                      @map("failure_reason")
  createdAt           DateTime                     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime                     @updatedAt @map("updated_at") @db.Timestamptz(3)
  conversation        Conversation                 @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sourceMessage       Message                      @relation("ResumptionSourceMessage", fields: [sourceMessageId], references: [id], onDelete: Restrict)
  template            WhatsAppTemplate             @relation(fields: [templateId], references: [id], onDelete: Restrict)
  message             Message?                     @relation("ResumptionMessage", fields: [messageId], references: [id], onDelete: SetNull)
  sentByUser          User                         @relation("ConversationResumptionSender", fields: [sentByUserId], references: [id], onDelete: Restrict)

  @@index([conversationId, sourceMessageId, status])
  @@map("conversation_resumptions")
}

model ContactMessagingRestrictionEvent {
  id          String                            @id @default(uuid()) @db.Uuid
  contactId   String                            @map("contact_id") @db.Uuid
  actorUserId String                            @map("actor_user_id") @db.Uuid
  action      ContactMessagingRestrictionAction
  reason      String
  createdAt   DateTime                          @default(now()) @map("created_at") @db.Timestamptz(3)
  contact     Contact                           @relation(fields: [contactId], references: [id], onDelete: Cascade)
  actorUser   User                              @relation("ContactMessagingRestrictionActor", fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([contactId, createdAt])
  @@map("contact_messaging_restriction_events")
}
```

Add to `Conversation`: `lastCustomerMessageAt`, `lastCustomerMessageId`, `pendingCustomerMessageAt`, `pendingCustomerMessageId`, `awaitingCustomerSince`, `serviceWindowStateVersion`, and named message relations. Keep the legacy database column `awaitingResponseSince` only for rollback compatibility; later tasks stop exposing or using it. Add to `Contact`: `messagingOptOutAt`, `messagingRestrictionReason`, `messagingRestrictedByUserId`, and restriction events. Add to `Message`: `outboundPayloadKind @default(FREE_FORM)`, `templateName`, `templateLanguage`, `templateComponents`, `templateDefinitionHash`, plus resumption relations. Add all required named reverse relations to `User`.

- [ ] **Step 4: Implement the additive SQL and safe backfill**

Create the new enum types/tables/columns and this latest-inbound backfill before adding the message pointer FK:

```sql
WITH ranked_inbound AS (
  SELECT
    id,
    conversation_id,
    external_timestamp,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id
      ORDER BY external_timestamp DESC, id DESC
    ) AS row_number
  FROM messages
  WHERE direction = 'INBOUND'
)
UPDATE conversations AS conversation
SET
  last_customer_message_at = inbound.external_timestamp,
  last_customer_message_id = inbound.id
FROM ranked_inbound AS inbound
WHERE inbound.row_number = 1
  AND conversation.id = inbound.conversation_id;

INSERT INTO whatsapp_policy_configuration (
  id, mode, version, last_template_sync_status, updated_at
) VALUES (1, 'INACTIVE', 0, 'NEVER', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

CREATE UNIQUE INDEX conversation_resumptions_active_source_idx
ON conversation_resumptions (source_message_id)
WHERE status IN ('RESERVED', 'SEND_IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SENT');
```

Add checks for singleton `id=1`, non-negative parameter/version values, bounded non-empty names/languages/hash/reasons, and coherent activation timestamps. Do not update `awaiting_response_since`, backfill `pending_customer_message_at`/`pending_customer_message_id`, or create consent/resumption history.

- [ ] **Step 5: Generate Prisma and run GREEN twice**

Run:

```powershell
npm run db:generate
npm run db:validate
npx vitest run prisma/whatsapp-service-window-contract.test.ts prisma/temporal-contract.test.ts prisma/response-state-backfill-contract.test.ts
```

Expected: Prisma validates; both test runs PASS; a second `prisma migrate deploy` reports no pending migration and does not alter the backfill.

- [ ] **Step 6: Commit persistence**

```powershell
git add prisma/schema.prisma prisma/migrations/202608230003_whatsapp_service_window_templates/migration.sql prisma/whatsapp-service-window-contract.test.ts src/test/database.ts src/generated
git commit -m "feat: persist WhatsApp service-window policy"
```

### Task 2: Compute the exact window, preserve unanswered requests, and guard free-form sends

**Files:**
- Create: `src/modules/messaging-policy/types.ts`
- Create: `src/modules/messaging-policy/service.ts`
- Create: `src/modules/messaging-policy/service.test.ts`
- Create: `src/modules/messaging-policy/service.integration.test.ts`
- Modify: `src/modules/conversations/shared-state.ts`
- Modify: `src/modules/conversations/shared-state.test.ts`
- Modify: `src/modules/conversations/shared-state.integration.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`
- Modify: `src/lib/http.ts`
- Modify: `src/app/api/conversations/route.ts`
- Modify: `src/app/api/conversations/[id]/messages/route.test.ts`
- Modify: `src/app/api/conversations/[id]/recordings/route.test.ts`

**Interfaces:**
- Produces `SERVICE_WINDOW_MS`, `ServiceWindowDto`, `calculateServiceWindow`, `getMessagingPolicySnapshot`, and `assertFreeFormSendAllowed`.
- `HttpError` gains optional stable `code`; conversation envelopes prefer it over the generic status mapping.
- Existing `sendMessage`/`retryMessage` keep their public signatures and gain a policy dependency.

- [ ] **Step 1: Write RED boundary, failure-restoration, and side-effect tests**

Cover no inbound, 23:59:59.999 open, exactly 24:00:00.000 closed, future/out-of-order webhook timestamps, inactive enforcement, active enforcement, and opt-out. In message unit/integration tests assert a closed request performs zero file validation/storage, zero message creation, zero quota consumption, and zero provider calls:

```ts
await expect(sendMessage(actor, conversationId, textInput, dependenciesAt(exactly24h)))
  .rejects.toMatchObject({
    status: 409,
    code: "WHATSAPP_SERVICE_WINDOW_CLOSED",
  });
expect(repository.created).toHaveLength(0);
expect(provider.textInputs).toHaveLength(0);
```

Add a regression test where a pending outbound temporarily clears `pendingCustomerMessageId`, a definitive provider failure changes the message to `FAILED`, and `refreshResponseState` restores the exact same inbound pointer. Assert `OUTCOME_UNKNOWN` remains non-eligible and an app echo with `SENT` clears it company-wide. Add a DTO regression proving `awaitingResponseSince` is absent.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx vitest run src/modules/messaging-policy/service.test.ts src/modules/messaging-policy/service.integration.test.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts 'src/app/api/conversations/[id]/messages/route.test.ts' 'src/app/api/conversations/[id]/recordings/route.test.ts'
```

Expected: FAIL because policy types/guard and failure restoration are absent.

- [ ] **Step 3: Implement stable errors and exact pure calculation**

Use these contracts:

```ts
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ServiceWindowDto = {
  enforcement: "INACTIVE" | "ACTIVE";
  status: "OPEN" | "CLOSED";
  closesAt: string | null;
  sendMode: "FREE_FORM" | "RESUMPTION" | "AWAITING_CUSTOMER" | "CONFIRMING" | "BLOCKED";
  reason: "NO_CUSTOMER_MESSAGE" | "WINDOW_EXPIRED" | "NO_PENDING_REQUEST" | "CONTACT_OPTED_OUT" | "TEMPLATE_UNAVAILABLE" | null;
  resumption: { templateName: string; language: string; previewBody: string } | null;
};

export function calculateServiceWindow(lastCustomerMessageAt: Date | null, now: Date) {
  if (!lastCustomerMessageAt) return { status: "CLOSED" as const, closesAt: null };
  const closesAt = new Date(lastCustomerMessageAt.getTime() + SERVICE_WINDOW_MS);
  return {
    status: now.getTime() < closesAt.getTime() ? "OPEN" as const : "CLOSED" as const,
    closesAt,
  };
}
```

Extend `HttpError` as `constructor(status: number, message: string, public readonly code?: string)`. Change `conversationErrorResponse` to emit `error.code ?? errorCode(error.status)`.

- [ ] **Step 4: Make shared response state status-aware and materialize the inbound boundary**

In `refreshResponseState`, choose the latest outbound with `status: { not: MessageStatus.FAILED }`, choose the latest inbound by `(externalTimestamp DESC,id DESC)`, and choose the latest inbound after the active outbound as the explicit unanswered source. Update in the same locked transaction:

```ts
data: {
  lastCustomerMessageAt: latestInbound?.externalTimestamp ?? null,
  lastCustomerMessageId: latestInbound?.id ?? null,
  pendingCustomerMessageAt: latestUnansweredInbound?.externalTimestamp ?? null,
  pendingCustomerMessageId: latestUnansweredInbound?.id ?? null,
  awaitingCustomerSince:
    awaitingCustomerSince && latestInbound && latestInbound.externalTimestamp > awaitingCustomerSince
      ? null
      : awaitingCustomerSince,
  serviceWindowStateVersion: { increment: 1 },
}
```

Call `refreshResponseState` after `markFailed` as well as after outbound creation/echo. Pending and unknown attempts remain active replies; definitive failures are excluded and restore the pending request.

Stop returning `awaitingResponseSince` from `SharedConversationStateDto`, `ConversationListItem`, or `ConversationDetail`. Do not delete its database column in this release; cease using it for UI and new policy decisions.

- [ ] **Step 5: Guard normal creation, delivery races, and retry**

Add `assertFreeFormSendAllowed(conversationId, now)` to `MessageServiceDependencies`. For a new request call it after idempotency lookup but before media validation or `createPending`. Call it again immediately before claiming a READY free-form message for provider delivery and from `retryMessage`. Existing SENT/DELIVERED/READ idempotent results are returned without a new guard or provider call.

When the policy singleton is `INACTIVE`, the guard returns. When active and closed, throw:

```ts
throw new HttpError(
  409,
  "A janela de atendimento terminou. Aguarde o cliente responder ou retome com o modelo aprovado.",
  "WHATSAPP_SERVICE_WINDOW_CLOSED",
);
```

- [ ] **Step 6: Run GREEN twice and commit**

Run Step 2 twice, then:

```powershell
git add src/modules/messaging-policy src/modules/conversations/shared-state.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/messages/service.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/lib/http.ts src/app/api/conversations/route.ts 'src/app/api/conversations/[id]/messages/route.test.ts' 'src/app/api/conversations/[id]/recordings/route.test.ts'
git commit -m "feat: enforce the WhatsApp service window"
```

### Task 3: Add explicit company-wide opt-out and audit

**Files:**
- Modify: `src/modules/contacts/schemas.ts`
- Modify: `src/modules/contacts/types.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Modify: `src/modules/contacts/service.integration.test.ts`
- Create: `src/app/api/contacts/[id]/messaging-restriction/route.ts`
- Create: `src/app/api/contacts/[id]/messaging-restriction/route.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`

**Interfaces:**
- Produces `setContactMessagingRestriction(actor, contactId, input)` and contact DTO field `messagingRestricted: boolean`.
- Route input is exactly `{ restricted: boolean; reason: string }`; reason is trimmed `3..240` characters.
- Existing `contact.updated` SSE invalidates every session without sending the reason.

- [ ] **Step 1: Write RED service, route, and shared DTO tests**

Assert active-user/origin checks, invalid reason, missing contact, OPT_OUT and OPT_IN audit rows, monotonic shared visibility, idempotent same-state calls, and no reason in DTO/SSE. Assert opt-out immediately changes an eligible closed conversation from `RESUMPTION` to `BLOCKED/CONTACT_OPTED_OUT`.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts' src/modules/conversations/service.test.ts
```

Expected: FAIL because restriction service/route fields do not exist.

- [ ] **Step 3: Implement the strict schema and transaction**

Add:

```ts
export const contactMessagingRestrictionSchema = z.strictObject({
  restricted: z.boolean(),
  reason: z.string().trim().min(3).max(240),
});
```

Inside the existing serializable contact repository transaction, lock the contact, verify the actor remains active, no-op if the requested state already matches, otherwise update the three current-state fields and append exactly one `ContactMessagingRestrictionEvent`. Return only `messagingRestricted`, never the stored reason or actor.

- [ ] **Step 4: Add the authenticated same-origin route and DTO wiring**

The route uses `PUT`, `assertSameOrigin`, `requireUser`, `contactIdSchema`, and the strict schema. Return the existing `{ data, error }` envelope and publish `{ type:"contact.updated", contactId }` after commit. Add `messagingRestricted` to conversation/contact selects and mapping.

- [ ] **Step 5: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts' src/modules/conversations/service.test.ts
npx vitest run src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts' src/modules/conversations/service.test.ts
git add src/modules/contacts src/app/api/contacts src/modules/conversations/types.ts src/modules/conversations/service.ts
git commit -m "feat: audit contact messaging restrictions"
```

### Task 4: Extend the provider with bounded Meta template listing and sending

**Files:**
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`
- Modify: `src/modules/whatsapp/factory.ts`

**Interfaces:**
- `WhatsAppProvider.listTemplates(): Promise<ProviderTemplate[]>`.
- `WhatsAppProvider.sendTemplate(input: TemplateSendInput): Promise<SendResult>`.
- `WhatsAppProviderError` gains sanitized `graphCode: string | null`; no raw response is retained.

- [ ] **Step 1: Write RED provider contracts**

Cover WABA endpoint, encoded IDs, bearer header, exact fields, `limit=100`, only `paging.cursors.after`, repeated cursor, maximum 20 pages/2,000 items, 512 KiB page cap, timeout, malformed UTF-8/JSON/schema, token redaction, `408/429/5xx => unknown`, definitive `4xx => rejected`, graph code `131047`, and exact template-send payload.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/modules/whatsapp/meta-provider.test.ts src/lib/env.test.ts
```

Expected: FAIL because provider template methods/config are absent.

- [ ] **Step 3: Add typed provider contracts**

```ts
export type ProviderTemplateComponent = {
  type: string;
  format: string | null;
  text: string | null;
};

export type ProviderTemplate = {
  metaId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string | null;
  components: ProviderTemplateComponent[];
};

export type TemplateSendInput = {
  to: string;
  name: string;
  language: string;
  bodyParameters: Array<{ type: "text"; text: string }>;
};
```

Add both methods to `WhatsAppProvider` and deterministic no-network implementations to `DemoWhatsAppProvider`.

- [ ] **Step 4: Implement safe pagination and template send**

Pass `WHATSAPP_BUSINESS_ACCOUNT_ID` from `factory.ts`. Rebuild every page URL locally; never follow `paging.next`:

```ts
const url = new URL(this.endpoint(`${encodeURIComponent(this.config.businessAccountId)}/message_templates`));
url.searchParams.set("fields", "id,name,status,category,language,quality_score,components");
url.searchParams.set("limit", "100");
if (after) url.searchParams.set("after", after);
```

Normalize bounded strings and text components before returning. Send with:

```ts
return this.send({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: input.to,
  type: "template",
  template: {
    name: input.name,
    language: { code: input.language },
    components: [{ type: "body", parameters: input.bodyParameters }],
  },
});
```

- [ ] **Step 5: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/whatsapp/meta-provider.test.ts src/lib/env.test.ts
npx vitest run src/modules/whatsapp/meta-provider.test.ts src/lib/env.test.ts
git add src/modules/whatsapp
git commit -m "feat: support approved Meta templates"
```

### Task 5: Synchronize, analyze, assign, and update templates safely

**Files:**
- Create: `src/modules/templates/analysis.ts`
- Create: `src/modules/templates/analysis.test.ts`
- Create: `src/modules/templates/types.ts`
- Create: `src/modules/templates/schemas.ts`
- Create: `src/modules/templates/service.ts`
- Create: `src/modules/templates/service.test.ts`
- Create: `src/modules/templates/service.integration.test.ts`
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Modify: `src/modules/realtime/events.ts`

**Interfaces:**
- Produces `syncWhatsAppTemplates`, `getWhatsAppPolicySettings`, `assignServiceResumptionTemplate`, `setWhatsAppPolicyMode`, `applyTemplateStatusUpdate`, and `applyTemplateQualityUpdate`.
- Produces browser-safe `WhatsAppPolicySettingsDto` without Meta IDs or raw components.
- Adds realtime scope `whatsapp-policy`.

- [ ] **Step 1: Write RED analysis, sync, activation, and webhook tests**

Cover a valid `pt_BR` body with contiguous `{{1}}`, missing body, two bodies, header, buttons, noncontiguous/repeated placeholders, more than one parameter, overlong text, pending/rejected/paused templates, hash stability, HTML as plain text, full-sync upsert, mark-missing only after success, failed sync preserving cache, stale sync, admin-only assignment/activation, and template status/quality webhooks.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/modules/templates/analysis.test.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts
```

Expected: FAIL because template modules/events do not exist.

- [ ] **Step 3: Implement deterministic body-only analysis**

Use SHA-256 over normalized `{name,language,category,status,components}`. A service-resumption candidate is supported only when it has exactly one BODY component, no HEADER/BUTTONS component, optional static FOOTER only, body length `1..1024`, contiguous unique placeholders, and exactly one parameter. Render with plain replacement:

```ts
export function renderServiceResumption(bodyText: string, resolvedName: string | null): string {
  const parameter = resolvedName?.trim().slice(0, 80) || "cliente";
  return bodyText.replaceAll("{{1}}", parameter);
}
```

- [ ] **Step 4: Implement complete-cache sync and fail-safe settings**

`syncWhatsAppTemplates` requires an active admin, calls `provider.listTemplates()` before opening the database transaction, then upserts the complete normalized set with one `syncedAt`. Only after a complete provider result, mark previously cached missing rows `status="UNAVAILABLE"` and `supported=false`. On provider failure, update only the singleton attempt status/code and rethrow a safe error; leave template rows and assignment unchanged.

Assignment requires `status="APPROVED"`, `supported=true`, `language="pt_BR"`, `parameterCount=1`, and a definition synchronized successfully. Activation requires an assignment meeting the same conditions and `lastTemplateSyncSucceededAt >= now - 24 hours`; otherwise return `409 WHATSAPP_TEMPLATE_NOT_READY`.

- [ ] **Step 5: Normalize and process official template webhooks**

Add:

```ts
type NormalizedTemplateStatusEvent = {
  kind: "templateStatus";
  metaTemplateId: string;
  name: string;
  language: string;
  status: string;
  entryTimeRaw: string;
};

type NormalizedTemplateQualityEvent = {
  kind: "templateQuality";
  metaTemplateId: string;
  name: string;
  language: string;
  qualityScore: string;
  entryTimeRaw: string;
};
```

Accept only bounded exact identifiers/status tokens from `message_template_status_update` and `message_template_quality_update`. Deduplicate by kind, Meta ID, state, and `entry.time`; update the matching cached row without creating an unknown template; recompute eligibility; publish only `{ type:"settings.updated", scope:"whatsapp-policy" }`.

- [ ] **Step 6: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/templates/analysis.test.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts
npx vitest run src/modules/templates/analysis.test.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts
git add src/modules/templates src/modules/webhooks src/test/fixtures/meta-webhooks.ts src/modules/realtime/events.ts
git commit -m "feat: synchronize WhatsApp template policy"
```

### Task 6: Reserve and send one idempotent service resumption

**Files:**
- Create: `src/modules/resumptions/types.ts`
- Create: `src/modules/resumptions/schemas.ts`
- Create: `src/modules/resumptions/service.ts`
- Create: `src/modules/resumptions/service.test.ts`
- Create: `src/modules/resumptions/service.integration.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`

**Interfaces:**
- Produces `resumeConversation(actor, conversationId, { clientRequestId })`.
- Produces internal `sendPreparedTemplateMessage`; it is not exposed directly to a route.
- Browser input never selects a template or sends parameters; the server uses the active assignment and resolved contact name.

- [ ] **Step 1: Write RED eligibility, concurrency, idempotency, and failure tests**

Cover active employee, active policy, exact source message, unanswered state, app echo already answered, opt-out, stale/rejected template, same `clientRequestId`, reused ID in another conversation, two attendants racing, stale pre-provider reservation, provider rejected, `131047`, provider timeout, markSent persistence failure, status webhook, customer reply, and no blind retry for unknown outcome.

The PostgreSQL race test must prove one provider call:

```ts
const [left, right] = await Promise.allSettled([
  resumeConversation(attendantA, conversationId, { clientRequestId: requestA }, dependencies),
  resumeConversation(attendantB, conversationId, { clientRequestId: requestB }, dependencies),
]);
expect(provider.templateInputs).toHaveLength(1);
expect([left.status, right.status].sort()).toEqual(["fulfilled", "rejected"]);
```

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/modules/resumptions/service.test.ts src/modules/resumptions/service.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/modules/webhooks/process.test.ts
```

Expected: FAIL because resumption reservation and template delivery are absent.

- [ ] **Step 3: Add server-only template delivery to the existing outbound state machine**

Extend `PendingMessageInput` with:

```ts
type PreparedTemplatePayload = {
  kind: "TEMPLATE";
  name: string;
  language: "pt_BR";
  definitionHash: string;
  bodyParameters: [{ type: "text"; text: string }];
};
```

Persist `outboundPayloadKind=TEMPLATE` and the snapshotted metadata on `Message`. In `deliver`, call `provider.sendTemplate` for this kind; otherwise retain the current text/media paths. Template delivery bypasses only the free-form window guard and retains the existing rate limit, delivery lease, provider-attempt commit, `REJECTED`, `OUTCOME_UNKNOWN`, markSent, echo reconciliation, and status webhook behavior.

- [ ] **Step 4: Implement exclusive reservation and finalization**

Inside a serializable transaction, lock the conversation and policy row; validate all eligibility against current database state; expire only a stale `RESERVED` attempt that has no provider attempt/message attempt; insert one resumption row protected by the partial unique index. A unique conflict returns `409 WHATSAPP_RESUMPTION_ALREADY_STARTED` unless the same `clientRequestId` identifies the same operation.

Create/deliver the prepared message, then finalize:

- `SENT`: resumption `SENT`, provider ID saved, conversation `awaitingCustomerSince=now`, pending request cleared;
- definitive failure: resumption `FAILED`, call `refreshResponseState` so the inbound request becomes eligible again;
- provider/commit uncertainty: resumption `OUTCOME_UNKNOWN`, no retry, conversation state `CONFIRMING`;
- crash with provider attempt committed but unfinished: reconciliation promotes it to `OUTCOME_UNKNOWN`, never back to sendable.

Publish normal `message.created`/`message.status` plus one PII-free `conversation.updated` after finalization.

- [ ] **Step 5: Reconcile inbound replies and app echoes**

When an inbound message is committed after a SENT resumption, `refreshResponseState` clears `awaitingCustomerSince`, reopens the 24-hour window, and the existing `message.created` SSE refreshes all sessions. An outbound `smb_message_echoes` after the source message removes eligibility exactly like an in-app outbound.

- [ ] **Step 6: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/resumptions/service.test.ts src/modules/resumptions/service.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/modules/webhooks/process.test.ts
npx vitest run src/modules/resumptions/service.test.ts src/modules/resumptions/service.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/modules/webhooks/process.test.ts
git add src/modules/resumptions src/modules/messages src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts
git commit -m "feat: resume unanswered WhatsApp service requests"
```

### Task 7: Expose secure policy, sync, restriction, and resumption APIs

**Files:**
- Create: `src/app/api/settings/whatsapp/route.ts`
- Create: `src/app/api/settings/whatsapp/route.test.ts`
- Create: `src/app/api/settings/whatsapp/sync/route.ts`
- Create: `src/app/api/settings/whatsapp/sync/route.test.ts`
- Create: `src/app/api/conversations/[id]/resumptions/route.ts`
- Create: `src/app/api/conversations/[id]/resumptions/route.test.ts`
- Modify: `src/app/api/conversations/route.ts`
- Modify: `src/lib/public-error.ts`

**Interfaces:**
- `GET /api/settings/whatsapp`: admin-only safe dashboard.
- `POST /api/settings/whatsapp/sync`: admin-only, same-origin cache refresh.
- `PATCH /api/settings/whatsapp`: admin-only discriminated assignment/activation mutation.
- `POST /api/conversations/:id/resumptions`: active employee, same-origin, body `{clientRequestId}`.

- [ ] **Step 1: Write RED route security and envelope tests**

Assert authentication, admin role, same origin, strict unknown-field rejection, UUID normalization, safe error codes, no Graph diagnostics, no Meta IDs/components/tokens, duplicate request result, `409` conflicts, and one realtime publication after a committed mutation.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/app/api/settings/whatsapp/route.test.ts src/app/api/settings/whatsapp/sync/route.test.ts 'src/app/api/conversations/[id]/resumptions/route.test.ts' 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts'
```

Expected: FAIL because the new routes do not exist.

- [ ] **Step 3: Implement strict schemas and route factories**

Use this admin mutation schema:

```ts
export const whatsappPolicyMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ASSIGN_TEMPLATE"), templateId: z.string().uuid() }),
  z.strictObject({ action: z.literal("SET_MODE"), mode: z.enum(["INACTIVE", "ACTIVE"]) }),
]);
```

Every mutation calls `assertSameOrigin` before parsing body, then `requireAdmin` or `requireUser`. Route factories accept injected services for tests. Successful settings mutations publish `settings.updated/whatsapp-policy`; resumption service owns message/conversation events.

- [ ] **Step 4: Preserve stable domain codes end to end**

Teach the envelope and client-safe copy about:

- `WHATSAPP_SERVICE_WINDOW_CLOSED`;
- `WHATSAPP_TEMPLATE_NOT_READY`;
- `WHATSAPP_RESUMPTION_ALREADY_STARTED`;
- `WHATSAPP_CONTACT_OPTED_OUT`;
- `WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN`.

Never forward the provider error message. Return the exact Portuguese user copy defined in the domain service.

- [ ] **Step 5: Run GREEN twice and commit**

```powershell
npx vitest run src/app/api/settings/whatsapp/route.test.ts src/app/api/settings/whatsapp/sync/route.test.ts 'src/app/api/conversations/[id]/resumptions/route.test.ts' 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts'
npx vitest run src/app/api/settings/whatsapp/route.test.ts src/app/api/settings/whatsapp/sync/route.test.ts 'src/app/api/conversations/[id]/resumptions/route.test.ts' 'src/app/api/contacts/[id]/messaging-restriction/route.test.ts'
git add src/app/api/settings/whatsapp src/app/api/conversations src/lib/public-error.ts
git commit -m "feat: expose WhatsApp policy operations"
```

### Task 8: Add the admin template and activation screen

**Files:**
- Create: `src/app/configuracoes/whatsapp/page.tsx`
- Create: `src/app/configuracoes/whatsapp/page.test.tsx`
- Create: `src/app/configuracoes/whatsapp/loading.tsx`
- Create: `src/app/configuracoes/whatsapp/error.tsx`
- Create: `src/components/settings/whatsapp-policy-screen.tsx`
- Create: `src/components/settings/whatsapp-policy-screen.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Server page redirects anonymous users to `/login` and attendants to `/conversas`.
- Screen consumes `WhatsAppPolicySettingsDto` and only submits internal template UUID plus explicit admin action.

- [ ] **Step 1: Write RED page and screen tests**

Cover role redirects, empty cache, failed/stale/successful sync, approved/unsupported rows, selected assignment, exact preview, busy lock, double click, refresh after mutation, focus restoration, 401 redirect, network/malformed responses, activation confirmation, activation refusal, deactivation, desktop and 390px layout, and absence of Meta IDs/tokens.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/app/configuracoes/whatsapp/page.test.tsx src/components/settings/whatsapp-policy-screen.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: FAIL because the page/screen/link do not exist.

- [ ] **Step 3: Implement the restrained settings UI**

The page heading is **WhatsApp e janela de atendimento**. Show four compact status rows: policy mode, last successful synchronization, assigned template, and readiness. Provide **Sincronizar com a Meta**, a radio list of approved supported `pt_BR` templates, a plain-text preview, **Usar para retomada**, and a destructive confirmation before **Desativar proteção**. The activation button is disabled until the server DTO says `canActivate=true`; the server revalidates regardless.

Add one admin-only header link with `aria-label="Configurar WhatsApp"` to `/configuracoes/whatsapp`.

- [ ] **Step 4: Run GREEN, focused lint, and commit**

```powershell
npx vitest run src/app/configuracoes/whatsapp/page.test.tsx src/components/settings/whatsapp-policy-screen.test.tsx src/components/inbox/inbox-shell.test.tsx
npx eslint src/app/configuracoes/whatsapp src/components/settings/whatsapp-policy-screen.tsx src/components/inbox/inbox-shell.tsx
git add src/app/configuracoes/whatsapp src/components/settings/whatsapp-policy-screen.tsx src/components/settings/whatsapp-policy-screen.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: configure WhatsApp template enforcement"
```

### Task 9: Add window badges, resumption confirmation, and contact restriction controls

**Files:**
- Create: `src/hooks/use-service-window.ts`
- Create: `src/hooks/use-service-window.test.tsx`
- Create: `src/components/inbox/service-window-banner.tsx`
- Create: `src/components/inbox/service-window-banner.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`

**Interfaces:**
- Conversation list/detail DTOs include `serviceWindow: ServiceWindowDto` and `contact.messagingRestricted`.
- `useInbox.resumeConversation(conversationId)` sends only a generated `clientRequestId`.
- `MessageComposer` receives `serviceWindow`; no normal control is enabled in closed active modes.

- [ ] **Step 1: Write RED DTO, timer, composer, confirmation, and opt-out tests**

Cover removal of the generic **Aguardando resposta** row marker and DTO field, open remaining-time copy, exact client expiry without reload, inactive mode preserving current composer, closed disabled text/attachment/mic/quick replies/reply draft, eligible preview, explicit confirmation, double click, conversation A→B race, already resumed, confirming, awaiting customer, blocked reasons, inbound reopening, app echo removing eligibility, opt-out confirmation, opt-in confirmation, SSE refresh, Escape/mobile-back preservation, and no automatic send.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/hooks/use-service-window.test.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/customer-panel.test.tsx src/hooks/use-inbox.test.tsx src/components/inbox/inbox-shell.test.tsx src/modules/conversations/service.test.ts
```

Expected: FAIL because service-window DTO/UI/actions are absent.

- [ ] **Step 3: Compute one server-authoritative DTO per response**

Load the policy singleton/assignment once per list request and once per detail request. Map each record with an injected `now`. The resumption preview is rendered on the server from the active template and resolved contact name. Return no source message ID, template UUID, Meta ID, restriction reason, or parameters.

- [ ] **Step 4: Implement the client timer and closed-window experience**

`useServiceWindow` updates once per second only while an open window has less than one hour remaining, otherwise once per minute. It may locally transition OPEN→CLOSED for immediate control disabling, but never locally transition CLOSED→OPEN or create eligibility.

Render exact states:

- `Janela aberta — 8h restantes`;
- `Janela encerrada — use um template`;
- `Aguardando cliente`;
- `Retomada em confirmação`;
- `Retomada indisponível`.

For `RESUMPTION`, show the server preview and **Retomar atendimento**. The confirmation dialog repeats the final text and requires **Enviar template**. For every other closed mode, remove the normal composer controls rather than leaving focusable disabled duplicates.

- [ ] **Step 5: Implement safe hook reconciliation**

Extend `ApiRequestError` to retain the safe envelope code. On a window `409`, remove the optimistic row, refresh detail/list, and show the domain copy. Resumption requests have their own in-flight map keyed by conversation and `clientRequestId`; repeat clicks share one promise. A scope check prevents a response for conversation A from mutating B. Realtime message/conversation/settings events reload authoritative state.

- [ ] **Step 6: Add opt-out/opt-in controls to the customer panel**

Show **Não contatar** with confirmation and required reason when unrestricted. When restricted, show a visible warning and **Permitir contato novamente**, also requiring confirmation and reason. Disable during mutation; on failure keep the previous state and offer retry. Do not infer opt-out from message text.

- [ ] **Step 7: Run GREEN twice, React review, and commit**

```powershell
npx vitest run src/hooks/use-service-window.test.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/customer-panel.test.tsx src/hooks/use-inbox.test.tsx src/components/inbox/inbox-shell.test.tsx src/modules/conversations/service.test.ts
npx vitest run src/hooks/use-service-window.test.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/customer-panel.test.tsx src/hooks/use-inbox.test.tsx src/components/inbox/inbox-shell.test.tsx src/modules/conversations/service.test.ts
npx eslint src/hooks/use-service-window.ts src/hooks/use-inbox.ts src/components/inbox
git add src/hooks src/components/inbox src/modules/conversations
git commit -m "feat: guide attendants through service windows"
```

### Task 10: Complete security, privacy, operational documentation, and full local verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `scripts/test-deployment.ps1`
- Modify: `scripts/verify-compose.ps1`
- Modify: `scripts/verify-kvm-deployment.ps1`
- Create: `src/whatsapp-service-window-release.test.ts`
- Create: `docs/verification/2026-08-23-whatsapp-service-window-stage-1.md`

**Interfaces:**
- Produces one integrated artifact contract and a fail-closed operations runbook.
- No new public environment variable is required; existing server-only WABA ID/token remain the template credentials.

- [ ] **Step 1: Write RED integrated artifact and deployment mutation tests**

The release contract must assert that the same source tree contains the new migration, server guard, provider template methods, admin page, resumption route, opt-out route, and closed-window UI. Deployment tests must reject client-exposed WABA/token variables, build args containing credentials, removal of any existing Meta env wiring, or recreation of non-app services.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run src/whatsapp-service-window-release.test.ts
pwsh -NoProfile -File scripts/test-deployment.ps1
pwsh -NoProfile -File scripts/verify-compose.ps1
pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1
```

Expected: the new artifact assertions fail before runbook/verifier updates; existing safety checks remain green.

- [ ] **Step 3: Document exact operator behavior and rollback**

Document:

- official 24-hour semantics and exactly-at-boundary closure;
- automatic consent limited to an unanswered inbound request;
- how to create `retomar_atendimento` manually in Meta with `pt_BR` text `Olá, {{1}}! A XP Eletrônicos está retomando o atendimento que você iniciou. Podemos continuar por aqui?`;
- admin sync, assignment, inactive Stage 1, activation readiness, opt-out, and deactivation;
- safe failure/unknown behavior and prohibition on blind retries;
- app-only rollback with additive schema retained;
- mandatory parallel-work audit and non-app snapshot before each production mutation.

- [ ] **Step 4: Run the complete local gate**

```powershell
npm run db:generate
npm run db:validate
npm test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
pwsh -NoProfile -File scripts/test-deployment.ps1
pwsh -NoProfile -File scripts/verify-compose.ps1
pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1
git diff --check
git status --short
```

Expected: every command exits `0`, npm audit reports zero production vulnerabilities, full tests have zero failures, and only intentional tracked changes remain.

- [ ] **Step 5: Review secrets/PII and commit the integrated candidate**

Run:

```powershell
rg -n "WHATSAPP_ACCESS_TOKEN|META_APP_SECRET|Authorization: Bearer|raw payload|console\.(log|error)" src docs README.md .env.example
git diff --stat
git diff --check
```

Expected: no hard-coded secret, raw Graph logging, message-body logging, or browser token exposure. Commit:

```powershell
git add README.md .env.example scripts src/whatsapp-service-window-release.test.ts docs/verification/2026-08-23-whatsapp-service-window-stage-1.md
git commit -m "docs: prepare WhatsApp policy operations"
```

### Task 11: Audit parallel work and publish Stage 1 inactive infrastructure

**Files:**
- Create: `.superpowers/sdd/whatsapp-service-window-stage-1-predeploy-audit.md`
- Modify after Task 10 creates: `docs/verification/2026-08-23-whatsapp-service-window-stage-1.md`

**Interfaces:**
- Consumes the exact production revision and every local worktree/branch at deploy time.
- Produces a reviewed candidate containing all relevant completed parallel work and a healthy inactive production deployment.

- [ ] **Step 1: Inventory every worktree and dirty state immediately before integration**

Run:

```powershell
git worktree list --porcelain
$worktreePaths = git worktree list --porcelain | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) }
foreach ($worktreePath in $worktreePaths) {
  "WORKTREE=$worktreePath"
  git -C $worktreePath status --short
  git -C $worktreePath log -1 --oneline
}
git branch --all --verbose --no-abbrev
git log --all --since='7 days ago' --date=iso --pretty=format:'%H|%ad|%d|%s'
```

Expected: every tree/head/dirty file is recorded. Any dirty worktree or branch with newer relevant messaging commits stops deployment until its owner commits and the changes are reviewed.

- [ ] **Step 2: Compare every unmerged branch with the candidate**

```powershell
$candidate = git rev-parse HEAD
$branches = git for-each-ref --format='%(refname:short)' 'refs/heads/codex/*'
foreach ($branch in $branches) {
  if ($branch -eq 'codex/whatsapp-quoted-replies') { continue }
  "BRANCH=$branch"
  git log "$candidate..$branch" --oneline
  git diff --stat "$candidate...$branch"
}
```

Expected: each unmerged commit is classified in the audit as already integrated/cherry-picked, unrelated historical work, incomplete work intentionally excluded, or relevant completed work to merge. Never merge a dirty/detached tree or an unreviewed branch.

- [ ] **Step 3: Verify production ancestry before building**

Read the active app image revision label on the KVM without printing environment values:

```sh
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' xp-whatsapp-app
```

Back locally:

```powershell
$productionRevision = Read-Host 'Cole a revisão de produção lida na KVM'
if ($productionRevision -notmatch '^[0-9a-f]{40}$') { throw 'Revisão de produção inválida' }
git merge-base --is-ancestor $productionRevision HEAD
```

Expected: exit `0`. If production is not an ancestor, fetch/recover that exact revision and reconcile it before proceeding.

- [ ] **Step 4: Re-run focused/full gates after any parallel integration**

If reviewed commits were merged, rerun Task 10 Step 4 in full and update the audit with exact commit IDs, conflict resolutions, and test counts. Expected: zero failures and production revision remains an ancestor.

- [ ] **Step 5: Build and verify one immutable Linux/amd64 candidate**

Build from the exact clean HEAD with OCI revision label. Verify inside the image: non-root user `1001:1001`, migration `202608230003_whatsapp_service_window_templates`, compiled settings/resumption routes, FFmpeg/FFprobe, and no embedded production env file. Run the full suite against a disposable PostgreSQL 18 container before transfer.

- [ ] **Step 6: Back up, snapshot, migrate, and recreate only the app**

On the KVM use the canonical absolute release/env/Compose paths from `README.md`:

1. record current app image/revision, database ID/`StartedAt`, app restart count, networks, and total/non-app container counts;
2. create and validate a fresh `/srv/backups/example-app` database/media backup;
3. save the deterministic sorted JSON snapshot of all containers except `xp-whatsapp-app`;
4. drain/stop only the app, run `prisma migrate deploy` from the candidate, and require migration state clean;
5. set only `XP_WHATSAPP_IMAGE` to the immutable tag and run `up -d --no-deps --force-recreate --wait --wait-timeout 120 app`;
6. on failure, recreate only the previous app image; retain additive migration/data.

Expected: `WhatsAppPolicyConfiguration.mode=INACTIVE`, app healthy/restarts zero, database identity/start unchanged, and non-app snapshot byte-identical.

- [ ] **Step 7: Verify Stage 1 and commit evidence**

Verify local/public health `200`, login `200`, anonymous conversation redirect, invalid webhook `401`, settings page auth, admin dashboard mode inactive, the generic **Aguardando resposta** marker absent from the authenticated conversation list and its browser payload, normal existing send paths unchanged, no fatal/error/secret logs, Meta subscription read-only invariants, and three soak samples. Record exact evidence without PII/secrets in both reports and commit:

```powershell
git add .superpowers/sdd/whatsapp-service-window-stage-1-predeploy-audit.md docs/verification/2026-08-23-whatsapp-service-window-stage-1.md
git commit -m "docs: verify inactive WhatsApp policy release"
```

### Task 12: Synchronize the approved template, re-audit parallel work, and activate Stage 2

**Files:**
- Create: `.superpowers/sdd/whatsapp-service-window-stage-2-preactivation-audit.md`
- Create: `docs/verification/2026-08-23-whatsapp-service-window-stage-2.md`

**Interfaces:**
- Consumes an approved Meta dashboard template and the healthy Stage 1 release.
- Produces active production enforcement and controlled end-to-end acceptance without sending to an unauthorized customer.

- [ ] **Step 1: Create or confirm the template in Meta without using the application as an editor**

In Meta Business Manager, submit or confirm the `pt_BR` text-only template with the approved service-resumption text. Do not activate policy while status is pending/rejected/paused or while the definition differs. Template approval timing is external; Stage 1 remains usable and inactive while waiting.

- [ ] **Step 2: Run the mandatory parallel audit again before production activation**

Repeat Task 11 Steps 1–3 against the now-current production revision and HEAD. Record all new branches, commits, dirty trees, and whether the running revision has changed. Stop if another deployment is newer, if a relevant completed feature is missing, or if any writer is modifying the same files/state.

- [ ] **Step 3: Synchronize and assign through the admin screen**

From `/configuracoes/whatsapp`, run one synchronization. Verify only aggregate counts in logs, then select the approved `pt_BR` supported template. Read the dashboard back and require `lastTemplateSyncStatus=SUCCEEDED`, freshness under 24 hours, assignment present, and `canActivate=true`.

- [ ] **Step 4: Activate atomically and prove fail-closed behavior without a real policy violation**

Confirm **Ativar proteção** once. Verify the database singleton changes from `INACTIVE` to `ACTIVE` with version increment and actor/timestamp audit. In a disposable/fake-provider environment, prove free-form text/media/recording return `409 WHATSAPP_SERVICE_WINDOW_CLOSED` exactly at 24 hours. Do not deliberately send a prohibited free-form production message.

- [ ] **Step 5: Perform one authorized production acceptance**

Use only a user-approved controlled number/contact:

1. establish or select an inbound customer message older than 24 hours that remains unanswered;
2. confirm all attendants see the same closed/eligible state;
3. preview and explicitly send one resumption template;
4. confirm only one message/provider ID exists after double-click/two-session pressure;
5. verify **Aguardando cliente** for every user;
6. reply from the controlled WhatsApp number;
7. verify the 24-hour window reopens and normal text/audio/media controls return;
8. verify a WhatsApp Business App outbound echo removes pending eligibility;
9. verify opt-out blocks resumption and explicit opt-in restores only future eligible service use.

- [ ] **Step 6: Run final production health, invariants, and soak**

Require app healthy/restarts zero, database ID/`StartedAt` unchanged, migrations clean, local/public health, protected routes, invalid webhook rejection, template status still approved, no unresolved resumption except the deliberately tested path, no 5xx/fatal/secret logs, Meta subscription unchanged, non-app snapshot byte-identical, and three soak samples.

- [ ] **Step 7: Record activation and rollback evidence**

Write exact revision/image, approval status (without template body/Meta ID), sync aggregates, policy version, controlled opaque internal IDs, route results, test counts, backup, non-app hash, and rollback coordinates. Immediate rollback is the admin `INACTIVE` mutation; app rollback recreates only the prior image and retains additive schema/history.

```powershell
git add .superpowers/sdd/whatsapp-service-window-stage-2-preactivation-audit.md docs/verification/2026-08-23-whatsapp-service-window-stage-2.md
git commit -m "docs: verify active WhatsApp service windows"
```
