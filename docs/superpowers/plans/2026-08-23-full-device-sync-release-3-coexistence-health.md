# Full Device Sync — Release 3: Coexistence Health and Safe Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline. Do not use subagents. Release 2 must already be live and verified.

**Goal:** Give administrators a trustworthy view of WhatsApp coexistence health, process connection lifecycle signals, and stop panel sends when the business app is known disconnected.

**Approved design:** [`docs/superpowers/specs/2026-08-23-whatsapp-full-device-sync-design.md`](../specs/2026-08-23-whatsapp-full-device-sync-design.md)

**Architecture:** Persist one sanitized state row per configured phone number, updated from Meta lifecycle webhooks and successful sync activity. Read this state at send admission time. Expose an admin-only health endpoint/page with status, last successful activity, initial-sync progress, and safe failure summary. Treat `UNKNOWN` as observable but not blocked; block only authoritative `DISCONNECTED`.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL 18, Zod, Vitest, Meta Graph API.

## Non-negotiable release rules

- Inline execution only; no subagents.
- Audit all worktrees before implementation and immediately before build. Preserve dirty work and compose completed commits deliberately.
- Re-check current official Meta coexistence/quality-alert documentation before coding; use only primary Meta documentation and record URLs/date in verification evidence.
- Do not change `META_GRAPH_VERSION` merely because v26 responds to a read-only probe. Keep v23 unless the explicit compatibility gates in Task 7 pass.
- Never expose access tokens, raw webhook bodies, WAMIDs, phones, contact content, or Graph response bodies in health state/API/UI/logs.
- Backup, additive migration, exact-SHA archive, app-only deploy.

---

### Task 1: Audit parallel work and refresh official Meta contracts

**Files:**
- Create: `docs/verification/2026-08-23-meta-coexistence-contract.md`
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-3.md`

- [ ] **Step 1: Run the worktree and production ledger procedure**

Repeat Release 1 Task 1 against every registered worktree and the current production SHA. Release 2 must be healthy with no mutation backlog/failures before proceeding.

- [ ] **Step 2: Verify official lifecycle and unsupported-operation contracts**

Using current Meta primary documentation, confirm and capture sanitized fixtures for `account_update` statuses `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`, coexistence unsupported error code `131060`, quality/phone status fields, and the exact webhook fields available to the app. Mark any doc/payload ambiguity as a test fixture quarantine case rather than guessing.

- [ ] **Step 3: Record v23/v26 read-only compatibility baseline**

With the production token kept out of command output, compare the exact read-only WABA/phone/subscription fields used by the application under v23 and v26. Do not send, subscribe, offboard, or update configuration in this task.

### Task 2: Add the singleton coexistence state model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230004_whatsapp_coexistence_state/migration.sql`
- Create: `src/modules/whatsapp/coexistence-state.test.ts`

**Interfaces:**
- Add enum `WhatsAppConnectionStatus { UNKNOWN CONNECTED DISCONNECTED RECONNECTING }`.
- Add enum `WhatsAppInitialSyncStatus { NOT_REQUESTED PENDING SUCCEEDED FAILED }`.
- Add model `WhatsAppCoexistenceState` unique by `phoneNumberId`.

- [ ] **Step 1: Write the failing schema contract**

Require fields:

```prisma
phoneNumberId            String  @unique @map("phone_number_id")
connectionStatus        WhatsAppConnectionStatus @default(UNKNOWN)
lastConnectedAt         DateTime? @db.Timestamptz(3)
lastDisconnectedAt      DateTime? @db.Timestamptz(3)
lastWebhookActivityAt   DateTime? @db.Timestamptz(3)
lastConnectionEventAt  DateTime? @db.Timestamptz(3)
lastMessageEchoAt       DateTime? @db.Timestamptz(3)
lastContactSyncAt       DateTime? @db.Timestamptz(3)
lastHistorySyncAt       DateTime? @db.Timestamptz(3)
lastFailureCode         String?
lastFailureSummary      String?
contactsSyncStatus      WhatsAppInitialSyncStatus @default(NOT_REQUESTED)
historySyncStatus       WhatsAppInitialSyncStatus @default(NOT_REQUESTED)
historyCutoverAt        DateTime? @db.Timestamptz(3)
updatedAt               DateTime @updatedAt
```

