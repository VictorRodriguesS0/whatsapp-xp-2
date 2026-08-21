# WhatsApp Business App Message Echoes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with test-driven-development, independent review, and verification-before-completion.

**Goal:** Make messages sent from the store's WhatsApp Business app or linked devices appear once in XP Atendimento, attributed safely as **WhatsApp**, synchronized to every session, and counted as a company response.

**Architecture:** Extend the signed Meta webhook normalizer with the official `smb_message_echoes` field, then persist echoes through the existing serializable webhook transaction and media recovery pipeline. The existing unique `whatsappMessageId`, a dedicated webhook reservation key, monotonic conversation ordering, and shared response-state service prevent duplicates and regressions. Only after the application release is healthy will production add the new Meta subscription field while preserving the existing subscription exactly.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2.8, TypeScript 7, Prisma 7.9.1, PostgreSQL 18, Vitest 4.1.11, SSE, WhatsApp Cloud API/Graph API, Docker Compose on the KVM.

## Global Constraints

- Follow the approved design at `docs/superpowers/specs/2026-08-21-whatsapp-business-app-message-echoes-design.md`.
- Use only the official Meta webhook; do not automate the phone, read local WhatsApp data, or infer an employee identity.
- Preserve signature verification, request size/deadline limits, safe public errors, and sanitized structured logs.
- Never log or persist raw payloads, message bodies, captions, filenames, telephone numbers, Meta IDs, tokens, secrets, or verify tokens in reports/evidence.
- Keep message order and state monotonic by `(externalTimestamp, id)` inside serializable transactions.
- A duplicate echo must never overwrite content, status, media, or `sentByUserId` on an API-created message.
- Reuse the current bounded media pipeline: leases, limiter, five-attempt cap, MIME/hash/size/magic validation, and `media.updated` publication.
- SSE payloads remain ID/state-only. No new public browser API is needed.
- Deploy one immutable app image and recreate only `xp-whatsapp-app`; do not recreate or edit PostgreSQL, Caddy, volumes, networks, or unrelated KVM services.
- Update Meta subscriptions only after health checks, preserving every previously subscribed field; restore the exact prior list before image rollback if validation fails.

---

## File Structure

- `src/modules/webhooks/types.ts`: normalized message-echo and echo-control event contracts.
- `src/modules/webhooks/normalize.ts`: field router and strict `message_echoes` normalization.
- `src/modules/webhooks/normalize.test.ts`: text/media/control/malformed/multi-change coverage.
- `src/modules/webhooks/process.ts`: echo reservation, idempotent persistence, shared response state, media scheduling, and realtime publication.
- `src/modules/webhooks/process.test.ts`: repository-level behavior and failure seams.
- `src/modules/webhooks/process.integration.test.ts`: real PostgreSQL concurrency, ordering, duplicate-actor, and rollback tests.
- `src/modules/conversations/shared-state.ts`: reused response-state operation inside the webhook transaction.
- `src/components/inbox/message-bubble.tsx`: safe **WhatsApp** author fallback for outbound messages without an internal actor.
- `src/components/inbox/message-bubble.test.tsx`: author rendering coverage.
- `src/app/api/webhooks/meta/route.test.ts`: signed route integration with echo payloads and safe logging.
- `README.md`: required Meta subscription field and production verification instructions.
- `docs/verification/2026-08-21-whatsapp-business-app-message-echoes.md`: sanitized production checklist/evidence.

