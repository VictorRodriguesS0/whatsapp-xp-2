# Full Device Sync — Release 1: Official App Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline, task by task. Do not use subagents; the user explicitly prohibited them. Keep checkbox state in this file while executing.

**Goal:** Make replies sent from the official WhatsApp Business app immediately clear the shared pending/read state in XP Atendimento without clearing a deliberate manual-unread marker.

**Approved design:** [`docs/superpowers/specs/2026-08-23-whatsapp-full-device-sync-design.md`](../specs/2026-08-23-whatsapp-full-device-sync-design.md)

**Architecture:** Extend the existing `smb_message_echoes` transaction. After an official outbound echo is persisted, locate the latest inbound boundary at or before the echo and monotonically advance only `Conversation.teamLastReadMessageId/teamLastReadAt`; keep `ConversationRead`, Meta read-receipt queues, and manual-unread fields untouched. Repair prior official replies with an evidence-based, idempotent SQL operator script that defaults to dry-run.

**Tech Stack:** Next.js 16, TypeScript 7, Prisma 7, PostgreSQL 18, Vitest, Docker Compose, Meta WhatsApp Cloud API.

## Non-negotiable release rules

- Execute in this isolated worktree and never use subagents.
- Immediately before the production build, enumerate every local worktree and inspect branch, HEAD, staged, modified, deleted, and untracked files. Classify all unique application code, tests, migrations, docs, and infrastructure changes. Preserve dirty work and integrate only explicit commits; never copy or overwrite a parallel worktree.
- Repeat that audit after integration and build from an exact clean Git archive SHA.
- Back up and validate database/media before any production mutation.
- Deploy only `xp-whatsapp-app`; do not recreate PostgreSQL, Caddy, networks, volumes, or unrelated KVM containers.
- Graph stays on v23 in this release. Do not alter the Meta subscription.

---

### Task 1: Re-audit the repository and production baseline

**Files:**
- Read: every registered Git worktree and `docs/verification/`
- Create during execution: `docs/verification/2026-08-23-full-device-sync-release-1.md`

**Interfaces:**
- Consumes: all current worktree heads/diffs and the live immutable revision.
- Produces: a written integration ledger containing `path | branch | HEAD | clean/dirty | unique changes | disposition`.

- [ ] **Step 1: Inventory every worktree without modifying any of them**

```powershell
$rows = git worktree list --porcelain
$rows
git status --short --branch
git log -1 --format='%H %s'
```

For each path returned in `$rows`, bind that literal path to `$worktreePath` and run `git -C $worktreePath status --short --branch`, `git -C $worktreePath diff --stat`, `git -C $worktreePath diff --cached --stat`, and `git -C $worktreePath log -1 --format='%H %s'`. Record untracked paths with `git -C $worktreePath ls-files --others --exclude-standard`. Do not stash, reset, clean, commit, or edit another worktree.

- [ ] **Step 2: Classify and integrate explicit completed commits**

Use `git log --all --left-right --cherry-pick --oneline codex/full-device-sync-design...$otherBranch` plus path-level diffs, where `$otherBranch` is each branch discovered in Step 1. Integrate only completed relevant commits using `git merge --no-ff` or `git cherry-pick`; resolve overlaps by composition and rerun affected tests. Leave every dirty/uncommitted parallel change in place.

- [ ] **Step 3: Confirm the live baseline read-only**

Record current release SHA/image ID, app/database/Caddy container IDs and `StartedAt`, restart counts, migration count, public/local health, 12-field webhook subscription, and a sanitized query that recomputes the number of official-app replies whose preceding inbound boundary is still unread. Do not encode the previously observed count of 23 as an invariant.

### Task 2: Add the official-echo shared-read primitive with TDD

**Files:**
- Modify: `src/modules/conversations/shared-state.ts`
- Modify: `src/modules/conversations/shared-state.test.ts`
- Modify: `src/modules/conversations/shared-state.integration.test.ts`

