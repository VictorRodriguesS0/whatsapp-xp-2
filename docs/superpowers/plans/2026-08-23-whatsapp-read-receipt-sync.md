# WhatsApp Read Receipt Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagents for this project.

**Goal:** Send official WhatsApp read receipts when any attendant opens a conversation, while keeping the local read state shared, durable, retryable, and consistent across every panel session.

**Architecture:** Keep `advanceSharedRead` as the local source of truth and atomically enqueue the newest eligible inbound message in a one-row-per-conversation synchronization table. Deliver the official `status: "read"` request immediately after the local commit and recover transient failures through a lease-based processor running inside the existing single Node container.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, PostgreSQL 18, Vitest 4, Meta WhatsApp Cloud API, Docker Compose on the existing KVM.

## Global Constraints

- Use only the official WhatsApp Cloud API; do not automate WhatsApp Web or add unofficial protocol libraries.
- A read receipt targets only an inbound, non-revoked message with a valid `whatsappMessageId` received no more than 30 days ago.
- Marking a message read in Meta also marks all earlier messages in that conversation read; keep only the newest target per conversation.
- The shared local read transaction must succeed independently of Meta availability and must never regress.
- A mobile-app-only read cannot be inferred; continue using `smb_message_echoes` only for actual messages sent from the official app.
- Retry delays are exactly 2 seconds, 10 seconds, 30 seconds, 2 minutes, 10 minutes, then 30 minutes until the 30-day eligibility window expires.
- The retry processor runs every 5 seconds in the existing Node process; do not add another production service.
- Never log Meta tokens, message bodies, full provider payloads, or unsanitized provider responses.
- Preserve and integrate parallel work before production deployment; do not overwrite unrelated changes.
- Execute inline without subagents.

---

## File Map

- `prisma/schema.prisma`: declare the synchronization model, relations, and failure enum.
- `prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql`: add the durable queue and due-work index.
- `prisma/whatsapp-read-receipt-contract.test.ts`: verify migration structure and database constraints.
- `src/test/database.ts`: delete synchronization rows before message/conversation fixtures.
- `src/modules/whatsapp/provider.ts`: expose the provider-level `markRead` contract.
- `src/modules/whatsapp/meta-provider.ts`: issue and validate the official Meta request.
- `src/modules/whatsapp/demo-provider.ts`: provide deterministic no-network acknowledgement.
- `src/modules/whatsapp/meta-provider.test.ts`: cover exact request and safe failure handling.
- `src/modules/read-receipts/types.ts`: define boundaries, claims, repository interfaces, and public delivery outcomes.
- `src/modules/read-receipts/repository.ts`: select eligible targets and implement durable PostgreSQL claiming/finalization.
- `src/modules/read-receipts/repository.integration.test.ts`: prove target monotonicity, leasing, and crash recovery.
- `src/modules/read-receipts/service.ts`: send receipts, classify failures, and calculate retries.
- `src/modules/read-receipts/service.test.ts`: cover success, rejection, transient failure, and retry timing.
- `src/modules/read-receipts/worker.ts`: run one bounded due-work drain every five seconds.
- `src/modules/read-receipts/worker.test.ts`: verify singleton, overlap prevention, and bounded draining.
- `src/modules/conversations/shared-state.ts`: enqueue an eligible provider target in the existing read transaction.
- `src/modules/conversations/shared-state.integration.test.ts`: prove shared local state and target enqueue are atomic and concurrent-safe.
- `src/app/api/conversations/[id]/read/route.ts`: publish local state first, then attempt immediate provider delivery without changing local success semantics.
- `src/app/api/conversations/[id]/read/route.test.ts`: verify ordering, response status, and failure isolation.
- `src/instrumentation.ts`: start the internal retry processor once in the Node runtime.
- `src/instrumentation.test.ts`: verify runtime gating and singleton startup.
- `src/integrated-messaging-release.test.ts`: add a release-level contract for the new migration and provider method.
- `docs/verification/2026-08-23-whatsapp-read-receipt-sync.md`: record local, database, build, deployment, and production evidence.

---

### Task 1: Durable read-receipt synchronization state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql`
- Create: `prisma/whatsapp-read-receipt-contract.test.ts`
- Modify: `src/test/database.ts`

**Interfaces:**
- Produces: Prisma model `WhatsAppReadSync`, enum `ReadReceiptFailureKind`, and relations `Conversation.whatsappReadSync`, `Message.readSyncTargets`, `Message.readSyncConfirmations`, and `Message.readSyncFailures`.
- Consumes: existing `Conversation`, `Message`, UUID, and timestamptz conventions.

- [ ] **Step 1: Write the failing migration contract test**

```ts
// prisma/whatsapp-read-receipt-contract.test.ts
// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/202608230002_whatsapp_read_receipts/migration.sql",
  import.meta.url,
);

describe("WhatsApp read receipt migration", () => {
  it("creates one durable monotonic synchronization row per conversation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('CREATE TABLE "whatsapp_read_sync"');
    expect(sql).toMatch(/"conversation_id" UUID PRIMARY KEY/u);
    expect(sql).toMatch(/"target_message_id" UUID NOT NULL/u);
    expect(sql).toMatch(/"confirmed_message_id" UUID/u);
    expect(sql).toMatch(/"failed_target_message_id" UUID/u);
    expect(sql).toMatch(/CHECK \("attempt_count" >= 0\)/u);
    expect(sql).toContain('CREATE INDEX "whatsapp_read_sync_due_idx"');
    expect(sql).toMatch(/FOREIGN KEY \("conversation_id"\).*ON DELETE CASCADE/u);
    expect(sql).toMatch(/FOREIGN KEY \("target_message_id"\).*ON DELETE CASCADE/u);
  });
});
```