Use no raw JSON payload column. Validate additive DDL and singleton uniqueness.

- [ ] **Step 2: Implement, generate, migrate disposable PostgreSQL, and commit**

Run schema RED/GREEN, `npm run db:generate`, `npm run db:validate`, migrations from zero and upgrade from Release 2 snapshot.

### Task 3: Build a monotonic sanitized state service

**Files:**
- Create: `src/modules/whatsapp/coexistence-state.ts`
- Create: `src/modules/whatsapp/coexistence-state.integration.test.ts`
- Modify: `src/lib/env.ts`

**Interfaces:**
- `recordConnectionEvent(client, event)`
- `recordWebhookActivity(client, kind, timestamp)`
- `recordSyncStatus(client, sync, status, timestamp, safeFailure?)`
- `getCoexistenceHealth(phoneNumberId)`
- `assertPanelSendingAllowed(phoneNumberId)`

- [ ] **Step 1: Write failing service tests**

Cover singleton upsert; provider timestamp monotonicity; reconnect after disconnect; late disconnect ignored; successful `messageEcho` proves connected activity but does not overwrite a newer explicit disconnect; summaries are allowlisted/length-limited; unknown code becomes generic text; `UNKNOWN/CONNECTED/RECONNECTING` allow send; `DISCONNECTED` throws HTTP 409 with a safe Portuguese instruction.

- [ ] **Step 2: Implement state transitions**

Use an explicit transition table. Never concatenate provider messages into user-visible/logged summaries. Read the configured `META_PHONE_NUMBER_ID` from validated server env and always scope state reads/writes to that ID.

- [ ] **Step 3: Verify concurrency and commit**

Prove concurrent/duplicate events converge deterministically in PostgreSQL, then commit.

### Task 4: Normalize and process lifecycle/failure signals

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`

**Interfaces:**
- Add `NormalizedAccountUpdateEvent` with allowlisted status, provider timestamp, and phone/WABA identifier.
- Add `NormalizedCoexistenceFailureEvent` for code 131060 with sanitized operation category.

- [ ] **Step 1: Write failing normalizer/processor tests**

Assert known lifecycle statuses normalize; unknown statuses quarantine safely; 131060 never creates a chat message; duplicate lifecycle delivery is idempotent; every accepted webhook updates `lastWebhookActivityAt`; `messageEcho` updates `lastMessageEchoAt`; contact batches update `lastContactSyncAt`; state is committed in the same webhook transaction.

- [ ] **Step 2: Implement field admission and state recording**

Add `account_update` only if it is already in the live subscription/readback; otherwise parser support may ship dormant and subscription change requires a separate explicit approval. Never silently replace the 12-field set. Integrate state hooks without changing message/reaction/read behavior.

- [ ] **Step 3: Run webhook/state suites and commit**

### Task 5: Block unsafe panel sends without harming idempotency

**Files:**
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/reactions/service.ts`
- Modify: `src/modules/reactions/service.test.ts`
- Modify: `src/lib/public-error.ts`
- Modify: `src/lib/public-error.test.ts`

**Interfaces:**
- Admission occurs before creating a new pending message/reaction or consuming limiter/provider capacity.
- Existing idempotent requests remain readable/reconcilable even if state later becomes disconnected.

- [ ] **Step 1: Write failing sending tests**

Prove a new text/media/reaction send is rejected before local row/file/provider mutation when disconnected; UNKNOWN remains allowed; an existing `clientRequestId` returns its existing result before the disconnect guard; retry of an already-attempted uncertain outcome is not blindly repeated; public error says the official WhatsApp connection must be restored without leaking internals.

- [ ] **Step 2: Add `assertPanelSendingAllowed` at the correct admission boundary**

Perform idempotency lookup first, then guard only creation/new provider intent. Apply the same policy to reactions. Rerun service, route, limiter, recording, media and reaction tests.

### Task 6: Add the admin coexistence health screen

