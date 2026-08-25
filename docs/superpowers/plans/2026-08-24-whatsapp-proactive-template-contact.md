# WhatsApp Proactive Template Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an attendant initiate one consented WhatsApp conversation outside the 24-hour window for Equipe XP, a requested product update, or an agreed follow-up, using only a fresh approved Meta template and an idempotent confirmed send.

**Architecture:** Expand the existing authoritative template cache into function-specific assignments, then derive proactive availability from shared conversation state, current contact consent, contact type, and template readiness. Preview and send use the same server-side purpose catalog; send persists a consent/template snapshot and follows the existing reservation/provider-outcome pattern so retries, concurrent attendants, and unknown outcomes never duplicate a message.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Prisma 7.9.1, PostgreSQL 18, Zod 4.4.3, Vitest, Testing Library, SSE, WhatsApp Graph API v23.0, Docker Compose.

## Global Constraints

- Work in `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\whatsapp-quoted-replies` on `codex/whatsapp-quoted-replies`.
- Execute only after the template-deletion and contact-consent releases are deployed and verified.
- Follow TDD for every behavior change: RED, minimum GREEN, focused test twice, commit.
- Outside the 24-hour customer-service window, never send free-form text, audio, image, video, document, or an arbitrary template.
- Proactive sending requires current explicit consent and no opt-out at confirmation time; clearing opt-out never restores consent.
- Purpose functions are exactly `TEAM_CONTACT`, `REQUESTED_PRODUCT_UPDATE`, and `AGREED_FOLLOW_UP`; `SERVICE_RESUMPTION` remains separate.
- `TEAM_CONTACT` is available only when the contact type normalized name is exactly `equipe xp`.
- Eligible proactive templates are fresh, `APPROVED`, `supported`, `pt_BR`, category `UTILITY` or `MARKETING`, and have the exact body parameter count for their function. `AUTHENTICATION` is always blocked.
- Meta determines the final category. Show `MARKETING` prominently before confirmation; do not alter or disguise category in the app.
- Product detail is 2–80 characters and agreed-follow-up detail is 2–120 characters after whitespace normalization. Reject control characters and URLs.
- The browser may select a listed purpose and provide only its constrained detail. It may not provide a template name, language, category, body, contact name, consent actor, timestamp, or Graph payload.
- A preview is server-authoritative and bound to `definitionHash`; a changed assignment or definition makes the preview stale and sends nothing.
- One `clientRequestId` represents one immutable operation. A concurrent active attempt or `OUTCOME_UNKNOWN` blocks a second provider call.
- A template accepted by Meta sets `awaitingCustomerSince` but does not open the free-form window. Only a new inbound customer message opens the 24-hour window.
- Realtime events carry only conversation/contact/message IDs and force authoritative refresh in every session.
- Submit only the three approved texts from the design; do not add campaign, broadcast, promotion, automatic send, or bulk-selection behavior.
- Before every deployment, audit all worktrees and the production revision. Back up first, replace only `xp-whatsapp-app`, preserve PostgreSQL container `4804d7dee603`, and do not modify unrelated KVM systems.

---

## File Structure

- `prisma/schema.prisma`: new template functions, proactive attempt status/model, consent snapshot relations, and conversation/message/template/user reverse relations.
- `prisma/migrations/202608250002_proactive_template_functions/migration.sql`: additive enum values for function-specific assignments.
- `prisma/proactive-template-functions-contract.test.ts`: migration and assignment compatibility contract.
- `prisma/migrations/202608250003_conversation_template_initiations/migration.sql`: additive attempt table, indexes, constraints, and active-attempt uniqueness.
- `prisma/conversation-template-initiations-contract.test.ts`: migration-from-empty, upgrade, constraints, and idempotence contract.
- `src/modules/proactive-messaging/purposes.ts`: single purpose catalog, strict detail normalization, parameter building, and body rendering.
- `src/modules/proactive-messaging/purposes.test.ts`: exact labels, limits, URL/control rejection, team rule, and rendering tests.
- `src/modules/templates/types.ts`, `schemas.ts`, `service.ts`: function-aware assignment and readiness.
- `src/modules/templates/service.test.ts`, `service.integration.test.ts`: assignment isolation, category/parameter rules, freshness, and admin authorization.
- `src/app/api/settings/whatsapp/route.ts`, `route.test.ts`: function-aware assignment mutation.
- `src/components/settings/whatsapp-policy-screen.tsx`, `.test.tsx`: one assignment card per function.
- `src/modules/messaging-policy/types.ts`, `service.ts`, tests: proactive DTO and precedence after opt-out, awaiting customer, and pending resumption.
- `src/modules/proactive-messaging/types.ts`: preview, eligibility, reservation, persistence, and result contracts.
- `src/modules/proactive-messaging/schemas.ts`: strict preview/send inputs.
- `src/modules/proactive-messaging/service.ts`: authoritative preview, reservation, one provider call, reconciliation, finalization, and SSE invalidation.
- `src/modules/proactive-messaging/service.test.ts`, `service.integration.test.ts`: business, concurrency, idempotency, and PostgreSQL proofs.
- `src/modules/messages/service.ts`, `service.test.ts`: prepared template payloads with one or two body parameters and complete idempotency comparison.
- `src/app/api/conversations/[id]/proactive-messages/preview/route.ts`, `.test.ts`: authenticated server preview.
- `src/app/api/conversations/[id]/proactive-messages/route.ts`, `.test.ts`: authenticated idempotent confirmation/send.
- `src/hooks/use-inbox.ts`, `use-inbox.test.tsx`: preview/send actions, stable request ID, one in-flight operation, and authoritative refresh.
- `src/components/inbox/proactive-contact-dialog.tsx`, `.test.tsx`: purpose fields, preview, category disclosure, stale-preview recovery, and mobile keyboard behavior.
- `src/components/inbox/service-window-banner.tsx`, `.test.tsx`, `inbox-shell.tsx`: state precedence and **Iniciar contato** entry point.
- `src/lib/public-error.ts`: stable safe proactive errors.
- `docs/verification/2026-08-25-proactive-template-settings-release.md`: assignment-support deployment and Meta submission evidence.
- `docs/verification/2026-08-25-proactive-template-contact-release.md`: sending release, controlled production acceptance, and rollback evidence.