- [ ] **Step 2: Run the contract test and verify the missing migration failure**

Run: `npx vitest run prisma/whatsapp-read-receipt-contract.test.ts`

Expected: FAIL because `202608230002_whatsapp_read_receipts/migration.sql` does not exist.

- [ ] **Step 3: Add the Prisma model and migration**

Add to `prisma/schema.prisma`:

```prisma
enum ReadReceiptFailureKind {
  TRANSIENT
  REJECTED
}

model WhatsAppReadSync {
  conversationId       String                  @id @map("conversation_id") @db.Uuid
  targetMessageId      String                  @map("target_message_id") @db.Uuid
  confirmedMessageId   String?                 @map("confirmed_message_id") @db.Uuid
  failedTargetMessageId String?                @map("failed_target_message_id") @db.Uuid
  attemptCount         Int                     @default(0) @map("attempt_count")
  nextAttemptAt        DateTime?               @map("next_attempt_at") @db.Timestamptz(3)
  leaseId              String?                 @map("lease_id") @db.Uuid
  leaseUntil           DateTime?               @map("lease_until") @db.Timestamptz(3)
  lastFailureKind      ReadReceiptFailureKind? @map("last_failure_kind")
  createdAt            DateTime                @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime                @updatedAt @map("updated_at") @db.Timestamptz(3)
  conversation         Conversation            @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  targetMessage        Message                 @relation("ReadSyncTarget", fields: [targetMessageId], references: [id], onDelete: Cascade)
  confirmedMessage     Message?                @relation("ReadSyncConfirmed", fields: [confirmedMessageId], references: [id], onDelete: SetNull)
  failedTargetMessage  Message?                @relation("ReadSyncFailed", fields: [failedTargetMessageId], references: [id], onDelete: SetNull)

  @@index([nextAttemptAt, leaseUntil], map: "whatsapp_read_sync_due_idx")
  @@map("whatsapp_read_sync")
}
```

Add these relation fields:

```prisma
// Conversation
whatsappReadSync WhatsAppReadSync?

// Message
readSyncTargets       WhatsAppReadSync[] @relation("ReadSyncTarget")
readSyncConfirmations WhatsAppReadSync[] @relation("ReadSyncConfirmed")
readSyncFailures      WhatsAppReadSync[] @relation("ReadSyncFailed")
```

Create `prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql`:

```sql
CREATE TYPE "ReadReceiptFailureKind" AS ENUM ('TRANSIENT', 'REJECTED');

CREATE TABLE "whatsapp_read_sync" (
  "conversation_id" UUID PRIMARY KEY,
  "target_message_id" UUID NOT NULL,
  "confirmed_message_id" UUID,
  "failed_target_message_id" UUID,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "lease_id" UUID,
  "lease_until" TIMESTAMPTZ(3),
  "last_failure_kind" "ReadReceiptFailureKind",
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_read_sync_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "whatsapp_read_sync_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_target_message_id_fkey" FOREIGN KEY ("target_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_confirmed_message_id_fkey" FOREIGN KEY ("confirmed_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_read_sync_failed_target_message_id_fkey" FOREIGN KEY ("failed_target_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "whatsapp_read_sync_due_idx"
  ON "whatsapp_read_sync" ("next_attempt_at", "lease_until");
```

Update `resetTestDatabase()` so `prisma.whatsAppReadSync.deleteMany()` appears before `message.deleteMany()`.

- [ ] **Step 4: Generate Prisma and run schema/database contracts**

Run: `npm run db:generate`

Run: `npm run db:validate`

Run: `npx vitest run prisma/whatsapp-read-receipt-contract.test.ts prisma/temporal-contract.test.ts`

Expected: all commands exit 0 and both test files pass.

- [ ] **Step 5: Commit the database contract**

```powershell
git add -- prisma/schema.prisma prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql prisma/whatsapp-read-receipt-contract.test.ts src/test/database.ts src/generated/prisma
git commit -m "feat: persist WhatsApp read receipt synchronization"
```

---

### Task 2: Official provider operation