### Task 1: Normalize WhatsApp Business app echoes

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/app/api/webhooks/meta/route.test.ts`

**Interfaces:**
- Produces `NormalizedMessageEchoEvent` with `kind: "messageEcho"`, exact stable `whatsappMessageId`, nullable canonical legacy phone `to`, nullable `toUserId`, nullable separate `toParentUserId`, validated timestamp, supported/unsupported message type, safe body/media, and constant origin `WHATSAPP_BUSINESS_APP`. At least one of `to` or `toUserId` is required.
- Produces a deduplicable control event for valid edit/revoke callbacks without mutating history in this release.
- Preserves all current `messages` and `statuses` behavior.
- Does not add schema or persistence in Task 1; Task 2 owns durable BSUID/phone reconciliation and must prevent duplicate contacts/conversations.

- [ ] **Step 1: Write failing normalization and route tests**

Add representative fixtures for text, image, video, audio, document, unsupported, edit, revoke, multiple echoes, mixed `messages` + `smb_message_echoes`, and multiple `changes`. Cover the official legacy shape with only `to`, the newer shape with `to_user_id` and no phone, both identities together, optional `to_parent_user_id`, and assert the store number is never selected as the contact identity.

Add table tests for missing/oversized/invalid `id`, `to`, `to_user_id`, `to_parent_user_id`, timestamp, body, media ID, MIME, hash, filename, and control references. Assert echo/control and standard message/status deduplication IDs containing whitespace or controls are rejected rather than cleaned, and errors expose only `WebhookPayloadError`, never secret or payload markers.

- [ ] **Step 2: Run the focused RED tests**

Run:

```powershell
npx vitest run src/modules/webhooks/normalize.test.ts src/app/api/webhooks/meta/route.test.ts
```

Expected: FAIL because `smb_message_echoes` is ignored and the new event contracts do not exist.

- [ ] **Step 3: Add strict field routing and echo normalization**

Route only `messages` and `smb_message_echoes`. Reuse current cleaning/limits for text and media. Canonicalize `to` to digits only when present; validate `to_user_id` in the documented BSUID format (uppercase two-letter ISO prefix, dot, then 1-128 alphanumerics) when present; validate `to_parent_user_id` independently when present. Require at least one of `to` or `to_user_id`, while preserving the official legacy phone-only payload. Do not derive one identity from the other. Require an epoch timestamp, map supported types to the current `MessageType`, and preserve unknown message activity as `UNSUPPORTED`.

Recognize valid edit/revoke controls as no-op normalized events with their own stable identity. Preserve the event ID and original-message reference exactly; reject whitespace, controls or oversize instead of trimming/sanitizing deduplication identity. Reject malformed supported items so Meta retries instead of silently losing them.

- [ ] **Step 4: Run focused tests and static checks**

Run:

```powershell
npx vitest run src/modules/webhooks/normalize.test.ts src/app/api/webhooks/meta/route.test.ts
npm run typecheck
npm run lint -- --no-warn-ignored src/modules/webhooks/types.ts src/modules/webhooks/normalize.ts src/modules/webhooks/normalize.test.ts src/app/api/webhooks/meta/route.test.ts
git diff --check
```

Expected: PASS with no warning, payload leak, or changed standard-message behavior.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/webhooks/types.ts src/modules/webhooks/normalize.ts src/modules/webhooks/normalize.test.ts src/app/api/webhooks/meta/route.test.ts
git commit -m "feat: normalize WhatsApp app message echoes"
```

### Task 2: Persist echoes atomically and update shared response state

**Files:**
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Create or modify: `src/modules/webhooks/process.integration.test.ts`
- Reuse: `src/modules/conversations/shared-state.ts`

**Interfaces:**
- `WebhookRepository.createMessage` accepts explicit direction, status, and nullable internal actor instead of hardcoding inbound values.
- Echoes use reservation key `message-echo:<wamid>`; controls use a stable action/reference key.
- Echo persistence creates `OUTBOUND` / `SENT` / `sentByUserId=null`, refreshes shared response state in the same transaction, and returns the existing `message.created` event and optional media scheduling ID.

- [ ] **Step 1: Write failing repository and PostgreSQL tests**

Cover:

- text echo creates/finds one contact by the available recipient phone or BSUID, reconciles both when present without duplicating a contact known by either identity, and stores exactly one outbound `SENT` message with no internal actor;
- an echo without `to` still resolves through BSUID, and a later event carrying both identities attaches the phone to the same contact rather than creating a second conversation;
- an official legacy echo without BSUID still resolves through `to`, and later overlap with a BSUID converges on that same contact;
- new contact/conversation creation;
- media echo creates one pending media row and schedules recovery once after commit;
- serial and concurrent duplicate deliveries create one message;
- an echo duplicating an API-created `wamid` preserves its content, media, status, and `sentByUserId`;
- a stale echo can enter history but cannot regress `lastMessageAt` or clear an awaiting state opened by a newer inbound message;
- a latest echo clears `awaitingResponseSince`;
- transaction failure publishes no SSE, schedules no media, and leaves no partial contact/conversation/message/media/event state;
- edit/revoke controls are deduplicated and marked processed without changing message history.

