# Shared Inbox State and Media Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unread/answered state authoritative for the whole team and make inbound audio recover and become playable without a page reload.

**Architecture:** Add additive conversation state and audit fields, preserve per-user reads only for audit, and recompute the response state inside the same serializable transaction that persists each message. Extend the existing authenticated SSE/refetch pattern and expose explicit media state/recovery APIs so the UI never renders a disabled `0:00` player for pending media.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2.8, TypeScript 7, Prisma 7.9.1, PostgreSQL 18, Vitest 4.1.11, SSE, Docker/Compose on the KVM.

## Global Constraints

- Node.js must remain `>=22`; do not change dependency versions in this release.
- PostgreSQL timestamps remain `timestamptz(3)` and IDs remain UUIDs.
- Message order is always `(externalTimestamp, id)`; reads and response state must never regress.
- The state shown in every session is team-wide; `ConversationRead` remains only for per-user audit.
- A conversation is awaiting response when the latest relevant message is inbound; consecutive inbound messages keep the first unanswered timestamp.
- Media recovery remains bounded by the existing lease, limiter, five-attempt cap, size, hash, MIME, and magic-byte validation.
- SSE payloads contain IDs/state only; never include message bodies, notes, provider payloads, paths, or secrets.
- Every mutation requires an active session and same-origin protection.
- Public errors are safe Portuguese copy and never expose Graph responses, stack traces, tokens, or local paths.
- Deployment is a single immutable app image; database, Caddy, and unrelated KVM systems must not be recreated.

---

## File Structure

- `prisma/schema.prisma`: additive shared-state/audit fields and relations.
- `prisma/migrations/202608210001_shared_inbox_state/migration.sql`: schema plus deterministic backfill from the highest existing read boundary.
- `src/modules/conversations/shared-state.ts`: stable-boundary comparison and transactional team read/unread/response-state operations.
- `src/modules/conversations/shared-state.test.ts`: pure and repository-level state tests.
- `src/modules/conversations/shared-state.integration.test.ts`: PostgreSQL concurrency/backfill behavior.
- `src/modules/conversations/types.ts`: shared state and safe media state DTOs.
- `src/modules/conversations/schemas.ts`: mark-unread and media-recovery inputs.
- `src/modules/conversations/service.ts`: global unread counts and shared DTO mapping.
- `src/modules/webhooks/process.ts`: update response state in the inbound webhook transaction.
- `src/modules/messages/service.ts`: update response state in the outbound creation transaction.
- `src/modules/realtime/events.ts`: team-state and media-state invalidations.
- `src/modules/media/service.ts`: safe media-state lookup, explicit manual recovery, and post-commit publication.
- `src/app/api/conversations/[id]/read/route.ts`: publish a team-wide read invalidation.
- `src/app/api/conversations/[id]/unread/route.ts`: new shared mark-unread endpoint.
- `src/app/api/media/[id]/recover/route.ts`: authenticated bounded recovery endpoint.
- `src/hooks/use-inbox.ts`: reconcile shared state and refetch on team/media events.
- `src/components/inbox/conversation-list.tsx`: separate unread and awaiting-response indicators.
- `src/components/inbox/message-media.tsx`: pending/available/failed media state machine.
- Adjacent `*.test.ts` and `*.test.tsx` files: route, hook, component, and concurrency coverage.

### Task 1: Add and backfill the shared-state schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608210001_shared_inbox_state/migration.sql`
- Modify: `prisma/temporal-contract.test.ts`
- Modify: `prisma/seed.ts`
- Test: `prisma/seed.test.ts`

**Interfaces:**
- Produces: `Conversation.teamLastReadMessageId`, `teamLastReadAt`, `manualUnreadAt`, `manualUnreadByUserId`, and `awaitingResponseSince`.
- Produces: `ConversationAuditEvent` with `READ` and `MARKED_UNREAD` actions.
- Preserves: `ConversationRead` and every existing message/media relation.

