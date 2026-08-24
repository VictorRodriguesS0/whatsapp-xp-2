# Meta Quality Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only Meta health badge and settings page backed by operational webhooks and periodic Graph API reconciliation.

**Architecture:** Persist a current health snapshot and immutable alert transitions in PostgreSQL. Extend the signed webhook pipeline with bounded operational events, then reconcile queryable phone, WABA, and template state through a separate Graph client guarded by a database lease. Expose admin-only APIs and a small client hook shared by the inbox badge and the detailed settings page.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7/PostgreSQL 18, Zod 4, Vitest, Testing Library, existing SSE realtime hub, Meta Graph API.

## Global Constraints

- Execute inline without subagents; the user explicitly prohibited subagent implementation.
- Keep message composition and media rendering outside this feature's edits.
- Only `ADMIN` users can access the badge, page, data, acknowledgement, or sync actions.
- Poll the local summary every 60 seconds and consider a successful Graph snapshot stale after 15 minutes.
- Rate-limit manual refreshes to one per 60 seconds and expire a sync lease after 60 seconds.
- Never persist or display the Meta access token or raw Graph/webhook payloads.
- Unknown webhook fields must continue to return success and must not interrupt message ingestion.
- Treating an alert acknowledges it; only a positive Meta transition resolves it.
- Add no new npm dependency.
- Before deployment, audit the production image and every worktree/branch/uncommitted change; deploy only an integrated superset.

---

## File Structure

- `prisma/schema.prisma`: persisted snapshot, alerts, enums, and acknowledgement relation.
- `prisma/migrations/202608230003_meta_health/migration.sql`: additive production migration, sequenced after the parallel `202608230001` and `202608230002` migrations.
- `prisma/meta-health-contract.test.ts`: migration invariants and indexes.
- `src/modules/meta-health/types.ts`: server/client DTOs and provider-neutral remote state.
- `src/modules/meta-health/severity.ts`: pure severity, copy, resolution, and staleness rules.
- `src/modules/meta-health/graph-client.ts`: bounded Meta Graph reads and safe error mapping.
- `src/modules/meta-health/repository.ts`: snapshot lease and alert persistence operations.
- `src/modules/meta-health/service.ts`: summary, history, acknowledgement, and reconciliation orchestration.
- `src/modules/webhooks/types.ts`: normalized operational event union member.
- `src/modules/webhooks/normalize.ts`: allowlisted operational webhook parsing.
- `src/modules/webhooks/process.ts`: idempotent operational event persistence and realtime publication.
- `src/modules/realtime/events.ts`: `meta-health.updated` event contract.
- `src/app/api/meta-health/**/route.ts`: admin-only HTTP boundary.
- `src/hooks/use-meta-health.ts`: badge/page polling, stale sync trigger, and SSE convergence.
- `src/components/meta-health/meta-health-badge.tsx`: compact accessible admin badge.
- `src/components/meta-health/meta-health-screen.tsx`: detailed admin health page.
- `src/app/configuracoes/meta/page.tsx`: server-side admin guard and initial data.
- `src/components/inbox/inbox-shell.tsx`: one isolated badge mount for admins.

---

### Task 1: Persist snapshots and operational alerts

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608230003_meta_health/migration.sql`
- Create: `prisma/meta-health-contract.test.ts`

**Interfaces:**
- Produces: Prisma models `MetaHealthSnapshot` and `MetaOperationalAlert`.
- Produces: enums `MetaAlertCategory`, `MetaAlertSeverity`, and `MetaAlertSource`.
- Produces: relation `User.acknowledgedMetaAlerts`.

- [ ] **Step 1: Write the failing migration contract**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./migrations/202608230003_meta_health/migration.sql", import.meta.url),
  "utf8",
);

describe("meta health migration", () => {
  it("creates additive snapshot and alert storage with leases and acknowledgement", () => {
    expect(sql).toContain('CREATE TABLE "meta_health_snapshots"');
    expect(sql).toContain('CREATE TABLE "meta_operational_alerts"');
    expect(sql).toContain('"sync_lease_until" TIMESTAMPTZ(3)');
    expect(sql).toContain('"acknowledged_by_user_id" UUID');
    expect(sql).toContain('CREATE UNIQUE INDEX "meta_health_snapshots_phone_number_id_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "meta_operational_alerts_deduplication_key_key"');
  });
});
```