### Task 1: Define the three safe purposes once

**Files:**
- Create: `src/modules/proactive-messaging/purposes.ts`
- Create: `src/modules/proactive-messaging/purposes.test.ts`

**Interfaces:**
- Produces `ProactivePurposeInput`, `PROACTIVE_PURPOSES`, `parseProactivePurposeInput`, `parametersForPurpose`, `renderProactiveBody`, and `purposeAllowedForContactType`.
- Later policy, preview, send, and UI tasks consume the exact same catalog and never reimplement parameter rules.

- [ ] **Step 1: Write RED tests for the catalog**

Assert these exact contracts:

```ts
expect(PROACTIVE_PURPOSES.TEAM_CONTACT).toMatchObject({
  label: "Equipe XP",
  parameterCount: 1,
  detail: null,
});
expect(PROACTIVE_PURPOSES.REQUESTED_PRODUCT_UPDATE.detail).toEqual({
  label: "Produto solicitado",
  min: 2,
  max: 80,
});
expect(PROACTIVE_PURPOSES.AGREED_FOLLOW_UP.detail).toEqual({
  label: "Referência do retorno",
  min: 2,
  max: 120,
});
expect(parseProactivePurposeInput({
  function: "REQUESTED_PRODUCT_UPDATE",
  detail: "  controle   de PS5  ",
})).toEqual({ function: "REQUESTED_PRODUCT_UPDATE", detail: "controle de PS5" });
```

Also assert rejection of empty/oversized detail, `https://`, `http://`, `www.`, `produto.com`, ASCII control characters, unknown keys, detail on `TEAM_CONTACT`, and missing detail on the two-detail functions. Assert `purposeAllowedForContactType("TEAM_CONTACT", "equipe xp") === true`, accents/case do not create a match, and both other functions allow a null contact type.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/modules/proactive-messaging/purposes.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the strict catalog**

Use this exported shape and exact body definitions:

```ts
export type ProactiveFunction =
  | "TEAM_CONTACT"
  | "REQUESTED_PRODUCT_UPDATE"
  | "AGREED_FOLLOW_UP";

export const PROACTIVE_PURPOSES = {
  TEAM_CONTACT: {
    label: "Equipe XP",
    parameterCount: 1,
    detail: null,
    proposedBody: "Olá, {{1}}. A XP Eletrônicos precisa falar com você sobre uma questão da equipe. Responda a esta mensagem quando puder.",
  },
  REQUESTED_PRODUCT_UPDATE: {
    label: "Produto solicitado",
    parameterCount: 2,
    detail: { label: "Produto solicitado", min: 2, max: 80 },
    proposedBody: "Olá, {{1}}. Você pediu para receber uma atualização sobre {{2}}. A XP Eletrônicos tem uma informação para você. Responda a esta mensagem para continuarmos.",
  },
  AGREED_FOLLOW_UP: {
    label: "Retorno ou lembrete combinado",
    parameterCount: 2,
    detail: { label: "Referência do retorno", min: 2, max: 120 },
    proposedBody: "Olá, {{1}}. Este é o retorno combinado sobre {{2}}. Responda a esta mensagem para continuarmos.",
  },
} as const;
```

Normalize whitespace with `value.trim().replace(/\s+/gu, " ")`; reject `/[\u0000-\u001f\u007f]/u` before normalization and `/(?:https?:\/\/|www\.|\b[\p{L}\d-]+\.(?:com(?:\.br)?|net|org|io)\b)/iu` afterward. Derive parameter arrays as `{ type: "text", text }[]`, use safe contact name `trim().slice(0, 80) || "cliente"`, and render only numbered placeholders that correspond to the exact parameter count.

- [ ] **Step 4: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/proactive-messaging/purposes.test.ts
git add src/modules/proactive-messaging/purposes.ts src/modules/proactive-messaging/purposes.test.ts
git commit -m "feat: define proactive WhatsApp purposes"
```

Expected: focused tests pass twice before commit.

### Task 2: Add function-specific template assignments

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608250002_proactive_template_functions/migration.sql`
- Create: `prisma/proactive-template-functions-contract.test.ts`
- Modify: `src/modules/templates/types.ts`
- Modify: `src/modules/templates/schemas.ts`
- Modify: `src/modules/templates/service.ts`
- Modify: `src/modules/templates/service.test.ts`
- Modify: `src/modules/templates/service.integration.test.ts`

**Interfaces:**
- Produces enum values `TEAM_CONTACT`, `REQUESTED_PRODUCT_UPDATE`, and `AGREED_FOLLOW_UP` in `WhatsAppTemplateFunction`.
- Produces `assignTemplateFunction(actor, functionName, templateId, dependencies)` and `WhatsAppPolicySettingsDto.functions` keyed by all four functions.
- Replaces the one-function repository methods with `listAssignments()` and `assignTemplate(functionName, templateId, actorUserId)`.

- [ ] **Step 1: Write RED migration and service tests**

The migration contract must assert three additive `ALTER TYPE ... ADD VALUE` statements, no destructive SQL, upgrade from the prior schema, and idempotent schema deployment. Service tests must cover each matrix row:

```ts
const rules = [
  ["SERVICE_RESUMPTION", 1, ["UTILITY", "MARKETING"]],
  ["TEAM_CONTACT", 1, ["UTILITY", "MARKETING"]],
  ["REQUESTED_PRODUCT_UPDATE", 2, ["UTILITY", "MARKETING"]],
  ["AGREED_FOLLOW_UP", 2, ["UTILITY", "MARKETING"]],
] as const;
```

