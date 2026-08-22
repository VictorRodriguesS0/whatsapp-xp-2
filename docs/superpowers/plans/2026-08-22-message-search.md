# Message Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast, shared search across all messages and within one conversation, with exact-message navigation and no search-induced read-state changes.

**Architecture:** Store a deterministic `searchText` projection on every message, backfill it transactionally, and index it with PostgreSQL `pg_trgm`. A focused search module owns extraction, validation, cursor pagination, snippets, and context retrieval; authenticated API routes expose it to isolated global and in-thread React search components.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, PostgreSQL 18, Zod 4, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- Search text, captions, original attachment names, shared-contact names and numbers, and textual location data.
- Do not add audio transcription, image OCR, typo-tolerant search, or an external search service.
- Require at least 2 and at most 120 normalized query characters.
- Administrators and active attendants share the same company-wide search scope.
- Searching and selecting a result must not mark a conversation read; only the existing visible-message rule may do so.
- Render customer content as escaped text, never executable HTML.
- Use stable cursor pagination and server-controlled limits; never load the complete history to search in the browser.
- Respect keyboard navigation, mobile touch targets, focus restoration, and `prefers-reduced-motion`.
- Deploy with a validated backup, Prisma migration, health checks, automatic rollback, and no mutation of unrelated KVM services.

---

## File map

- `src/modules/message-search/text.ts`: deterministic extraction and normalization of searchable message content.
- `src/modules/message-search/types.ts`: repository records, public result DTOs, cursors, and query contracts.
- `src/modules/message-search/schemas.ts`: global and conversation query validation.
- `src/modules/message-search/service.ts`: indexed search, cursor encoding, snippets, and exact-message context retrieval.
- `src/app/api/message-search/route.ts`: authenticated global search.
- `src/app/api/conversations/[id]/message-search/route.ts`: authenticated in-conversation search.
- `src/components/inbox/message-search-results.tsx`: global result list and paging states.
- `src/components/inbox/conversation-message-search.tsx`: in-thread search bar and occurrence navigation.
- `src/hooks/use-message-search.ts`: debounced global/in-thread request state without read side effects.
- Existing inbox, conversation, message ingestion, Prisma, and deployment files change only at their integration boundaries.

### Task 1: Search-text projection and indexed migration

**Files:**
- Create: `src/modules/message-search/text.ts`
- Create: `src/modules/message-search/text.test.ts`
- Create: `prisma/migrations/202608220003_message_search/migration.sql`
- Create: `prisma/message-search-contract.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/webhooks/process.ts`

**Interfaces:**
- Produces: `buildMessageSearchText(input: { body: string | null; content: unknown; originalFilename?: string | null }): string`.
- Produces: nullable database column `messages.search_text`, mapped by Prisma as `searchText String? @map("search_text")`.

- [ ] **Step 1: Write failing extractor tests**

```ts
expect(buildMessageSearchText({ body: "  Olá   PIX ", content: null })).toBe("olá pix");
expect(buildMessageSearchText({ body: "Legenda", content: { kind: "location", name: "Loja", address: "Asa Norte", latitude: -15.7, longitude: -47.8 } }))
  .toBe("legenda loja asa norte -15.7 -47.8");
expect(buildMessageSearchText({ body: null, content: { kind: "contacts", contacts: [{ name: "Ana", phones: [{ phone: "+55 61 9999-0000", type: "CELL" }] }], truncated: false } }))
  .toContain("ana +55 61 9999-0000 cell");
expect(buildMessageSearchText({ body: "catálogo", content: null, originalFilename: "Lista Agosto.PDF" }))
  .toBe("catálogo lista agosto.pdf");
```

- [ ] **Step 2: Run the extractor test and confirm the red state**

Run: `npm test -- src/modules/message-search/text.test.ts`  
Expected: FAIL because `buildMessageSearchText` does not exist.

