# WhatsApp Contact Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any active attendant grant or revoke explicit WhatsApp messaging consent with required source, server timestamp, actor, and immutable audit history.

**Architecture:** Add an append-only consent event stream plus materialized current consent fields on `Contact`. Reuse the existing serializable contact transaction, same-origin route pattern, contact DTO reconciliation, and SSE invalidation; keep consent distinct from the existing opt-out restriction so clearing “não contatar” never silently restores permission.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Prisma 7.9.1, PostgreSQL 18, Zod 4.4.3, Vitest, Testing Library, SSE, Docker Compose.

## Global Constraints

- Work in `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\whatsapp-quoted-replies` on `codex/whatsapp-quoted-replies`.
- Execute only after the template-deletion alert release is deployed and verified.
- Follow TDD for every behavior change: RED, minimum GREEN, focused test twice, commit.
- Any active attendant may grant or revoke consent; actor ID and timestamp come only from the authenticated server context.
- Allowed sources are exactly `WHATSAPP`, `LOJA_FISICA`, `TELEFONE`, and `OUTRO`.
- `OUTRO` requires a trimmed 3–240 character note; other sources accept no note.
- Opt-out wins over consent. Setting “não contatar” revokes current consent in the same transaction and records both audit facts.
- Clearing opt-out leaves consent inactive until a new explicit grant.
- No existing contact receives consent by migration or backfill.
- This release stores and displays consent but does not yet add proactive template sending.
- Browser DTOs and SSE contain no token, Graph payload, phone identity beyond existing contact display, or hidden audit rows.
- Deploy with additive migration, verified backup, app-only replacement, and no changes to other KVM services.

---

## File Structure

- `prisma/schema.prisma`: consent enums, current contact fields, event model, and named user/contact relations.
- `prisma/migrations/202608250001_contact_messaging_consent/migration.sql`: additive enums, nullable current state, immutable event table, checks and indexes.
- `prisma/contact-messaging-consent-contract.test.ts`: additive migration, constraints, no-backfill, and audit relation contracts.
- `src/modules/contacts/schemas.ts`: strict grant/revoke discriminated union.
- `src/modules/contacts/types.ts`: repository records and safe consent DTO.
- `src/modules/contacts/service.ts`: serializable grant/revoke, opt-out precedence, and DTO mapping.
- `src/modules/contacts/service.test.ts`, `service.integration.test.ts`: business and PostgreSQL concurrency/audit tests.
- `src/app/api/contacts/[id]/messaging-consent/route.ts`: same-origin authenticated mutation.
- `src/app/api/contacts/[id]/messaging-consent/route.test.ts`: route contract and safe errors.
- `src/modules/conversations/types.ts`, `service.ts`: consent state in the existing contact DTO.
- `src/hooks/use-inbox.ts`, `use-inbox.test.tsx`: one in-flight mutation per contact and authoritative reconciliation.
- `src/components/inbox/contact-consent-control.tsx`: focused consent display/dialog.
- `src/components/inbox/contact-consent-control.test.tsx`: keyboard, source, note, revoke and error UI.
- `src/components/inbox/customer-panel.tsx`, `customer-panel.test.tsx`, `inbox-shell.tsx`: integrate the focused control without growing restriction logic further.
- `src/lib/public-error.ts`: stable consent error copy.
- `src/realtime-release.test.ts` or existing realtime tests: confirm ID-only `contact.updated` payload.
- `docs/verification/2026-08-25-contact-consent-release.md`: migration and production evidence.

### Task 1: Add additive consent persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608250001_contact_messaging_consent/migration.sql`
- Create: `prisma/contact-messaging-consent-contract.test.ts`

**Interfaces:**
- Produces enums `ContactMessagingConsentSource` and `ContactMessagingConsentAction`.
- Produces current fields on `Contact` and append-only `ContactMessagingConsentEvent`.
- Later tasks consume relation names `MessagingConsentGrantActor` and `ContactMessagingConsentActor`.