- [ ] **Step 1: Write the failing schema and migration-contract tests**

Add assertions that query `information_schema` and prove all new timestamps are timezone-aware, the new foreign keys exist, and the migration backfills the highest boundary:

```ts
const columns = await pg.query<{ column_name: string; data_type: string }>(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'conversations'
    AND column_name IN ('team_last_read_at', 'manual_unread_at', 'awaiting_response_since')
  ORDER BY column_name
`);
expect(columns.rows).toEqual([
  { column_name: "awaiting_response_since", data_type: "timestamp with time zone" },
  { column_name: "manual_unread_at", data_type: "timestamp with time zone" },
  { column_name: "team_last_read_at", data_type: "timestamp with time zone" },
]);
```

Seed two reads at equal timestamps with ordered UUIDs and assert the larger `(externalTimestamp,id)` becomes the team boundary.

- [ ] **Step 2: Run the database tests to verify RED**

Run: `npm run test:db -- prisma/temporal-contract.test.ts prisma/seed.test.ts`

Expected: FAIL because the columns/table do not exist and the seed has no shared boundary.

- [ ] **Step 3: Add the Prisma models and exact migration**

Add these fields/relations (including inverse relations on `User` and `Message`):

```prisma
enum ConversationAuditAction {
  READ
  MARKED_UNREAD
}

model Conversation {
  teamLastReadMessageId String?   @map("team_last_read_message_id") @db.Uuid
  teamLastReadAt        DateTime? @map("team_last_read_at") @db.Timestamptz(3)
  manualUnreadAt        DateTime? @map("manual_unread_at") @db.Timestamptz(3)
  manualUnreadByUserId  String?   @map("manual_unread_by_user_id") @db.Uuid
  awaitingResponseSince DateTime? @map("awaiting_response_since") @db.Timestamptz(3)
  teamLastReadMessage   Message?  @relation("TeamLastReadMessage", fields: [teamLastReadMessageId], references: [id], onDelete: SetNull)
  manualUnreadByUser    User?     @relation("ManualUnreadByUser", fields: [manualUnreadByUserId], references: [id], onDelete: SetNull)
  auditEvents           ConversationAuditEvent[]
}