- [ ] **Step 2: Run the contract and confirm the missing migration fails**

Run: `npx vitest run prisma/meta-health-contract.test.ts`

Expected: FAIL because `202608230003_meta_health/migration.sql` does not exist.

- [ ] **Step 3: Add the Prisma enums, relations, and models**

Add these schema units, preserving the existing naming style:

```prisma
enum MetaAlertCategory {
  PHONE_QUALITY
  ACCOUNT
  ACCOUNT_REVIEW
  PHONE_NAME
  TEMPLATE
}

enum MetaAlertSeverity {
  INFO
  ATTENTION
  CRITICAL
}

enum MetaAlertSource {
  WEBHOOK
  RECONCILIATION
}

model MetaHealthSnapshot {
  id                       String                 @id @default(uuid()) @db.Uuid
  phoneNumberId            String                 @unique @map("phone_number_id")
  wabaId                   String                 @map("waba_id")
  displayPhoneNumber       String?                @map("display_phone_number")
  verifiedName             String?                @map("verified_name")
  qualityRating            String?                @map("quality_rating")
  accountReviewStatus      String?                @map("account_review_status")
  accountEvent             String?                @map("account_event")
  messagingLimit           String?                @map("messaging_limit")
  lastSyncAttemptAt        DateTime?              @map("last_sync_attempt_at") @db.Timestamptz(3)
  lastSuccessfulSyncAt     DateTime?              @map("last_successful_sync_at") @db.Timestamptz(3)
  lastSyncErrorCode        String?                @map("last_sync_error_code")
  syncLeaseId              String?                @map("sync_lease_id") @db.Uuid
  syncLeaseUntil           DateTime?              @map("sync_lease_until") @db.Timestamptz(3)
  createdAt                DateTime               @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                DateTime               @updatedAt @map("updated_at") @db.Timestamptz(3)
  alerts                   MetaOperationalAlert[]

  @@index([syncLeaseUntil])
  @@map("meta_health_snapshots")
}

model MetaOperationalAlert {
  id                     String                @id @default(uuid()) @db.Uuid
  snapshotId             String                @map("snapshot_id") @db.Uuid
  deduplicationKey       String?               @unique @map("deduplication_key")
  category               MetaAlertCategory
  severity               MetaAlertSeverity
  source                 MetaAlertSource
  sourceField            String                @map("source_field")
  eventCode              String                @map("event_code")
  resourceId             String?               @map("resource_id")
  summary                String
  details                Json?
  occurredAt             DateTime              @map("occurred_at") @db.Timestamptz(3)
  active                 Boolean               @default(true)
  resolvedAt             DateTime?             @map("resolved_at") @db.Timestamptz(3)
  acknowledgedAt         DateTime?             @map("acknowledged_at") @db.Timestamptz(3)
  acknowledgedByUserId   String?               @map("acknowledged_by_user_id") @db.Uuid
  createdAt              DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt              DateTime              @updatedAt @map("updated_at") @db.Timestamptz(3)
  snapshot               MetaHealthSnapshot    @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  acknowledgedByUser     User?                 @relation("MetaAlertAcknowledgement", fields: [acknowledgedByUserId], references: [id], onDelete: SetNull)

  @@index([snapshotId, active, severity, occurredAt])
  @@index([occurredAt, id])
  @@map("meta_operational_alerts")
}
```

Add `acknowledgedMetaAlerts MetaOperationalAlert[] @relation("MetaAlertAcknowledgement")` to `User`.

- [ ] **Step 4: Generate the additive SQL migration and client**

Run: `npm run db:generate`

Create the migration SQL matching the schema with `CREATE TYPE`, `CREATE TABLE`, indexes, and foreign keys only. Do not alter or drop existing tables or columns.

- [ ] **Step 5: Run schema and migration tests**

