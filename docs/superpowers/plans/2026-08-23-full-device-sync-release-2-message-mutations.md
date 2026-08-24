# Full Device Sync — Release 2: Message Edits and Revokes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline. Do not use subagents. Complete and deploy Release 1 before starting this plan.

**Goal:** Synchronize future message edits and deletions from both incoming WhatsApp messages and official-app echoes, with an auditable internal revision trail and WhatsApp-like current-state rendering.

**Approved design:** [`docs/superpowers/specs/2026-08-23-whatsapp-full-device-sync-design.md`](../specs/2026-08-23-whatsapp-full-device-sync-design.md)

**Architecture:** Normalize provider mutations into one discriminated event, reconcile them transactionally against the original WAMID, store one immutable `MessageRevision` per provider event, update only the current message body/content/search projection, and broadcast a safe message update. Revision history remains server-internal; API/UI expose only `editedAt`, `revokedAt`, and current content.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL 18, Vitest, Meta WhatsApp Cloud API.

## Non-negotiable release rules

- No subagents; execute inline in an isolated clean worktree.
- Before implementation and again immediately before production build, audit all worktrees and production. Preserve dirty parallel work; integrate only explicit commits and retest the composed tree.
- Release 1 must be live and healthy. Graph remains v23; subscription remains unchanged.
- Migrations are additive and forward-compatible. Backup before migration; deploy app-only.
- Do not invent old edited text. The five previously observed edit controls remain unreconstructable unless a later official history payload supplies current content.

---

### Task 1: Audit and establish mutation fixtures

**Files:**
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-2.md`

- [ ] **Step 1: Run the complete worktree/production audit from Release 1**

Use the ledger procedure from Release 1 Task 1. Explicitly check the previously dirty media/PDF-thumbnail worktree and every newer worktree. Integrate completed relevant commits only; never copy uncommitted files.

- [ ] **Step 2: Add sanitized provider-shaped fixtures**

Add fixtures for inbound `messages` edit, inbound revoke, `smb_message_echoes` edit containing final text/caption, echo revoke, duplicate delivery, older edit, equal-timestamp provider-ID tie, malformed mutation, missing target, and wrong-contact target. Keep payload keys/provider nesting faithful to captured official docs/test webhook samples, but use synthetic WAMIDs/phones/content.

### Task 2: Add the immutable message revision model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230003_message_mutations/migration.sql`
- Create: `src/modules/messages/mutations.test.ts`

**Interfaces:**
- Add enum `MessageRevisionAction { EDIT REVOKE }`.
- Add `Message.editedAt DateTime?`, `Message.lastMutationAt DateTime?`, and relation `revisions`.
- Add `MessageRevision(id, messageId, providerEventId unique, action, providerTimestamp, previousBody, previousContent, createdAt)`.

- [ ] **Step 1: Write the failing schema contract**

```ts
expect(schema).toContain("enum MessageRevisionAction");
expect(schema).toContain("editedAt");
expect(schema).toContain("lastMutationAt");
expect(schema).toContain("model MessageRevision");
expect(schema).toContain("providerEventId");
```

Also assert the migration uses nullable message columns, a unique provider event ID, cascade from revision to message, timestamp indexes, and no destructive alteration of existing messages.

- [ ] **Step 2: Verify RED, implement schema/migration, and regenerate**

Run `npx vitest run src/modules/messages/mutations.test.ts`, then add:

```prisma
enum MessageRevisionAction {
  EDIT
  REVOKE
}

model MessageRevision {
  id                String                @id @default(uuid()) @db.Uuid
  messageId         String                @map("message_id") @db.Uuid
  providerEventId   String                @unique @map("provider_event_id")
  action            MessageRevisionAction
  providerTimestamp DateTime              @map("provider_timestamp") @db.Timestamptz(3)
  previousBody      String?               @map("previous_body")
  previousContent   Json?                 @map("previous_content")
  createdAt         DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  message           Message               @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId, providerTimestamp, providerEventId])
  @@map("message_revisions")
}
```

Run `npm run db:generate && npm run db:validate`, apply all migrations to disposable PostgreSQL 18, rerun the contract, and commit.