- [ ] **Step 3: Implement safe extraction through `parseMessageContent`**

```ts
export function normalizeSearchText(parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== null && part !== undefined)
    .join(" ").normalize("NFC").toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
}

export function buildMessageSearchText(input: SearchTextInput) {
  const content = parseMessageContent(input.content);
  const parts: Array<string | number | null | undefined> = [input.body, input.originalFilename];
  if (content?.kind === "location") parts.push(content.name, content.address, content.latitude, content.longitude);
  if (content?.kind === "contacts") for (const contact of content.contacts) {
    parts.push(contact.name);
    for (const phone of contact.phones) parts.push(phone.phone, phone.type);
  }
  if (content?.kind === "interactive") parts.push(content.title, content.id);
  if (content?.kind === "system") parts.push(content.text);
  return normalizeSearchText(parts);
}
```

- [ ] **Step 4: Write a failing SQL contract test**

The contract test must assert `CREATE EXTENSION IF NOT EXISTS pg_trgm`, `ADD COLUMN search_text`, a bounded backfill covering `body`, supported JSON content, and `media_objects.original_filename`, plus `CREATE INDEX ... USING gin (search_text gin_trgm_ops)`.

Run: `npm test -- prisma/message-search-contract.test.ts`  
Expected: FAIL until the migration exists with every contract fragment.

- [ ] **Step 5: Add the migration and Prisma mapping**

Use a migration transaction that creates `pg_trgm`, adds `search_text`, backfills from message/body/content/media filename, creates a trigger function for database-side safety, attaches insert/update triggers, and creates `messages_search_text_trgm_idx`. Keep the column nullable during backfill and finish it as `NOT NULL DEFAULT ''` only after all rows are populated.

- [ ] **Step 6: Populate `searchText` in all application ingestion paths**

Before message creation, resolve the safe original filename when a media object exists and set:

```ts
searchText: buildMessageSearchText({ body, content, originalFilename }),
```

The trigger remains a defense for non-application writes and old integrations.

- [ ] **Step 7: Verify and commit the projection**

Run: `npm test -- src/modules/message-search/text.test.ts prisma/message-search-contract.test.ts src/modules/messages/service.test.ts src/modules/webhooks/process.test.ts`  
Expected: all selected tests PASS.

```bash
git add prisma/schema.prisma prisma/migrations/202608220003_message_search prisma/message-search-contract.test.ts src/modules/message-search src/modules/messages/service.ts src/modules/webhooks/process.ts
git commit -m "feat: index searchable message content"
```

### Task 2: Search service, pagination, snippets, and exact context

**Files:**
- Create: `src/modules/message-search/types.ts`
- Create: `src/modules/message-search/schemas.ts`
- Create: `src/modules/message-search/service.ts`
- Create: `src/modules/message-search/service.test.ts`
- Create: `src/modules/message-search/service.integration.test.ts`

**Interfaces:**
- Produces: `searchMessages(actorId: string, input: MessageSearchInput, repository?: MessageSearchRepository): Promise<MessageSearchPage>`.
- Produces: `searchConversationMessages(actorId: string, conversationId: string, input: ConversationMessageSearchInput, repository?: MessageSearchRepository): Promise<ConversationMessageSearchPage>`.
- Produces: `loadMessageContext(actorId: string, conversationId: string, messageId: string, repository?: MessageSearchRepository): Promise<MessageContextDto>`.
- `MessageSearchResultDto` contains `messageId`, `conversationId`, `contact`, `direction`, `type`, `externalTimestamp`, `snippet`, and `matchedText`.

- [ ] **Step 1: Write failing schema and service tests**

```ts
expect(messageSearchSchema.parse({ query: " pix " })).toMatchObject({ query: "pix", take: 20 });
expect(() => messageSearchSchema.parse({ query: "/" })).toThrow();
expect(await searchMessages(user.id, { query: "produto", take: 20 }, repository)).toEqual({
  items: [expect.objectContaining({ messageId: match.id, conversationId: conversation.id, snippet: expect.any(String) })],
  nextCursor: null,
});
```