For every function, assert `APPROVED + supported + pt_BR + exact count + allowed category` is eligible. Assert `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`, unsupported components, wrong language, wrong count, `AUTHENTICATION`, stale sync, missing assignment, inactive actor, and non-admin actor are ineligible. Assigning one function must not change another.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run prisma/proactive-template-functions-contract.test.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts
```

Expected: FAIL on missing enum values and function-aware interfaces.

- [ ] **Step 3: Add the additive enum migration**

Add the three enum members after `SERVICE_RESUMPTION` in Prisma and use one PostgreSQL statement per value:

```sql
ALTER TYPE "WhatsAppTemplateFunction" ADD VALUE IF NOT EXISTS 'TEAM_CONTACT';
ALTER TYPE "WhatsAppTemplateFunction" ADD VALUE IF NOT EXISTS 'REQUESTED_PRODUCT_UPDATE';
ALTER TYPE "WhatsAppTemplateFunction" ADD VALUE IF NOT EXISTS 'AGREED_FOLLOW_UP';
```

Do not insert assignments. Existing `SERVICE_RESUMPTION` remains unchanged.

- [ ] **Step 4: Make assignment contracts function-aware**

Define:

```ts
export type WhatsAppTemplateFunctionDto =
  | "SERVICE_RESUMPTION"
  | "TEAM_CONTACT"
  | "REQUESTED_PRODUCT_UPDATE"
  | "AGREED_FOLLOW_UP";

export type WhatsAppFunctionReadinessDto = {
  assignment: {
    templateId: string;
    name: string;
    language: string;
    category: string;
    previewBody: string;
    definitionHash: string;
  } | null;
  readinessReason:
    | "NO_ASSIGNMENT"
    | "TEMPLATE_INELIGIBLE"
    | "SYNC_STALE"
    | null;
};
```

Change template summaries from `assigned: boolean` to `assignedFunctions: WhatsAppTemplateFunctionDto[]`, and settings from one `assignment/readinessReason` to:

```ts
functions: Record<WhatsAppTemplateFunctionDto, WhatsAppFunctionReadinessDto>;
```

Keep `canActivate` derived only from `SERVICE_RESUMPTION` so the already-active inbound-reply policy does not depend on optional proactive functions.

- [ ] **Step 5: Implement generic repository/service methods**

Replace `getServiceResumptionAssignment` with `listAssignments`, and replace `assignServiceResumptionTemplate` with:

```ts
assignTemplate(
  functionName: WhatsAppTemplateFunction,
  templateId: string,
  actorUserId: string,
): Promise<void>;
```

Implement `assignmentRule(functionName)` using exact parameter counts above, require category uppercase `UTILITY` or `MARKETING`, and reuse the existing status/support/language/fresh-sync checks. `assignTemplateFunction` must run in the existing transaction, lock/re-read configuration, require active admin, re-read the template, validate the selected function, upsert by function, and return fresh settings.

- [ ] **Step 6: Run GREEN twice and commit**

```powershell
npx prisma generate
npx prisma validate
npx vitest run prisma/proactive-template-functions-contract.test.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts
git add prisma/schema.prisma prisma/migrations/202608250002_proactive_template_functions/migration.sql prisma/proactive-template-functions-contract.test.ts src/generated/prisma src/modules/templates/types.ts src/modules/templates/schemas.ts src/modules/templates/service.ts src/modules/templates/service.test.ts src/modules/templates/service.integration.test.ts
git commit -m "feat: assign templates by WhatsApp function"
```

Expected: all focused tests pass twice before commit.

### Task 3: Expose and display four independent assignment slots

**Files:**
- Modify: `src/modules/templates/schemas.ts`
- Modify: `src/app/api/settings/whatsapp/route.ts`
- Modify: `src/app/api/settings/whatsapp/route.test.ts`
- Modify: `src/components/settings/whatsapp-policy-screen.tsx`
- Modify: `src/components/settings/whatsapp-policy-screen.test.tsx`

**Interfaces:**
- Consumes `assignTemplateFunction` and the `functions` readiness map.
- Produces admin mutation `{ action: "ASSIGN_TEMPLATE", function, templateId }` and one settings card for each exact function.

- [ ] **Step 1: Write RED route and screen tests**

Route tests must reject a missing/unknown function, unknown keys, inactive/non-admin actor, wrong-function template, and same-origin failure. Assert success calls:

```ts
assignTemplateFunction(actor, "REQUESTED_PRODUCT_UPDATE", templateId)
```

Screen tests must assert exact labels `Retomar atendimento`, `Equipe XP`, `Produto solicitado`, and `Retorno ou lembrete combinado`; show readiness per card; show category beside the selected template; filter incompatible parameter counts; warn `A categoria deste template é Marketing.`; and never change one card while another request is pending.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/app/api/settings/whatsapp/route.test.ts src/components/settings/whatsapp-policy-screen.test.tsx
```

Expected: FAIL because the route and screen still assume one assignment.

- [ ] **Step 3: Implement the strict mutation**

Change the assignment member of `whatsappPolicyMutationSchema` to:

```ts
z.strictObject({
  action: z.literal("ASSIGN_TEMPLATE"),
  function: z.enum([
    "SERVICE_RESUMPTION",
    "TEAM_CONTACT",
    "REQUESTED_PRODUCT_UPDATE",
    "AGREED_FOLLOW_UP",
  ]),
  templateId: whatsAppTemplateIdSchema,
})
```

Pass both authoritative values to `assignTemplateFunction`. Keep sync and mode mutations admin-only and unchanged.

- [ ] **Step 4: Render focused assignment cards**