model ConversationAuditEvent {
  id             String                  @id @default(uuid()) @db.Uuid
  conversationId String                  @map("conversation_id") @db.Uuid
  actorUserId    String                  @map("actor_user_id") @db.Uuid
  action         ConversationAuditAction
  messageId      String?                 @map("message_id") @db.Uuid
  createdAt      DateTime                @default(now()) @map("created_at") @db.Timestamptz(3)
  conversation   Conversation            @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  actorUser      User                    @relation(fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([conversationId, createdAt])
  @@map("conversation_audit_events")
}
```

The migration must backfill with a deterministic `DISTINCT ON` query and then backfill unanswered conversations from the latest stable message:

```sql
WITH highest AS (
  SELECT DISTINCT ON (cr.conversation_id)
    cr.conversation_id,
    cr.last_read_message_id,
    cr.last_read_at
  FROM conversation_reads cr
  LEFT JOIN messages m ON m.id = cr.last_read_message_id
  ORDER BY cr.conversation_id,
    COALESCE(m.external_timestamp, cr.last_read_at) DESC,
    m.id DESC NULLS LAST
)
UPDATE conversations c
SET team_last_read_message_id = h.last_read_message_id,
    team_last_read_at = h.last_read_at
FROM highest h
WHERE c.id = h.conversation_id;

WITH latest AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, direction
  FROM messages
  ORDER BY conversation_id, external_timestamp DESC, id DESC
), last_outbound AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, external_timestamp, id
  FROM messages
  WHERE direction = 'OUTBOUND'
  ORDER BY conversation_id, external_timestamp DESC, id DESC
), trailing_inbound AS (
  SELECT m.conversation_id, MIN(m.external_timestamp) AS awaiting_since
  FROM messages m
  JOIN latest l ON l.conversation_id = m.conversation_id AND l.direction = 'INBOUND'
  LEFT JOIN last_outbound o ON o.conversation_id = m.conversation_id
  WHERE m.direction = 'INBOUND'
    AND (o.id IS NULL OR (m.external_timestamp, m.id) > (o.external_timestamp, o.id))
  GROUP BY m.conversation_id
)
UPDATE conversations c
SET awaiting_response_since = t.awaiting_since
FROM trailing_inbound t
WHERE c.id = t.conversation_id;
```

Update seed expectations without making the seed reset production data.

- [ ] **Step 4: Generate, validate, migrate a disposable PostgreSQL database, and verify GREEN**

Run:

```powershell
npm run db:generate
npm run db:validate
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npm run db:deploy
npm run test:db -- prisma/temporal-contract.test.ts prisma/seed.test.ts
```

Expected: all commands exit 0; the backfill assertion selects the highest equal-time UUID.

- [ ] **Step 5: Commit the schema boundary**

```bash
git add prisma/schema.prisma prisma/migrations/202608210001_shared_inbox_state/migration.sql prisma/temporal-contract.test.ts prisma/seed.ts prisma/seed.test.ts src/generated/prisma
git commit -m "feat: add shared conversation state"
```

### Task 2: Implement monotonic shared read and manual unread

**Files:**
- Create: `src/modules/conversations/shared-state.ts`
- Create: `src/modules/conversations/shared-state.test.ts`
- Create: `src/modules/conversations/shared-state.integration.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`

**Interfaces:**
- Produces: `advanceSharedRead(actorUserId, conversationId, messageId, observedManualUnreadRevision): Promise<SharedConversationStateDto>`.
- Produces: `markSharedUnread(actorUserId, conversationId): Promise<SharedConversationStateDto>`.
- Produces: `refreshResponseState(client, conversationId): Promise<void>` for Task 3.
- Produces DTO:

```ts
export type SharedConversationStateDto = {
  conversationId: string;
  unreadCount: number;
  manuallyUnread: boolean;
  manualUnreadRevision: string | null;
  awaitingResponseSince: string | null;
  revision: string;
};
```

- [ ] **Step 1: Write RED tests for two users and stale boundaries**

Cover: user A reads and user B sees zero unread; a newer inbound arriving during read remains unread; an older read cannot regress; manual unread is global; a stale read cannot clear a newer manual mark.

```ts
await advanceSharedRead(userA.id, conversation.id, visibleMessage.id);
expect((await listConversations(userB.id, {})).items[0]).toMatchObject({
  unreadCount: 0,
  manuallyUnread: false,
});

await markSharedUnread(userA.id, conversation.id);
expect((await getConversation(userB.id, conversation.id)).manuallyUnread).toBe(true);