Also assert inactive users are rejected, global ordering is `(externalTimestamp DESC, id DESC)`, a cursor has no duplicates, conversation search never crosses conversation IDs, and context returns at most 20 preceding plus the target plus 20 following messages.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- src/modules/message-search/service.test.ts src/modules/message-search/service.integration.test.ts`  
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement typed cursor and repository boundaries**

```ts
export type MessageSearchCursor = { externalTimestamp: string; id: string };
export type MessageSearchInput = { query: string; take?: number; cursor?: string };
export type MessageSearchPage = { items: MessageSearchResultDto[]; nextCursor: string | null };
export type MessageContextDto = { conversationId: string; targetMessageId: string; messages: MessageDto[] };
```

Encode cursors as base64url JSON and validate the decoded timestamp and UUID before issuing SQL.

- [ ] **Step 4: Implement indexed parameterized queries**

Use Prisma `$queryRaw` tagged templates. Filter with `message.search_text ILIKE '%' || ${normalizedQuery} || '%'`, preserve the stable tuple cursor, join only contact and media fields needed for the DTO, and fetch `take + 1`. Generate snippets in TypeScript from the already-safe `searchText`, limiting output to 180 characters around the first occurrence.

- [ ] **Step 5: Implement context retrieval without read writes**

Verify the active actor and conversation, verify the target belongs to it, query bounded rows before and after the target, map through the existing message DTO conversion, and do not call `markConversationRead` or mutate `ConversationRead`.

- [ ] **Step 6: Verify and commit the service**

Run: `npm test -- src/modules/message-search/service.test.ts src/modules/message-search/service.integration.test.ts`  
Expected: all selected tests PASS.

```bash
git add src/modules/message-search
git commit -m "feat: search indexed message history"
```

### Task 3: Authenticated search APIs

**Files:**
- Create: `src/app/api/message-search/route.ts`
- Create: `src/app/api/message-search/route.test.ts`
- Create: `src/app/api/conversations/[id]/message-search/route.ts`
- Create: `src/app/api/conversations/[id]/message-search/route.test.ts`
- Create: `src/app/api/conversations/[id]/messages/[messageId]/context/route.ts`
- Create: `src/app/api/conversations/[id]/messages/[messageId]/context/route.test.ts`

**Interfaces:**
- `GET /api/message-search?query=pix&cursor=...`
- `GET /api/conversations/:id/message-search?query=pix&cursor=...`
- `GET /api/conversations/:id/messages/:messageId/context`
- All success responses use `{ data, error: null }`; failures reuse `conversationErrorResponse`.

- [ ] **Step 1: Write failing route tests**

Test 401 without a session, 400 for one-character or duplicate scalar query values, 404 for missing conversation/target, and 200 forwarding validated actor IDs and parameters to the service.

- [ ] **Step 2: Confirm the route tests fail**

Run: `npm test -- src/app/api/message-search/route.test.ts src/app/api/conversations/[id]/message-search/route.test.ts src/app/api/conversations/[id]/messages/[messageId]/context/route.test.ts`  
Expected: FAIL because the route handlers do not exist.

- [ ] **Step 3: Implement injectable route factories**

Follow the existing route pattern:

```ts
const actor = await dependencies.requireUser();
const parsed = messageSearchSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
return conversationSuccessResponse(await dependencies.searchMessages(actor.id, parsed));
```

Reject duplicate scalar parameters explicitly instead of allowing `Object.fromEntries` to silently keep the last value.

- [ ] **Step 4: Verify and commit the APIs**

Run the same three route test files.  
Expected: all selected tests PASS.

```bash
git add src/app/api/message-search src/app/api/conversations
git commit -m "feat: expose authenticated message search api"
```

### Task 4: Reusable client-side search state

**Files:**
- Create: `src/hooks/use-message-search.ts`
- Create: `src/hooks/use-message-search.test.tsx`

**Interfaces:**
- Produces `useMessageSearch({ scope: "global" | "conversation"; conversationId?: string; debounceMs?: number })`.
- Returns `query`, `setQuery`, `items`, `loading`, `loadingMore`, `error`, `nextCursor`, `retry`, `loadMore`, `activeIndex`, `setActiveIndex`, `next`, `previous`, and `reset`.

- [ ] **Step 1: Write failing hook tests**

Use fake timers to prove no request occurs below two characters, only one request occurs after 250 ms, stale responses cannot overwrite a newer term, pagination appends without duplicates, conversation changes reset state, and `next`/`previous` wrap across loaded matches without sending read requests.

- [ ] **Step 2: Confirm the hook tests fail**

Run: `npm test -- src/hooks/use-message-search.test.tsx`  
Expected: FAIL because the hook is absent.

- [ ] **Step 3: Implement abortable debounced requests**

Use an `AbortController` per request and a monotonically increasing request revision. Build only same-origin URLs and parse the existing `{ data, error }` envelope. Keep the typed query on errors and expose `retry`.

- [ ] **Step 4: Verify and commit the hook**

Run: `npm test -- src/hooks/use-message-search.test.tsx`  
Expected: PASS.

```bash
git add src/hooks/use-message-search.ts src/hooks/use-message-search.test.tsx
git commit -m "feat: manage message search state"
```

### Task 5: Global message search in the conversation pane

**Files:**
- Create: `src/components/inbox/message-search-results.tsx`
- Create: `src/components/inbox/message-search-results.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `MessageSearchResults` consumes the global hook result plus `onSelect(result: MessageSearchResultDto): void`.
- `InboxShell.selectSearchResult` opens the conversation and requests exact context before focusing the target.

