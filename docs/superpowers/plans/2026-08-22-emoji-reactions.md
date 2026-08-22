# Emoji Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meta-compliant emoji reactions that attendants can send and that stay synchronized with customer reactions and the official WhatsApp Business app.

**Architecture:** Store current reactions in a normalized table keyed by target message and reactor, reconcile outbound attempts and webhook echoes through provider timestamps, and expose reactions in existing message DTOs. A focused reaction service owns eligibility, emoji validation, idempotency, and provider state; the inbox adds a WhatsApp-like quick strip plus a lazily loaded accessible full picker.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, PostgreSQL 18, Zod 4, Vitest, Testing Library, Radix UI, Frimousse 0.3.0, Meta WhatsApp Cloud API.

## Global Constraints

- Use only the official WhatsApp Cloud API; do not add WhatsApp Web, QR code, browser automation, or unofficial WhatsApp libraries.
- Support send, replace, remove, inbound customer reactions, and official WhatsApp Business app echoes.
- Reject targets without a confirmed `wamid`, older than 30 days, revoked, or representing a reaction.
- Accept one Unicode emoji grapheme; accept an empty string only as a removal command.
- Keep at most one current `CONTACT` and one current `BUSINESS` reaction per target message.
- Reaction actions must not modify unread state, `awaitingResponseSince`, delayed-response highlighting, assignment, or original message delivery status.
- The latest valid provider timestamp wins; ties use a stable provider event identifier.
- Keep customer content escaped as text and return only safe public errors.
- Quick reactions are `👍 ❤️ 😂 😮 😢 🙏`; the full picker is client-only and loaded on demand.
- Preserve mouse, keyboard, long-press, `Escape`, mobile back, 44px targets, screen-reader labels, and reduced-motion behavior.
- Deploy app-only with a validated backup, migration, health checks, automatic rollback, and no changes to unrelated KVM services.

---

## File map

- `src/modules/reactions/emoji.ts`: Unicode grapheme validation.
- `src/modules/reactions/types.ts`: service, repository, provider, and DTO contracts.
- `src/modules/reactions/service.ts`: eligibility, idempotent outbound operations, retry, and reconciliation.
- `src/modules/reactions/repository.ts`: Prisma persistence and compare-and-set rules.
- `src/app/api/messages/[id]/reaction/route.ts`: authenticated create/replace/remove API.
- `src/components/inbox/message-reactions.tsx`: badges, quick strip, pending/error state.
- `src/components/inbox/full-emoji-picker.tsx`: dynamically imported Frimousse picker.
- `src/hooks/use-message-reactions.ts`: optimistic request ownership without read-state writes.
- Existing message, webhook, provider, realtime, inbox, Prisma, and deployment files change only at their integration boundaries.

### Task 1: Reaction schema, migration, and message DTOs

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608220005_message_reactions/migration.sql`
- Create: `prisma/message-reactions-contract.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`

**Interfaces:**
- Produces Prisma enums `ReactionReactor` and `ReactionStatus`.
- Produces model `MessageReaction` with unique `(messageId, reactor)`.
- Produces `ReactionDto` and `MessageDto.reactions: ReactionDto[]` plus `MessageDto.revokedAt: string | null`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
expect(sql).toMatch(/CREATE TYPE "ReactionReactor" AS ENUM \('CONTACT', 'BUSINESS'\)/u);
expect(sql).toMatch(/UNIQUE \("message_id", "reactor"\)/u);
expect(sql).toMatch(/ADD COLUMN "revoked_at" TIMESTAMPTZ\(3\)/u);
expect(sql).toMatch(/ON DELETE CASCADE/u);
expect(sql).toMatch(/sent_by_user_id/u);
```

Run: `npm test -- prisma/message-reactions-contract.test.ts`  
Expected: FAIL because the migration does not exist.

- [ ] **Step 2: Add failing DTO mapping tests**

Assert a message maps reactions in deterministic `CONTACT`, then `BUSINESS` order; includes the employee name only for a system-created business reaction; excludes failure details; and serializes `revokedAt` as ISO or `null`.

