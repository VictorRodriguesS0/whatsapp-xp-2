# Full Device Sync — Release 4: Contacts and History Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` inline. Do not use subagents. Release 3 must be live and healthy. The external Meta cutover is a separate approval gate inside this plan.

**Goal:** Safely import the supported WhatsApp Business app contact/message baseline (up to Meta's available history window), then continue incremental synchronization without creating false unread or response-pending work.

**Approved design:** [`docs/superpowers/specs/2026-08-23-whatsapp-full-device-sync-design.md`](../specs/2026-08-23-whatsapp-full-device-sync-design.md)

**Architecture:** Ship and verify a dormant `history` parser/importer first. Process provider batches in bounded transactions, deduplicate messages by WAMID and history items by event/chunk identity, reuse existing contact/message/media/reply/mutation pipelines, and protect operational state with one server-recorded `historyCutoverAt`. Only after the receiver is healthy and the user gives new action-time approval may operations add the single `history` subscription field and perform the official one-time offboard/re-onboard/initial-sync workflow.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL 18, Vitest, Meta WhatsApp Cloud API coexistence history/contacts webhooks, Docker Compose.

## Non-negotiable release rules

- Inline only; no subagents.
- Audit all worktrees before implementation and immediately before every deploy/build. Preserve dirty parallel work, integrate completed commits explicitly, and test the composed exact-SHA tree.
- Do not offboard, re-onboard, add `history`, trigger initial sync, disconnect/relink companion devices, or ask the owner to share history until the code-only candidate is live/healthy and the user grants a new explicit approval at Task 8.
- Subscription mutation must be set-preserving: read back current fields, require the known 12-field baseline, add only `history`, write once, and read back exact equality. Never replace the list with a hard-coded subset.
- Initial contacts/history request, covering up to the six-month window currently documented by Meta when available, is one-time and must never auto-repeat. Failure becomes visible and requires human review.
- Historical baseline must not create artificial unread, SLA, reminder, assignment, read-receipt, or awaiting-response work.
- Backup first; migrations additive; exact Git archive; app-only deploy.

---

### Task 1: Audit all work and freeze the supported Meta contract

**Files:**
- Create: `docs/verification/2026-08-23-meta-history-contract.md`
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-4.md`

- [ ] **Step 1: Repeat the worktree/production ledger**

Require Releases 1–3 live and healthy. Inventory every worktree/branch/HEAD/diff/untracked path, integrate only relevant committed work, preserve dirty work, and record production revision/image/migrations/subscription/coexistence state.

- [ ] **Step 2: Capture current official provider-shaped fixtures**

From primary Meta documentation/test webhook tooling, record sanitized fixtures for history notification envelope, chunks/batches, 1:1 messages, text/media/reply/current edits/revokes, contacts, unavailable content, duplicates across chunks, and terminal/failed sync signals. Confirm supported limitations: no groups/calls/labels/quick replies, finite history window, and device relink requirements. Do not guess undocumented fields; quarantine unknown items.

- [ ] **Step 3: Define hard limits**

Document and test maximum webhook body already enforced, maximum history items per normalized batch, database transaction chunk size, media queue admission, processing deadline/retry policy, and sanitized metrics. Use conservative constants with named exports rather than loading an entire history payload into unbounded application arrays.

### Task 2: Extend coexistence state for one-time sync ownership

**Files:**
- Modify: `src/modules/whatsapp/coexistence-state.ts`
- Modify: `src/modules/whatsapp/coexistence-state.test.ts`
- Modify: `src/modules/whatsapp/coexistence-state.integration.test.ts`

**Interfaces:**
- `beginInitialSync(kind, requestedAt)` changes `NOT_REQUESTED|FAILED` to `PENDING` only through explicit operator action.
- `completeInitialSync(kind, completedAt)` is monotonic/idempotent.
- `historyCutoverAt` is immutable once set for a completed bootstrap unless a separately designed reset exists.

- [ ] **Step 1: Write failing state-machine tests**

Prove automatic webhook traffic cannot initiate/reset sync, duplicate terminal success is harmless, failure stores only safe code/summary, `historyCutoverAt` cannot move, and contacts/history states are independent.

- [ ] **Step 2: Implement compare-and-set transitions**

Use database conditions/locking, provider timestamps where authoritative, and server receipt time for operator cutover. Never store token, raw payload, contact data, or message content in health state.

### Task 3: Normalize bounded history batches

**Files:**
- Create: `src/modules/webhooks/history.ts`
- Create: `src/modules/webhooks/history.test.ts`
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`

**Interfaces:**
- Add `NormalizedHistoryBatchEvent` with `providerBatchId`, `chunkIndex`, `isTerminal`, `items`, and provider timestamp.
- Each history item reuses the canonical normalized message/contact/mutation data structures and includes `historical: true`.

- [ ] **Step 1: Write failing parser tests**

Cover one/multiple chunks, duplicate message across chunks, supported 1:1 text/media/reply/mutation/contact, unsupported group/call quarantined, missing IDs, malformed timestamps, oversize item count, terminal success/failure, deterministic event key, and absence of raw provider data after normalization.

- [ ] **Step 2: Implement streaming/bounded extraction**

Keep provider-envelope parsing in `history.ts`; reuse existing body/content/media/reply/contact normalizers. Reject/quarantine a malformed item without discarding valid siblings only when the official batch contract permits item isolation. Never convert history into live `message` events that implicitly run active-state transitions.

- [ ] **Step 3: Verify parser regression and commit**

Run history/normalizer/webhook-route body/signature tests.

### Task 4: Build an idempotent historical importer

**Files:**
- Create: `src/modules/history/import.ts`
- Create: `src/modules/history/import.test.ts`
- Create: `src/modules/history/import.integration.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`

**Interfaces:**
- `importHistoryBatch(event, repository, cutover): Promise<HistoryImportSummary>`.
- Summary contains counts only: inserted, existing, mediaQueued, quarantined, terminal; no identity/content.
- Deduplication: WAMID for messages, canonical version key for contacts, provider event ID for mutations, `history:<batch>:<chunk>` for webhook event reservation.

- [ ] **Step 1: Write failing importer tests**

Prove message WAMID idempotence across live/history/chunks; conversation/contact reuse and existing name precedence; chronological last-message calculation; reply resolution when parent arrives before/after child; mutation ordering uses Release 2 logic; media object is created once and queued through existing downloader; retry after partial/failed chunk is safe; concurrent chunks converge.

- [ ] **Step 2: Prove operational-state protection in tests**

For every imported item at/before `historyCutoverAt`, assert:

- existing manual-unread, responsible user, tags, reminders, pins, individual reads, team read, read-sync, and audits are preserved;
- existing live `awaitingResponseSince` is preserved;
- history-only conversations end with team boundary at their latest inbound/message baseline, `unreadCount = 0`, `manualUnreadAt = null`, and `awaitingResponseSince = null`;
- no realtime per-message storm, Meta read receipt, SLA/reminder, or outbound provider call occurs.

For a genuinely live event after cutover, assert the normal active message path still updates unread/awaiting/realtime.

- [ ] **Step 3: Implement bounded transactional chunks**

Separate historical persistence from live `processMessage`. Upsert identities/messages with existing repositories but suppress operational transitions. After a history-only conversation's final known chunk, set its baseline in one locked operation. Publish one coarse `conversation.updated` per affected open conversation after commit, capped/deduplicated.

- [ ] **Step 4: Verify failure recovery/concurrency and commit**

Run importer plus existing message, echo, mutation, media, contact, shared-state and read-receipt suites.

### Task 5: Complete contact bootstrap reuse

**Files:**
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Modify: `src/modules/contacts/service.integration.test.ts`
- Modify: `src/lib/contact-display.test.ts`
- Modify: `src/modules/whatsapp/coexistence-state.ts`

- [ ] **Step 1: Write failing contact-bootstrap tests**

Prove history contact sync reuses `WhatsAppAppContact`, canonical phone/WhatsApp identities, active/remove version ordering, and current name precedence; does not overwrite `preferredName`; handles the previously observed code 131000 as FAILED with safe summary; explicit retry is possible only through operator action and never automatic.

- [ ] **Step 2: Implement completion/failure recording and verify**

Keep the existing contact batch path authoritative. Add only the state transitions and history linkage required; do not create a second contact table/pipeline.

### Task 6: Add read-only admin controls and observability for bootstrap

**Files:**
- Modify: `src/app/api/settings/whatsapp-sync/route.ts`
- Modify: `src/app/api/settings/whatsapp-sync/route.test.ts`
- Modify: `src/components/settings/whatsapp-sync-health-screen.tsx`
- Modify: `src/components/settings/whatsapp-sync-health-screen.test.tsx`
- Create: `src/modules/history/metrics.ts`
- Create: `src/modules/history/metrics.test.ts`

- [ ] **Step 1: Write failing health/metrics tests**

Show contacts/history NOT_REQUESTED/PENDING/SUCCEEDED/FAILED, cutover time, last batch time and aggregate counts. Never expose message/contact content, phone, WAMID, batch raw ID, token, or raw error. UI explains that groups, calls, labels, and quick replies are outside Meta coexistence sync.

- [ ] **Step 2: Implement read-only UI and bounded metrics**

Do not place offboard/re-onboard or trigger buttons in the web app. These remain controlled operator/human steps with explicit approval to prevent accidental repeat.

### Task 7: Ship the dormant receiver before touching Meta

**Files:**
- Create/update: `docs/verification/2026-08-23-full-device-sync-release-4.md`
- Modify: `scripts/test-deployment.ps1` only for a missing artifact invariant

- [ ] **Step 1: Run all local, migration, Linux, concurrency, browser, build, and security gates**

Include large bounded synthetic history, partial retries, live/history races, media/reply/mutation/contact regression, zero artificial pending, authorization and secrets scans.

- [ ] **Step 2: Repeat the complete worktree audit immediately before build**

Classify changes from every worktree, explicitly integrate completed relevant commits, preserve dirty work, rerun affected/full tests, and repeat the audit until clean.

- [ ] **Step 3: Exact-SHA backup/migration/app-only deploy**

Build from the clean archive; validate provenance/UID/no secrets; create validated backup; apply additive state migration; recreate only app; keep the existing 12-field subscription and Graph version unchanged. Verify production parser is dormant, webhook health unchanged, no new events/failures, and rollback readiness. Record code-only deployment evidence.

### Task 8: External Meta cutover — new action-time approval required

**Files:**
- Create: `scripts/enable-history-bootstrap.ps1`
- Create: `scripts/enable-history-bootstrap.test.ts`
- Modify: `README.md`
- Update: `docs/verification/2026-08-23-full-device-sync-release-4.md`

**Interfaces:**
- Default mode is read-only preflight.
- Mutation requires `-Apply`, exact expected app/WABA/phone identifiers through environment, a one-time operation ID, and interactive/action-time confirmation outside automated tests.

- [ ] **Step 1: Write the safe operator script contract before approval**

Require: token only via environment; no secret output; live callback must equal `https://whatsapp.xpeletronicos.com/api/webhooks/meta`; current 12 fields must equal the previously audited set; target fields must be `current ∪ {history}`; diff must contain exactly `+history`; abort if history already present or any current field would disappear; read back exact target after mutation; never automatically offboard/re-onboard or trigger sync.

- [ ] **Step 2: Run read-only preflight and present evidence to the user**

Show receiver revision/health, backup readiness, exact sanitized subscription set/diff, coexistence status, known device implications, expected human steps and rollback limits. Ask for new explicit approval. Stop here without it.

- [ ] **Step 3: After approval, create a fresh validated backup and add only `history`**

Re-run worktree/production health audit, backup, script dry-run, then `-Apply`. Read back exact equality. If equality fails, restore the original subscription set immediately and stop; do not proceed to offboarding.

- [ ] **Step 4: Perform the official one-time coexistence workflow with the owner**

Follow current Meta UI/API instructions exactly: controlled offboard/re-onboard if required, owner explicitly chooses to share available history, request contacts/history once within Meta's allowed 24-hour window, then relink only supported companion devices. Record timestamps/status only, never screenshots containing secrets/customer content.

- [ ] **Step 5: Monitor import and prevent repetition**

Watch webhook 2xx/latency/failures, batch progress, DB/media capacity, dedupe counts, artificial-pending audit, health state and app responsiveness. Never invoke the trigger again automatically. On failure, keep the live receiver, mark FAILED, preserve imported idempotent data, and ask for diagnosis/approval before any retry.

- [ ] **Step 6: Final production acceptance**

Verify representative old conversations/media/replies/current mutations, contact names, no groups/calls/labels/quick replies expectation mismatch, no false unread/awaiting/reminders, two-session consistency, new official-app and panel traffic after cutover, read receipts, edits/revokes, health, zero restarts, unchanged non-app infrastructure, and exact subscription. Commit sanitized evidence.

## Self-review checklist

- [ ] Receiver deploy precedes every Meta mutation.
- [ ] External cutover has a new explicit approval gate.
- [ ] Subscription change preserves all existing fields and adds only `history`.
- [ ] Historical data is idempotent and cannot fabricate active work.
- [ ] One-time sync never auto-repeats.
- [ ] Unsupported Meta domains are stated, not simulated as synchronized.
- [ ] Worktree audit is repeated immediately before both code deploy and external cutover.