Use the settings DTO rather than local readiness inference. Each card renders its purpose, assigned name/language/category/body, precise reason if unavailable, eligible select options, and its own save-pending state. Submit only internal template UUID and function. Do not offer template creation, category override, body editing, or a browser-provided Meta ID.

- [ ] **Step 5: Run GREEN twice, React quality checks, and commit**

```powershell
npx vitest run src/app/api/settings/whatsapp/route.test.ts src/components/settings/whatsapp-policy-screen.test.tsx
npm run typecheck
npm run lint
git add src/modules/templates/schemas.ts src/app/api/settings/whatsapp/route.ts src/app/api/settings/whatsapp/route.test.ts src/components/settings/whatsapp-policy-screen.tsx src/components/settings/whatsapp-policy-screen.test.tsx
git commit -m "feat: configure proactive WhatsApp templates"
```

Expected: all pass. Apply the `vercel:react-best-practices` checklist to the TSX changes before commit.

### Task 4: Deploy assignment support and submit the three Meta templates

**Files:**
- Create: `docs/verification/2026-08-25-proactive-template-settings-release.md`

**Interfaces:**
- Produces production support for independent assignments and three Meta template submissions with recorded IDs/status/category.
- Does not expose proactive sending; inbox behavior remains unchanged in this release.

- [ ] **Step 1: Run release gates and browser acceptance**

Run Prisma generate/validate, migration-from-empty/upgrade/idempotence tests, focused template tests, full Vitest, lint, typecheck, build, Compose/KVM verifiers, audit, and Linux/amd64 image smoke. On desktop and 390×844 verify the four cards, per-function filters, category warning, save isolation, keyboard flow, and zero console errors.

- [ ] **Step 2: Audit, back up, and deploy app-only**

Repeat worktree/production preflight, validate a new backup under `/srv/backups/example-app`, preserve the previous image, apply migration `202608250002_proactive_template_functions` exactly once, and recreate only `xp-whatsapp-app` from immutable `xp-whatsapp:<candidate-sha>`. Verify the database container ID and non-app snapshot remain unchanged.

- [ ] **Step 3: Submit exact templates once**

Using the permanent system-user token only inside the production server process environment, POST each exact `pt_BR` body from `PROACTIVE_PURPOSES` to `/{WABA_ID}/message_templates`, requesting category `UTILITY` and these names:

```text
contato_equipe_xp
aviso_produto_solicitado
retorno_combinado
```

Use BODY text components and examples matching parameter counts. Do not log the token or raw request. Store sanitized response evidence containing only template name, Meta ID, status, final category, language, and timestamp. If the HTTP outcome is ambiguous, list templates and reconcile by exact `name + pt_BR`; do not repeat POST blindly.

- [ ] **Step 4: Sync, wait for Meta, and assign only ready templates**

Trigger authenticated template sync. Pending/rejected/paused templates remain unassigned and their functions unavailable. For each `APPROVED` compatible template, assign its exact function through the admin endpoint, re-fetch settings, and confirm name/language/category/body/definition hash. Meta may classify a template as `MARKETING`; record that category and preserve the UI warning.

- [ ] **Step 5: Verify production and commit the report**

Confirm policy remains active, the existing `SERVICE_RESUMPTION` assignment is unchanged, new assignments are independent, no proactive button exists yet, app/database are healthy, restarts remain zero, phone echoes/webhooks still work, and three soak samples are clean. Record candidate SHA, image ID, backup, prior image, migration row, sanitized Meta outcomes, assignments, tests, non-app diff, and rollback command.

```powershell
git add docs/verification/2026-08-25-proactive-template-settings-release.md
git commit -m "docs: verify proactive template settings release"
```

### Task 5: Support exact one- or two-parameter prepared template messages

**Files:**
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`

**Interfaces:**
- Changes `PreparedTemplatePayload.bodyParameters` from a one-item tuple to a readonly array containing one or two text parameters.
- Preserves service-resumption behavior and makes idempotent identity compare the complete ordered parameter array.

- [ ] **Step 1: Write RED message tests**

Send a prepared two-parameter template and assert persistence/provider values remain ordered. Reuse the same `clientRequestId` with an identical payload and assert one provider call. Repeat with only parameter 2 changed and assert `409 Identificador de envio já utilizado`. Keep the existing one-parameter resumption test passing.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/modules/messages/service.test.ts src/modules/resumptions/service.test.ts
```

Expected: FAIL because `PreparedTemplatePayload` and identity comparison assume one parameter.

- [ ] **Step 3: Generalize the payload safely**

Use:

```ts
export type PreparedTemplateTextParameter = { type: "text"; text: string };
export type PreparedTemplatePayload = {
  kind: "TEMPLATE";
  name: string;
  language: "pt_BR";
  definitionHash: string;
  bodyParameters:
    | readonly [PreparedTemplateTextParameter]
    | readonly [PreparedTemplateTextParameter, PreparedTemplateTextParameter];
};
```

Replace the index-zero identity check with exact ordered comparison of parsed stored parameters:

```ts
const stored = preparedBodyParameters(message);
const requested = input.payload.bodyParameters;
const sameParameters =
  stored.length === requested.length &&
  stored.every((item, index) => item.type === requested[index]?.type && item.text === requested[index]?.text);
```

Include `!sameParameters` in the existing conflict condition. Pass the complete array to `provider.sendTemplate`; do not truncate, reorder, or accept zero/more-than-two parameters.

- [ ] **Step 4: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/messages/service.test.ts src/modules/resumptions/service.test.ts src/modules/resumptions/service.integration.test.ts
git add src/modules/messages/service.ts src/modules/messages/service.test.ts
git commit -m "feat: send two-parameter WhatsApp templates"
```

Expected: both one- and two-parameter paths pass twice.

### Task 6: Persist proactive attempts and immutable snapshots

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608250003_conversation_template_initiations/migration.sql`
- Create: `prisma/conversation-template-initiations-contract.test.ts`

