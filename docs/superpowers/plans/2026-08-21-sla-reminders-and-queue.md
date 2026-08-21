# SLA, Reminders, and Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prioritize unattended customers after 30 business minutes and let the team create durable, assigned, auditable reminders that bring conversations back to attention.

**Architecture:** Materialize `responseDueAt` and the earliest pending reminder on each conversation so the queue can be indexed and cursor-paginated without volatile jobs. Calculate business time on the server in `America/Sao_Paulo`; derive due state from database time, schedule precise browser refreshes with a periodic fallback, and serialize every reminder transition in PostgreSQL.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7, Prisma 7.9.1, PostgreSQL 18, Node `Intl.DateTimeFormat`, Vitest/Testing Library, SSE.

## Global Constraints

- Releases 0 and 1 must be deployed and verified first.
- SLA is 30 business minutes, Tuesday through Sunday, 09:00–17:30, `America/Sao_Paulo`; Monday is closed.
- There is no holiday/exception calendar in this version.
- Consecutive inbound messages never restart or postpone the first unanswered deadline.
- Any outbound staff message after the unanswered inbound clears SLA for the whole team.
- Reminders are durable, shared, assigned, and visible to all; the creator is the default assignee.
- Any active employee may complete, postpone, or cancel a reminder; every transition records its actor.
- A reminder never sends a WhatsApp message automatically.
- No correctness may depend solely on an in-process timer, browser timer, SSE delivery, or app uptime.
- Queue order is: due reminders, overdue response, unread, then remaining recent conversations.
- Every list cursor must be opaque, validated, bounded, and stable under equal timestamps.

---

## File Structure

- `prisma/schema.prisma`: `responseDueAt`, `nextReminderAt`, reminder/event enums and models.
- `prisma/migrations/202608210003_sla_and_reminders/migration.sql`: additive schema/backfill/indexes.
- `src/modules/sla/business-time.ts`: timezone-aware business-minute calculation.
- `src/modules/sla/business-time.test.ts`: boundary/table tests.
- `src/modules/conversations/shared-state.ts`: assign/preserve/clear SLA deadline with response state.
- `src/modules/reminders/types.ts`, `schemas.ts`, `service.ts`: reminder contracts and transitions.
- `src/modules/reminders/*.test.ts`: unit/PostgreSQL concurrency.
- `src/app/api/conversations/[id]/reminders/route.ts`: list/create.
- `src/app/api/reminders/[id]/**`: postpone/complete/cancel actions.
- `src/modules/conversations/types.ts`, `schemas.ts`, `service.ts`: queue filters, group/rank, versioned cursor.
- `src/app/api/conversations/route.ts`: filter query surface.
- `src/hooks/use-inbox.ts`: queue filters, due timers, reminder mutations, SSE reconciliation.
- `src/components/inbox/conversation-filters.tsx`: accessible filters.
- `src/components/inbox/conversation-list.tsx`: priority groups and SLA/reminder indicators.
- `src/components/inbox/reminder-panel.tsx`: create/list/operate reminders.
- `src/components/inbox/customer-panel.tsx`: reminder panel composition.
- `src/lib/public-error.ts`: safe reminder copy.

### Task 1: Implement Brasília business-time calculation

**Files:**
- Create: `src/modules/sla/business-time.ts`
- Create: `src/modules/sla/business-time.test.ts`

**Interfaces:**
- Produces `calculateResponseDueAt(receivedAt: Date): Date`.
- Produces `isWithinBusinessHours(instant: Date): boolean`.
- Exports constants `SLA_TIME_ZONE`, `SLA_MINUTES`, `OPEN_MINUTE`, and `CLOSE_MINUTE`.

- [ ] **Step 1: Write a RED table of exact cases**

```ts
it.each([
  ["2026-08-18T12:00:00.000Z", "2026-08-18T12:30:00.000Z"], // Tuesday 09:00 BRT
  ["2026-08-23T20:15:00.000Z", "2026-08-25T12:15:00.000Z"], // Sunday 17:15 → Tuesday 09:15
  ["2026-08-24T15:00:00.000Z", "2026-08-25T12:30:00.000Z"], // Monday closed
  ["2026-08-18T21:00:00.000Z", "2026-08-19T12:30:00.000Z"], // after close
])("calculates 30 business minutes from %s", (received, due) => {
  expect(calculateResponseDueAt(new Date(received)).toISOString()).toBe(due);
});
```

