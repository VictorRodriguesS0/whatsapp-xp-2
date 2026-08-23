# Shared Pinned Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unlimited company-wide conversation pinning, with shared persistence, stable pagination, optimistic controls, realtime synchronization, and a production rollout.

**Architecture:** Store an optional `pinnedAt` timestamp on `Conversation` and include it in the keyset cursor. A dedicated authenticated mutation writes the shared state and publishes the existing `conversation.updated` realtime event. The inbox applies the mutation optimistically, then reconciles with the API and normal list refresh path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7/PostgreSQL, Zod 4, Vitest/Testing Library, SSE realtime hub, Docker Compose on the KVM.

## Global Constraints

- There is no limit on the number of pinned conversations.
- Pin state is company-wide and identical for attendants and administrators.
- Pinned conversations sort first; pinned rows use descending `pinnedAt`; unpinned rows retain descending `lastMessageAt`; IDs provide stable tie-breaking.
- Pinning an already pinned conversation is idempotent and must not change its position.
- The UI must remain operable without hover on mobile.
- Mutations are optimistic, per-conversation conflicts are blocked, and failures restore server state with a public error.
- The migration is additive and nullable; existing conversations start unpinned.
- No subagents are used, per the user's explicit instruction.
- Before production deployment, integrate concurrent work without overwriting it and recreate only `xp-whatsapp-app`.

---

## File Structure

- Modify `prisma/schema.prisma`: add the shared timestamp and index.
- Create `prisma/migrations/202608230001_pinned_conversations/migration.sql`: additive production migration.
- Modify `src/modules/conversations/schemas.ts`: pin payload and cursor contract.
- Modify `src/modules/conversations/types.ts`: DTO, record, cursor, query, and repository contracts.
- Modify `src/modules/conversations/service.ts`: stable pinned ordering, cursor encoding, mutation service, and Prisma repository methods.
- Modify `src/modules/conversations/service.test.ts`: service and keyset-pagination behavior.
- Modify `src/modules/conversations/service.integration.test.ts`: PostgreSQL ordering and idempotent mutation coverage.
- Create `src/app/api/conversations/[id]/pin/route.ts`: authenticated mutation endpoint and realtime publish.
- Create `src/app/api/conversations/[id]/pin/route.test.ts`: endpoint authorization, validation, success, and failure tests.
- Modify `src/lib/public-error.ts`: safe pinning error copy.
- Modify `src/hooks/use-inbox.ts`: optimistic mutation, rollback/reconciliation, and exposed state.
- Modify `src/hooks/use-inbox.test.tsx`: optimistic, duplicate-action, success, failure, and realtime tests.
- Modify `src/components/inbox/conversation-list.tsx`: accessible pin/unpin action and persistent indicator.
- Modify `src/components/inbox/conversation-list.test.tsx`: desktop/mobile-independent controls and event isolation.
- Modify `src/components/inbox/inbox-shell.tsx`: connect hook state/actions to the list.
- Modify `src/components/inbox/inbox-shell.test.tsx`: integration wiring.
- Create `docs/verification/2026-08-23-pinned-conversations.md`: verification and sanitized production evidence.

---

### Task 1: Persist and paginate shared pin state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230001_pinned_conversations/migration.sql`
- Modify: `src/modules/conversations/schemas.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Test: `src/modules/conversations/service.test.ts`
- Test: `src/modules/conversations/service.integration.test.ts`

**Interfaces:**
- Produces: `ConversationListItem.pinnedAt: string | null`.
- Produces: `ConversationCursor = { pinnedAt: Date | null; lastMessageAt: Date; id: string }`.
- Produces: `PinnedConversationStateDto = { conversationId: string; pinnedAt: string | null; revision: string }`.

- [ ] **Step 1: Write failing service tests for ordering and cursor boundaries**

Add tests that create pinned and unpinned records, request pages smaller than the fixture set through a repository harness, and assert this exact order:

```ts
expect(allPages.map(({ id }) => id)).toEqual([
  "pinned-new",
  "pinned-old",
  "regular-new",
  "regular-old",
]);
expect(new Set(allPages.map(({ id }) => id)).size).toBe(allPages.length);
```

Also assert that a decoded cursor carries `pinnedAt`, `lastMessageAt`, and `id`, and that a legacy/malformed cursor is rejected with `HttpError(400, "Cursor inválido")`.

- [ ] **Step 2: Run the focused service tests and verify RED**

Run: `npm test -- src/modules/conversations/service.test.ts`

Expected: FAIL because `pinnedAt` is absent and the list remains ordered only by `lastMessageAt`.

- [ ] **Step 3: Write a failing PostgreSQL integration test**

Create four conversations with crossed message/pin times and assert the Prisma-backed repository returns pinned rows first across a page boundary. Skip only through the repository's existing `TEST_DATABASE_URL` guard; never point the test at production.

- [ ] **Step 4: Run the integration test and verify RED**

Run: `$env:NODE_ENV='test'; npm test -- src/modules/conversations/service.integration.test.ts`

Expected: FAIL because the database schema and generated client do not expose `pinnedAt`.

- [ ] **Step 5: Add the nullable field and additive index migration**

Add to `Conversation`:

```prisma
pinnedAt DateTime? @map("pinned_at") @db.Timestamptz(3)