- [ ] **Step 1: Write failing component tests**

Assert the UI switches between `Conversas` and `Mensagens`, preserves each mode's term, shows contact/snippet/type/direction/date, highlights matched text through React text nodes, exposes loading/empty/error/load-more states, and provides at least 44px touch targets.

- [ ] **Step 2: Confirm component tests fail**

Run: `npm test -- src/components/inbox/message-search-results.test.tsx src/components/inbox/inbox-shell.test.tsx`  
Expected: FAIL because the mode selector and results component are absent.

- [ ] **Step 3: Implement the accessible mode selector and result list**

Use buttons with `aria-pressed`, labels `Conversas` and `Mensagens`, and change the placeholder to `Buscar nas mensagens` in message mode. Split snippets around case-insensitive occurrences and render matches with `<mark>`; never use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Wire result selection to exact context loading**

Add a focused inbox action that opens the selected conversation, fetches `/context`, merges returned messages by ID in timestamp order, and stores `targetMessageId`. Do not invoke the read endpoint during this action.

- [ ] **Step 5: Verify and commit global search UI**

Run: `npm test -- src/components/inbox/message-search-results.test.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-inbox.test.tsx`  
Expected: all selected tests PASS.

```bash
git add src/components/inbox/message-search-results.tsx src/components/inbox/message-search-results.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/app/globals.css
git commit -m "feat: search messages across conversations"
```

### Task 6: In-conversation search and exact-message focus