Run: `npm test -- src/modules/conversations/service.test.ts`  
Expected: FAIL because reactions and revocation are absent from the DTO.

- [ ] **Step 3: Add the Prisma model and migration**

```prisma
enum ReactionReactor { CONTACT BUSINESS }
enum ReactionStatus { PENDING SENT FAILED OUTCOME_UNKNOWN }

model MessageReaction {
  id                  String          @id @default(uuid()) @db.Uuid
  messageId           String          @map("message_id") @db.Uuid
  reactor             ReactionReactor
  emoji               String
  status              ReactionStatus
  clientRequestId     String?         @unique @map("client_request_id") @db.Uuid
  providerMessageId   String?         @map("provider_message_id")
  providerEventId     String?         @map("provider_event_id")
  providerTimestamp   DateTime?       @map("provider_timestamp") @db.Timestamptz(3)
  providerAttemptedAt DateTime?       @map("provider_attempted_at") @db.Timestamptz(3)
  sentByUserId        String?         @map("sent_by_user_id") @db.Uuid
  failureReason       String?         @map("failure_reason")
  createdAt           DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime        @updatedAt @map("updated_at") @db.Timestamptz(3)
  message             Message         @relation(fields: [messageId], references: [id], onDelete: Cascade)
  sentByUser          User?           @relation("ReactionSentByUser", fields: [sentByUserId], references: [id], onDelete: Restrict)

  @@unique([messageId, reactor])
  @@index([providerMessageId])
  @@map("message_reactions")
}
```

Add `Message.revokedAt`, `Message.reactions`, and `User.sentReactions`. The SQL migration must use PostgreSQL enum names exactly, foreign keys, uniqueness, indexes, and timezone-aware timestamps.

- [ ] **Step 4: Map bounded reaction selections into DTOs**

Select only current reactions and `sentByUser: { id, name }`; map them through a dedicated `toReactionDto` helper. Never return `failureReason`, provider event IDs, or client request IDs in conversation reads.

- [ ] **Step 5: Generate, verify, and commit**

Run: `npm run db:generate && npm run db:validate && npm test -- prisma/message-reactions-contract.test.ts src/modules/conversations/service.test.ts`  
Expected: all selected tests PASS.

```bash
git add prisma src/generated/prisma src/modules/conversations
git commit -m "feat: persist current message reactions"
```

### Task 2: Emoji validation and outbound reaction service

**Files:**
- Create: `src/modules/reactions/emoji.ts`
- Create: `src/modules/reactions/emoji.test.ts`
- Create: `src/modules/reactions/types.ts`
- Create: `src/modules/reactions/repository.ts`
- Create: `src/modules/reactions/service.ts`
- Create: `src/modules/reactions/service.test.ts`
- Create: `src/modules/reactions/service.integration.test.ts`

**Interfaces:**
- Produces `isSingleEmoji(value: string): boolean` and `reactionInputSchema`.
- Produces `setBusinessReaction(actorId, messageId, { emoji, clientRequestId }, dependencies?): Promise<ReactionMutationDto>`.
- Produces `retryBusinessReaction(actorId, reactionId, dependencies?): Promise<ReactionMutationDto>`.

- [ ] **Step 1: Write failing emoji tests**

```ts
expect(isSingleEmoji("👍")).toBe(true);
expect(isSingleEmoji("👨🏽‍💻")).toBe(true);
expect(isSingleEmoji("❤️")).toBe(true);
expect(isSingleEmoji("")).toBe(false);
expect(isSingleEmoji("👍👍")).toBe(false);
expect(isSingleEmoji("ok")).toBe(false);
expect(isSingleEmoji("1")).toBe(false);
```

Run: `npm test -- src/modules/reactions/emoji.test.ts`  
Expected: FAIL because the validator is absent.

- [ ] **Step 2: Implement grapheme-aware validation**

Use `Intl.Segmenter("pt-BR", { granularity: "grapheme" })` to require one segment and a Unicode property expression containing `Extended_Pictographic` or a valid emoji presentation sequence. Cap UTF-8 input at 64 bytes before segmentation.

- [ ] **Step 3: Write failing service tests**