**Files:**
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/media/service.test.ts`
- Modify: `src/modules/media/service.integration.test.ts`

**Interfaces:**
- Produces: `WhatsAppProvider.markRead(input: { messageId: string }): Promise<void>`.
- Consumes: existing Meta endpoint builder, bounded JSON parser, timeout wrapper, and `WhatsAppProviderError` classification.

- [ ] **Step 1: Write failing provider tests**

Append to `src/modules/whatsapp/meta-provider.test.ts`:

```ts
it("marks an inbound message read with the exact official payload", async () => {
  const fetchMock = vi.fn(async () => new Response('{"success":true}', {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  const provider = new MetaWhatsAppProvider(config, fetchMock);

  await expect(provider.markRead({ messageId: "wamid.inbound-1" })).resolves.toBeUndefined();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://graph.facebook.com/v23.0/123/messages");
  expect(init).toMatchObject({
    method: "POST",
    headers: {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    },
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    messaging_product: "whatsapp",
    status: "read",
    message_id: "wamid.inbound-1",
  });
});

it.each([
  ["false success", '{"success":false}'],
  ["missing success", '{}'],
])("rejects an invalid read acknowledgement: %s", async (_name, body) => {
  const provider = new MetaWhatsAppProvider(
    config,
    vi.fn(async () => new Response(body, { status: 200 })),
  );
  await expect(provider.markRead({ messageId: "wamid.inbound-1" }))
    .rejects.toMatchObject({ name: "WhatsAppProviderError", kind: "unknown" });
});
```

- [ ] **Step 2: Run the provider tests and verify the missing method failure**

Run: `npx vitest run src/modules/whatsapp/meta-provider.test.ts`

Expected: FAIL because `markRead` is not part of `MetaWhatsAppProvider`.

- [ ] **Step 3: Add the provider contract and implementations**

Add to `WhatsAppProvider` in `src/modules/whatsapp/provider.ts`:

```ts
markRead(input: { messageId: string }): Promise<void>;
```

Add to `MetaWhatsAppProvider`:

```ts
async markRead(input: { messageId: string }): Promise<void> {
  await this.operation(async (signal) => {
    const response = await this.request(
      this.endpoint(`${encodeURIComponent(this.config.phoneNumberId)}/messages`),
      {
        method: "POST",
        headers: this.authorizationHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
        }),
        signal,
      },
    );
    const payload = await this.json(response, signal);
    if (payload.success !== true) throw unknownProviderError();
  });
}
```

Add to `DemoWhatsAppProvider`:

```ts
async markRead(_input: { messageId: string }): Promise<void> {}
```

Add the same no-op method to each test class that implements `WhatsAppProvider` in `messages/service.test.ts`, `media/service.test.ts`, and `media/service.integration.test.ts`:

```ts
async markRead(_input: { messageId: string }): Promise<void> {}
```

- [ ] **Step 4: Run provider and provider-consumer tests**

Run: `npx vitest run src/modules/whatsapp/meta-provider.test.ts src/modules/messages/service.test.ts src/modules/media/service.test.ts src/modules/media/service.integration.test.ts src/modules/reactions/service.test.ts`

Expected: all five files pass and every fake provider implements `markRead`.

- [ ] **Step 5: Commit the provider operation**

```powershell
git add -- src/modules/whatsapp/provider.ts src/modules/whatsapp/meta-provider.ts src/modules/whatsapp/demo-provider.ts src/modules/whatsapp/meta-provider.test.ts src/modules/messages/service.test.ts src/modules/media/service.test.ts src/modules/media/service.integration.test.ts
git commit -m "feat: mark inbound WhatsApp messages read"
```

---

### Task 3: Eligible-target selection inside the shared read transaction

**Files:**
- Create: `src/modules/read-receipts/types.ts`
- Create: `src/modules/read-receipts/repository.ts`
- Create: `src/modules/read-receipts/repository.integration.test.ts`
- Modify: `src/modules/conversations/shared-state.ts`
- Modify: `src/modules/conversations/shared-state.integration.test.ts`

**Interfaces:**
- Produces: `queueEligibleReadTarget(client, input): Promise<string | null>` and `THIRTY_DAYS_MS`.
- Consumes: `compareBoundary`, an already locked conversation transaction, `MessageDirection.INBOUND`, and `WhatsAppReadSync`.

- [ ] **Step 1: Define types and write failing target-selection integration tests**

Create `src/modules/read-receipts/types.ts`:

```ts
import type { Prisma } from "@/generated/prisma/client";
import type { ReadReceiptFailureKind } from "@/generated/prisma/enums";

export type ReadBoundary = { id: string; externalTimestamp: Date };
export type ReadSyncClient = Prisma.TransactionClient;
export type ReadReceiptDelivery = "CONFIRMED" | "PENDING" | "NOT_APPLICABLE";

export type ReadReceiptClaim = {
  conversationId: string;
  targetMessageId: string;
  whatsappMessageId: string;
  externalTimestamp: Date;
  attemptCount: number;
  leaseId: string;
};

export type ReadReceiptFailure = {
  kind: ReadReceiptFailureKind;
  nextAttemptAt: Date | null;
};
```

In `repository.integration.test.ts`, seed five ordered messages: eligible inbound, outbound, inbound without `wamid`, revoked inbound, and inbound older than 30 days. Assert:

```ts
const target = await prisma.$transaction((tx) => queueEligibleReadTarget(tx, {
  conversationId: conversation.id,
  visibleBoundary: { id: outbound.id, externalTimestamp: outbound.externalTimestamp },
  now,
}));
expect(target).toBe(eligibleInbound.id);
await expect(prisma.whatsAppReadSync.findUnique({
  where: { conversationId: conversation.id },
})).resolves.toMatchObject({
  targetMessageId: eligibleInbound.id,
  confirmedMessageId: null,
  attemptCount: 0,
  nextAttemptAt: now,
});
```

Add a second test that queues a newer eligible inbound target, then calls the function with the older boundary and asserts the target never regresses.

- [ ] **Step 2: Run target-selection tests and verify the missing repository failure**

Run: `npx vitest run src/modules/read-receipts/repository.integration.test.ts`

Expected: FAIL because `queueEligibleReadTarget` does not exist.

- [ ] **Step 3: Implement target selection and monotonic upsert**

Create the start of `src/modules/read-receipts/repository.ts`:

```ts
import "server-only";
import { MessageDirection } from "@/generated/prisma/enums";
import { compareBoundary } from "@/modules/conversations/shared-state";
import type { ReadBoundary, ReadSyncClient } from "./types";

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export async function queueEligibleReadTarget(
  client: ReadSyncClient,
  input: {
    conversationId: string;
    visibleBoundary: ReadBoundary;
    now: Date;
  },
): Promise<string | null> {
  const eligible = await client.message.findFirst({
    where: {
      conversationId: input.conversationId,
      direction: MessageDirection.INBOUND,
      whatsappMessageId: { not: null },
      revokedAt: null,
      externalTimestamp: {
        gte: new Date(input.now.getTime() - THIRTY_DAYS_MS),
        lte: input.visibleBoundary.externalTimestamp,
      },
      OR: [
        { externalTimestamp: { lt: input.visibleBoundary.externalTimestamp } },
        {
          externalTimestamp: input.visibleBoundary.externalTimestamp,
          id: { lte: input.visibleBoundary.id },
        },
      ],
    },
    orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
    select: { id: true, externalTimestamp: true },
  });
  if (!eligible) return null;

  const current = await client.whatsAppReadSync.findUnique({
    where: { conversationId: input.conversationId },
    select: { targetMessage: { select: { id: true, externalTimestamp: true } } },
  });
  if (current && compareBoundary(eligible, current.targetMessage) <= 0) {
    return current.targetMessage.id;
  }

  await client.whatsAppReadSync.upsert({
    where: { conversationId: input.conversationId },
    create: {
      conversationId: input.conversationId,
      targetMessageId: eligible.id,
      nextAttemptAt: input.now,
    },
    update: {
      targetMessageId: eligible.id,
      attemptCount: 0,
      nextAttemptAt: input.now,
      lastFailureKind: null,
      failedTargetMessageId: null,
    },
  });
  return eligible.id;
}
```

Because `shared-state.ts` is imported by the repository, move `compareBoundary` into `src/modules/conversations/boundary.ts`, re-export it from `shared-state.ts`, and import it from `boundary.ts` in both modules to avoid a cycle.

- [ ] **Step 4: Enqueue inside `advanceSharedRead` and prove atomicity**

In `advanceSharedRead`, after `upsertIndividualRead` and before the audit event, add:

```ts
await queueEligibleReadTarget(transaction, {
  conversationId,
  visibleBoundary: target,
  now: new Date(),
});
```

Add an optional `now: Date = new Date()` parameter before `client` so integration tests can enforce the 30-day boundary deterministically, and pass `now` to the queue function.

Extend `shared-state.integration.test.ts` to assert that two users opening the same conversation concurrently produce one sync row whose target is the newest inbound message, while both individual read audits exist and shared unread count is zero.

- [ ] **Step 5: Run shared state and repository integration tests**

Run: `npx vitest run src/modules/read-receipts/repository.integration.test.ts src/modules/conversations/shared-state.integration.test.ts src/modules/conversations/service.test.ts`

Expected: all three files pass.

- [ ] **Step 6: Commit atomic target enqueueing**

```powershell
git add -- src/modules/read-receipts/types.ts src/modules/read-receipts/repository.ts src/modules/read-receipts/repository.integration.test.ts src/modules/conversations/boundary.ts src/modules/conversations/shared-state.ts src/modules/conversations/shared-state.integration.test.ts src/modules/conversations/service.test.ts
git commit -m "feat: queue read receipts with shared inbox state"
```

---

### Task 4: Lease-based delivery and retry classification

**Files:**
- Modify: `src/modules/read-receipts/types.ts`
- Modify: `src/modules/read-receipts/repository.ts`
- Modify: `src/modules/read-receipts/repository.integration.test.ts`
- Create: `src/modules/read-receipts/service.ts`
- Create: `src/modules/read-receipts/service.test.ts`

**Interfaces:**
- Produces: `deliverReadReceiptForConversation(conversationId, dependencies?)`, `processNextDueReadReceipt(dependencies?)`, and `retryDelayMs(attemptCount)`.
- Consumes: `WhatsAppProvider.markRead`, `WhatsAppProviderError.kind`, persisted claims, and the 30-day eligibility rule.

- [ ] **Step 1: Write failing retry and delivery service tests**

Create `service.test.ts` with a fake repository and provider. Assert this exact delay table:

```ts
expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([
  2_000,
  10_000,
  30_000,
  120_000,
  600_000,
  1_800_000,
  1_800_000,
]);
```

Add these cases:

```ts
it("confirms an accepted provider receipt", async () => {
  repository.claim = claim;
  await expect(deliverReadReceiptForConversation(claim.conversationId, deps))
    .resolves.toBe("CONFIRMED");
  expect(provider.markRead).toHaveBeenCalledWith({ messageId: claim.whatsappMessageId });
  expect(repository.confirm).toHaveBeenCalledWith(claim, now);
});

it("keeps local success pending after an unknown provider result", async () => {
  provider.markRead.mockRejectedValue(new WhatsAppProviderError("unknown"));
  await expect(deliverReadReceiptForConversation(claim.conversationId, deps))
    .resolves.toBe("PENDING");
  expect(repository.fail).toHaveBeenCalledWith(claim, {
    kind: "TRANSIENT",
    nextAttemptAt: new Date(now.getTime() + 2_000),
  });
});

it("blocks only the rejected target", async () => {
  provider.markRead.mockRejectedValue(new WhatsAppProviderError("rejected"));
  await expect(deliverReadReceiptForConversation(claim.conversationId, deps))
    .resolves.toBe("PENDING");
  expect(repository.fail).toHaveBeenCalledWith(claim, {
    kind: "REJECTED",
    nextAttemptAt: null,
  });
});
```

- [ ] **Step 2: Run the service tests and verify missing exports**

Run: `npx vitest run src/modules/read-receipts/service.test.ts`

Expected: FAIL because delivery service exports do not exist.

- [ ] **Step 3: Add repository claim/finalize interfaces**

Extend `types.ts`:

```ts
export interface ReadReceiptRepository {
  claimConversation(input: {
    conversationId: string;
    now: Date;
    leaseId: string;
    leaseUntil: Date;
  }): Promise<ReadReceiptClaim | null>;
  claimNextDue(input: {
    now: Date;
    leaseId: string;
    leaseUntil: Date;
  }): Promise<ReadReceiptClaim | null>;
  confirm(claim: ReadReceiptClaim, confirmedAt: Date): Promise<void>;
  fail(claim: ReadReceiptClaim, failure: ReadReceiptFailure): Promise<void>;
}
```

Implement both claims in `repository.ts` with a PostgreSQL transaction:

```ts
await tx.$executeRaw`
  UPDATE whatsapp_read_sync wrs
  SET next_attempt_at = NULL,
      failed_target_message_id = wrs.target_message_id,
      last_failure_kind = 'REJECTED'::"ReadReceiptFailureKind",
      lease_id = NULL,
      lease_until = NULL,
      updated_at = ${input.now}
  FROM messages target
  WHERE target.id = wrs.target_message_id
    AND wrs.next_attempt_at IS NOT NULL
    AND target.external_timestamp < ${new Date(input.now.getTime() - THIRTY_DAYS_MS)}
`;

const rows = await tx.$queryRaw<Array<{ conversation_id: string }>>`
  SELECT wrs.conversation_id
  FROM whatsapp_read_sync wrs
  JOIN messages target ON target.id = wrs.target_message_id
  WHERE wrs.next_attempt_at <= ${input.now}
    AND (wrs.lease_until IS NULL OR wrs.lease_until <= ${input.now})
    AND wrs.target_message_id IS DISTINCT FROM wrs.confirmed_message_id
    AND wrs.target_message_id IS DISTINCT FROM wrs.failed_target_message_id
    AND target.revoked_at IS NULL
    AND target.external_timestamp >= ${new Date(input.now.getTime() - THIRTY_DAYS_MS)}
  ORDER BY wrs.next_attempt_at ASC, wrs.updated_at ASC
  FOR UPDATE OF wrs SKIP LOCKED
  LIMIT 1
`;
```

The first statement parks targets that have aged out of Meta's 30-day window so the worker does not rescan them forever.

For `claimConversation`, add `AND wrs.conversation_id = ${input.conversationId}::uuid`. After selecting, update `lease_id`, `lease_until`, and increment `attempt_count`; return the target `whatsappMessageId`, timestamp, resulting attempt count, and supplied lease ID.

`confirm` must update only `WHERE conversationId AND leaseId`, set `confirmedMessageId` to `claim.targetMessageId`, clear the lease and failure fields, and set `nextAttemptAt` to `now` only when a newer target remains; otherwise set it to null.

`fail` must update only the lease owner, clear the lease, set `lastFailureKind`, set `failedTargetMessageId` only for `REJECTED`, and persist `nextAttemptAt`.

- [ ] **Step 4: Add integration tests for lease ownership and crash recovery**

Test two independent repository objects claiming the same due row concurrently; assert exactly one claim is non-null. Advance the target while the first claim is held, confirm the older claim, and assert the newer target remains due. Expire a lease in the database and assert a new owner can reclaim it.

Run: `npx vitest run src/modules/read-receipts/repository.integration.test.ts`

Expected: PASS for monotonic target, single owner, newer-target preservation, and expired-lease recovery.

- [ ] **Step 5: Implement the delivery service**

Create `service.ts`:

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { ReadReceiptFailureKind } from "@/generated/prisma/enums";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import { prismaReadReceiptRepository } from "./repository";
import type { ReadReceiptClaim, ReadReceiptDelivery, ReadReceiptRepository } from "./types";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";

const LEASE_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 120_000, 600_000] as const;

export function retryDelayMs(attemptCount: number): number {
  if (attemptCount > RETRY_DELAYS_MS.length) return 1_800_000;
  return RETRY_DELAYS_MS[Math.max(attemptCount, 1) - 1] ?? 2_000;
}

export type ReadReceiptServiceDependencies = {
  repository: ReadReceiptRepository;
  provider: Pick<WhatsAppProvider, "markRead">;
  now?: () => Date;
  createUuid?: () => string;
  leaseMs?: number;
};

const defaults: ReadReceiptServiceDependencies = {
  repository: prismaReadReceiptRepository,
  provider: getWhatsAppProvider(),
};

async function deliverClaim(
  claim: ReadReceiptClaim,
  dependencies: ReadReceiptServiceDependencies,
): Promise<ReadReceiptDelivery> {
  const clock = dependencies.now ?? (() => new Date());
  try {
    await dependencies.provider.markRead({ messageId: claim.whatsappMessageId });
    await dependencies.repository.confirm(claim, clock());
    return "CONFIRMED";
  } catch (error) {
    const rejected = error instanceof WhatsAppProviderError && error.kind === "rejected";
    const failedAt = clock();
    await dependencies.repository.fail(claim, {
      kind: rejected ? ReadReceiptFailureKind.REJECTED : ReadReceiptFailureKind.TRANSIENT,
      nextAttemptAt: rejected
        ? null
        : new Date(failedAt.getTime() + retryDelayMs(claim.attemptCount)),
    });
    return "PENDING";
  }
}

async function claimInput(dependencies: ReadReceiptServiceDependencies) {
  const now = (dependencies.now ?? (() => new Date()))();
  return {
    now,
    leaseId: (dependencies.createUuid ?? randomUUID)(),
    leaseUntil: new Date(now.getTime() + (dependencies.leaseMs ?? LEASE_MS)),
  };
}

export async function deliverReadReceiptForConversation(
  conversationId: string,
  dependencies: ReadReceiptServiceDependencies = defaults,
): Promise<ReadReceiptDelivery> {
  const claim = await dependencies.repository.claimConversation({
    conversationId,
    ...(await claimInput(dependencies)),
  });
  return claim ? deliverClaim(claim, dependencies) : "NOT_APPLICABLE";
}

export async function processNextDueReadReceipt(
  dependencies: ReadReceiptServiceDependencies = defaults,
): Promise<boolean> {
  const claim = await dependencies.repository.claimNextDue(await claimInput(dependencies));
  if (!claim) return false;
  await deliverClaim(claim, dependencies);
  return true;
}
```

- [ ] **Step 6: Run delivery unit and integration tests**

Run: `npx vitest run src/modules/read-receipts/service.test.ts src/modules/read-receipts/repository.integration.test.ts`

Expected: both files pass.

- [ ] **Step 7: Commit lease-based delivery**

```powershell
git add -- src/modules/read-receipts
git commit -m "feat: retry WhatsApp read receipts durably"
```

---

### Task 5: Read route orchestration and internal processor

**Files:**
- Modify: `src/app/api/conversations/[id]/read/route.ts`
- Modify: `src/app/api/conversations/[id]/read/route.test.ts`
- Create: `src/modules/read-receipts/worker.ts`
- Create: `src/modules/read-receipts/worker.test.ts`
- Create: `src/instrumentation.ts`
- Create: `src/instrumentation.test.ts`

**Interfaces:**
- Produces: read-route response `SharedConversationStateDto & { whatsappReadReceipt: ReadReceiptDelivery }`, `startReadReceiptWorker()`, and Next.js `register()`.
- Consumes: `deliverReadReceiptForConversation`, `processNextDueReadReceipt`, and existing realtime publication.

- [ ] **Step 1: Write failing route orchestration tests**

Extend route dependencies with `deliverReadReceipt`. Update the primary test to assert this call order:

```ts
expect(calls).toEqual([
  "origin",
  "auth",
  "service",
  "publish",
  "provider-read",
]);
expect(await response.json()).toEqual({
  data: { ...state, whatsappReadReceipt: "CONFIRMED" },
  error: null,
});
```

Add a pending case:

```ts
it("keeps local read success when Meta remains pending", async () => {
  const { POST } = createConversationReadRouteHandlers({
    assertSameOrigin: () => undefined,
    requireUser: async () => actor,
    markSharedRead: async () => state,
    publishRealtime: () => undefined,
    deliverReadReceipt: async () => "PENDING",
  });
  const response = await POST(validRequest(), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    data: { ...state, whatsappReadReceipt: "PENDING" },
    error: null,
  });
});
```

Add another case where `deliverReadReceipt` throws a repository error after `markSharedRead` has committed. Assert the response is still `200`, contains `whatsappReadReceipt: "PENDING"`, and the realtime event was already published.

- [ ] **Step 2: Run route tests and verify dependency/response failures**

Run: `npx vitest run 'src/app/api/conversations/[id]/read/route.test.ts'`

Expected: FAIL because the route does not call a provider receipt service or return `whatsappReadReceipt`.

- [ ] **Step 3: Orchestrate local state, realtime, and immediate delivery**

Add `deliverReadReceipt: typeof deliverReadReceiptForConversation` to route dependencies. After `publishRealtime`, call:

```ts
let whatsappReadReceipt: ReadReceiptDelivery = "PENDING";
try {
  whatsappReadReceipt = await dependencies.deliverReadReceipt(parsedId);
} catch {
  // The durable target remains available to the retry worker.
}
return conversationSuccessResponse({ ...state, whatsappReadReceipt });
```

Provider and post-commit repository failures remain `PENDING`; validation, authentication, and the local shared-read transaction keep using the existing safe error response.

- [ ] **Step 4: Write failing worker tests**

Use fake timers and an injected `processNext` function. Assert:

```ts
const controller = startReadReceiptWorker({
  intervalMs: 5_000,
  maximumPerDrain: 25,
  processNext,
});
await controller.runNow();
expect(processNext).toHaveBeenCalledTimes(3); // true, true, false

const second = controller.runNow();
const third = controller.runNow();
expect(second).toBe(third); // overlapping drains are coalesced
```

Assert a second `startReadReceiptWorker()` call returns the same controller until `stop()` is called.

- [ ] **Step 5: Implement the bounded singleton worker**

Create `worker.ts`:

```ts
import "server-only";
import { processNextDueReadReceipt } from "./service";

export type ReadReceiptWorker = {
  runNow(): Promise<void>;
  stop(): void;
};

let singleton: ReadReceiptWorker | null = null;

export function startReadReceiptWorker(input: {
  intervalMs?: number;
  maximumPerDrain?: number;
  processNext?: () => Promise<boolean>;
} = {}): ReadReceiptWorker {
  if (singleton) return singleton;
  const intervalMs = input.intervalMs ?? 5_000;
  const maximum = input.maximumPerDrain ?? 25;
  const processNext = input.processNext ?? (() => processNextDueReadReceipt());
  let stopped = false;
  let active: Promise<void> | null = null;

  const runNow = () => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      for (let index = 0; index < maximum; index += 1) {
        if (stopped || !(await processNext())) break;
      }
    })().finally(() => { active = null; });
    return active;
  };
  const timer = setInterval(() => void runNow().catch(() => undefined), intervalMs);
  timer.unref?.();
  singleton = {
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
      singleton = null;
    },
  };
  void runNow().catch(() => undefined);
  return singleton;
}
```

- [ ] **Step 6: Start the worker only in the Node runtime**

Create `src/instrumentation.ts`:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startReadReceiptWorker } = await import("@/modules/read-receipts/worker");
  startReadReceiptWorker();
}
```

In `instrumentation.test.ts`, reset modules between cases, mock the worker module, and assert `register()` starts once for `NEXT_RUNTIME=nodejs` and never for `edge`.

- [ ] **Step 7: Run route, worker, instrumentation, and hook regressions**

Run: `npx vitest run 'src/app/api/conversations/[id]/read/route.test.ts' src/modules/read-receipts/worker.test.ts src/instrumentation.test.ts src/hooks/use-inbox.test.tsx src/components/inbox/conversation-view.test.tsx`

Expected: all five files pass.

- [ ] **Step 8: Commit orchestration and worker startup**

```powershell
git add -- 'src/app/api/conversations/[id]/read/route.ts' 'src/app/api/conversations/[id]/read/route.test.ts' src/modules/read-receipts/worker.ts src/modules/read-receipts/worker.test.ts src/instrumentation.ts src/instrumentation.test.ts
git commit -m "feat: synchronize shared reads with WhatsApp"
```

---

### Task 6: Release contract and full local verification

**Files:**
- Modify: `src/integrated-messaging-release.test.ts`
- Modify: `README.md`
- Create: `docs/verification/2026-08-23-whatsapp-read-receipt-sync.md`

**Interfaces:**
- Produces: release-level evidence that schema, provider, shared state, retry worker, and official constraints ship together.
- Consumes: all preceding tasks.

- [ ] **Step 1: Add a failing integrated release contract**

Append assertions to `src/integrated-messaging-release.test.ts`:

```ts
it("ships shared official read receipts as one release", () => {
  expect(source("prisma/migrations/202608230002_whatsapp_read_receipts/migration.sql"))
    .toContain('CREATE TABLE "whatsapp_read_sync"');
  expect(source("src/modules/whatsapp/provider.ts"))
    .toContain('markRead(input: { messageId: string }): Promise<void>');
  expect(source("src/modules/conversations/shared-state.ts"))
    .toContain("queueEligibleReadTarget");
  expect(source("src/instrumentation.ts"))
    .toContain("startReadReceiptWorker");
});
```

- [ ] **Step 2: Run the release contract**

Run: `npx vitest run src/integrated-messaging-release.test.ts`

Expected: PASS only when every implementation unit is present.

- [ ] **Step 3: Document operation and safe diagnostics**

Add a README section stating:

```md
### Confirmações de leitura