**Files:**
- Create: `src/components/inbox/conversation-message-search.tsx`
- Create: `src/components/inbox/conversation-message-search.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- `ConversationView` receives `searchTargetMessageId`, `onSearchTargetHandled`, and `onLoadMessageContext`.
- Each bubble root exposes `data-message-id={message.id}` and supports `searchHighlighted`.

- [ ] **Step 1: Write failing interaction tests**

Assert the header search button opens the bar, autofocuses input, `Enter` advances, `Shift+Enter` returns, arrow buttons work, `Escape` closes and restores focus, conversation changes reset it, and a match outside loaded history fetches context before focus.

- [ ] **Step 2: Write failing visibility/read-state tests**

Assert selecting a result and merging context makes no `/read` request. Only after the target bubble is actually visible may the existing `onVisibleMessage` path mark the latest visible message according to current shared-inbox rules.

- [ ] **Step 3: Confirm tests fail**

Run: `npm test -- src/components/inbox/conversation-message-search.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.test.tsx src/hooks/use-inbox.test.tsx`  
Expected: FAIL because search controls and target focus do not exist.

- [ ] **Step 4: Implement search controls and bounded context merging**

Render a second compact header row on narrow screens. Expose `N de T` through `aria-live="polite"`. Merge context with a `Map<string, InboxMessage>`, sort by `(externalTimestamp, id)`, and retain realtime messages already present.

- [ ] **Step 5: Implement exact focus and temporary highlight**

After messages render, locate the escaped ID through `document.querySelector('[data-message-id="..."]')` only after validating it as a UUID, call `scrollIntoView({ block: "center", behavior })`, focus a `tabIndex={-1}` bubble, and remove the highlight after 3 seconds. Use `behavior: "auto"` when reduced motion is enabled.

- [ ] **Step 6: Verify and commit in-thread search**

Run the four focused test files from Step 3.  
Expected: all selected tests PASS.

```bash
git add src/components/inbox/conversation-message-search.tsx src/components/inbox/conversation-message-search.test.tsx src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-bubble.test.tsx src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: search within an open conversation"
```

### Task 7: Full verification and production rollout

**Files:**
- Modify: `scripts/test-deployment.ps1` only if the new migration reveals a missing validator invariant.
- Create: `docs/verification/2026-08-22-message-search.md`

**Interfaces:**
- Produces a release image labeled with the exact Git revision and a written, sanitized verification record.

- [ ] **Step 1: Run focused database validation**

Run: `npm run db:generate && npm run db:validate`  
Expected: Prisma generation and validation succeed.

- [ ] **Step 2: Run the complete quality gate**

Run: `npm test && npm run lint && npm run typecheck && npm run build && npm audit --omit=dev`  
Expected: zero test failures, zero lint/type/build errors, and zero production vulnerabilities.

- [ ] **Step 3: Validate the real migration against a disposable PostgreSQL 18 database**

Apply every migration, seed representative text/media/contact/location messages, verify the backfill and index with SQL, and run the integration suite. Confirm that searching never inserts or updates `conversation_reads`.

- [ ] **Step 4: Run responsive browser acceptance locally**

Verify desktop and mobile: global mode switch, two-character threshold, result paging, exact-message jump, internal navigation, `Escape`, reduced-motion behavior, safe HTML rendering, and no console errors. Do not send a real WhatsApp message.

- [ ] **Step 5: Build and validate the immutable image**

Build `xp-whatsapp:<short-sha>`, assert UID 1001, `ffmpeg`/`ffprobe`, OCI revision label, health check, migration presence, and no CRLF in POSIX release scripts.

- [ ] **Step 6: Back up and deploy app-only to the KVM**

Create and validate a timestamped backup under `/srv/backups/example-app`, transfer an exact Git archive, run Prisma deploy, replace only `xp-whatsapp-app`, and preserve database identity, networks, environment, volumes, and unrelated containers. Roll back automatically if any post-check fails.

- [ ] **Step 7: Verify production and record evidence**

Collect three spaced samples of public/local HTTP 200, `healthy`, stable `StartedAt`, and `restarts=0`; inspect recent logs; verify anonymous authorization boundaries; and perform authenticated read-only search acceptance if a session is available. Write sanitized evidence to `docs/verification/2026-08-22-message-search.md`.

- [ ] **Step 8: Commit verification evidence**

```bash
git add docs/verification/2026-08-22-message-search.md scripts/test-deployment.ps1
git commit -m "docs: record message search production verification"
```