const staleRevision = (await getConversation(userB.id, conversation.id)).manualUnreadRevision;
await markSharedUnread(userA.id, conversation.id);
await advanceSharedRead(userB.id, conversation.id, visibleMessage.id, staleRevision);
expect((await getConversation(userA.id, conversation.id)).manuallyUnread).toBe(true);
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts`

Expected: FAIL because `shared-state.ts` and the shared DTO fields do not exist.

- [ ] **Step 3: Implement the transactional service**

Use `Serializable` with the existing three-attempt `P2034` retry. Lock the conversation, validate membership, compare the target to the current team boundary, update both individual/team cursors, and insert the audit row atomically:

```ts
export async function advanceSharedRead(
  actorUserId: string,
  conversationId: string,
  messageId: string,
  observedManualUnreadRevision: string | null,
  client: PrismaClient = prisma,
): Promise<SharedConversationStateDto> {
  return runConversationTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    const target = await tx.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, externalTimestamp: true },
    });
    if (!target) throw new HttpError(400, "Mensagem não pertence à conversa");
    const current = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { teamLastReadAt: true, teamLastReadMessage: { select: { id: true, externalTimestamp: true } }, manualUnreadAt: true },
    });
    const advances = !current.teamLastReadMessage || compareBoundary(target, current.teamLastReadMessage) > 0;
    const canClearManualUnread = current.manualUnreadAt?.toISOString() === observedManualUnreadRevision;
    if (advances) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          teamLastReadMessageId: messageId,
          teamLastReadAt: target.externalTimestamp,
          ...(canClearManualUnread ? { manualUnreadAt: null, manualUnreadByUserId: null } : {}),
        },
      });
    }
    await upsertIndividualRead(tx, actorUserId, conversationId, target);
    await tx.conversationAuditEvent.create({ data: { actorUserId, conversationId, messageId, action: "READ" } });
    return sharedState(tx, conversationId);
  });
}
```

`markSharedUnread` must lock the same row, set `manualUnreadAt`/actor, insert `MARKED_UNREAD`, and return the same DTO. `sharedState` counts inbound messages after the team boundary and sets `manuallyUnread` independently.

- [ ] **Step 4: Replace per-user unread mapping in the conversation service**

Change list/detail selects to load the conversation team boundary and return:

```ts
unreadCount: counts.get(row.id) ?? 0,
manuallyUnread: row.manualUnreadAt !== null,
manualUnreadRevision: row.manualUnreadAt?.toISOString() ?? null,
awaitingResponseSince: row.awaitingResponseSince?.toISOString() ?? null,
revision: row.updatedAt.toISOString(),
```

Keep `lastReadMessageId`/`lastReadAt` in detail as aliases of the team boundary for backward compatibility during this release.

- [ ] **Step 5: Run focused unit and PostgreSQL tests**

Run: `npm test -- src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts`

Expected: PASS, including equal-timestamp and concurrent two-user cases.

- [ ] **Step 6: Commit the shared service**

```bash
git add src/modules/conversations/shared-state.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts
git commit -m "feat: share conversation read state"
```

### Task 3: Update response state atomically on inbound and outbound messages

**Files:**
- Modify: `src/modules/conversations/shared-state.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`

**Interfaces:**
- Consumes: `refreshResponseState(client, conversationId)` from Task 2.
- Guarantees: response state commits in the same transaction as the message; consecutive inbound messages preserve the earliest unanswered timestamp.

- [ ] **Step 1: Write RED message-order and concurrency tests**

```ts
await persistInbound(firstInbound);
await persistInbound(secondInbound);
expect(await state(conversation.id)).toMatchObject({ awaitingResponseSince: firstInbound.externalTimestamp });

await persistOutbound(reply);
expect(await state(conversation.id)).toMatchObject({ awaitingResponseSince: null });