- [ ] **Step 2: Run focused RED tests against an isolated `_test` database**

Set both `DATABASE_URL` and `TEST_DATABASE_URL` to the dedicated PostgreSQL test database, then run:

```powershell
npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts
```

Expected: FAIL because the processor has no echo branch and hardcodes inbound persistence.

- [ ] **Step 3: Generalize message creation and implement echo processing**

Refactor repository inputs without changing standard inbound semantics. Before creating an echo, look up `whatsappMessageId`; an existing row is authoritative and must only complete the echo event as duplicate.

For a new echo, resolve the recipient by the available BSUID, phone or both inside the transaction. If either identity already maps to a contact, converge on that contact and attach the other identity monotonically; never create duplicate contacts/conversations for the same recipient. Then create optional pending media, create the outbound message, update conversation activity monotonically, call `refreshResponseState` with the same Prisma transaction, and complete the webhook reservation. Publish/schedule only after transaction commit.

Control events reserve and complete with no history mutation.

- [ ] **Step 4: Close concurrency and retry seams**

Retain serializable retry for `P2002`/`P2034`. Confirm concurrent duplicate reservations and the unique `whatsappMessageId` converge without clobbering the winning message. Keep safe `recordFailure` behavior and do not emit identifiers in errors.

- [ ] **Step 5: Run focused, full PostgreSQL, and static checks**

Run:

```powershell
npx vitest run src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/conversations/shared-state.test.ts src/modules/conversations/shared-state.integration.test.ts
npx vitest run --exclude ".superpowers/**"
npm run lint
npm run typecheck
git diff --check
```