Run: `npm run db:validate && npx vitest run prisma/meta-health-contract.test.ts prisma/temporal-contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the persistence layer**

```bash
git add prisma/schema.prisma prisma/migrations/202608230003_meta_health/migration.sql prisma/meta-health-contract.test.ts src/generated
git commit -m "feat: persist Meta health alerts"
```

---

### Task 2: Define deterministic health and severity rules

**Files:**
- Create: `src/modules/meta-health/types.ts`
- Create: `src/modules/meta-health/severity.ts`
- Create: `src/modules/meta-health/severity.test.ts`

**Interfaces:**
- Produces: `MetaHealthLabel = "NORMAL" | "ATTENTION" | "CRITICAL" | "STALE"`.
- Produces: `deriveMetaHealthLabel(input, now): MetaHealthLabel`.
- Produces: `describeMetaTransition(field, eventCode): MetaTransitionDescription`.
- Produces: DTOs `MetaHealthSummaryDto`, `MetaOperationalAlertDto`, and `MetaHealthRemoteState`.

- [ ] **Step 1: Write failing table-driven severity tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveMetaHealthLabel, describeMetaTransition } from "./severity";

describe("Meta health severity", () => {
  it.each([
    ["GREEN", [], "NORMAL"],
    ["YELLOW", [], "ATTENTION"],
    ["RED", [], "CRITICAL"],
    ["GREEN", ["ACCOUNT_DISABLED"], "CRITICAL"],
    ["GREEN", ["TEMPLATE_REJECTED"], "ATTENTION"],
  ] as const)("maps %s and %j to %s", (qualityRating, activeCodes, expected) => {
    expect(deriveMetaHealthLabel({ qualityRating, activeCodes, lastSuccessfulSyncAt: new Date("2026-08-23T12:00:00Z") }, new Date("2026-08-23T12:10:00Z"))).toBe(expected);
  });

  it("never hides a known critical state behind stale", () => {
    expect(deriveMetaHealthLabel({ qualityRating: "RED", activeCodes: [], lastSuccessfulSyncAt: new Date("2026-08-23T10:00:00Z") }, new Date("2026-08-23T12:00:00Z"))).toBe("CRITICAL");
  });

  it("returns stale when freshness is unknown and no stronger state exists", () => {
    expect(deriveMetaHealthLabel({ qualityRating: null, activeCodes: [], lastSuccessfulSyncAt: null }, new Date("2026-08-23T12:00:00Z"))).toBe("STALE");
  });

  it("uses safe Portuguese copy for documented events", () => {
    expect(describeMetaTransition("phone_number_quality_update", "FLAGGED")).toMatchObject({ severity: "ATTENTION", summary: "Número sinalizado pela Meta", resolvesCodes: [] });
    expect(describeMetaTransition("account_update", "DISABLED_UPDATE")).toMatchObject({ severity: "CRITICAL", summary: "Conta desativada pela Meta" });
  });
});
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `npx vitest run src/modules/meta-health/severity.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement bounded DTOs and the event mapping table**

Use explicit unions for label, remote quality, alert category/source/severity, and cursor pagination. Implement `describeMetaTransition` as an allowlisted record keyed by `${field}:${eventCode}`. Positive transitions must list the prior codes they resolve; unknown documented values map to `INFO` copy without interpolating raw provider data.

```ts
export type MetaHealthLabel = "NORMAL" | "ATTENTION" | "CRITICAL" | "STALE";

export type MetaHealthRemoteState = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: "GREEN" | "YELLOW" | "RED" | "NA" | null;
  accountReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  templates: Array<{ id: string; name: string; language: string; status: string }>;
};

export type MetaHealthSummaryDto = {
  label: MetaHealthLabel;
  unacknowledgedCount: number;
  stale: boolean;
  phone: { displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null };
  account: { reviewStatus: string | null; event: string | null; messagingLimit: string | null };
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncErrorCode: string | null;
};
```

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/modules/meta-health/severity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit pure domain rules**

```bash
git add src/modules/meta-health/types.ts src/modules/meta-health/severity.ts src/modules/meta-health/severity.test.ts
git commit -m "feat: classify Meta health states"
```

---

### Task 3: Read and reconcile queryable Graph state

**Files:**
- Create: `src/modules/meta-health/graph-client.ts`
- Create: `src/modules/meta-health/graph-client.test.ts`
- Create: `src/modules/meta-health/repository.ts`
- Create: `src/modules/meta-health/service.ts`
- Create: `src/modules/meta-health/service.test.ts`

**Interfaces:**
- Consumes: `MetaHealthRemoteState`, severity rules, Prisma models, and existing server environment.
- Produces: `MetaHealthGraphClient.fetchState(): Promise<MetaHealthRemoteState>`.
- Produces: `getMetaHealthSummary`, `listMetaHealthAlerts`, `acknowledgeMetaAlert`, and `syncMetaHealth`.
- Produces: sync result union `SYNCED | FRESH | BUSY | RATE_LIMITED`.