- [ ] **Step 1: Write the RED migration contract**

Create a contract that reads the migration and applies it to a disposable PostgreSQL database. Assert nullable current fields, no contact backfill, event foreign keys, indexes, and a consistency check:

```ts
expect(migration).toContain('CREATE TYPE "ContactMessagingConsentSource"');
expect(migration).toContain('ADD COLUMN "messaging_consent_granted_at" TIMESTAMPTZ(3)');
expect(migration).toContain('CREATE TABLE "contact_messaging_consent_events"');
expect(migration).toContain('contact_messaging_consent_current_consistency');
expect(migration).not.toMatch(/UPDATE\s+"?contacts"?/iu);
expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE/iu);
```

The database part must insert a legacy contact before migration and assert all four current consent columns remain null afterward.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run prisma/contact-messaging-consent-contract.test.ts
```

Expected: FAIL because schema and migration do not exist.

- [ ] **Step 3: Add the Prisma domain**

Add:

```prisma
enum ContactMessagingConsentSource {
  WHATSAPP
  LOJA_FISICA
  TELEFONE
  OUTRO
}

enum ContactMessagingConsentAction {
  GRANTED
  REVOKED
}

model ContactMessagingConsentEvent {
  id          String                        @id @default(uuid()) @db.Uuid
  contactId   String                        @map("contact_id") @db.Uuid
  actorUserId String                        @map("actor_user_id") @db.Uuid
  action      ContactMessagingConsentAction
  source      ContactMessagingConsentSource
  note        String?
  createdAt   DateTime                      @default(now()) @map("created_at") @db.Timestamptz(3)
  contact     Contact                       @relation(fields: [contactId], references: [id], onDelete: Cascade)
  actorUser   User                          @relation("ContactMessagingConsentActor", fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([contactId, createdAt])
  @@map("contact_messaging_consent_events")
}
```

Add these current fields to `Contact`:

```prisma
messagingConsentGrantedAt       DateTime?                      @map("messaging_consent_granted_at") @db.Timestamptz(3)
messagingConsentSource          ContactMessagingConsentSource? @map("messaging_consent_source")
messagingConsentGrantedByUserId String?                        @map("messaging_consent_granted_by_user_id") @db.Uuid
messagingConsentNote            String?                        @map("messaging_consent_note")
messagingConsentGrantedByUser   User?                          @relation("MessagingConsentGrantActor", fields: [messagingConsentGrantedByUserId], references: [id], onDelete: SetNull)
messagingConsentEvents          ContactMessagingConsentEvent[]
```

Add reverse relations to `User` for current grants and events. Write matching additive SQL with a check requiring timestamp, source, and actor to be all null or all present; require a note only for `OUTRO` and require it to be null for the other sources. Leave every legacy row null.

- [ ] **Step 4: Generate, validate, and run GREEN twice**

```powershell
npx prisma generate
npx prisma validate
npx vitest run prisma/contact-messaging-consent-contract.test.ts
```

Run the Vitest command twice. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/202608250001_contact_messaging_consent/migration.sql prisma/contact-messaging-consent-contract.test.ts src/generated/prisma
git commit -m "feat: add contact messaging consent storage"
```

### Task 2: Implement strict grant, revoke, and opt-out precedence

**Files:**
- Modify: `src/modules/contacts/schemas.ts`
- Modify: `src/modules/contacts/types.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Modify: `src/modules/contacts/service.integration.test.ts`

**Interfaces:**
- Produces `contactMessagingConsentSchema` and `setContactMessagingConsent(actor, contactId, input)`.
- Produces `ContactMessagingConsentDto` used by API and inbox hook.
- Extends the existing restriction transaction so `restricted=true` clears current consent and appends `REVOKED` exactly once.

- [ ] **Step 1: Write RED schema tests**

Add this discriminated union and test matrix expectation before implementation:

```ts
const grant = {
  action: "GRANT",
  source: "LOJA_FISICA",
} as const;
expect(contactMessagingConsentSchema.parse(grant)).toEqual(grant);
expect(() => contactMessagingConsentSchema.parse({ action: "GRANT", source: "OUTRO" })).toThrow();
expect(contactMessagingConsentSchema.parse({
  action: "GRANT",
  source: "OUTRO",
  note: "Autorização registrada no evento da loja",
})).toMatchObject({ source: "OUTRO" });
expect(contactMessagingConsentSchema.parse({ action: "REVOKE" })).toEqual({ action: "REVOKE" });
```

- [ ] **Step 2: Write RED service tests**

Cover: inactive actor, missing contact, first grant, idempotent identical grant, changed grant creates a second event, revoke, idempotent revoke, opt-out clearing a grant, and opt-in not restoring it. Assert server `now()` and actor ID override all client-controlled values.

- [ ] **Step 3: Run RED**

```powershell
npx vitest run src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts
```

Expected: FAIL because consent interfaces do not exist.

- [ ] **Step 4: Add strict schemas**

```ts
const consentNoteSchema = z.string().trim().min(3).max(240);
const consentSourceSchema = z.enum([
  ContactMessagingConsentSource.WHATSAPP,
  ContactMessagingConsentSource.LOJA_FISICA,
  ContactMessagingConsentSource.TELEFONE,
  ContactMessagingConsentSource.OUTRO,
]);

export const contactMessagingConsentSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("GRANT"),
    source: consentSourceSchema,
    note: consentNoteSchema.optional(),
  }).superRefine((value, context) => {
    if (value.source === ContactMessagingConsentSource.OUTRO && !value.note) {
      context.addIssue({ code: "custom", path: ["note"], message: "Informe a origem da autorização" });
    }
    if (value.source !== ContactMessagingConsentSource.OUTRO && value.note !== undefined) {
      context.addIssue({ code: "custom", path: ["note"], message: "Observação não permitida para esta origem" });
    }
  }),
  z.strictObject({ action: z.literal("REVOKE") }),
]);
```

- [ ] **Step 5: Add repository and DTO contracts**

Extend `ContactRecord` with current grant and actor selection, add lock/update/create-event methods, and return:

```ts
export type ContactMessagingConsentDto = {
  active: boolean;
  source: ContactMessagingConsentSource | null;
  grantedAt: string | null;
  grantedBy: { id: string; name: string } | null;
  note: string | null;
};
```

Implement `setContactMessagingConsent` inside `runContactRepositoryTransaction`: lock contact, require active actor, refuse grant while `messagingOptOutAt` is non-null with `409 WHATSAPP_CONTACT_OPTED_OUT`, compare current values for idempotence, update the four materialized fields with dependency `now()`, and append one immutable event.

- [ ] **Step 6: Make opt-out revoke consent atomically**

When `setContactMessagingRestriction(...restricted=true)` sees active consent, clear the four consent fields and append:

```ts
await transaction.createContactMessagingConsentEvent({
  contactId: parsedContactId,
  actorUserId: actor.id,
  action: ContactMessagingConsentAction.REVOKED,
  source: current.messagingConsentSource,
  note: current.messagingConsentNote,
});
```

Do this in the same serializable transaction as the restriction event. The `restricted=false` branch must not create or restore consent.

- [ ] **Step 7: Run GREEN twice**

```powershell
npx vitest run src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts
```

Expected: PASS twice.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/contacts/schemas.ts src/modules/contacts/types.ts src/modules/contacts/service.ts src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts
git commit -m "feat: audit contact messaging consent"
```