**Interfaces:**
- Produces `ConversationTemplateInitiationStatus` and `ConversationTemplateInitiation`.
- Later service tasks consume unique `clientRequestId`, optional unique `messageId`, and one active attempt per conversation.

- [ ] **Step 1: Write the RED migration contract**

Apply the migration after the consent and function migrations. Assert legacy rows remain unchanged, enum/table/foreign keys exist, `client_request_id` and `message_id` are unique, category/definition/parameters/consent snapshot columns are present, and this partial index exists:

```sql
CREATE UNIQUE INDEX "conversation_template_initiations_active_unique"
ON "conversation_template_initiations" ("conversation_id")
WHERE "status" IN ('RESERVED', 'SEND_IN_FLIGHT', 'OUTCOME_UNKNOWN');
```

Insert two active attempts for one conversation and assert PostgreSQL rejects the second; insert a `FAILED` then another `RESERVED` and assert success. Assert no `DROP`, `TRUNCATE`, or data backfill.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run prisma/conversation-template-initiations-contract.test.ts
```

Expected: FAIL because the model and migration do not exist.

- [ ] **Step 3: Add the exact Prisma model**

```prisma
enum ConversationTemplateInitiationStatus {
  RESERVED
  SEND_IN_FLIGHT
  SENT
  FAILED
  OUTCOME_UNKNOWN
}

model ConversationTemplateInitiation {
  id                       String                               @id @default(uuid()) @db.Uuid
  conversationId           String                               @map("conversation_id") @db.Uuid
  function                 WhatsAppTemplateFunction
  templateId               String                               @map("template_id") @db.Uuid
  messageId                String?                              @unique @map("message_id") @db.Uuid
  sentByUserId             String                               @map("sent_by_user_id") @db.Uuid
  clientRequestId          String                               @unique @map("client_request_id") @db.Uuid
  status                   ConversationTemplateInitiationStatus
  renderedBody             String                               @map("rendered_body")
  templateName             String                               @map("template_name")
  templateLanguage         String                               @map("template_language")
  templateCategory         String                               @map("template_category")
  definitionHash           String                               @map("definition_hash")
  parameters               Json
  consentGrantedAt         DateTime                             @map("consent_granted_at") @db.Timestamptz(3)
  consentSource            ContactMessagingConsentSource       @map("consent_source")
  consentGrantedByUserId   String                               @map("consent_granted_by_user_id") @db.Uuid
  providerMessageId        String?                              @map("provider_message_id")
  providerAttemptedAt      DateTime?                            @map("provider_attempted_at") @db.Timestamptz(3)
  reservationUntil         DateTime?                            @map("reservation_until") @db.Timestamptz(3)
  failureReason            String?                              @map("failure_reason")
  createdAt                DateTime                             @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                DateTime                             @updatedAt @map("updated_at") @db.Timestamptz(3)
  conversation             Conversation                         @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  template                 WhatsAppTemplate                     @relation(fields: [templateId], references: [id], onDelete: Restrict)
  message                  Message?                             @relation("TemplateInitiationMessage", fields: [messageId], references: [id], onDelete: SetNull)
  sentByUser               User                                 @relation("TemplateInitiationSender", fields: [sentByUserId], references: [id], onDelete: Restrict)
  consentGrantedByUser     User                                 @relation("TemplateInitiationConsentActor", fields: [consentGrantedByUserId], references: [id], onDelete: Restrict)

  @@index([conversationId, function, status])
  @@map("conversation_template_initiations")
}
```

Add reverse relations to `Conversation`, `WhatsAppTemplate`, `Message`, and both named `User` relations. Write matching additive SQL and a check that proactive `function <> 'SERVICE_RESUMPTION'`.

- [ ] **Step 4: Generate, validate, run GREEN twice, and commit**

```powershell
npx prisma generate
npx prisma validate
npx vitest run prisma/conversation-template-initiations-contract.test.ts
git add prisma/schema.prisma prisma/migrations/202608250003_conversation_template_initiations/migration.sql prisma/conversation-template-initiations-contract.test.ts src/generated/prisma
git commit -m "feat: persist proactive template attempts"
```

Expected: focused test passes twice before commit.

### Task 7: Derive proactive availability with the approved precedence

**Files:**
- Modify: `src/modules/messaging-policy/types.ts`
- Modify: `src/modules/messaging-policy/service.ts`
- Modify: `src/modules/messaging-policy/service.test.ts`
- Modify: `src/modules/messaging-policy/service.integration.test.ts`

**Interfaces:**
- Adds send mode `PROACTIVE`, reasons `CONSENT_REQUIRED` and `PROACTIVE_TEMPLATE_UNAVAILABLE`, and `proactive.options` to `ServiceWindowDto`.
- Produces options only after opt-out, awaiting-customer, and pending-resumption states have been ruled out.

- [ ] **Step 1: Write the RED precedence table**

Use table tests in this exact order:

```ts
const cases = [
  ["opt-out", "BLOCKED", "CONTACT_OPTED_OUT"],
  ["awaiting customer", "AWAITING_CUSTOMER", null],
  ["pending inbound", "RESUMPTION", null],
  ["no pending + consent + ready function", "PROACTIVE", null],
  ["no pending + no consent", "BLOCKED", "CONSENT_REQUIRED"],
  ["no pending + consent + no ready function", "BLOCKED", "PROACTIVE_TEMPLATE_UNAVAILABLE"],
] as const;
```

Also assert an open window returns `FREE_FORM` when the contact is not opted out, while opt-out remains `BLOCKED`; `TEAM_CONTACT` appears only for `equipe xp`; product/follow-up appear for any type; marketing remains available but labeled; active attempt/`awaitingCustomerSince` suppresses proactive options; and the existing resumption path never becomes proactive because consent exists.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/modules/messaging-policy/service.test.ts src/modules/messaging-policy/service.integration.test.ts
```