await Promise.all([persistOutbound(reply), persistInbound(laterInbound)]);
expect(await state(conversation.id)).toMatchObject({ awaitingResponseSince: laterInbound.externalTimestamp });
```

Also insert an older delayed webhook after an outbound message and prove it does not reopen the conversation.

- [ ] **Step 2: Run the focused service tests to verify RED**

Run: `npm test -- src/modules/webhooks/process.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts`

Expected: FAIL because message persistence only updates `lastMessageAt`.

- [ ] **Step 3: Implement response-state refresh under a conversation row lock**

```ts
export async function refreshResponseState(
  client: SharedStateClient,
  conversationId: string,
): Promise<void> {
  await client.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
  const [conversation, latest] = await Promise.all([
    client.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { awaitingResponseSince: true } }),
    client.message.findFirst({
      where: { conversationId },
      orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
      select: { direction: true, externalTimestamp: true },
    }),
  ]);
  const awaitingResponseSince = latest?.direction === "INBOUND"
    ? conversation.awaitingResponseSince ?? latest.externalTimestamp
    : null;
  await client.conversation.update({
    where: { id: conversationId },
    data: { awaitingResponseSince },
  });
}
```

Do not use `Promise.all` on a single transaction client if the pg adapter warns about concurrent queries; load the two records sequentially in that environment.

- [ ] **Step 4: Call the refresh inside both message transactions**

In `processMessage`, call it after `createMessage` and before `completeEvent`. In `createPending`, replace the standalone raw statement with the existing serializable transaction helper: insert the idempotent outbound row, call `refreshResponseState(transaction, conversationId)`, and only then return the hydrated record. Preserve unique-key/idempotency and foreign-key error mappings.

- [ ] **Step 5: Run the focused tests twice**

Run twice: `npm test -- src/modules/webhooks/process.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts`

Expected: both runs PASS with one stable final state and no pg concurrency warning.

- [ ] **Step 6: Commit response-state correctness**

```bash
git add src/modules/conversations/shared-state.ts src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/messages/service.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts
git commit -m "fix: share awaiting response state"
```

### Task 4: Expose shared read/unread routes and realtime invalidation

**Files:**
- Modify: `src/app/api/conversations/[id]/read/route.ts`
- Modify: `src/app/api/conversations/[id]/read/route.test.ts`
- Create: `src/app/api/conversations/[id]/unread/route.ts`
- Create: `src/app/api/conversations/[id]/unread/route.test.ts`
- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/hub.test.ts`

**Interfaces:**
- Produces SSE: `{ type: "conversation.updated"; conversationId: string; revision: string }`.
- Read body is `{ messageId: string; observedManualUnreadRevision: string | null }`; unread body is empty. The observed revision is required so a stale tab cannot clear a newer manual-unread mark.

- [ ] **Step 1: Write RED route tests**

Assert same-origin before body, active auth, UUID validation, global service call, stable envelope, and one post-commit publication:

```ts
expect(events).toEqual([{
  type: "conversation.updated",
  conversationId,
  revision: "2026-08-21T12:00:00.000Z",
}]);
```

- [ ] **Step 2: Run routes to verify RED**

Run: `npm test -- "src/app/api/conversations/[id]/read/route.test.ts" "src/app/api/conversations/[id]/unread/route.test.ts" src/modules/realtime/hub.test.ts`

Expected: unread module missing and old read event is user-specific.

- [ ] **Step 3: Implement the handlers**

Both handlers must call `assertSameOrigin`, `requireUser`, validate `id`, validate the read revision as `z.iso.datetime({ offset: true }).nullable()`, call the shared-state service, publish after the service resolves, and return the standard conversation envelope:

```ts
const state = await dependencies.markSharedUnread(actor.id, parsedId);
dependencies.publishRealtime({
  type: "conversation.updated",
  conversationId: parsedId,
  revision: state.revision,
});
return Response.json({ data: state, error: null });
```

- [ ] **Step 4: Run route and hub tests**

Run: `npm test -- "src/app/api/conversations/[id]/read/route.test.ts" "src/app/api/conversations/[id]/unread/route.test.ts" src/modules/realtime/hub.test.ts`

Expected: PASS; invalid IDs are safe 400 responses and events contain no message body/user email.

- [ ] **Step 5: Commit the API boundary**

```bash
git add src/app/api/conversations/[id]/read src/app/api/conversations/[id]/unread src/modules/realtime/events.ts src/modules/realtime/hub.test.ts
git commit -m "feat: expose shared unread actions"
```

### Task 5: Add explicit media state and bounded recovery