Also cover before opening, exact close, seconds/milliseconds, month/year rollover, equal open/close boundaries, and invalid dates.

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- src/modules/sla/business-time.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement timezone conversion using built-in `Intl`**

Do not hard-code UTC−03:00. Create a formatter with numeric parts for `America/Sao_Paulo`, derive local calendar parts, and convert local open/close instants by iteratively resolving the zone offset. Then consume available minutes day by day:

```ts
export const SLA_TIME_ZONE = "America/Sao_Paulo";
export const SLA_MINUTES = 30;
export const OPEN_MINUTE = 9 * 60;
export const CLOSE_MINUTE = 17 * 60 + 30;

export function calculateResponseDueAt(receivedAt: Date): Date {
  assertValidDate(receivedAt);
  let current = nextBusinessInstant(receivedAt);
  let remaining = SLA_MINUTES;
  while (remaining > 0) {
    const close = closeInstantForLocalDay(current);
    const available = Math.max(0, Math.floor((close.getTime() - current.getTime()) / 60_000));
    if (remaining <= available) return new Date(current.getTime() + remaining * 60_000);
    remaining -= available;
    current = nextBusinessInstant(new Date(close.getTime() + 60_000));
  }
  return current;
}
```

`nextBusinessInstant` accepts only Tuesday–Sunday and clamps to 09:00–17:30 in the named zone.

- [ ] **Step 4: Run the test under two host timezones**

Run:

```powershell
$env:TZ='UTC'; npm test -- src/modules/sla/business-time.test.ts
$env:TZ='America/Los_Angeles'; npm test -- src/modules/sla/business-time.test.ts
Remove-Item Env:TZ
```

Expected: both runs PASS with identical ISO instants.

- [ ] **Step 5: Commit the clock domain**

```bash
git add src/modules/sla/business-time.ts src/modules/sla/business-time.test.ts
git commit -m "feat: calculate response SLA in Brasilia time"
```

### Task 2: Add deadline and reminder persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608210003_sla_and_reminders/migration.sql`
- Modify: `prisma/temporal-contract.test.ts`
- Modify: `src/modules/conversations/shared-state.integration.test.ts`
- Create: `scripts/backfill-response-due-at.ts`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker-entrypoint.sh`

**Interfaces:**
- Produces `Conversation.responseDueAt` and `nextReminderAt`.
- Produces `Reminder`, `ReminderEvent`, `ReminderStatus`, and `ReminderAction`.

- [ ] **Step 1: Write RED schema/backfill tests**

Assert all reminder/deadline timestamps are `timestamp with time zone`, foreign keys are restrictive/set-null as designed, pending indexes exist, and existing `awaitingResponseSince` rows receive a calculated due date through an explicit migration backfill fixture.

- [ ] **Step 2: Run DB tests to verify RED**

Run: `npm run test:db -- prisma/temporal-contract.test.ts src/modules/conversations/shared-state.integration.test.ts`

Expected: FAIL because deadline/reminder models do not exist.

- [ ] **Step 3: Add exact Prisma models**

```prisma
enum ReminderStatus {
  PENDING
  COMPLETED
  CANCELLED
}

enum ReminderAction {
  CREATED
  POSTPONED
  COMPLETED
  CANCELLED
}

model Conversation {
  responseDueAt  DateTime? @map("response_due_at") @db.Timestamptz(3)
  nextReminderAt DateTime? @map("next_reminder_at") @db.Timestamptz(3)
  reminders      Reminder[]

  @@index([nextReminderAt, id], map: "conversations_next_reminder_idx")
  @@index([responseDueAt, id], map: "conversations_response_due_idx")
}