Expected: FAIL on missing proactive DTO and precedence.

- [ ] **Step 3: Extend the DTO**

Add:

```ts
export type ProactiveTemplateOptionDto = {
  function: "TEAM_CONTACT" | "REQUESTED_PRODUCT_UPDATE" | "AGREED_FOLLOW_UP";
  label: string;
  detail: { label: string; min: number; max: number } | null;
  templateName: string;
  language: "pt_BR";
  category: "UTILITY" | "MARKETING";
};
```

Every `ServiceWindowDto` returns `proactive: { options: ProactiveTemplateOptionDto[] } | null`. `PROACTIVE` requires at least one option. Do not send body text/definition hash in this list; the preview endpoint supplies the final authoritative message.

- [ ] **Step 4: Extend the policy record and derive in approved order**

Select current consent fields, opt-out, normalized contact type, all four assignments/templates, pending customer state, awaiting-customer state, active resumption/initiation attempts, policy configuration, and last successful sync. Filter proactive options through the purpose catalog and function assignment rules. Preserve the existing inactive-policy behavior, then evaluate opt-out; open window; confirming attempt; awaiting customer; pending resumption; consent; available proactive options. Return `CONSENT_REQUIRED` before template-readiness diagnostics when no active consent exists.

- [ ] **Step 5: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/messaging-policy/service.test.ts src/modules/messaging-policy/service.integration.test.ts src/modules/resumptions/service.test.ts
git add src/modules/messaging-policy/types.ts src/modules/messaging-policy/service.ts src/modules/messaging-policy/service.test.ts src/modules/messaging-policy/service.integration.test.ts
git commit -m "feat: derive proactive WhatsApp availability"
```

Expected: policy and existing resumption tests pass twice.

### Task 8: Implement authoritative preview and idempotent send

**Files:**
- Create: `src/modules/proactive-messaging/types.ts`
- Create: `src/modules/proactive-messaging/schemas.ts`
- Create: `src/modules/proactive-messaging/service.ts`
- Create: `src/modules/proactive-messaging/service.test.ts`
- Create: `src/modules/proactive-messaging/service.integration.test.ts`
- Modify: `src/lib/public-error.ts`

**Interfaces:**
- Produces `previewProactiveMessage(actor, conversationId, input, dependencies)` and `sendProactiveMessage(actor, conversationId, input, dependencies)`.
- Preview returns `{ function, detail, previewBody, templateName, language, category, definitionHash }`.
- Send accepts the same purpose input plus `clientRequestId` and `expectedDefinitionHash`, and returns `{ id, clientRequestId, status, messageId }`.

- [ ] **Step 1: Write RED schema and service tests**

Cover inactive actor, missing conversation, open window, pending inbound, awaiting customer, no consent, opt-out, wrong contact type, absent/stale/pending/rejected/paused/deleted/authentication template, changed definition hash, normalized details, preview rendering, consent revoked between preview/send, inbound message between preview/send, identical idempotent replay, changed payload with reused ID, double click, two attendants, stale reservation before provider attempt, provider confirmed failure, provider success, throw before message creation, throw after provider attempt, and `OUTCOME_UNKNOWN` reconciliation. Assert the provider receives exactly the assigned template name, `pt_BR`, ordered parameters, and contact phone from the server record.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/modules/proactive-messaging/purposes.test.ts src/modules/proactive-messaging/service.test.ts src/modules/proactive-messaging/service.integration.test.ts
```

Expected: FAIL because the service contracts do not exist.

- [ ] **Step 3: Define strict input and repository contracts**

Export:

```ts
export type ProactivePreviewInput = ProactivePurposeInput;
export type ProactiveSendInput = ProactivePurposeInput & {
  clientRequestId: string;
  expectedDefinitionHash: string;
};
```

Build Zod as a discriminated union per function, not an intersection that permits extra keys. `clientRequestId` uses the existing lowercase UUID schema; `expectedDefinitionHash` is trimmed 16–128 ASCII hex. Define a repository with `transaction`, `lockConversationAndPolicy`, `getEligibility`, `findByClientRequestId`, `findActiveByConversation`, `findAttemptMessage`, `expireReservation`, `createReservation`, and `finalize`, matching the existing resumption reservation semantics but using `ConversationTemplateInitiation`.

- [ ] **Step 4: Implement preview with no persistence or provider call**

Parse actor/conversation/input, require active actor, load and validate the full current eligibility record, then derive safe contact name, parameters, and rendered body. Return only:

```ts
{
  function: parsed.function,
  detail: "detail" in parsed ? parsed.detail : null,
  previewBody,
  templateName: template.name,
  language: "pt_BR",
  category: template.category as "UTILITY" | "MARKETING",
  definitionHash: template.definitionHash,
}
```

Do not reserve, publish SSE, create a message, or call Meta.

- [ ] **Step 5: Implement reservation and single-call delivery**

Inside a serializable transaction: lock conversation/policy; re-check actor, closed window, no pending request, not awaiting, current consent, no opt-out, function/contact-type compatibility, fresh assignment, exact definition hash, and normalized parameters. Reconcile an identical `clientRequestId`; reject a changed identity. Reconcile an active attempt/message; expire only `RESERVED` attempts whose reservation elapsed and whose message/provider-attempt fields are all null. Create a reservation containing the consent snapshot and template snapshot.

Outside the transaction call `sendPreparedTemplateMessage` once with the same `clientRequestId`, body, definition hash, and complete parameter tuple. Re-enter a locked transaction and map message state to `SENT`, `FAILED`, or `OUTCOME_UNKNOWN`; on accepted send set `Conversation.awaitingCustomerSince = providerAttemptedAt ?? now`, clear pending response state through the established shared-state helper, and attach `messageId/providerMessageId`. A thrown local error becomes `FAILED` only when no prepared message and no provider-attempt evidence exist; otherwise keep `OUTCOME_UNKNOWN` and block blind retry.