**Files:**
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/media/service.ts`
- Modify: `src/modules/media/service.test.ts`
- Modify: `src/modules/media/service.integration.test.ts`
- Create: `src/app/api/media/[id]/recover/route.ts`
- Create: `src/app/api/media/[id]/recover/route.test.ts`
- Modify: `src/modules/realtime/events.ts`

**Interfaces:**
- Produces `MessageDto.mediaState`:

```ts
type MediaStateDto = {
  status: "PENDING" | "AVAILABLE" | "FAILED";
  nextAttemptAt: string | null;
  canRetry: boolean;
};
```

- Produces: `recoverMedia(actorUserId, mediaId, manual): Promise<MediaStateDto>`.
- Produces SSE: `{ type: "media.updated"; conversationId: string; messageId: string; mediaId: string }`.

- [ ] **Step 1: Write RED service and route tests**

Cover pending, available, transient failure, exhausted failure, manual reset, two simultaneous recoveries, wrong UUID, unauthenticated request, same-origin rejection, and post-commit SSE.

```ts
await Promise.all([
  recoverMedia(user.id, media.id, false),
  recoverMedia(user.id, media.id, false),
]);
expect(provider.downloadCalls).toBe(1);
expect(events).toEqual([{ type: "media.updated", conversationId, messageId, mediaId: media.id }]);
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/media/service.test.ts src/modules/media/service.integration.test.ts "src/app/api/media/[id]/recover/route.test.ts"`

Expected: FAIL because safe media state/recovery route/publication do not exist.

- [ ] **Step 3: Select safe media state in conversation DTOs**

Extend `messageSelect` with only safe fields and map them without storage keys/provider IDs:

```ts
mediaObject: {
  select: {
    status: true,
    downloadNextAttemptAt: true,
    downloadAttempts: true,
  },
},
```

`canRetry` is true for pending media after `nextAttemptAt`, and for failed media only through the explicit manual route.

- [ ] **Step 4: Implement authenticated recovery and publication**

Validate that the media belongs to a message/conversation visible to active users. Automatic recovery delegates to existing `ensureMediaAvailable(mediaId, dependencies, actorUserId)`. Manual recovery atomically resets a failed object to pending with cleared lease/next-attempt and `downloadAttempts: 0`, then delegates through the same limiter. After terminal state commit, load message/conversation IDs and publish `media.updated`.

- [ ] **Step 5: Run media, webhook-after, and route tests**

Run: `npm test -- src/modules/media/service.test.ts src/modules/media/service.integration.test.ts "src/app/api/media/[id]/recover/route.test.ts" src/app/api/webhooks/meta/route.test.ts`

Expected: PASS; provider calls remain bounded and webhook response remains independent of the download.

- [ ] **Step 6: Commit server-side recovery**

```bash
git add src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/media/service.ts src/modules/media/service.test.ts src/modules/media/service.integration.test.ts src/app/api/media/[id]/recover src/modules/realtime/events.ts
git commit -m "fix: recover inbound media without reload"
```

### Task 6: Reconcile team state and media state in the inbox UI

**Files:**
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/message-media.tsx`
- Create: `src/components/inbox/message-media.test.tsx`

**Interfaces:**
- Consumes: shared conversation DTOs, `conversation.updated`, `media.updated`, and `POST /api/media/[id]/recover`.
- Produces: `markUnread(conversationId)` from `useInbox` and `onMarkUnread` in the view.

- [ ] **Step 1: Write RED UI tests**

Test two-event reconciliation, no per-user stale badge, manual unread action, pending audio spinner/no `<audio>`, automatic recovery after `nextAttemptAt`, SSE transition to enabled player, failed retry button, abort on unmount/conversation change, and no duplicate recovery call.

```tsx
render(<MessageMedia message={pendingAudio} />);
expect(screen.getByRole("status")).toHaveTextContent("Baixando áudio");
expect(screen.queryByLabelText("Reproduzir áudio")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run focused UI tests to verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-media.test.tsx`

Expected: FAIL because the hook ignores media/shared conversation events and pending media renders native controls.

- [ ] **Step 3: Update `useInbox` reconciliation**

On `conversation.updated`, refetch the first list page and selected conversation. On `media.updated`, refetch only when the selected conversation matches, while still refreshing the first list page. Keep the existing sequence/AbortController guards.

When acknowledging a visible message, send the selected DTO's exact `manualUnreadRevision`; never synthesize it from the browser clock:

```ts
await fetch(`/api/conversations/${conversationId}/read`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messageId, observedManualUnreadRevision: conversation.manualUnreadRevision }),
});
```

Add:

```ts
const markUnread = useCallback(async (conversationId: string) => {
  const response = await fetch(`/api/conversations/${conversationId}/unread`, { method: "POST" });
  await readEnvelope<SharedConversationStateDto>(response);
  await Promise.all([refreshList(), selectedIdRef.current === conversationId ? refreshConversation() : Promise.resolve()]);
}, [refreshConversation, refreshList]);
```

- [ ] **Step 4: Render distinct shared indicators**

The list shows unread count/manual dot independently from “Aguardando resposta”. Add a menu/button named **Marcar como não lida** in the conversation header. Do not show an answered conversation as pending just because the current user did not open it.

- [ ] **Step 5: Implement the media state machine**

Use an effect keyed by `message.id`, `mediaObjectId`, status, and `nextAttemptAt`. Abort the request on unmount/change. Render:

```tsx
if (message.mediaState?.status === "PENDING") {
  return <div role="status"><Spinner label="Baixando áudio" /> Baixando áudio</div>;
}
if (message.mediaState?.status === "FAILED") {
  return <Button onClick={recoverManually}>Tentar novamente</Button>;
}
return <audio aria-label="Reproduzir áudio" controls preload="metadata" src={source!} />;
```

Automatic POSTs use `manual=false` semantics once `nextAttemptAt <= now`; manual retry is a user click. Server claims make concurrent tabs safe.

- [ ] **Step 6: Run focused UI tests**

Run: `npm test -- src/hooks/use-inbox.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-media.test.tsx`

Expected: PASS with no unhandled promise, duplicate request, or leaked timer.

- [ ] **Step 7: Run React and stop-slop review, then commit**

Verify effects use primitive dependencies, focus returns to the invoking control, 44 px targets remain, and indicators have text/accessible names.

```bash
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/inbox
git commit -m "feat: synchronize shared inbox state"
```

### Task 7: Verify and publish Release 0

**Files:**
- Modify: `docs/verification/2026-08-21-shared-inbox-release.md`
- Modify: `README.md` only if an operational command or behavior changed.

**Interfaces:**
- Consumes the complete Release 0.
- Produces an immutable image/release and a rollback record; no code changes are allowed during the production smoke without a new RED/GREEN cycle.

- [ ] **Step 1: Run fail-fast local gates**

Run in order:

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

Expected: all exit 0; audit reports 0 vulnerabilities; build includes read/unread/recover routes.

- [ ] **Step 2: Run PostgreSQL race tests repeatedly**

Run: `npm run test:db -- src/modules/conversations/shared-state.integration.test.ts src/modules/conversations/service.integration.test.ts src/modules/messages/service.integration.test.ts src/modules/media/service.integration.test.ts`

Repeat twice. Expected: both runs PASS with no pg warning and one final shared state.

- [ ] **Step 3: Run two-session browser acceptance locally**

Use two independent sessions. Prove: A reads and B clears; A replies and B no longer sees awaiting response; B marks unread and A sees it; inbound audio moves loading → playable without refresh; mobile 390×844 has no overflow and controls remain keyboard accessible.

- [ ] **Step 4: Back up, build, and deploy app-only**

Follow the canonical KVM release process in `README.md`: validated backup, immutable image tagged with the full commit, Git-archive release directory, `docker compose up -d --no-deps app`, health wait, public endpoint/webhook checks, and container snapshot comparison proving database/Caddy/other systems were not recreated.

- [ ] **Step 5: Record production evidence and commit**

Document UTC deployment time, image digest, compose config hash, migration list, health/login/webhook results, two-user result, audio result, log counts, backup path/checksum, and rollback target without secrets/PII.

```bash
git add docs/verification/2026-08-21-shared-inbox-release.md README.md
git commit -m "docs: verify shared inbox release"
```