Expected: all tracked tests pass; the ignored FFmpeg integration artifact remains excluded on Windows.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts
git commit -m "feat: persist WhatsApp app message echoes"
```

### Task 3: Show the safe WhatsApp author and verify realtime reconciliation

**Files:**
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify if a regression test needs it: `src/hooks/use-inbox.test.tsx`
- Modify if a regression test needs it: `src/hooks/use-realtime.test.ts`

**Interfaces:**
- Outbound message with `sentBy` displays that employee.
- Outbound message without `sentBy` displays **WhatsApp**.
- Inbound message without `sentBy` displays no author label.
- Existing `message.created` invalidation refetches the selected conversation and list without transporting content over SSE.

- [ ] **Step 1: Write the failing author and realtime tests**

Assert all three author cases. Add/strengthen an inbox test proving a `message.created` event for an echo causes one guarded refetch/reconciliation without duplicating an optimistic/API message.

- [ ] **Step 2: Run focused RED tests**

```powershell
npx vitest run src/components/inbox/message-bubble.test.tsx src/hooks/use-inbox.test.tsx src/hooks/use-realtime.test.ts
```

Expected: the outbound-null-actor test fails because the label is currently omitted.

- [ ] **Step 3: Implement the minimum UI fallback**

Render `message.sentBy?.name ?? "WhatsApp"` only for outbound messages. Preserve all media, status, retry, accessibility, and responsive behavior.

- [ ] **Step 4: Run frontend quality gates**

```powershell
npx vitest run src/components/inbox/message-bubble.test.tsx src/hooks/use-inbox.test.tsx src/hooks/use-realtime.test.ts
npm run lint
npm run typecheck
git diff --check
```

Run the React best-practices and stop-slop review checklists because TSX changed. Expected: PASS with no new client state or payload data.

- [ ] **Step 5: Commit**

```powershell
git add src/components/inbox/message-bubble.tsx src/components/inbox/message-bubble.test.tsx src/hooks/use-inbox.test.tsx src/hooks/use-realtime.test.ts
git commit -m "feat: label WhatsApp app messages"
```

### Task 4: Verify, deploy app-only, and enable the Meta subscription

**Files:**
- Modify: `README.md`
- Create: `docs/verification/2026-08-21-whatsapp-business-app-message-echoes.md`
- Modify: `.superpowers/sdd/progress.md` (local ignored progress ledger)

- [ ] **Step 1: Document the required subscription and rollback**

Document that coexistence requires the existing `messages` subscription plus `smb_message_echoes`, that the previous field list must be preserved, and that App Secret/access token/verify token must stay server-side. Include the exact rollback order: restore prior fields, verify readback, then roll back the image.

- [ ] **Step 2: Run fresh release gates**

Using the isolated `_test` database, run:

```powershell
npx vitest run --exclude ".superpowers/**"
npm run lint
npm run typecheck
npm run db:validate
npm run db:generate
npm run build
npm audit --omit=dev
npm audit
pwsh scripts/verify-compose.ps1
git diff --check
git status --short
```

Build the immutable Docker image from the exact clean commit and verify standalone startup, internal/host health, UID 1001, and zero packaged tests. Do not deploy with a dirty tree.

- [ ] **Step 3: Back up and deploy only the app**

Create and validate the existing database/media backup bundle because this release includes the already-reviewed shared-state migration. Record the current release/image/hash and a non-sensitive snapshot of all container identities/StartedAt values.

Transfer/import the immutable image and exact Git-archive release. Validate resolved Compose, then recreate only `xp-whatsapp-app`. Verify Compose config hash, UID 1001, health, public login/legal routes, webhook GET, invalid signature 401, three canonical networks, and unchanged database/Caddy/other containers.

- [ ] **Step 4: Add `smb_message_echoes` safely**

On the KVM, read the current app subscription field list into process memory without printing secrets or identifiers. Submit the exact prior list plus `smb_message_echoes`, with the existing public callback and verify token read from the app environment. Read back and assert:

1. every previous field is still present;
2. `smb_message_echoes` is present exactly once;
3. callback/verification succeeded;
4. no other field changed.

If any assertion fails, restore the exact previous list and verify restoration before considering image rollback.

- [ ] **Step 5: Run the real controlled acceptance test**

Ask the user to send one identifiable text from the store's WhatsApp Business app to an authorized test contact. Verify, without printing phone/content/Meta IDs:

- one signed `smb_message_echoes` webhook returns 200;
- exactly one `OUTBOUND` / `SENT` row with `sentByUserId=null` is added;
- the intended conversation is used;
- the UI shows author **WhatsApp** in both active sessions without reload;
- shared `awaitingResponseSince` clears only when the echo is the latest relevant message;
- duplicate delivery does not create a second row;
- no 5xx, raw payload, PII, message content, or secret appears in post-deploy logs.

Then test one supported media echo if the text flow is stable; confirm pending-to-available recovery without blocking the webhook.

- [ ] **Step 6: Close verification and commit documentation**

Record only sanitized counts, timestamps, commit/image hashes, HTTP status, container invariants, and pass/fail outcomes in the verification document. Update the local progress ledger and commit tracked documentation:

```powershell
git add README.md docs/verification/2026-08-21-whatsapp-business-app-message-echoes.md
git commit -m "docs: verify WhatsApp app message echoes"
git status --short
```

Expected: worktree clean, production healthy, subscription converged, and the mobile-sent message visible once.

---

## Completion Criteria

- Official `smb_message_echoes` callbacks are normalized and processed with the existing signature/body/deadline protections.
- Text and supported media sent from the WhatsApp Business app appear once in the correct conversation.
- Echoes resolve with either legacy phone or BSUID, and later BSUID/phone overlap converges without duplicate contacts or conversations.
- Mobile-app messages are outbound `SENT`, have no invented internal actor, and display **WhatsApp**.
- API-originated messages keep their employee attribution when a duplicate echo arrives.
- Latest mobile-app replies clear the shared awaiting-response state; stale echoes cannot regress state.
- Every session reconciles through existing ID-only SSE.
- Existing Meta subscriptions, database, Caddy, volumes, networks, and unrelated services remain intact.
- Rollback was proven safe and production evidence contains no PII/content/secrets.