model Reminder {
  id             String         @id @default(uuid()) @db.Uuid
  conversationId String         @map("conversation_id") @db.Uuid
  note           String
  dueAt          DateTime       @map("due_at") @db.Timestamptz(3)
  assignedUserId String         @map("assigned_user_id") @db.Uuid
  createdByUserId String        @map("created_by_user_id") @db.Uuid
  status         ReminderStatus @default(PENDING)
  completedAt    DateTime?      @map("completed_at") @db.Timestamptz(3)
  completedByUserId String?     @map("completed_by_user_id") @db.Uuid
  cancelledAt    DateTime?      @map("cancelled_at") @db.Timestamptz(3)
  cancelledByUserId String?     @map("cancelled_by_user_id") @db.Uuid
  createdAt      DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)
  conversation   Conversation   @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  assignedUser   User           @relation("ReminderAssignee", fields: [assignedUserId], references: [id], onDelete: Restrict)
  createdByUser  User           @relation("ReminderCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  completedByUser User?         @relation("ReminderCompleter", fields: [completedByUserId], references: [id], onDelete: SetNull)
  cancelledByUser User?         @relation("ReminderCanceller", fields: [cancelledByUserId], references: [id], onDelete: SetNull)
  events         ReminderEvent[]

  @@index([status, dueAt, id])
  @@index([assignedUserId, status, dueAt])
  @@map("reminders")
}