- [ ] **Step 1: Write failing Graph client tests with injected fetch**

Test three exact requests: configured phone fields, WABA `account_review_status`, and paginated `message_templates`. Assert bearer authorization is present in requests but absent from thrown/loggable errors. Cover timeout, non-2xx, malformed JSON, oversized arrays, and template pagination capped at ten pages.

```ts
it("returns bounded phone, WABA, and template state", async () => {
  const responses = [
    { id: "phone-1", display_phone_number: "+55 61 99999-0000", verified_name: "XP Eletrônicos", quality_rating: "GREEN" },
    { id: "waba-1", account_review_status: "APPROVED" },
    { data: [{ id: "tpl-1", name: "aviso", language: "pt_BR", status: "APPROVED" }] },
  ];
  const fetcher = vi.fn(async () => Response.json(responses.shift()));
  const client = createMetaHealthGraphClient({
    graphVersion: "v23.0",
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    accessToken: "secret-token",
    timeoutMs: 15_000,
    fetcher,
  });
  await expect(client.fetchState()).resolves.toMatchObject({ phoneNumberId: "phone-1", wabaId: "waba-1", qualityRating: "GREEN", templates: [{ id: "tpl-1", status: "APPROVED" }] });
});
```

- [ ] **Step 2: Implement the bounded Graph client**

Use `AbortSignal.timeout(timeoutMs)`, allowlist response fields, cap strings, cap templates at 2,000 and pagination at ten pages, reject cross-origin paging URLs, and map every public error to one of `META_TIMEOUT`, `META_UNAUTHORIZED`, `META_RATE_LIMITED`, `META_UNAVAILABLE`, or `META_INVALID_RESPONSE`.

- [ ] **Step 3: Write failing reconciliation service tests**

Cover first snapshot creation, fresh snapshot short-circuit, concurrent lease returning `BUSY`, expired lease recovery, one alert per transition, no alert for identical refresh, positive resolution, failure preservation, and acknowledgement idempotency. Define a test-only `createMemoryMetaHealthRepository` implementing the `MetaHealthRepository` interface with Maps, and a `failingClient(code)` implementing `MetaHealthGraphClient`; neither helper is exported to production.

```ts
it("preserves a critical snapshot when Graph synchronization fails", async () => {
  const repository = createMemoryMetaHealthRepository({ qualityRating: "RED", lastSuccessfulSyncAt: new Date("2026-08-23T10:00:00Z") });
  const result = await syncMetaHealth(admin, { repository, client: failingClient("META_TIMEOUT"), now: () => new Date("2026-08-23T12:00:00Z") });
  expect(result).toEqual({ status: "SYNCED", success: false });
  expect((await getMetaHealthSummary(admin, { repository, now: () => new Date("2026-08-23T12:00:00Z") })).label).toBe("CRITICAL");
});
```

- [ ] **Step 4: Implement the repository and orchestration**

Acquire the lease with one conditional database update where `syncLeaseUntil` is null or expired. Store `lastSyncAttemptAt` before I/O. On success, compare and persist transitions in one serializable transaction, clear error and lease, and update `lastSuccessfulSyncAt`. On failure, store only the public code and clear the lease. Acknowledgement uses `updateMany` constrained to `acknowledgedAt: null` and returns the final record.

- [ ] **Step 5: Run the focused server tests**

Run: `npx vitest run src/modules/meta-health/graph-client.test.ts src/modules/meta-health/service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit reconciliation**

```bash
git add src/modules/meta-health
git commit -m "feat: reconcile Meta health state"
```

---

### Task 4: Process operational webhooks without disturbing messages

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/events.test.ts`

**Interfaces:**
- Produces normalized `kind: "metaOperational"` events with no raw payload.
- Produces realtime event `{ type: "meta-health.updated" }`.
- Consumes: `applyMetaOperationalEvent` from the health service.

- [ ] **Step 1: Add failing fixtures and normalization tests**

Create signed-shape fixtures for all five fields. Assert exact allowlisted output, deterministic dedupe key, entry timestamp conversion, bounded resource identifiers, rejection of malformed known fields, and continued `[]` for unknown fields.