@@index([pinnedAt, lastMessageAt, id], map: "conversations_pinned_queue_idx")
```

Create migration SQL:

```sql
ALTER TABLE "conversations"
ADD COLUMN "pinned_at" TIMESTAMPTZ(3);

CREATE INDEX "conversations_pinned_queue_idx"
ON "conversations"("pinned_at" DESC, "last_message_at" DESC, "id" DESC);
```

- [ ] **Step 6: Extend types, selection, DTO conversion, cursor encoding, and cursor parsing**

Use the cursor JSON shape:

```ts
{
  pinnedAt: record.pinnedAt?.toISOString() ?? null,
  lastMessageAt: record.lastMessageAt.toISOString(),
  id: record.id,
}
```

Use Zod to accept `pinnedAt: z.iso.datetime({ offset: true }).nullable()` and map it back to `Date | null`.

- [ ] **Step 7: Implement stable Prisma ordering and keyset predicates**

Use this order:

```ts
orderBy: [
  { pinnedAt: { sort: "desc", nulls: "last" } },
  { lastMessageAt: "desc" },
  { id: "desc" },
]
```

For a pinned cursor, admit older non-null pin timestamps, all null pin timestamps, and exact-pin ties ordered by message time/ID. For an unpinned cursor, restrict to `pinnedAt: null` and continue by message time/ID. This explicit null branch prevents SQL null comparison from dropping regular conversations.

- [ ] **Step 8: Generate Prisma artifacts and verify GREEN**

Run:

```powershell
npm run db:generate
npm run db:validate
npm test -- src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts
```

Expected: Prisma validation succeeds and both suites pass when the disposable test database is configured.

- [ ] **Step 9: Commit the persistence and pagination slice**

```powershell
git add prisma src/modules/conversations
git commit -m "feat: persist shared conversation pins"
```

---

### Task 2: Add the idempotent authenticated mutation and realtime event

**Files:**
- Modify: `src/modules/conversations/schemas.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Test: `src/modules/conversations/service.test.ts`
- Create: `src/app/api/conversations/[id]/pin/route.ts`
- Create: `src/app/api/conversations/[id]/pin/route.test.ts`

**Interfaces:**
- Consumes: `PinnedConversationStateDto` from Task 1.
- Produces: `pinConversationSchema = z.strictObject({ pinned: z.boolean() })`.
- Produces: `setConversationPinned(userId: string, conversationId: string, pinned: boolean, repository?: ConversationRepository, now?: () => Date): Promise<PinnedConversationStateDto>`.
- Produces: `PATCH /api/conversations/:id/pin` with body `{ "pinned": true | false }`.

- [ ] **Step 1: Write failing service tests for pin, unpin, idempotency, and absence**

Assert that the first pin stores the injected server clock, a second pin returns the existing timestamp without calling update, unpin stores `null`, and a missing conversation throws `HttpError(404, "Conversa não encontrada")`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/modules/conversations/service.test.ts`

Expected: FAIL because `setConversationPinned` and repository pin methods do not exist.

- [ ] **Step 3: Implement the transactional service**

Add repository methods with these signatures:

```ts
findPinState(conversationId: string): Promise<{
  id: string;
  pinnedAt: Date | null;
  updatedAt: Date;
} | null>;
updatePinnedAt(conversationId: string, pinnedAt: Date | null): Promise<{
  id: string;
  pinnedAt: Date | null;
  updatedAt: Date;
}>;
```

In a serializable transaction, return the current record when its boolean state already matches the request; otherwise update with `pinned ? now() : null`. Convert timestamps to ISO strings only at the service boundary.

- [ ] **Step 4: Verify the service tests are GREEN**

Run: `npm test -- src/modules/conversations/service.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Cover same-origin enforcement, authenticated actor lookup, lowercase UUID normalization, strict boolean validation, successful envelope, `404`, safe `500`, and this exact realtime event:

```ts
expect(events).toEqual([{
  type: "conversation.updated",
  conversationId,
  revision: state.revision,
}]);
```

- [ ] **Step 6: Run route tests and verify RED**

Run: `npm test -- "src/app/api/conversations/[id]/pin/route.test.ts"`

Expected: FAIL because the route does not exist.

- [ ] **Step 7: Implement the route with existing guards and envelopes**

The handler must call `assertSameOrigin(request)`, `requireUser()`, parse the route UUID and `{ pinned }`, invoke `setConversationPinned(actor.id, id, pinned)`, publish `conversation.updated`, and return `conversationSuccessResponse(state)`.

- [ ] **Step 8: Run service and route tests and verify GREEN**

Run: `npm test -- src/modules/conversations/service.test.ts "src/app/api/conversations/[id]/pin/route.test.ts"`

Expected: PASS.

- [ ] **Step 9: Commit the mutation slice**

```powershell
git add src/modules/conversations src/app/api/conversations
git commit -m "feat: expose shared conversation pinning"
```

---

### Task 3: Add optimistic inbox state with safe reconciliation

**Files:**
- Modify: `src/lib/public-error.ts`
- Modify: `src/hooks/use-inbox.ts`
- Test: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/conversations/:id/pin` and `PinnedConversationStateDto`.
- Produces from `useInbox`: `setPinned(conversationId: string, pinned: boolean): Promise<void>`, `pinPendingIds: Set<string>`, and `pinError: string | null`.

- [ ] **Step 1: Write failing optimistic-state tests**

Assert that pinning immediately moves a row above regular rows before fetch resolves, unpinning immediately restores last-message order, a duplicate action returns the same in-flight promise, success applies the server timestamp/revision, and failure calls `refreshList()` and exposes “Não foi possível atualizar a fixação da conversa.”

- [ ] **Step 2: Run hook tests and verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx`

Expected: FAIL because `setPinned`, pending state, and pin error are absent.

- [ ] **Step 3: Add the public error operation**

Extend `PublicErrorOperation` with `"pin"` and map it to:

```ts
pin: "Não foi possível atualizar a fixação da conversa.",
```

- [ ] **Step 4: Implement the optimistic mutation**

Maintain a `Map<string, Promise<void>>` for in-flight requests. Update both `conversations` and the selected `conversation` using a shared helper that replaces `pinnedAt` and `revision`, then sorts with the server contract. On failure, refresh from the server rather than trusting an obsolete snapshot; clear pending state only when the component remains mounted.

- [ ] **Step 5: Reconcile realtime updates**

Keep the existing `conversation.updated` branch as the cross-session source of truth. Confirm the initiating client tolerates both its response and the subsequent event without duplicate rows or selection loss.

- [ ] **Step 6: Run hook and realtime tests and verify GREEN**

Run: `npm test -- src/hooks/use-inbox.test.tsx src/hooks/use-realtime.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the client-state slice**

```powershell
git add src/lib/public-error.ts src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: sync conversation pins in the inbox"
```

---

### Task 4: Add accessible pin and unpin controls

**Files:**
- Modify: `src/components/inbox/conversation-list.tsx`
- Test: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Test: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: `ConversationListItem.pinnedAt`, `setPinned`, `pinPendingIds`, and `pinError`.
- Adds to `ConversationListProps`: `onSetPinned`, `pinPendingIds`, and `pinError`.

- [ ] **Step 1: Write failing list component tests**

Render one pinned and one regular conversation. Assert the pinned row has a persistent pin indicator, actions are named “Desfixar conversa de Carlos” and “Fixar conversa de Bia”, clicking the action does not call `onSelect`, and the pending action is disabled with an accessible busy label.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm test -- src/components/inbox/conversation-list.test.tsx`

Expected: FAIL because no pin controls are rendered.

- [ ] **Step 3: Implement sibling controls without nested buttons**

Import `Pin` from `lucide-react`. Keep the conversation-select button and pin action as sibling buttons inside a `group relative` list item. Use `aria-pressed={Boolean(item.pinnedAt)}`, an explicit action label containing the contact name, and `onClick={() => onSetPinned(item.id, !item.pinnedAt)}`. The control is always visible below the desktop breakpoint and may use opacity transitions only on larger viewports.

- [ ] **Step 4: Display mutation errors without replacing the conversation list**

Render `pinError` as a compact `role="alert"` region above the list while keeping all rows usable.