### Task 3: Normalize edits and revokes from both webhook surfaces

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`

**Interfaces:**
- Replace `NormalizedMessageEchoControlEvent` with unified `NormalizedMessageMutationEvent`:

```ts
export type NormalizedMessageMutationEvent = {
  kind: "messageMutation";
  action: "EDIT" | "REVOKE";
  providerEventId: string;
  originalWhatsappMessageId: string;
  timestamp: Date;
  timestampRaw: string;
  body: string | null;
  content: MessageContent | null;
  identity: { phone: string | null; whatsappUserId: string | null };
  origin: "CONTACT" | "WHATSAPP_BUSINESS_APP";
};
```

- [ ] **Step 1: Write failing normalization tests**

Prove both webhook surfaces emit the same event shape; EDIT requires current supported text/content; REVOKE carries no replacement content; inbound edit no longer becomes `UNSUPPORTED`; malformed mutation is quarantined; identity, timestamp, and original WAMID are mandatory.

- [ ] **Step 2: Verify RED, implement strict normalization, verify GREEN**

Use small provider-specific extractors but a shared mutation constructor. Preserve current message/reaction/contact normalization. Run `npx vitest run src/modules/webhooks/normalize.test.ts` and commit.

### Task 4: Reconcile mutations transactionally and idempotently

**Files:**
- Create: `src/modules/messages/mutations.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/events.test.ts`

**Interfaces:**
- Add repository method `applyMessageMutation(input): Promise<"APPLIED" | "IGNORED" | "MISSING">`.
- Add realtime event `{ type: "message.updated"; conversationId; messageId }`.

- [ ] **Step 1: Write failing reconciliation tests**

Cover edit/revoke in either direction; immutable previous content snapshot; duplicate provider ID; older event ignored; equal timestamps ordered by provider event ID; edit after revoke ignored; repeated revoke ignored; wrong conversation/contact quarantined; missing recent target retries, stale missing target completes safely; edit updates `searchText`; revoke replaces current searchable/display state with tombstone; no response/read state changes.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/realtime/events.test.ts
```

- [ ] **Step 3: Implement compare-and-apply inside the webhook transaction**

Lock the target message. Compare `(providerTimestamp, providerEventId)` to `lastMutationAt` plus the latest revision ID. Create `MessageRevision` before changing current fields. For EDIT, set body/content/searchText/editedAt/lastMutationAt. For REVOKE, set `body = null`, `content = Prisma.JsonNull` as appropriate, `searchText = "mensagem apagada"`, `revokedAt`, and `lastMutationAt`. Never delete media bytes or revision rows during revoke.

- [ ] **Step 4: Complete event and publish only after commit**

Use dedup key `message-mutation:<providerEventId>`. Publish one `message.updated` only for `APPLIED`; duplicate/older events publish nothing. Rerun focused tests and commit.

### Task 5: Expose only current mutation state and render it safely

**Files:**
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/message-search/text.ts`
- Modify: `src/modules/message-search/text.test.ts`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/quoted-reply-preview.tsx`
- Modify: `src/components/inbox/quoted-reply-preview.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Add `editedAt: string | null` to `MessageDto`/records; retain `revokedAt`.
- Do not expose `MessageRevision` or prior content through conversation/search APIs.

- [ ] **Step 1: Write failing DTO/search/UI tests**

Assert edited current content is returned/searchable and shows the subtle label `editada`; revoked message shows only `Mensagem apagada`, hides media/body/rich content/reactions/reply action, and is not retriable; a quote targeting a revoked message shows an unavailable/deleted preview; realtime `message.updated` refreshes the target in both sessions.

- [ ] **Step 2: Implement current-state mapping and WhatsApp-like presentation**

Add `editedAt` to Prisma selects and mappers. In `MessageBubble`, branch on `revokedAt` before `MessageMedia`, `MessageRichContent`, and body. Render `editada` beside time without exposing audit history. Update fixtures in all affected tests explicitly.

- [ ] **Step 3: Verify focused UI/service suites and commit**

Run conversation, search, bubble, quote, realtime, and inbox hook suites plus lint/typecheck.

### Task 6: Full gates, worktree re-audit, and incremental deploy

**Files:**
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-2.md`

- [ ] **Step 1: Run full local, disposable-DB, Linux, build, and audit gates**

Run `db:generate`, `db:validate`, all tests, lint, typecheck, build, production dependency audit, `git diff --check`, migrations from zero, and concurrency/redelivery fixtures.

- [ ] **Step 2: Repeat the complete worktree audit immediately before build**

If another worktree changed since Task 1, classify/integrate/preserve it, rerun affected/full tests, and repeat until the exact release tree is clean. Commit, archive, and build from the same full SHA.

- [ ] **Step 3: Back up, migrate, and deploy app-only**

Validate a new backup; apply only the additive mutation migration; recreate only `xp-whatsapp-app`; keep Graph v23/subscription/DB/Caddy/other systems unchanged; promote after health and rollback on failure.

- [ ] **Step 4: Verify production**

Require healthy/restarts/log/auth/migration/container invariants and manually test one future official-app edit and revoke using a controlled conversation. Verify two sessions update, current search changes, no old content leaks in API/UI, revision rows exist internally, and no read/response state regresses. Do not claim reconstruction of pre-release edits. Commit sanitized evidence.

## Self-review checklist

- [ ] Both inbound messages and official-app echoes normalize through one mutation contract.
- [ ] Provider redelivery/ordering is deterministic and one revision exists per provider event.
- [ ] Prior content is internal only.
- [ ] Revoke is a tombstone, not destructive media/audit deletion.
- [ ] Worktree audit and app-only exact-SHA deployment gates are explicit.