**Files:**
- Create: `src/app/api/settings/whatsapp-sync/route.ts`
- Create: `src/app/api/settings/whatsapp-sync/route.test.ts`
- Create: `src/app/configuracoes/whatsapp/page.tsx`
- Create: `src/app/configuracoes/whatsapp/page.test.tsx`
- Create: `src/app/configuracoes/whatsapp/loading.tsx`
- Create: `src/app/configuracoes/whatsapp/error.tsx`
- Create: `src/components/settings/whatsapp-sync-health-screen.tsx`
- Create: `src/components/settings/whatsapp-sync-health-screen.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`
- Modify: `src/components/settings/contact-classification-screen.tsx`
- Modify: `src/components/settings/contact-classification-screen.test.tsx`
- Modify: `src/components/settings/quick-replies-screen.tsx`
- Modify: `src/components/settings/quick-replies-screen.test.tsx`
- Modify: `src/components/users/users-screen.tsx`
- Modify: `src/components/users/users-screen.test.tsx`

**Interfaces:**
- Admin-only GET returns status, sanitized timestamps, initial-sync statuses, cutover, and safe failure summary.
- UI auto-refreshes conservatively and provides no destructive/offboard/re-onboard button.

- [ ] **Step 1: Write failing authorization/API/UI tests**

Cover 401 unauthenticated, 403 attendant, 200 admin, no secrets/raw IDs, UNKNOWN/connected/reconnecting/disconnected visual copy, stale-activity hint, contacts/history status, keyboard/mobile layout, and no action that mutates Meta.

- [ ] **Step 2: Implement a restrained operational screen**

Use existing settings layout and design tokens. Show `Conectado`, `Reconectando`, `Desconectado`, or `Sem confirmação`; last relevant activity; safe next action; contact/history sync status. Avoid green success when data is stale/unknown.

- [ ] **Step 3: Verify routes/components and commit**

### Task 7: Gate Graph v26 compatibility without automatic upgrade

**Files:**
- Create: `scripts/verify-meta-graph-compatibility.ps1`
- Create: `scripts/verify-meta-graph-compatibility.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write a safe verifier contract**

The verifier must accept token through environment only, never print it, perform only allowlisted read-only comparisons by default, redact IDs, and require an explicit `-AllowControlledSend` switch plus action-time approval for a controlled send/read/media check.

- [ ] **Step 2: Run v23/v26 gates**

Compare WABA/phone/subscription reads, webhook signature independence, text/media/reaction/read APIs in controlled test mode, error mapping and all app tests. If any gate differs, keep v23. Even if all pass, record a recommendation and request explicit approval before changing production env.

### Task 8: Full gates, re-audit, and incremental production deployment

**Files:**
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-3.md`

- [ ] **Step 1: Run complete local/disposable-DB/Linux/browser/build/security gates**

Include migration upgrade, lifecycle concurrency, disconnected send admission, admin authorization, all existing messaging/media/read/reaction regressions, lint/type/build/audit.

- [ ] **Step 2: Repeat the complete worktree audit immediately before build**

Classify every changed worktree since Task 1, compose explicit commits, preserve dirty work, rerun tests, and repeat until the exact release tree is clean.

- [ ] **Step 3: Build exact-SHA, back up, migrate, and deploy app-only**

Keep subscription and Graph version unchanged unless separately approved after Task 7. Verify image provenance, UID/secrets, backup, database/Caddy/unrelated identity, health, zero restarts, logs and rollback.

- [ ] **Step 4: Production acceptance**

Verify admin health in a real authenticated session, two-session messaging, official-app echo activity, safe state timestamps, and a simulated/test-fixture disconnected guard without disrupting the live number. Record exact migration/revision/image and sanitized evidence.

## Self-review checklist

- [ ] Only authoritative DISCONNECTED blocks new sends.
- [ ] Idempotent existing requests are reconciled before the guard.
- [ ] Health state and API contain no raw provider payload or secret identifiers.
- [ ] Graph v26 is evaluated, not silently enabled.
- [ ] Worktree and app-only deployment gates protect parallel and production work.