```ts
expect(normalizeWebhook(phoneQualityFixture("FLAGGED"))).toEqual([{
  kind: "metaOperational",
  wabaId: "waba-1",
  field: "phone_number_quality_update",
  eventCode: "FLAGGED",
  resourceId: "+5561999990000",
  occurredAt: new Date("2026-08-23T12:00:00.000Z"),
  details: { displayPhoneNumber: "+5561999990000", currentLimit: "TIER_10K" },
  deduplicationKey: expect.stringMatching(/^meta:/),
}]);
```

- [ ] **Step 2: Extend normalized types and parser**

Capture bounded `entry.id` and `entry.time`. Add one parser per field so no parser sees unrelated keys. Hash only normalized technical fields for the dedupe key. Do not copy the original `value` object into `details`.

- [ ] **Step 3: Add failing processing and realtime tests**

Assert that a duplicate operational event increments `duplicates`, a new event updates the snapshot and publishes exactly `{ type: "meta-health.updated" }`, and a message plus operational event in one payload both persist.

- [ ] **Step 4: Route the operational union member to the health service**

Reuse the existing `WebhookEvent` reservation and completion lifecycle. Keep message/media transactions unchanged. Add `meta-health.updated` to both the Zod realtime schema and the client guard.

- [ ] **Step 5: Run webhook regression tests**

Run: `npx vitest run src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts src/modules/realtime/events.test.ts src/app/api/webhooks/meta/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit webhook support**

```bash
git add src/modules/webhooks src/modules/realtime src/hooks/use-realtime.ts src/test/fixtures/meta-webhooks.ts
git commit -m "feat: ingest Meta operational alerts"
```

---

### Task 5: Expose admin-only health APIs

**Files:**
- Create: `src/app/api/meta-health/summary/route.ts`
- Create: `src/app/api/meta-health/summary/route.test.ts`
- Create: `src/app/api/meta-health/alerts/route.ts`
- Create: `src/app/api/meta-health/alerts/route.test.ts`
- Create: `src/app/api/meta-health/alerts/[id]/acknowledge/route.ts`
- Create: `src/app/api/meta-health/alerts/[id]/acknowledge/route.test.ts`
- Create: `src/app/api/meta-health/sync/route.ts`
- Create: `src/app/api/meta-health/sync/route.test.ts`
- Create: `src/modules/meta-health/schemas.ts`

**Interfaces:**
- Consumes service functions from Task 3.
- Produces JSON contracts consumed by `useMetaHealth` and `MetaHealthScreen`.

- [ ] **Step 1: Write route tests before handlers**

For every route assert `401` without session and `403` for attendants. For POST routes assert same-origin protection. Assert invalid UUID/cursor returns generic `400`; no error body contains Graph text, token fragments, SQL, or environment names.

```ts
it("does not allow attendants to read the summary", async () => {
  const handlers = createMetaHealthSummaryHandlers({ requireAdmin: async () => { throw new HttpError(403, "Acesso negado"); }, getMetaHealthSummary: vi.fn() });
  expect((await handlers.GET()).status).toBe(403);
});
```

- [ ] **Step 2: Implement strict schemas**

Use Zod UUID validation for alert IDs, cursor `{ occurredAt, id }`, page limit default 30/max 100, and an empty strict object for sync POST bodies.

- [ ] **Step 3: Implement injectable route factories**

Follow `createUsersRouteHandlers`: `requireAdmin` first, `assertSameOrigin` before POST mutation, service call, bounded JSON, and `toErrorResponse`. Return `200` for summary/history/acknowledgement and `202` for a newly started sync; return `200` with `FRESH`, `BUSY`, or `RATE_LIMITED` status otherwise.

- [ ] **Step 4: Run all route tests**

Run: `npx vitest run src/app/api/meta-health`

Expected: PASS.

- [ ] **Step 5: Commit the HTTP boundary**

```bash
git add src/app/api/meta-health src/modules/meta-health/schemas.ts
git commit -m "feat: expose admin Meta health APIs"
```

---

### Task 6: Add the discreet admin badge

**Files:**
- Create: `src/hooks/use-meta-health.ts`
- Create: `src/hooks/use-meta-health.test.tsx`
- Create: `src/components/meta-health/meta-health-badge.tsx`
- Create: `src/components/meta-health/meta-health-badge.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: summary and sync APIs plus `meta-health.updated` SSE.
- Produces: `<MetaHealthBadge initialSummary={summary} />`.

- [ ] **Step 1: Write failing hook tests with fake timers**