model ReminderEvent {
  id         String         @id @default(uuid()) @db.Uuid
  reminderId String         @map("reminder_id") @db.Uuid
  actorUserId String        @map("actor_user_id") @db.Uuid
  action     ReminderAction
  previousDueAt DateTime?   @map("previous_due_at") @db.Timestamptz(3)
  nextDueAt  DateTime?      @map("next_due_at") @db.Timestamptz(3)
  createdAt  DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  reminder   Reminder       @relation(fields: [reminderId], references: [id], onDelete: Cascade)
  actorUser  User           @relation(fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([reminderId, createdAt])
  @@map("reminder_events")
}
```

Add inverse user relations with explicit relation names.

- [ ] **Step 4: Backfill due dates with the same tested business-time rules**

Because SQL timezone arithmetic must match application behavior, add a one-shot TypeScript backfill command `scripts/backfill-response-due-at.ts` executed by the release entrypoint immediately after migration and written idempotently (`WHERE response_due_at IS NULL`). The script loads only conversations with `awaiting_response_since IS NOT NULL`, computes exact dates with `calculateResponseDueAt`, and updates in batches of 100 in transactions:

```ts
for (;;) {
  const rows = await prisma.conversation.findMany({
    where: { awaitingResponseSince: { not: null }, responseDueAt: null },
    orderBy: { id: "asc" },
    take: 100,
    select: { id: true, awaitingResponseSince: true },
  });
  if (rows.length === 0) break;
  await prisma.$transaction(rows.map((row) => prisma.conversation.updateMany({
    where: { id: row.id, responseDueAt: null },
    data: { responseDueAt: calculateResponseDueAt(row.awaitingResponseSince!) },
  })));
}
```

Add `"db:backfill-sla": "tsx scripts/backfill-response-due-at.ts"` to `package.json`. Copy `scripts/backfill-response-due-at.ts` and `src/modules/sla/business-time.ts` into the runner image. Run the backfill fail-fast between migration and the server:

```sh
node node_modules/prisma/build/index.js migrate deploy
node node_modules/tsx/dist/cli.mjs scripts/backfill-response-due-at.ts
exec "$@"
```

- [ ] **Step 5: Generate/migrate/backfill a disposable DB and verify GREEN**

Run: `npm run db:generate; npm run db:validate; npm run db:deploy; npm run db:backfill-sla; npm run test:db -- prisma/temporal-contract.test.ts src/modules/conversations/shared-state.integration.test.ts`

Expected: PASS and rerunning `db:backfill-sla` changes zero rows.

- [ ] **Step 6: Commit persistence**

```bash
git add prisma package.json scripts/backfill-response-due-at.ts src/modules/conversations/shared-state.integration.test.ts src/generated/prisma Dockerfile docker-entrypoint.sh
git commit -m "feat: persist SLA deadlines and reminders"
```

### Task 3: Attach SLA deadlines to response-state transitions

**Files:**
- Modify: `src/modules/conversations/shared-state.ts`
- Modify: `src/modules/conversations/shared-state.test.ts`
- Modify: `src/modules/conversations/shared-state.integration.test.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`

**Interfaces:**
- Consumes `calculateResponseDueAt`.
- Guarantees `awaitingResponseSince` and `responseDueAt` start/preserve/clear atomically.

- [ ] **Step 1: Write RED transition tests**

```ts
await persistInbound(first);
expect(await state()).toMatchObject({
  awaitingResponseSince: first.externalTimestamp,
  responseDueAt: calculateResponseDueAt(first.externalTimestamp),
});
await persistInbound(second);
expect((await state()).responseDueAt).toEqual(calculateResponseDueAt(first.externalTimestamp));
await persistOutbound(reply);
expect(await state()).toMatchObject({ awaitingResponseSince: null, responseDueAt: null });
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/webhooks/process.test.ts src/modules/messages/service.integration.test.ts`

Expected: FAIL because response-state refresh does not maintain the due date.

- [ ] **Step 3: Update the transition atomically**

```ts
const startsWaiting = latest?.direction === "INBOUND" && conversation.awaitingResponseSince === null;
const data = latest?.direction === "INBOUND"
  ? {
      awaitingResponseSince: conversation.awaitingResponseSince ?? latest.externalTimestamp,
      responseDueAt: conversation.responseDueAt ?? calculateResponseDueAt(latest.externalTimestamp),
    }
  : { awaitingResponseSince: null, responseDueAt: null };
await client.conversation.update({ where: { id: conversationId }, data });
```

Ensure a delayed older inbound does not reopen after a newer outbound and concurrent newer inbound wins by stable message order.

- [ ] **Step 4: Run focused tests twice and commit**

Run Step 2 twice. Expected: both PASS without transaction warnings.

```bash
git add src/modules/conversations/shared-state.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/webhooks/process.test.ts src/modules/messages/service.integration.test.ts
git commit -m "feat: enforce business-hour response deadlines"
```

### Task 4: Implement reminder creation and serialized transitions

**Files:**
- Create: `src/modules/reminders/types.ts`
- Create: `src/modules/reminders/schemas.ts`
- Create: `src/modules/reminders/service.ts`
- Create: `src/modules/reminders/service.test.ts`
- Create: `src/modules/reminders/service.integration.test.ts`

**Interfaces:**
- Produces `listReminders`, `createReminder`, `postponeReminder`, `completeReminder`, and `cancelReminder`.
- Produces `ReminderDto` with assignee/creator/action history and derived `overdue`.

- [ ] **Step 1: Write RED unit and concurrency tests**

Cover required note (1–500 chars), future due date, active assignee, default actor assignee, visibility to attendants, transition authorization, invalid transitions, earliest pending projection, two users completing simultaneously, postpone-vs-complete race, and audit actor/value fields.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/reminders/service.test.ts src/modules/reminders/service.integration.test.ts`

Expected: FAIL because reminder modules do not exist.

- [ ] **Step 3: Implement schemas and DTOs**

```ts
export const createReminderSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  note: z.string().trim().min(1).max(500),
  assignedUserId: z.string().uuid().optional(),
});
export const postponeReminderSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});
```

Reject `dueAt <= now` for creation/postpone with safe 400 copy.

- [ ] **Step 4: Implement one serializable transition primitive**

Lock reminder and conversation. For expected `PENDING`, update exactly once, insert `ReminderEvent`, recompute the conversation projection, and return the committed DTO:

```ts
async function refreshNextReminderAt(tx: ReminderTransaction, conversationId: string) {
  const next = await tx.reminder.findFirst({
    where: { conversationId, status: "PENDING" },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    select: { dueAt: true },
  });
  await tx.conversation.update({
    where: { id: conversationId },
    data: { nextReminderAt: next?.dueAt ?? null },
  });
}
```

The losing concurrent transition returns 409 “Este lembrete já foi atualizado.” and never inserts a second terminal event.

- [ ] **Step 5: Run tests twice and commit**

Run Step 2 twice. Expected: PASS with a single final transition/event.

```bash
git add src/modules/reminders
git commit -m "feat: add durable conversation reminders"
```

### Task 5: Expose reminder APIs and realtime events

**Files:**
- Create: `src/app/api/conversations/[id]/reminders/route.ts`
- Create: `src/app/api/conversations/[id]/reminders/route.test.ts`
- Create: `src/app/api/reminders/[id]/postpone/route.ts`
- Create: `src/app/api/reminders/[id]/postpone/route.test.ts`
- Create: `src/app/api/reminders/[id]/complete/route.ts`
- Create: `src/app/api/reminders/[id]/complete/route.test.ts`
- Create: `src/app/api/reminders/[id]/cancel/route.ts`
- Create: `src/app/api/reminders/[id]/cancel/route.test.ts`
- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/hub.test.ts`

**Interfaces:**
- Produces SSE `{ type: "reminder.updated"; conversationId: string; reminderId: string }`.

- [ ] **Step 1: Write RED route tests**

Assert GET auth, mutation same-origin/auth/body/UUID ordering, actor propagation, 201 create, 200 transition, safe 400/404/409, and publication only after commit.

- [ ] **Step 2: Run routes to verify RED**

Run: `npm test -- "src/app/api/conversations/[id]/reminders/route.test.ts" "src/app/api/reminders/[id]" src/modules/realtime/hub.test.ts`

Expected: FAIL because routes/events do not exist.

- [ ] **Step 3: Implement route factories**

Use injectable dependencies and the standard envelope:

```ts
const reminder = await dependencies.completeReminder(actor, parsedId);
dependencies.publishRealtime({
  type: "reminder.updated",
  conversationId: reminder.conversationId,
  reminderId: reminder.id,
});
return Response.json({ data: reminder, error: null });
```

- [ ] **Step 4: Run route tests and commit**

Run Step 2. Expected: PASS and SSE contains no note.

```bash
git add src/app/api/conversations/[id]/reminders src/app/api/reminders src/modules/realtime/events.ts src/modules/realtime/hub.test.ts
git commit -m "feat: expose reminder workflow APIs"
```

### Task 6: Implement stable queue ranking, filtering, and pagination

**Files:**
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/schemas.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/service.integration.test.ts`
- Modify: `src/app/api/conversations/route.test.ts`

**Interfaces:**
- Produces `QueueGroup = "REMINDER_DUE" | "RESPONSE_OVERDUE" | "UNREAD" | "RECENT"`.
- Cursor v2: `{ v: 2; rank: 0|1|2|3; sortAt: string; id: string }`.
- Filters: `responsibleUserId`, `contactTypeId`, repeated `tagId`, `unread`, `awaitingResponse`, `overdue`, and `reminder`.

- [ ] **Step 1: Write RED ranking/filter/cursor tests**

Seed equal timestamps in every group, paginate through all rows without duplicates/skips, advance database `now`, combine filters, reject invalid/oversized cursors, and prove search results keep the same priority order.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts src/app/api/conversations/route.test.ts`

Expected: FAIL because current cursor is only `(lastMessageAt,id)` and no SLA/reminder filters exist.

- [ ] **Step 3: Implement a ranked ID query and hydrate in order**

Use a parameterized Prisma SQL CTE with database `CURRENT_TIMESTAMP`:

```sql
CASE
  WHEN c.next_reminder_at IS NOT NULL AND c.next_reminder_at <= CURRENT_TIMESTAMP THEN 0
  WHEN c.response_due_at IS NOT NULL AND c.response_due_at <= CURRENT_TIMESTAMP THEN 1
  WHEN c.manual_unread_at IS NOT NULL OR unread_count > 0 THEN 2
  ELSE 3
END AS rank
```

Use `sort_at` as `next_reminder_at` for rank 0, `response_due_at` for rank 1, and `last_message_at` for ranks 2/3. Sort ranks 0/1 oldest-first and ranks 2/3 newest-first by converting the cursor predicate per rank; always use `id` as final tie-breaker. Hydrate selected IDs with the existing safe Prisma select and reorder via an ID index map.

- [ ] **Step 4: Add DTO timing fields**

Return `queueGroup`, `awaitingResponseSince`, `responseDueAt`, `nextReminderAt`, `overdue`, and `nextStateChangeAt` (minimum future due time relevant to the row).

- [ ] **Step 5: Run focused tests twice and commit**

Run Step 2 twice. Expected: PASS with stable page coverage.

```bash
git add src/modules/conversations src/app/api/conversations/route.test.ts
git commit -m "feat: prioritize SLA and reminder queue"
```

### Task 7: Build reminder and queue UI with durable timers

**Files:**
- Create: `src/components/inbox/conversation-filters.tsx`
- Create: `src/components/inbox/conversation-filters.test.tsx`
- Create: `src/components/inbox/reminder-panel.tsx`
- Create: `src/components/inbox/reminder-panel.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/lib/public-error.ts`

**Interfaces:**
- Consumes queue DTOs and reminder APIs/events.
- Produces filter state plus `createReminder`, `postponeReminder`, `completeReminder`, and `cancelReminder` hook actions.

- [ ] **Step 1: Write RED UI/timer/race tests**

Cover priority group labels, 30-minute indicator, non-color copy, combined filters/reset, due timer reordering, 60-second fallback sync, tab sleep/wake resync, reminder create/default assignee, responsible emphasis, postpone/complete/cancel, stale A→B request guards, 409 refetch, offline error, focus restoration, and mobile overflow.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/components/inbox/conversation-filters.test.tsx src/components/inbox/reminder-panel.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/customer-panel.test.tsx src/hooks/use-inbox.test.tsx`

Expected: FAIL because queue/reminder UI/actions do not exist.

- [ ] **Step 3: Implement filters and priority presentation**

Keep filters in `useInbox`, reset pagination on change, encode repeated tag IDs with `URLSearchParams.append`, and abort stale pages. Render group separators only when group changes; indicators include “Lembrete vencido”, “Aguardando há …” or “Não lida”.

- [ ] **Step 4: Implement reminder panel/actions**

Use `datetime-local` converted to an offset ISO instant, a required note textarea, and active assignee select. A transition disables only that reminder row; on success refetch selected conversation/list, on 409 refetch and announce the updated state.

- [ ] **Step 5: Implement precise and fallback synchronization**

Compute the nearest `nextStateChangeAt` across loaded rows and schedule one timeout capped to the signed 32-bit timer maximum. Also set a 60-second interval and a `visibilitychange` listener that refreshes when visible. Cleanup all three on dependency change/unmount; never derive correctness from the timer because each fetch is server-authoritative.

- [ ] **Step 6: Run UI tests, React review, and commit**

Run Step 2 and `npx eslint src/hooks/use-inbox.ts src/components/inbox`. Expected: PASS with zero warnings/leaked timers.

```bash
git add src/components/inbox src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/lib/public-error.ts
git commit -m "feat: add SLA queue and reminders UI"
```

### Task 8: Verify and publish Release 2

**Files:**
- Create: `docs/verification/2026-08-21-sla-reminders-release.md`
- Modify: `README.md` for schedule/reminder operations and backfill command.

**Interfaces:**
- Produces the verified SLA/reminder release and rollback evidence.

- [ ] **Step 1: Run complete gates**

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run db:generate
npm run build
npm audit --omit=dev
git diff --check
```

Expected: all exit 0; build includes reminder routes; audit is 0.

- [ ] **Step 2: Run time/race tests under alternate timezone and PostgreSQL twice**

Run the Task 1 timezone commands and all reminder/shared-state/conversation integration tests twice. Expected: identical due instants, one terminal event per race, stable pagination.

- [ ] **Step 3: Run browser acceptance with two sessions**

Use shortened fixture times only in the isolated test environment. Prove due grouping, second-session visibility, postpone/complete, Monday/closing calculations via API fixture, timer resync after hidden tab, and no automatic message/provider call.

- [ ] **Step 4: Back up and deploy app-only**

Create/validate backup, build immutable image, deploy migration and idempotent SLA backfill, recreate only app, verify health/login/webhook, compare non-app container snapshots, and watch logs across a due transition.

- [ ] **Step 5: Record evidence and commit**

Document schedule, ISO examples, backfill counts, race results, image/config hashes, public health, reminder acceptance, provider-call count zero, logs, backup, and rollback.

```bash
git add docs/verification/2026-08-21-sla-reminders-release.md README.md
git commit -m "docs: verify SLA and reminders release"
```