- [ ] **Step 6: Add exact safe public codes**

Map these codes without phone, note, template payload, or Graph details:

```text
WHATSAPP_PROACTIVE_CONSENT_REQUIRED
WHATSAPP_PROACTIVE_CONSENT_REVOKED
WHATSAPP_PROACTIVE_PURPOSE_NOT_ALLOWED
WHATSAPP_PROACTIVE_TEMPLATE_NOT_READY
WHATSAPP_PROACTIVE_PREVIEW_STALE
WHATSAPP_PROACTIVE_ALREADY_STARTED
WHATSAPP_PROACTIVE_OUTCOME_UNKNOWN
WHATSAPP_SERVICE_WINDOW_REOPENED
```

Use status `409` for state conflicts, `400` for schema failure through the existing response helper, `401` for no session, and `404` for an unknown conversation.

- [ ] **Step 7: Publish minimal invalidations and run GREEN twice**

After reconciliation/finalization, publish only `{ type: "conversation.updated", conversationId, revision }`, where `revision` is the authoritative conversation `updatedAt` ISO string, and the existing ID-only `message.created` event emitted by message service. Publication failure must not convert an accepted provider result into a send failure.

```powershell
npx vitest run src/modules/proactive-messaging/purposes.test.ts src/modules/proactive-messaging/service.test.ts src/modules/proactive-messaging/service.integration.test.ts src/modules/messages/service.test.ts src/modules/resumptions/service.test.ts
git add src/modules/proactive-messaging src/lib/public-error.ts
git commit -m "feat: send consented proactive templates"
```

Expected: all focused tests pass twice.

### Task 9: Expose preview and send routes

**Files:**
- Create: `src/app/api/conversations/[id]/proactive-messages/preview/route.ts`
- Create: `src/app/api/conversations/[id]/proactive-messages/preview/route.test.ts`
- Create: `src/app/api/conversations/[id]/proactive-messages/route.ts`
- Create: `src/app/api/conversations/[id]/proactive-messages/route.test.ts`

**Interfaces:**
- Produces `POST /api/conversations/:id/proactive-messages/preview` and `POST /api/conversations/:id/proactive-messages` using the existing `{ data, error }` envelope.
- Both routes require same origin, authenticated active actor, strict JSON, and established per-user rate limits.

- [ ] **Step 1: Write RED route tests**

For both routes assert same-origin rejection, no session, invalid conversation UUID, unknown keys, invalid purpose detail, inactive actor, state error mapping, and success envelope. Preview must not publish events. Send must pass the exact authenticated actor and server-validated body to the service; a repeated `clientRequestId` returns the stored result. Assert response bodies never contain phone, consent note, raw provider error, token, or template components.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run 'src/app/api/conversations/[id]/proactive-messages/preview/route.test.ts' 'src/app/api/conversations/[id]/proactive-messages/route.test.ts'
```

Expected: FAIL because both routes are missing.

- [ ] **Step 3: Implement route factories with established dependencies**

Each `POST` executes `assertSameOrigin(request)`, `requireUser()`, UUID route-param parsing, `request.json()`, its exact Zod schema, and one service call. Use the current conversation route error helper. Apply the existing message-send rate limit to actual send; preview uses a separate bounded 30-per-minute user limit so preview cannot consume send reservations.

- [ ] **Step 4: Run GREEN twice and commit**

```powershell
npx vitest run 'src/app/api/conversations/[id]/proactive-messages/preview/route.test.ts' 'src/app/api/conversations/[id]/proactive-messages/route.test.ts'
git add src/app/api/conversations/[id]/proactive-messages/preview/route.ts src/app/api/conversations/[id]/proactive-messages/preview/route.test.ts src/app/api/conversations/[id]/proactive-messages/route.ts src/app/api/conversations/[id]/proactive-messages/route.test.ts
git commit -m "feat: expose proactive WhatsApp messaging"
```

Expected: both route suites pass twice.

### Task 10: Add the official-style preview and confirmation flow

**Files:**
- Create: `src/components/inbox/proactive-contact-dialog.tsx`
- Create: `src/components/inbox/proactive-contact-dialog.test.tsx`
- Modify: `src/components/inbox/service-window-banner.tsx`
- Modify: `src/components/inbox/service-window-banner.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes `serviceWindow.proactive.options`, preview route, and send route.
- Produces one **Iniciar contato** action with purpose selection, constrained field, authoritative preview, category disclosure, confirmation, stable request ID, and shared-state refresh.

- [ ] **Step 1: Write RED hook tests**

Assert preview posts only function/detail and stores no optimistic template data; send creates one UUID when confirmation begins, reuses it across a transport retry, blocks double submit, sends `expectedDefinitionHash`, and refreshes list/detail after every authoritative result. Assert `WHATSAPP_PROACTIVE_PREVIEW_STALE` clears the old confirmation and requests a new preview; `WHATSAPP_SERVICE_WINDOW_REOPENED` closes the dialog and restores free-form UI; `OUTCOME_UNKNOWN` remains blocked and visible.

- [ ] **Step 2: Write RED component/banner tests**

Cover exact precedence copy, no action without consent, purpose select, team option visibility, product/reference limits, preview loading, Utility category, Marketing warning, final text, technical name/language, cancel/Escape/back behavior, focus restoration, disabled double click, safe errors, accepted-send closure, 390×844 no overflow, and composer remaining disabled after accepted template until inbound reply.

- [ ] **Step 3: Run RED**

```powershell
npx vitest run src/hooks/use-inbox.test.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/proactive-contact-dialog.test.tsx
```

Expected: FAIL because proactive hook/actions/components do not exist.

- [ ] **Step 4: Implement hook actions without optimistic authority**