### Task 3: Expose a safe authenticated consent endpoint

**Files:**
- Create: `src/app/api/contacts/[id]/messaging-consent/route.ts`
- Create: `src/app/api/contacts/[id]/messaging-consent/route.test.ts`
- Modify: `src/lib/public-error.ts`

**Interfaces:**
- Consumes `contactMessagingConsentSchema` and `setContactMessagingConsent`.
- Produces `PUT /api/contacts/:id/messaging-consent` with the existing `{ data, error }` envelope.

- [ ] **Step 1: Write RED route tests**

Test same-origin rejection, unauthenticated user, invalid UUID, unknown fields, missing `OUTRO` note, grant success, revoke success, and stable `WHATSAPP_CONTACT_OPTED_OUT` propagation. Assert `publishRealtime` receives only:

```ts
{ type: "contact.updated", contactId }
```

- [ ] **Step 2: Run RED**

```powershell
npx vitest run 'src/app/api/contacts/[id]/messaging-consent/route.test.ts'
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route using the existing restriction pattern**

```ts
export function createContactMessagingConsentRouteHandlers(
  dependencies = defaultDependencies,
) {
  return {
    PUT: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const contactId = contactIdSchema.parse((await context.params).id);
        const input = contactMessagingConsentSchema.parse(await request.json());
        const result = await dependencies.setContactMessagingConsent(actor, contactId, input);
        dependencies.publishRealtime({ type: "contact.updated", contactId });
        return contactSuccessResponse(result);
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}
```

Add safe public copy: `Não foi possível salvar o consentimento. Confira os dados e tente novamente.`

- [ ] **Step 4: Run GREEN twice and commit**

```powershell
npx vitest run 'src/app/api/contacts/[id]/messaging-consent/route.test.ts'
git add src/app/api/contacts/[id]/messaging-consent/route.ts src/app/api/contacts/[id]/messaging-consent/route.test.ts src/lib/public-error.ts
git commit -m "feat: expose contact consent endpoint"
```

Expected: focused test passes twice before commit.

### Task 4: Carry authoritative consent through conversation DTOs and realtime refresh

**Files:**
- Modify: `src/modules/contacts/types.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Produces `contact.messagingConsent: ContactMessagingConsentDto` in list and detail responses.
- Produces hook action `setMessagingConsent(contactId, input): Promise<boolean>` and selected-contact pending/error state.

- [ ] **Step 1: Write RED DTO and hook tests**

Assert a granted contact maps to the exact safe DTO and a legacy contact maps to:

```ts
{
  active: false,
  source: null,
  grantedAt: null,
  grantedBy: null,
  note: null,
}
```

In the hook test, call `setMessagingConsent` twice before the first request resolves; assert one PUT, optimistic state is not invented, the authoritative envelope updates list/detail, then list/detail are refreshed. Test a `contact.updated` SSE event performs the same convergence.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/modules/conversations/service.test.ts src/hooks/use-inbox.test.tsx
```

Expected: FAIL on missing `messagingConsent` and hook action.

- [ ] **Step 3: Extend selections and DTO mapping**

Add the current grant actor to both contact selections and map with one shared-shaped helper:

```ts
messagingConsent: contact.messagingConsentGrantedAt &&
  contact.messagingConsentSource &&
  contact.messagingConsentGrantedByUser
  ? {
      active: contact.messagingOptOutAt === null,
      source: contact.messagingConsentSource,
      grantedAt: contact.messagingConsentGrantedAt.toISOString(),
      grantedBy: contact.messagingConsentGrantedByUser,
      note: contact.messagingConsentNote,
    }
  : { active: false, source: null, grantedAt: null, grantedBy: null, note: null },
```

- [ ] **Step 4: Implement one-in-flight hook mutation**

Follow `setMessagingRestriction`: keep `messagingConsentRequests`, pending contact ID, per-contact errors, PUT strict input, merge authoritative result into list/detail, then `Promise.all([refreshList(), fetchConversation(...)])`. Clear maps on unmount and return selected-contact state from the hook.

- [ ] **Step 5: Run GREEN twice and commit**

```powershell
npx vitest run src/modules/conversations/service.test.ts src/hooks/use-inbox.test.tsx
git add src/modules/contacts/types.ts src/modules/contacts/service.ts src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/conversations/service.test.ts src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: share contact consent state"
```

### Task 5: Add the focused mobile-friendly consent control

**Files:**
- Create: `src/components/inbox/contact-consent-control.tsx`
- Create: `src/components/inbox/contact-consent-control.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`

**Interfaces:**
- Consumes `conversation.contact.messagingConsent` and hook action/pending/error.
- Produces a compact status, grant dialog, revoke confirmation, and no template-send behavior.

- [ ] **Step 1: Write RED component tests**

Cover inactive copy, active source/date/actor, four source options, `OUTRO` note validation, grant payload, revoke payload, disabled double submit, server error, Escape/cancel focus restoration, and 390px layout without horizontal overflow.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run src/components/inbox/contact-consent-control.test.tsx src/components/inbox/customer-panel.test.tsx
```

Expected: FAIL because the control is missing.

- [ ] **Step 3: Implement `ContactConsentControl`**

Use existing `Button`, `Select`, `Input`, and `AlertDialog`. The callback is:

```ts
onChange: (
  contactId: string,
  input:
    | { action: "GRANT"; source: ContactMessagingConsentSource; note?: string }
    | { action: "REVOKE" },
) => Promise<boolean>;
```

Render exact source labels `WhatsApp`, `Loja física`, `Telefone`, `Outro`. Require the explicit confirmation button; do not auto-save on source selection. Show `Autorizado em <date> por <name>` only from authoritative DTO.

- [ ] **Step 4: Integrate into `CustomerPanel`**

Place consent above **Preferência de contato**. Keep restriction as a separate control and revise its unrestrict copy to clarify: `Remover a restrição não restaura consentimento; registre uma nova autorização acima.` Pass hook props through both desktop and mobile `CustomerPanel` instances in `inbox-shell.tsx`.

- [ ] **Step 5: Run GREEN twice, React quality checks, and commit**

```powershell
npx vitest run src/components/inbox/contact-consent-control.test.tsx src/components/inbox/customer-panel.test.tsx src/hooks/use-inbox.test.tsx
npm run typecheck
npm run lint
git add src/components/inbox/contact-consent-control.tsx src/components/inbox/contact-consent-control.test.tsx src/components/inbox/customer-panel.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/inbox-shell.tsx
git commit -m "feat: manage consent from contact panel"
```

Expected: all pass. Apply the `vercel:react-best-practices` checklist after the TSX edits and fix any material issue before commit.

### Task 6: Verify and deploy the consent-only release

**Files:**
- Create: `docs/verification/2026-08-25-contact-consent-release.md`

**Interfaces:**
- Produces the additive migration and consent UI in production while proactive sending remains unavailable.

- [ ] **Step 1: Run full local and artifact gates**

Run Prisma validate/generate, migration-from-empty and idempotence tests, focused consent tests, full Vitest, lint, typecheck, build, production config/Compose/KVM verifiers, audit, and exact Linux/amd64 image smoke. Expected: all exit `0` with no high vulnerabilities.

- [ ] **Step 2: Browser acceptance before deploy**

With an authenticated local admin/attendant fixture, verify desktop and 390×844: source selection, `OUTRO` note, cancel, grant, authoritative date/actor, revoke, restriction precedence, no console errors, and no proactive-send button in this release.

- [ ] **Step 3: Parallel audit, backup, and app-only rollout**

Repeat the established production preflight immediately before backup and rollout. Create/validate backup under `/srv/backups/example-app`, preserve prior image, apply migration exactly once, and recreate only `xp-whatsapp-app` from immutable `xp-whatsapp:<candidate-sha>`.

- [ ] **Step 4: Production acceptance**

On one controlled contact, grant consent with a non-sensitive source, verify the event/current row and cross-session UI, revoke it, verify a second event and inactive current state, then leave the contact in the user-approved final state. Confirm no legacy contact was backfilled, app/database healthy, database container unchanged, non-app snapshot unchanged, zero restarts, webhooks and cellphone echoes unaffected, and three soak samples clean.

- [ ] **Step 5: Commit the verification report**

```powershell
git add docs/verification/2026-08-25-contact-consent-release.md
git commit -m "docs: verify contact consent release"
```