Assert immediate local render, 60-second summary polling, stale-triggered sync only once, refetch after sync, SSE-triggered refresh, abort on unmount, and safe retention of the last summary on network error.

- [ ] **Step 2: Implement `useMetaHealth`**

Use one `AbortController` per refresh, a ref for in-flight sync, `setInterval(() => void refresh(), 60_000)`, and `useRealtime`. Never downgrade the last known label to normal on fetch failure.

- [ ] **Step 3: Write failing badge accessibility tests**

```tsx
render(<MetaHealthBadge initialSummary={{
  label: "CRITICAL",
  unacknowledgedCount: 2,
  stale: false,
  phone: { displayPhoneNumber: "+55 61 9514-9019", verifiedName: "XP Eletrônicos", qualityRating: "RED" },
  account: { reviewStatus: "APPROVED", event: null, messagingLimit: null },
  lastSuccessfulSyncAt: "2026-08-23T12:00:00.000Z",
  lastSyncAttemptAt: "2026-08-23T12:00:00.000Z",
  lastSyncErrorCode: null,
}} />);
expect(screen.getByRole("link", { name: "Meta crítica, 2 alertas não tratados" })).toHaveAttribute("href", "/configuracoes/meta");
expect(screen.getByText("Meta crítica")).toBeVisible();
```

Cover all four labels, zero count, keyboard focus, and accessible text independent of color.

- [ ] **Step 4: Implement the compact badge**

Use existing CSS variables and `Badge`/link primitives. Render a small status dot, label text, and count only above zero. Avoid animation, toast, modal, and fixed overlays.

- [ ] **Step 5: Mount only for admins**

Server-load or pass the initial summary on the conversations page, then render the badge next to existing admin settings controls. Do not request health data for attendants.

- [ ] **Step 6: Run badge and inbox tests**