Expose:

```ts
previewProactiveMessage(input: ProactivePurposeInput): Promise<ProactivePreviewDto | null>;
sendProactiveMessage(input: ProactivePurposeInput & {
  expectedDefinitionHash: string;
}): Promise<boolean>;
```

Keep one preview `AbortController` and one send promise per selected conversation. Generate the send UUID once, before the first POST, and retain it until an authoritative terminal response. On SSE `conversation.updated` or `contact.updated`, refresh list/detail and let server state close or reconfigure the dialog.

- [ ] **Step 5: Implement `ProactiveContactDialog`**

The first view selects one server-listed option and collects only its declared detail. **Ver prévia** calls the server. The confirmation view shows final body, template name, `pt_BR`, category, and `Este template foi classificado como Marketing pela Meta.` when applicable. **Enviar template** is the only sending action. If options/consent/window change, cancel confirmation and restore focus to the banner; browser back and Escape close without sending.

- [ ] **Step 6: Integrate the banner with approved copy**

For `PROACTIVE`, render **Contato fora da janela de 24 horas** and button **Iniciar contato**. For `CONSENT_REQUIRED`, render **Registre o consentimento antes de iniciar uma conversa.** For `PROACTIVE_TEMPLATE_UNAVAILABLE`, render **Nenhum template aprovado está disponível para este contato.** Preserve opt-out, awaiting-customer, resumption, confirming, and open-window branches in their higher precedence.

- [ ] **Step 7: Run GREEN twice, browser quality checks, and commit**

```powershell
npx vitest run src/hooks/use-inbox.test.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/proactive-contact-dialog.test.tsx src/modules/messaging-policy/service.test.ts
npm run typecheck
npm run lint
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/inbox/proactive-contact-dialog.tsx src/components/inbox/proactive-contact-dialog.test.tsx src/components/inbox/service-window-banner.tsx src/components/inbox/service-window-banner.test.tsx src/components/inbox/inbox-shell.tsx
git commit -m "feat: confirm proactive contact in inbox"
```

Expected: all pass. Apply `vercel:react-best-practices`, then verify authenticated desktop and 390×844 flows with no console error.

### Task 11: Verify, deploy, and perform one controlled production send

**Files:**
- Create: `docs/verification/2026-08-25-proactive-template-contact-release.md`

**Interfaces:**
- Produces the complete production feature and one consented controlled acceptance proof.
- Leaves campaigns, automatic sends, free-form outside 24 hours, and unapproved purposes unavailable.

- [ ] **Step 1: Run full local and artifact gates**

Run Prisma generate/validate, all migration contracts from empty and upgrade, focused proactive/template/message/resumption/policy/route/component/hook suites, full Vitest twice for flaky concurrency detection, lint, typecheck, build, Compose/KVM verifiers, dependency audit, exact Linux/amd64 image smoke, and a database concurrency run. Expected: every command exits `0`, no high vulnerability, no duplicate provider call, and no failed/flaky test.

- [ ] **Step 2: End-to-end local acceptance**

Using an authenticated two-attendant fixture and controlled contacts, verify: no consent; grant; opt-out; clear opt-out without restoration; re-grant; Equipe XP filtering; product and return fields; Utility and Marketing disclosures; stale preview; click twice; two attendants; open-window race; consent-revoke race; pending inbound precedence; accepted template -> awaiting customer; inbound reply -> free-form in both sessions; mobile back/Escape; zero console errors.

- [ ] **Step 3: Audit parallel work and production baseline**

Inspect every worktree status/log and the deployed revision. Confirm the candidate includes both prior releases and no unreviewed parallel change is overwritten. Read-only snapshot app/database container IDs, image labels, health/restarts, networks, volumes, current release link, active Meta assignment statuses, webhook activity, and all non-app containers.

- [ ] **Step 4: Back up, migrate, and deploy app-only**

Create/validate a new backup under `/srv/backups/example-app`, preserve prior immutable image, deploy `202608250003_conversation_template_initiations` once, atomically switch to `/opt/apps/example-app/releases/<candidate-sha>`, update only `XP_WHATSAPP_IMAGE`, and recreate only service `app`. Verify PostgreSQL container `4804d7dee603` and the non-app snapshot are unchanged.

- [ ] **Step 5: Controlled production acceptance**

Use one user-approved controlled contact of type **Equipe XP** outside the 24-hour window. Record consent with a truthful non-sensitive source, open **Iniciar contato**, select **Equipe XP**, verify final text/name/language/category, and confirm once. Assert one initiation row, one outbound template message, one provider message ID, `SENT`, `awaitingCustomerSince` set, composer still blocked, and all sessions show **Aguardando cliente**. Reply once from that controlled WhatsApp number and assert inbound echo appears, the 24-hour window opens, awaiting state clears, and free-form becomes available in all sessions.

- [ ] **Step 6: Negative production checks and soak**

Without sending, inspect one no-consent contact, one wrong-type contact, and one pending-inbound conversation to confirm their correct action/state. Confirm no legacy contact was backfilled, no bulk endpoint exists, no Graph/token/phone/consent note appears in logs/SSE, app/database healthy, zero restarts/OOM, webhooks/cellphone echoes/audio/media unaffected, and three 20-second soak samples contain no fatal/unhandled/migration/5xx markers.

- [ ] **Step 7: Record rollback and commit verification**

Document candidate SHA/image ID, prior image, backup/manifest/hash, migrations, test totals, browser evidence, sanitized template assignments/categories, controlled consent source, initiation/message IDs, before/after state, provider-call count, non-app diff, soak, and exact app-only rollback command. Database rollback is forward-fix: the additive table/enums remain if the prior app image is restored.

```powershell
git add docs/verification/2026-08-25-proactive-template-contact-release.md
git commit -m "docs: verify proactive WhatsApp contact release"
```