Cover active user, same-conversation message lookup, missing `wamid`, 30-day boundary, `revokedAt`, empty-string removal, create, replace, same-emoji removal, idempotent `clientRequestId`, confirmed provider rejection, unknown provider outcome, manual retry, and no calls to read/response-state repositories.

```ts
await expect(setBusinessReaction(actor.id, message.id, {
  emoji: "👍",
  clientRequestId,
}, dependencies)).resolves.toMatchObject({ reactor: "BUSINESS", emoji: "👍", status: "SENT" });
expect(provider.sendReaction).toHaveBeenCalledWith({
  to: contact.phone,
  targetWhatsappMessageId: message.whatsappMessageId,
  emoji: "👍",
});
```

- [ ] **Step 4: Confirm the service tests fail**

Run: `npm test -- src/modules/reactions/service.test.ts src/modules/reactions/service.integration.test.ts`  
Expected: FAIL because the service and repository are absent.

- [ ] **Step 5: Implement one-operation-per-message ownership**

Create or update the `BUSINESS` row in a transaction using `clientRequestId`, set `PENDING` before the external call, stamp `providerAttemptedAt` at the boundary, then mark `SENT`, `FAILED`, or `OUTCOME_UNKNOWN`. Empty emoji deletes only after provider confirmation. Do not blindly retry `OUTCOME_UNKNOWN`.

- [ ] **Step 6: Verify and commit the service**

Run the emoji, service, and integration tests.  
Expected: all selected tests PASS.

```bash
git add src/modules/reactions
git commit -m "feat: manage idempotent business reactions"
```

### Task 3: Meta provider reaction support

**Files:**
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`

**Interfaces:**
- Extends `WhatsAppProvider.sendReaction(input): Promise<SendResult>`.

- [ ] **Step 1: Write failing provider contract tests**

Assert the provider sends one POST to `/{phoneNumberId}/messages` with:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5561999999999",
  "type": "reaction",
  "reaction": { "message_id": "wamid.target", "emoji": "👍" }
}
```

Repeat with `emoji: ""` and assert the body remains an empty string. Cover non-2xx response, invalid Meta response, timeout before request completion, and outcome unknown after the request boundary.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/modules/whatsapp/meta-provider.test.ts`  
Expected: FAIL because `sendReaction` is not implemented.

- [ ] **Step 3: Implement through the existing authenticated request boundary**

Reuse the current timeout, response parsing, safe error mapping, and `SendResult` conversion. Do not add a separate HTTP client or token handling path. The demo provider returns a deterministic `wamid.demo-reaction-<uuid>`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/modules/whatsapp/meta-provider.test.ts src/modules/reactions/service.test.ts`  
Expected: PASS.

```bash
git add src/modules/whatsapp
git commit -m "feat: send reactions through Meta Cloud API"
```

### Task 4: Reaction and revocation webhook reconciliation

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Modify: `src/modules/realtime/events.ts`
- Modify: `src/modules/realtime/events.test.ts`

**Interfaces:**
- Produces `NormalizedReactionEvent` and `NormalizedReactionEchoEvent` with target `wamid`, emoji, provider event ID, timestamp, and identity fields.
- Produces SSE `reaction.updated` with `conversationId` and `messageId`.

- [ ] **Step 1: Replace the existing unknown-reaction expectation with failing normalization tests**

Assert inbound fixture becomes `kind: "reaction"`, app echo becomes `kind: "reactionEcho"`, emoji empty remains valid removal, malformed/multiple/text emoji is rejected, and the reaction never becomes a `MessageType.UNSUPPORTED` message.

- [ ] **Step 2: Confirm normalization tests fail**

Run: `npm test -- src/modules/webhooks/normalize.test.ts`  
Expected: FAIL because reaction payloads still normalize as unknown messages.

- [ ] **Step 3: Implement strict reaction normalization**

Add separate discriminated events. Reuse exact provider identifier, identity, and timestamp parsers. Use the shared emoji validator; permit empty emoji only for reaction removal.

- [ ] **Step 4: Write failing reconciliation tests**