Abrir uma conversa avança primeiro a leitura compartilhada local e enfileira a mensagem recebida elegível mais recente. A aplicação envia `status: read` pela Cloud API e o processador interno tenta novamente confirmações transitórias. Consulte somente contagem, horários, concessões e categoria da falha em `whatsapp_read_sync`; nunca copie tokens, corpos de mensagem ou respostas Graph completas para logs.
```

Create the verification document with headings `Local`, `Banco de teste`, `Build`, `Integração paralela`, `Produção`, and `Rollback`. Fill each heading only with commands actually run and their observed results during execution.

- [ ] **Step 4: Run the complete local quality gate**

Run in order:

```powershell
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Expected: every command exits 0; the audit reports no production vulnerabilities.

- [ ] **Step 5: Self-review the implementation without subagents**

Run:

```powershell
git diff --check
git status --short
git log --oneline --decorate -12
rg -n 'WHATSAPP_ACCESS_TOKEN|Authorization: Bearer|message.body|console\.(log|error)' src/modules/read-receipts src/instrumentation.ts
```

Expected: no whitespace errors, only intentional worktree changes, no hard-coded token, and no message body logging. Review every changed file against the approved spec before continuing.

- [ ] **Step 6: Commit documentation and release contract**

```powershell
git add -- src/integrated-messaging-release.test.ts README.md docs/verification/2026-08-23-whatsapp-read-receipt-sync.md
git commit -m "docs: verify WhatsApp read receipt synchronization"
```