- [ ] **Step 5: Wire the inbox shell and write its failing/passing test cycle**

First extend the shell test mock with `setPinned`, `pinPendingIds`, and `pinError`, assert the list action calls `setPinned(id, true)`, and run:

`npm test -- src/components/inbox/inbox-shell.test.tsx`

Verify RED, pass the three props from `useInbox` to `ConversationList`, rerun, and expect PASS.

- [ ] **Step 6: Run all focused UI tests and verify GREEN**

Run:

```powershell
npm test -- src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-inbox.test.tsx
```

Expected: PASS with no React accessibility or nested-interactive warnings.

- [ ] **Step 7: Commit the UI slice**

```powershell
git add src/components/inbox src/hooks src/lib/public-error.ts
git commit -m "feat: add shared pin controls to conversations"
```

---

### Task 5: Integrate, verify, deploy, and record evidence

**Files:**
- Create: `docs/verification/2026-08-23-pinned-conversations.md`
- Inspect: all changed source, migration, deployment files, active worktrees, and production release metadata.

**Interfaces:**
- Consumes: complete feature from Tasks 1–4.
- Produces: immutable candidate commit/image, additive migration applied once, healthy app-only deployment, and rollback metadata.

- [ ] **Step 1: Audit concurrent work before integration**

Run:

```powershell
git worktree list --porcelain
git status --short
git log --all --decorate -12 --oneline
git diff --check
```

Compare branch tips and changed paths. Merge or cherry-pick only reviewed commits; never overwrite a dirty worktree or unrelated user changes.

- [ ] **Step 2: Run the complete local verification gate**

Run:

```powershell
npm run db:generate
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
pwsh -NoProfile -File scripts/verify-compose.ps1
pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1
pwsh -NoProfile -File scripts/test-deployment.ps1
git diff --check
```

Expected: every command exits `0`; tests report zero failures; production dependency audit reports zero known vulnerabilities.

- [ ] **Step 3: Verify the migration on an isolated PostgreSQL database**

Start or reuse only a disposable database whose name ends in `_test`, apply all migrations, and run the integration suite. Assert `pinned_at` exists, the migration history is clean, and pinned pagination crosses the configured page boundary without duplicates.

- [ ] **Step 4: Commit the verified candidate and create immutable release metadata**

```powershell
git add .
git commit -m "feat: add shared pinned conversations"
git rev-parse HEAD
git status --short
```

Use the full commit SHA as the release directory and image tag. Do not use a mutable `latest` tag.

- [ ] **Step 5: Perform production preflight and backup**

On the KVM, resolve `/opt/apps/example-app`, `.env.production`, current release/image, app/database container IDs, non-app container snapshot, disk/memory availability, and migration status without printing secrets. Run the candidate's validated backup script:

```sh
"$CANDIDATE_RELEASE/scripts/backup.sh" /srv/backups/example-app --env-file "$ENV_FILE"
```

Require a verified database dump, media archive, checksums, and manifest before continuing.

- [ ] **Step 6: Build under explicit KVM resource limits and run an isolated candidate gate**

Build `xp-whatsapp:$CANDIDATE_REVISION` with no more than 2 GB memory and 3 GB memory-plus-swap, then start the candidate against an isolated PostgreSQL container/network. Run migrations, health, authenticated route tests, and the pin/unpin round trip there before touching production.

- [ ] **Step 7: Deploy app-only with the additive migration**

Use the canonical KVM Compose file from the candidate release. Stop and recreate only `xp-whatsapp-app` with `--no-deps --force-recreate --wait`; do not recreate PostgreSQL, Caddy, networks, volumes, or unrelated systems. The image entrypoint runs local `prisma migrate deploy` fail-fast before starting Next.js.

- [ ] **Step 8: Verify production behavior and invariants**

Require three spaced `/api/health` HTTP 200 samples, successful login, authenticated list response containing `pinnedAt`, pin and unpin mutations, a second-session realtime list update, clean migration status, no app/gateway 5xx, no sensitive-value log matches, and an unchanged non-app container snapshot.

- [ ] **Step 9: Record sanitized evidence and rollback target**

Write `docs/verification/2026-08-23-pinned-conversations.md` with candidate commit/image, backup path, migration count/status, health samples, pin/unpin/realtime results, app/database container invariants, unchanged non-app snapshot, and the prior compatible app image. Do not record access tokens, customer identifiers, payloads, or message content.

- [ ] **Step 10: Commit the verification record**

```powershell
git add docs/verification/2026-08-23-pinned-conversations.md
git commit -m "docs: record pinned conversations production verification"
```