**Interfaces:**
- Add: `advanceTeamReadFromBusinessEcho(client, conversationId, echoBoundary): Promise<MessageBoundary | null>`.
- Consumes: one already-persisted official outbound message boundary.
- Produces: a monotonic team-read boundary equal to the latest preceding inbound, or `null` when no inbound qualifies.

- [ ] **Step 1: Write failing unit/integration tests**

Cover: preceding inbound advances; no preceding inbound is a no-op; later inbound is not read; older/equal redelivery cannot move backward; equal timestamps use message UUID ordering; existing `manualUnreadAt/manualUnreadByUserId` remain byte-for-byte unchanged; no `ConversationRead`, `WhatsAppReadSync`, or `ConversationAuditEvent` row is created; a concurrent human read and official echo converge on the greatest boundary.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts
```

Expected: FAIL because `advanceTeamReadFromBusinessEcho` is absent.

- [ ] **Step 3: Implement the narrow transaction helper**

Implement the behavior around this contract:

```ts
export async function advanceTeamReadFromBusinessEcho(
  client: SharedStateClient,
  conversationId: string,
  echoBoundary: MessageBoundary,
): Promise<MessageBoundary | null> {
  await lockConversation(client, conversationId);
  const target = await client.message.findFirst({
    where: {
      conversationId,
      direction: MessageDirection.INBOUND,
      OR: [
        { externalTimestamp: { lt: echoBoundary.externalTimestamp } },
        {
          externalTimestamp: echoBoundary.externalTimestamp,
          id: { lt: echoBoundary.id },
        },
      ],
    },
    orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
    select: { id: true, externalTimestamp: true },
  });
  // Compare with the locked current team boundary; update only when target advances.
  // Never touch manual-unread fields, individual reads, audits, or read-sync queues.
  return target;
}
```

Use the same `compareBoundary` ordering as `advanceSharedRead`. Return the target only when this call advances the team boundary; return `null` for no eligible inbound or a no-op against an equal/later current boundary.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npx vitest run src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts
git add src/modules/conversations/shared-state.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts
git commit -m "feat: advance shared read on official replies"
```

### Task 3: Wire the helper into official app echoes

**Files:**
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`

**Interfaces:**
- Extend `WebhookRepository` with `advanceTeamReadFromBusinessEcho(conversationId, echoBoundary)`.
- `processMessageEcho` calls it only after a new official outbound message is persisted and before the event is marked processed.

- [ ] **Step 1: Write failing webhook tests**

Assert a new `messageEcho` calls, in order: create message → refresh response state → advance team read → complete event. Assert duplicates do not double-mutate, official replies clear `awaitingResponseSince`, realtime still publishes one `message.created`, merged conversations use the resolved target, and inbound/app-panel outbound messages do not enter this path.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts`

- [ ] **Step 3: Implement in the existing webhook transaction**

The Prisma repository method must delegate to the shared-state helper. Call it with `{ id: message.id, externalTimestamp: event.timestamp }` immediately after `refreshResponseState`. Do not create a second transaction and do not infer an official reply from nullable sender fields alone; the normalized `messageEcho` event is the authority for live processing.

- [ ] **Step 4: Verify focused webhook and shared-state suites**

```powershell
npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts
git add src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts
git commit -m "feat: reconcile official replies with shared inbox state"
```

### Task 4: Create an evidence-based idempotent production backfill

**Files:**
- Create: `scripts/backfill-official-echo-reads.sql`
- Create: `scripts/backfill-official-echo-reads.test.ts`
- Modify: `package.json`

**Interfaces:**
- Default invocation is read-only preview.
- `psql -v apply=1` applies only candidates proven by processed `messageEcho` webhook evidence.
- A second preview after apply must report zero candidates.

- [ ] **Step 1: Write a failing SQL contract test**