Cover CONTACT upsert/removal, BUSINESS app echo upsert/removal, same webhook redelivery, older timestamp ignored, timestamp tie resolved by provider event ID, cross-conversation target quarantine, missing target retry grace, and `REVOKE` setting `revokedAt` idempotently. Assert no message row or response-state refresh is created for reactions.

- [ ] **Step 5: Implement transactional reconciliation**

Use deduplication keys `reaction:<event-id>` and `reaction-echo:<event-id>`. Resolve the target and identity before upsert. Compare `(providerTimestamp, providerEventId)` atomically. Complete the webhook event and publish `reaction.updated` only after commit. Make current `REVOKE` handling update the target and publish `message.status` or a dedicated safe message update event.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/realtime/events.test.ts`  
Expected: all selected tests PASS.

```bash
git add src/modules/webhooks src/modules/realtime src/test/fixtures/meta-webhooks.ts
git commit -m "feat: reconcile reaction webhooks and app echoes"
```

### Task 5: Authenticated API and inbox mutation state

**Files:**
- Create: `src/app/api/messages/[id]/reaction/route.ts`
- Create: `src/app/api/messages/[id]/reaction/route.test.ts`
- Create: `src/app/api/reactions/[id]/retry/route.ts`
- Create: `src/app/api/reactions/[id]/retry/route.test.ts`
- Create: `src/hooks/use-message-reactions.ts`
- Create: `src/hooks/use-message-reactions.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/lib/public-error.ts`
- Modify: `src/lib/public-error.test.ts`

**Interfaces:**
- `PUT /api/messages/:id/reaction` body `{ emoji: string; clientRequestId: UUID }`.
- `POST /api/reactions/:id/retry` body `{ clientRequestId: UUID }`.
- Hook returns `react(message, emoji)`, `retry(reactionId)`, and per-message pending/error state.

- [ ] **Step 1: Write failing route tests**

Cover 401, malformed JSON, invalid emoji, duplicate scalar/body fields, 404, 409 ineligible target, 429/provider-safe failure, and 200 create/replace/remove. Injectable factories must forward the authenticated user ID.

- [ ] **Step 2: Confirm route tests fail**

Run: `npm test -- src/app/api/messages/[id]/reaction/route.test.ts src/app/api/reactions/[id]/retry/route.test.ts`  
Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement safe route envelopes**

Reuse `{ data, error }`, `requireUser`, `HttpError`, and existing public error helpers. Never return provider response bodies, access tokens, `wamid`s unrelated to the target, or failure internals.

- [ ] **Step 4: Write failing optimistic-state tests**

Assert immediate local badge, same-emoji removal, replacement, rollback on confirmed failure, `OUTCOME_UNKNOWN` preserved without blind retry, stale response ignored after conversation switch, one in-flight request per message, and zero `/read` calls.

- [ ] **Step 5: Implement request ownership and realtime refresh**

Generate `crypto.randomUUID()` per intent, merge the mutation response into the active message, and refetch on `reaction.updated`. Abort view-owned requests on conversation change but do not misclassify an already-attempted provider call as safe to repeat.

- [ ] **Step 6: Verify and commit**

Run the route, hook, inbox, public-error, and realtime tests.  
Expected: all selected tests PASS.

```bash
git add src/app/api/messages src/app/api/reactions src/hooks src/lib/public-error.ts src/lib/public-error.test.ts
git commit -m "feat: expose reaction mutations to the inbox"
```

### Task 6: WhatsApp-like reaction UI and accessible full picker

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/inbox/full-emoji-picker.tsx`
- Create: `src/components/inbox/full-emoji-picker.test.tsx`
- Create: `src/components/inbox/message-reactions.tsx`
- Create: `src/components/inbox/message-reactions.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `MessageReactions` receives the message, mutation state, `onReact`, and picker close/back integration.
- `FullEmojiPicker` emits one native emoji string and is imported with `dynamic(..., { ssr: false })` only after `+` is activated.

- [ ] **Step 1: Add pinned picker dependency and audit it**

Run: `npm install frimousse@0.3.0 --save-exact && npm audit --omit=dev`  
Expected: lockfile pins 0.3.0 and production audit reports zero vulnerabilities. No code imports it yet.

- [ ] **Step 2: Write failing badge and quick-strip tests**

Assert badges identify Cliente/XP, employee detail is optional, pending and failed state are announced, action appears on hover/focus, quick emojis match the approved six, same emoji removes, `+` opens full picker, `Escape` closes and restores focus, and targets are at least 44px.

- [ ] **Step 3: Write failing touch and full-picker tests**

Use pointer fake timers to assert long press opens after 500 ms, movement/cancel prevents it, a normal tap does not hijack media links, mobile back closes the picker first, Frimousse renders only after opening, picker search has Portuguese labeling, and selection emits one emoji.

- [ ] **Step 4: Confirm component tests fail**

Run: `npm test -- src/components/inbox/message-reactions.test.tsx src/components/inbox/full-emoji-picker.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-view.test.tsx`  
Expected: FAIL because reaction UI is absent.

- [ ] **Step 5: Implement quick reactions and lazy full picker**

Compose Frimousse inside the local Radix popover, style it with current variables, and configure the static emoji-data URL without sending search text to a server. Render quick buttons directly so the common path never waits for picker data.

- [ ] **Step 6: Implement desktop and mobile interaction boundaries**

Use semantic buttons and focus-visible styling. Handle long press only from non-interactive bubble space, cancel on pointer movement/up, close on `Escape`, and register picker state with the existing mobile history layer so browser back dismisses it before the thread.

- [ ] **Step 7: Verify and commit UI**

Run the four focused component tests plus `npm run lint` and `npm run typecheck`.  
Expected: all pass without accessibility or React warnings.

```bash
git add package.json package-lock.json src/components src/hooks/use-mobile-inbox-history.ts src/hooks/use-mobile-inbox-history.test.tsx src/app/globals.css
git commit -m "feat: add WhatsApp-like emoji reaction controls"
```

### Task 7: Full verification and incremental production rollout

**Files:**
- Modify: `scripts/test-deployment.ps1` only if the migration adds an uncovered deployment invariant.
- Create: `docs/verification/2026-08-22-emoji-reactions.md`

**Interfaces:**
- Produces immutable image `xp-whatsapp:<short-sha>` with the exact OCI Git revision and a sanitized verification report.

- [ ] **Step 1: Run all local quality gates**

Run: `npm run db:generate && npm run db:validate && npm test && npm run lint && npm run typecheck && npm run build && npm audit --omit=dev`  
Expected: zero test failures, lint/type/build errors, and production vulnerabilities.

- [ ] **Step 2: Verify migrations and concurrency on disposable PostgreSQL 18**

Apply every migration from zero, run the complete Linux suite with real FFmpeg, and execute concurrent system/app/contact reaction fixtures. Verify one CONTACT and one BUSINESS row, latest-provider ordering, deduplication, and no `conversation_reads` or response-state mutations.

- [ ] **Step 3: Run browser acceptance without contacting real clients**

Use demo provider fixtures to verify desktop, mobile, keyboard, long press, quick strip, full picker, replacement, removal, failure rollback, two-session realtime, focus restoration, reduced motion, and no console errors.

- [ ] **Step 4: Build and validate the immutable image**

Assert UID 1001, FFmpeg/FFprobe, OCI revision label, health check, migration presence, picker assets, no CRLF in POSIX scripts, and unchanged production runtime boundaries.

- [ ] **Step 5: Back up and deploy app-only to the KVM**

Create and validate a timestamped backup under `/srv/backups/example-app`, transfer an exact Git archive, run Prisma deploy, replace only `xp-whatsapp-app`, preserve database identity/networks/environment/volumes, and automatically roll back on any failed post-check.

- [ ] **Step 6: Verify production and record evidence**

Collect three spaced public/local HTTP 200 samples, healthy state, stable `StartedAt`, `restarts=0`, migration status, recent error logs, authorization boundaries, and authenticated read-only rendering. Send a real reaction only after explicit action-time approval from the user.

- [ ] **Step 7: Commit verification evidence**

```bash
git add docs/verification/2026-08-22-emoji-reactions.md scripts/test-deployment.ps1
git commit -m "docs: record emoji reaction production verification"
```