---

### Task 7: Integrate parallel work and deploy each completed feature safely

**Files:**
- Modify only when needed to resolve reviewed integration conflicts.
- Update: `docs/verification/2026-08-23-whatsapp-read-receipt-sync.md`

**Interfaces:**
- Produces: a production release containing read receipts plus all approved parallel changes, with backup and rollback coordinates.
- Consumes: clean, verified commits from Tasks 1-6 and the deployment procedure in `README.md`.

- [ ] **Step 1: Inventory every worktree and branch immediately before integration**

Run:

```powershell
git worktree list --porcelain
git branch -vv
git log --all --graph --decorate --oneline -30
```

Expected: identify the current tips for pinned conversations, search, read receipts, and the production branch. Record the hashes in the verification document.

- [ ] **Step 2: Integrate only reviewed parallel commits**

Inspect and integrate the two active parallel lines explicitly:

```powershell
$parallelBranches=@('codex/pinned-conversations','codex/xp-atendimento-mvp')
foreach($parallelBranch in $parallelBranches){
  git diff "HEAD...$parallelBranch" --stat
  git log "HEAD..$parallelBranch" --oneline
}
git merge --no-ff codex/pinned-conversations
git merge --no-ff codex/xp-atendimento-mvp
```

If either branch has a dirty worktree in Step 1, wait for its owner to commit before running these merges. Do not merge detached worktrees or unrelated historical feature branches.