The test must inspect/execute the script against isolated PostgreSQL fixtures and prove candidate eligibility requires all of:

```sql
m.direction = 'OUTBOUND'
AND m.sent_by_user_id IS NULL
AND m.client_request_id IS NULL
AND m.whatsapp_message_id IS NOT NULL
AND we.event_type = 'messageEcho'
AND we.status = 'PROCESSED'
AND we.deduplication_key = 'message-echo:' || m.whatsapp_message_id
```

Also prove the script updates only `team_last_read_message_id/team_last_read_at`, selects the latest inbound preceding the latest qualifying official echo, preserves manual-unread/individual-read/read-sync data, ignores an app-panel outbound, and is idempotent.

- [ ] **Step 2: Verify RED, then implement dry-run/apply branches**

Run: `npx vitest run scripts/backfill-official-echo-reads.test.ts`

Use a transaction, temporary candidate relation, explicit `\if :apply`, and output candidate IDs/timestamps/count without contact names, phones, message bodies, or WAMIDs. Default `apply` to `0` via `\if :{?apply}`. Lock only target conversation rows during apply.

- [ ] **Step 3: Add a reproducible operator command and verify GREEN**

Add `"backfill:official-echo-reads:test": "vitest run scripts/backfill-official-echo-reads.test.ts"` and run it. Commit the SQL, test, and script entry.

### Task 5: Complete gates, audit again, deploy, and verify production

**Files:**
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-1.md`

- [ ] **Step 1: Run all local gates from a clean tree**

```powershell
npm run db:generate
npm run db:validate
npm test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Run all migrations from zero in disposable PostgreSQL 18 and the Linux/FFmpeg suite used by the existing deployment verifier.

- [ ] **Step 2: Repeat the full worktree audit immediately before build**

Update the ledger from Task 1. If any branch or dirty path changed, stop the build, classify it, explicitly integrate or preserve it, rerun affected/full gates, then repeat this audit. Require `git status --porcelain` empty and commit the exact release tree.

- [ ] **Step 3: Build and inspect an immutable exact-SHA artifact**

Bind the clean full commit SHA to `$revision`, create the remote release from `git archive $revision`, tag `xp-whatsapp:$revision`, set/verify the same OCI revision, and confirm UID 1001, no `.env`/tests/secrets, current migrations/backfill script, and matching source/archive hash.

- [ ] **Step 4: Back up, stage, and deploy app-only**

Create a validated backup with the committed `scripts/backup.sh`. Record all container identities, deploy/migrate the candidate, recreate only `app` with `--no-deps --force-recreate --wait`, and promote `current` only after health checks. Roll back the app image/symlink automatically on failure; keep additive data changes.

- [ ] **Step 5: Preview, apply, and re-preview the backfill**

Pipe the SQL from the immutable candidate into the production database container. First use `-v apply=0`; record the recomputed count. Only after the preview matches the eligibility query, use `-v apply=1`; then repeat `-v apply=0` and require zero. Compare hashes/counts of non-target conversation fields, messages, individual reads, manual-unread fields, and read-sync rows before/after.

- [ ] **Step 6: Production acceptance and evidence**

Require public/local health 200 in three spaced samples, zero restart, no new webhook failures, unchanged subscription, unchanged database/Caddy/unrelated container identity, login/auth boundaries, and a manual official-app reply test. Verify the reply appears in XP Atendimento, clears the shared unread/awaiting state in two logged-in sessions, and preserves a deliberately marked-unread conversation. Record sanitized evidence and commit the verification report.

## Self-review checklist

- [ ] No step creates an individual read or Meta read receipt for an official-app echo.
- [ ] Manual unread is never cleared by echo or backfill.
- [ ] Historical candidates require processed webhook evidence, not nullable columns alone.
- [ ] Worktree audit occurs both before integration and immediately before the production build.
- [ ] Deployment is exact-SHA, backed up, app-only, observable, and rollback-ready.