Run: `npx vitest run src/hooks/use-meta-health.test.tsx src/components/meta-health/meta-health-badge.test.tsx src/components/inbox/inbox-shell.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the badge**

```bash
git add src/hooks/use-meta-health.ts src/hooks/use-meta-health.test.tsx src/components/meta-health src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx src/app/conversas/page.tsx
git commit -m "feat: show admin Meta health badge"
```

---

### Task 7: Build the detailed settings page

**Files:**
- Create: `src/app/configuracoes/meta/page.tsx`
- Create: `src/app/configuracoes/meta/page.test.tsx`
- Create: `src/app/configuracoes/meta/loading.tsx`
- Create: `src/app/configuracoes/meta/error.tsx`
- Create: `src/components/meta-health/meta-health-screen.tsx`
- Create: `src/components/meta-health/meta-health-screen.test.tsx`

**Interfaces:**
- Consumes: initial summary/history, `useMetaHealth`, acknowledgement, sync, and cursor APIs.
- Produces: responsive `/configuracoes/meta` administration experience.

- [ ] **Step 1: Write page guard tests**

Assert unauthenticated redirect to `/login`, attendant redirect to `/conversas`, and admin rendering with server-fetched initial data.

- [ ] **Step 2: Write screen behavior tests**

Assert phone/name/quality/review/limit/last-sync cards, stale and failure copy, active alerts before history, pagination, acknowledge pending/success/failure, manual sync pending/rate-limited/success, and no raw technical payload in the DOM.

```tsx
expect(screen.getByRole("heading", { name: "Saúde da Meta" })).toBeVisible();
expect(screen.getByText("Qualidade do número")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Marcar como tratado" }));
expect(await screen.findByText("Tratado por Administrador XP")).toBeVisible();
```

- [ ] **Step 3: Implement the server page and states**

Use the established settings-page guard. Fetch initial summary and first alert page in parallel. Loading/error files must use the same restrained panel layout and offer a return link to conversations.

- [ ] **Step 4: Implement the client screen**

Use semantic headings, definition lists for current status, explicit severity copy, paginated event list, disabled buttons while pending, inline `role="alert"` errors, and focus restoration after acknowledgement. Do not add charts or advanced filters.

- [ ] **Step 5: Run screen and page tests**

Run: `npx vitest run src/app/configuracoes/meta src/components/meta-health/meta-health-screen.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the settings page**

```bash
git add src/app/configuracoes/meta src/components/meta-health/meta-health-screen.tsx src/components/meta-health/meta-health-screen.test.tsx
git commit -m "feat: add Meta health settings page"
```

---

### Task 8: Integrated regression and local release candidate

**Files:**
- Create: `src/meta-health-release.test.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Verifies the complete feature boundary and production configuration.

- [ ] **Step 1: Add a cross-feature contract**

Assert the migration, five webhook fields, realtime event, four admin APIs, admin page, badge mount, 15-minute freshness, 60-second polling/lease, and absence of Meta token text from client modules.

- [ ] **Step 2: Document required permissions and behavior**

Document that the existing system-user token needs `whatsapp_business_management` for management reads, that the WABA must remain subscribed to the operational webhook fields, and that no external notification channel is used.

- [ ] **Step 3: Run focused and complete quality gates**

Run:

```bash
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run build
powershell -ExecutionPolicy Bypass -File scripts/verify-compose.ps1
```

Expected: every command exits `0`; the build includes `/configuracoes/meta` and all four API route groups.

- [ ] **Step 4: Inspect the final diff for media isolation and secrets**

Run:

```bash
git diff --check HEAD~7..HEAD
git diff --name-only HEAD~7..HEAD
git grep -n "WHATSAPP_ACCESS_TOKEN" -- src/components src/hooks src/app/configuracoes src/app/api/meta-health
```

Expected: no changes to `message-composer.tsx` or `message-media.tsx`; the grep has no client-side token usage.

- [ ] **Step 5: Commit release documentation**

```bash
git add src/meta-health-release.test.ts README.md .env.example
git commit -m "test: verify Meta health release"
```

---

### Task 9: Audit parallel work and deploy the integrated superset

**Files:**
- Modify only if needed after integration: files changed by completed parallel branches.
- Create: `docs/verification/2026-08-23-meta-health-release.md`

**Interfaces:**
- Consumes: completed local candidate plus current production/parallel state.
- Produces: immutable production image and evidence-backed verification record.

- [ ] **Step 1: Capture production state without mutation**

Run read-only SSH commands in `/opt/example-app` to capture `.env.production`'s `XP_WHATSAPP_IMAGE`, `docker compose ps`, container image IDs, health, restart counts, and `GET /api/health`. Do not print secrets.

- [ ] **Step 2: Audit every local worktree and branch**

Run `git worktree list --porcelain`, `git branch --all --verbose --no-abbrev`, status in every worktree, and `git log --all --decorate --oneline --date-order -50`. For every parallel commit not ancestral to the candidate, inspect `git diff --stat`, `git diff --name-status`, and overlapping hunks.

- [ ] **Step 3: Integrate completed parallel work safely**

Merge or cherry-pick only reviewed, complete commits. Resolve overlaps by preserving both behaviors and their tests. If an uncommitted media worktree exists, do not copy over it or deploy a candidate that omits its already-published functionality.

- [ ] **Step 4: Re-run the complete gate on the integrated commit**

Run the six commands from Task 8 Step 3 plus `powershell -ExecutionPolicy Bypass -File scripts/verify-kvm-deployment.ps1`. Expected: all exit `0`.

- [ ] **Step 5: Back up production**

Use `scripts/backup.sh` with a new absolute backup directory outside `/opt/example-app`. Verify the manifest and artifact hashes before applying the additive migration.

- [ ] **Step 6: Build and transfer an immutable image**

Tag the image `xp-whatsapp:<integrated-commit-sha>`, transfer it without changing other Compose projects, and verify the loaded image ID on the KVM.

- [ ] **Step 7: Deploy with the existing migration runbook**

Update only `XP_WHATSAPP_IMAGE` in `/opt/example-app/.env.production`, apply the additive migration through the established entrypoint/runbook, and run `docker compose up -d app` using `deploy/kvm/docker-compose.yml`. Never remove volumes, networks, or unrelated containers.

- [ ] **Step 8: Verify the complete production story**

Verify health, login, conversations, send/receive, images, videos, audio, document download, reactions, quoted replies, search, admin-only badge, `/configuracoes/meta`, manual refresh, acknowledgement, webhook ingestion, no secret exposure, zero restart loop, and unchanged non-app container snapshot.

- [ ] **Step 9: Record evidence and commit**

Document production image, integrated commit, migration result, backup location identifier, tests, HTTP checks, browser checks, container health, parallel-work audit, and rollback image in `docs/verification/2026-08-23-meta-health-release.md`.

```bash
git add docs/verification/2026-08-23-meta-health-release.md
git commit -m "docs: verify Meta health production release"
```