After each merge, run the focused tests for both features and then:

```powershell
npm run typecheck
npm test
```

Expected: exit 0 before proceeding to deployment.

- [ ] **Step 3: Create a fresh production database backup**

Run:

```powershell
$sshKey='C:\Users\developer\.ssh\id_ed25519_deploy'
ssh -i $sshKey deploy@server.example.com "set -eu; stamp=\$(date -u +%Y%m%dT%H%M%SZ); mkdir -p /srv/backups/example-app; docker exec xp-whatsapp-database pg_dump -U xp_whatsapp -d xp_atendimento -Fc > /srv/backups/example-app/xp-whatsapp-\$stamp.dump; echo /srv/backups/example-app/xp-whatsapp-\$stamp.dump"
```

Expected: an absolute backup path under `/srv/backups/example-app` is printed and the file is non-empty.

- [ ] **Step 4: Transfer the exact verified revision and build with KVM limits**

Run locally:

```powershell
$revision=(git rev-parse HEAD).Trim()
$archive=Join-Path $env:TEMP "xp-whatsapp-$revision.tar"
git archive --format=tar --output=$archive $revision
scp -i 'C:\Users\developer\.ssh\id_ed25519_deploy' $archive "deploy@server.example.com:/tmp/xp-whatsapp-$revision.tar"
```

Run the build remotely with the same exact revision:

```powershell
$remoteBuild="set -eu; release_revision='$revision'; release_dir='/opt/apps/example-app/releases/$revision'; mkdir -p \"`$release_dir\"; tar -xf '/tmp/xp-whatsapp-$revision.tar' -C \"`$release_dir\"; cd \"`$release_dir\"; docker build --cpu-period 100000 --cpu-quota 50000 --memory 2g --memory-swap 3g --label \"org.opencontainers.image.revision=`$release_revision\" -t \"xp-whatsapp:`$release_revision\" ."
ssh -i 'C:\Users\developer\.ssh\id_ed25519_deploy' deploy@server.example.com $remoteBuild
```

Expected: build exits 0 without affecting other KVM containers.

- [ ] **Step 5: Apply migration and replace only the application container**

Follow the exact compose/release symlink procedure in `README.md`: validate the candidate environment, run `prisma migrate deploy` once, point `/opt/apps/example-app/current` to the new release, and recreate only `xp-whatsapp-app`. Do not recreate PostgreSQL, Caddy, catalog services, volumes, or networks.

Expected: migration `202608230002_whatsapp_read_receipts` is applied once and `xp-whatsapp-app` becomes healthy with restart count 0.

- [ ] **Step 6: Verify production without sending an unsolicited customer message**

Run remotely:

```bash
set -eu
curl -fsS http://127.0.0.1:3100/api/health
curl -fsS https://whatsapp.xpeletronicos.com/api/health
docker inspect --format '{{.State.Health.Status}} {{.RestartCount}} {{.Config.Image}}' xp-whatsapp-app
docker exec xp-whatsapp-database psql -U xp_whatsapp -d xp_atendimento -Atc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 3"
docker exec xp-whatsapp-database psql -U xp_whatsapp -d xp_atendimento -Atc "SELECT count(*) FROM whatsapp_read_sync"
docker logs --since 10m xp-whatsapp-app 2>&1 | grep -E 'Unhandled|FATAL|panic|token|Bearer' && exit 1 || true
```

Expected: both health endpoints return success, container health is `healthy`, restart count is 0, the migration is listed, and no unsafe/error pattern is emitted.

- [ ] **Step 7: Ask for one manual read-receipt test and record evidence**

Have the user send a new message from a controlled test contact, then open that conversation in the panel. Verify:

```sql
SELECT
  wrs.conversation_id,
  wrs.target_message_id,
  wrs.confirmed_message_id,
  wrs.attempt_count,
  wrs.next_attempt_at,
  wrs.last_failure_kind
FROM whatsapp_read_sync wrs
ORDER BY wrs.updated_at DESC
LIMIT 5;
```

Expected: the tested row has `target_message_id = confirmed_message_id`, `next_attempt_at IS NULL`, and the customer confirms two blue ticks. Also verify a second logged-in panel session shows the conversation read.

- [ ] **Step 8: Finalize verification and retain rollback coordinates**

Record the deployed commit, image ID, release directory, container ID, backup path, migration result, health responses, restart count, manual test, and previous release symlink target in `docs/verification/2026-08-23-whatsapp-read-receipt-sync.md`. Commit the evidence without including tokens, phone numbers, or message content.

```powershell
git add -- docs/verification/2026-08-23-whatsapp-read-receipt-sync.md
git commit -m "docs: record read receipt production verification"
```

Expected: the branch is clean and the verification document contains enough information to roll back the app image and restore the database backup if required.
