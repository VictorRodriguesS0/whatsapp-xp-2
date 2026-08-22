# Conversation Labels and Close Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let active attendants apply multiple labels to contacts from the inbox and leave the selected conversation with desktop Escape or mobile back navigation without changing conversation business state.

**Architecture:** Add a read-only active-label catalog for authenticated active users while preserving admin-only definition management. Extend `useInbox` with authoritative label mutation/realtime reconciliation, render the editor and chips as focused inbox components, and isolate same-URL mobile history behavior in a dedicated hook.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 7, Prisma 7/PostgreSQL 18, Radix UI, Tailwind CSS 4, Vitest, Testing Library, Docker Compose.

## Global Constraints

- Leaving a conversation only returns to the list; it never archives, finishes, deletes, marks unread, or changes responsibility.
- All active attendants may read and apply active labels; only administrators may create, edit, or deactivate definitions.
- Label replacement remains atomic, complete-set, maximum 20 unique UUIDs, and publishes only PII-free realtime events after commit.
- History state contains only opaque UI layer markers and no contact, phone, conversation, message, or provider identifier.
- An overlay receives the first Escape; the active conversation receives Escape only when no dismissible overlay is open.
- Keep current Meta subscription and production infrastructure unchanged; deployment may recreate only `xp-whatsapp-app`.
- Use TDD for every production behavior and preserve unrelated worktree changes.

## File Structure

- Create `src/app/api/contact-tags/route.ts`: authenticated active-only label catalog.
- Create `src/app/api/contact-tags/route.test.ts`: route contract and safe envelope tests.
- Modify `src/modules/contacts/types.ts`: active-definition repository operation.
- Modify `src/modules/contacts/service.ts`: active-attendant catalog service and Prisma selection.
- Modify `src/modules/contacts/service.test.ts`: authorization and ordered active-only service behavior.
- Modify `src/lib/public-error.ts` and its test: safe label load/save messages.
- Modify `src/hooks/use-inbox.ts` and `src/hooks/use-inbox.test.tsx`: catalog state, label mutation, stale guards, realtime refresh.
- Create `src/components/inbox/contact-tag-editor.tsx`: accessible multi-label dialog.
- Create `src/components/inbox/contact-tag-editor.test.tsx`: selection, save, error, inactive-label and focus behavior.
- Modify `src/components/inbox/customer-panel.tsx` and its test: applied chips and editor integration.
- Modify `src/components/inbox/conversation-list.tsx` and its test: compact chips and overflow count.
- Create `src/hooks/use-mobile-inbox-history.ts`: same-URL thread/details history layers.
- Create `src/hooks/use-mobile-inbox-history.test.tsx`: push/replace/pop/fallback behavior.
- Modify `src/components/inbox/inbox-shell.tsx` and its test: hook integration, Escape priority and focus restoration.
- Create `.superpowers/sdd/release1-task-6-report.md`: verification and deployment ledger.
- Modify `.superpowers/sdd/progress.md`: durable checkpoint.

---

### Task 1: Active label catalog for attendants

**Files:**
- Modify: `src/modules/contacts/types.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Create: `src/app/api/contact-tags/route.ts`
- Create: `src/app/api/contact-tags/route.test.ts`

**Interfaces:**
- Consumes: `ContactActor`, `DefinitionDto`, `requireUser`, `contactSuccessResponse`, `contactErrorResponse`.
- Produces: `ContactRepository.listActiveContactTags(): Promise<ContactDefinitionRecord[]>` and `listActiveContactTags(actor, repository?): Promise<DefinitionDto[]>`; `GET /api/contact-tags` returns `{ data: { items: DefinitionDto[] }, error: null }`.

- [ ] **Step 1: Write failing service tests**

Add tests proving an active attendant receives only the repository’s active ordered definitions and that a missing/inactive actor is rejected before the definition query:

```ts
it("lists active labels for an active attendant in repository order", async () => {
  const calls: string[] = [];
  const repository = contactRepositoryStub({
    findActiveUser: async () => ({ id: actor.id, active: true, role: actor.role }),
    listActiveContactTags: async () => {
      calls.push("definitions");
      return [definition({ id: tagA, displayName: "Aguardando peça", position: 10 })];
    },
  });

  await expect(listActiveContactTags(actor, repository)).resolves.toEqual([
    { id: tagA, displayName: "Aguardando peça", color: "#176B52", position: 10, active: true },
  ]);
  expect(calls).toEqual(["definitions"]);
});
```

Add the repository method to the shared stub so every existing test remains type-safe.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm test -- src/modules/contacts/service.test.ts`

Expected: FAIL because `listActiveContactTags` and `ContactRepository.listActiveContactTags` do not exist.

- [ ] **Step 3: Implement the minimal domain and Prisma operations**

Extend the repository interface and both repository factories:

```ts
listActiveContactTags: () => Promise<ContactDefinitionRecord[]>;
```

```ts
listActiveContactTags: () => client.contactTagDefinition.findMany({
  where: { active: true },
  orderBy: [{ position: "asc" }, { id: "asc" }],
  select: definitionSelect,
}),
```

Add the service without granting administrative definition access:

```ts
export async function listActiveContactTags(
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
): Promise<DefinitionDto[]> {
  await requireActiveActor(actor, repository);
  return (await repository.listActiveContactTags()).map(toDefinitionDto);
}
```

- [ ] **Step 4: Verify service GREEN**

Run: `npm test -- src/modules/contacts/service.test.ts`

Expected: PASS with the new authorization/order cases and all pre-existing contact service cases.

- [ ] **Step 5: Write failing route tests**

Create route tests for: success as attendant, anonymous/inactive rejection, safe 500 response, exact envelope, and no mutation/realtime publication.

```ts
it("returns the active label catalog to an authenticated attendant", async () => {
  const { GET } = createContactTagCatalogRouteHandlers({
    requireUser: async () => actor,
    listActiveContactTags: async (received) => {
      expect(received).toBe(actor);
      return [tag];
    },
  });

  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ data: { items: [tag] }, error: null });
});
```

- [ ] **Step 6: Run route tests and verify RED**

Run: `npm test -- src/app/api/contact-tags/route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 7: Implement the route**

```ts
export function createContactTagCatalogRouteHandlers(dependencies = defaultDependencies) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const items = await dependencies.listActiveContactTags(actor);
        return contactSuccessResponse({ items });
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const GET = createContactTagCatalogRouteHandlers().GET;
```

- [ ] **Step 8: Verify Task 1 and commit**

Run:

```powershell
npm test -- src/modules/contacts/service.test.ts src/app/api/contact-tags/route.test.ts
npm run typecheck
```

Expected: both focused files pass and TypeScript exits 0.

Commit:

```powershell
git add src/modules/contacts/types.ts src/modules/contacts/service.ts src/modules/contacts/service.test.ts src/app/api/contact-tags
git commit -m "feat: expose active contact labels to attendants"
```

---

### Task 2: Inbox label state, mutation, and realtime reconciliation

**Files:**
- Modify: `src/lib/public-error.ts`
- Modify: `src/lib/public-error.test.ts`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes: Task 1 `GET /api/contact-tags`; existing `PUT /api/contacts/:contactId/tags`; `ContactClassificationRecord`, `ContactDto`, `RealtimeEvent`.
- Produces: hook fields `contactTags`, `contactTagsLoading`, `contactTagsError`, `contactTagSavePendingId`, `contactTagSaveError`; hook methods `loadContactTags()` and `replaceContactTags(contactId, tagIds): Promise<boolean>`.

- [ ] **Step 1: Write failing safe-error tests**

```ts
expect(publicErrorMessage("contact-tags")).toBe("Não foi possível carregar as etiquetas.");
expect(publicErrorMessage("contact-tag-save")).toBe("Não foi possível salvar as etiquetas.");
expect(publicErrorMessage("contact-tag-save", 429)).toBe("Muitas solicitações. Aguarde um momento e tente novamente.");
```

- [ ] **Step 2: Run safe-error tests and verify RED**

Run: `npm test -- src/lib/public-error.test.ts`

Expected: FAIL because both operations are absent from `PublicErrorOperation` and `fallback`.

- [ ] **Step 3: Add the two exact operations and messages**

Extend the union with `"contact-tags" | "contact-tag-save"` and the fallback record with the two Portuguese messages from Step 1.

- [ ] **Step 4: Verify safe-error GREEN**

Run: `npm test -- src/lib/public-error.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing hook catalog tests**

Cover mount loading, ordered catalog success, safe load failure, 401 navigation, cleanup abort, reconnect reload, and `settings.updated` reload. Every fetch mock must explicitly handle `/api/contact-tags` so unrelated hook tests fail loudly if the contract changes.

```ts
expect(fetchMock).toHaveBeenCalledWith("/api/contact-tags", expect.objectContaining({
  headers: { Accept: "application/json" },
}));
expect(hook.result.current.contactTags).toEqual([tag]);
```

- [ ] **Step 6: Run hook catalog tests and verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx -t "contact tag catalog|settings.updated|reconnect"`

Expected: FAIL because the hook does not load or expose the catalog.

- [ ] **Step 7: Implement catalog state with abort and request sequence guards**

Add state and a guarded loader:

```ts
const [contactTags, setContactTags] = useState<ContactClassificationRecord[]>([]);
const [contactTagsLoading, setContactTagsLoading] = useState(true);
const [contactTagsError, setContactTagsError] = useState<string | null>(null);
const contactTagsRequest = useRef<{ sequence: number; controller: AbortController } | null>(null);

const loadContactTags = useCallback(async () => {
  contactTagsRequest.current?.controller.abort();
  const sequence = (contactTagsRequest.current?.sequence ?? 0) + 1;
  const controller = new AbortController();
  contactTagsRequest.current = { sequence, controller };
  setContactTagsLoading(true);
  setContactTagsError(null);
  try {
    const response = await fetch("/api/contact-tags", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const result = await readEnvelope<{ items: ContactClassificationRecord[] }>(response);
    if (contactTagsRequest.current?.sequence === sequence) setContactTags(result.items);
  } catch (error) {
    if (!controller.signal.aborted && contactTagsRequest.current?.sequence === sequence) {
      setContactTagsError(publicErrorMessage("contact-tags", errorStatus(error)));
    }
  } finally {
    if (contactTagsRequest.current?.sequence === sequence) setContactTagsLoading(false);
  }
}, []);
```

Call it at mount, abort it on cleanup, include it in reconnect sync, and reload it only for `settings.updated` with scope `contact-tags`.

- [ ] **Step 8: Verify catalog GREEN**

Run: `npm test -- src/hooks/use-inbox.test.tsx -t "contact tag catalog|settings.updated|reconnect"`

Expected: PASS.

- [ ] **Step 9: Write failing label mutation tests**

Cover exact `PUT` body, empty array, duplicate-click suppression, authoritative update of selected detail and every matching list row, 400/404/429/500 failure, 401 navigation, refetch after uncertain failure, contact A response while B is selected, and `contact.updated` realtime behavior.

```ts
await act(() => hook.result.current.replaceContactTags(contactA, [tagA.id, tagB.id]));
expect(fetchMock).toHaveBeenCalledWith(`/api/contacts/${contactA}/tags`, expect.objectContaining({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify([tagA.id, tagB.id]),
}));
expect(hook.result.current.conversations.find((item) => item.contact.id === contactA)?.contact.tags)
  .toEqual([assignedA, assignedB]);
```

- [ ] **Step 10: Run mutation tests and verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx -t "replace contact tags|contact.updated"`

Expected: FAIL because the mutation and contact realtime branch do not exist.

- [ ] **Step 11: Implement authoritative mutation and stale guards**

Use one pending contact ID and errors keyed by contact ID. The minimal update helper is:

```ts
function replaceContactInRows(items: ConversationListItem[], contact: ContactDto) {
  return items.map((item) => item.contact.id === contact.id ? { ...item, contact } : item);
}
```

The action captures `contactId`, sends the complete array, updates cached rows matching the returned contact, updates selected detail only when `current.contact.id === contact.id`, returns `true` on authoritative success, and returns `false` after setting a safe error on failure. A `finally` block clears pending state only for the same contact. Handle `contact.updated` by refreshing the list and refreshing detail only when `selectedContactIdRef.current === event.contactId`.

- [ ] **Step 12: Verify Task 2 and commit**

Run:

```powershell
npm test -- src/lib/public-error.test.ts src/hooks/use-inbox.test.tsx
npm run typecheck
```

Expected: focused tests and TypeScript pass.

Commit:

```powershell
git add src/lib/public-error.ts src/lib/public-error.test.ts src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: synchronize contact labels in inbox"
```

---

### Task 3: Label editor and visible chips

**Files:**
- Create: `src/components/inbox/contact-tag-editor.tsx`
- Create: `src/components/inbox/contact-tag-editor.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: Task 2 hook fields/actions and `ContactClassificationDto`/`ContactClassificationRecord`.
- Produces: `ContactTagEditor` with props `{ contactId, assignedTags, availableTags, loading, pending, error, onRetryLoad, onSave }`; list and panel chips with textual labels.

- [ ] **Step 1: Write failing editor tests**

Test accessible trigger/dialog, initial checked state, selecting multiple labels, clearing all, cancel without save, explicit save, duplicate suppression, save failure remaining open, catalog retry, assigned inactive warning, Escape focus restoration, and contact change resetting the draft.

```tsx
await user.click(screen.getByRole("button", { name: "Gerenciar etiquetas" }));
await user.click(screen.getByRole("checkbox", { name: "Aguardando produto" }));
await user.click(screen.getByRole("button", { name: "Salvar etiquetas" }));
expect(onSave).toHaveBeenCalledWith(contactId, [waitingTag.id]);
```

- [ ] **Step 2: Run editor tests and verify RED**

Run: `npm test -- src/components/inbox/contact-tag-editor.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the accessible editor**

Use the existing Radix `Dialog`, native checkbox inputs, validated swatches, a `Set<string>` draft, and explicit actions. The save branch closes only when `await onSave(contactId, [...draft])` returns `true`:

```tsx
const saved = await onSave(contactId, availableTags.filter((tag) => draft.has(tag.id)).map((tag) => tag.id));
if (saved) setOpen(false);
```

Render assigned inactive labels above the checklist with text explaining that saving a new complete set removes unavailable labels. Disable save while pending or loading; show catalog and save errors with `role="alert"`; use `onCloseAutoFocus` to restore the trigger.

- [ ] **Step 4: Verify editor GREEN**

Run: `npm test -- src/components/inbox/contact-tag-editor.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing panel and list tests**

Panel tests assert textual current chips, empty state, editor prop wiring, pending/error propagation and safe color fallback. List tests assert the first two tags, `+N` accessible name, no empty-label row, and no profile image regression.

```tsx
expect(within(row).getByText("VIP")).toBeVisible();
expect(within(row).getByText("Aguardando produto")).toBeVisible();
expect(within(row).getByLabelText("Mais 2 etiquetas")).toHaveTextContent("+2");
```

- [ ] **Step 6: Run panel/list tests and verify RED**

Run: `npm test -- src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.test.tsx`

Expected: FAIL because chips/editor wiring are absent.

- [ ] **Step 7: Implement reusable textual chips and editor integration**

Keep chips small and text-first. Validate colors with `^#[0-9A-F]{6}$`; invalid values use the neutral border/text style and never reach inline style. Render at most two list chips and the overflow count. Add the Task 2 props to both desktop and mobile `CustomerPanel` instances in `InboxShell`, keying the editor by `conversation.contact.id`.

- [ ] **Step 8: Verify Task 3 and commit**

Run:

```powershell
npm test -- src/components/inbox/contact-tag-editor.test.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.test.tsx
npx eslint src/components/inbox/contact-tag-editor.tsx src/components/inbox/contact-tag-editor.test.tsx src/components/inbox/customer-panel.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
npm run typecheck
```

Expected: all focused tests, lint and TypeScript pass.

Commit:

```powershell
git add src/components/inbox
git commit -m "feat: apply labels from conversations"
```

---

### Task 4: Escape and mobile history navigation

**Files:**
- Create: `src/hooks/use-mobile-inbox-history.ts`
- Create: `src/hooks/use-mobile-inbox-history.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: existing `backToList`, `inbox.closeConversation`, `detailsOpen`, mobile viewport detection, conversation button registry.
- Produces: `useMobileInboxHistory({ isMobile, threadOpen, detailsOpen, closeThread, closeDetails })` where `isMobile: () => boolean`, returning `enterThread`, `switchThread`, `enterDetails`, `leaveThread`, and `leaveDetails`.

- [ ] **Step 1: Write failing history-hook tests**

Test one push from list to thread, replace/no push when switching, a second push for details, first pop closing details, second pop closing thread, visible-close calls consuming the correct layer, fallback without a current marker, no history mutations on desktop, opaque marker state, and cleanup of a stale marker when the selected conversation disappears.

```ts
act(() => hook.result.current.enterThread());
expect(pushState).toHaveBeenCalledWith(expect.objectContaining({ __xpInboxLayer: "thread" }), "", window.location.href);
act(() => hook.result.current.switchThread());
expect(pushState).toHaveBeenCalledTimes(1);
expect(replaceState).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run history tests and verify RED**

Run: `npm test -- src/hooks/use-mobile-inbox-history.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement opaque same-URL history layers**

Use the single key `__xpInboxLayer` with values `"thread" | "details"`. Never place an ID in state. Query `isMobile()` at each user action so a resize does not leave stale mode state. Keep current UI booleans and callbacks in refs so one `popstate` listener remains stable. `leaveDetails`/`leaveThread` call `history.back()` only when their layer is current; otherwise they execute the local callback. `switchThread` preserves/replaces the thread marker without adding a history entry. When `threadOpen` becomes false outside the history flow, strip the marker with `replaceState` rather than navigating.

- [ ] **Step 4: Verify history-hook GREEN**

Run: `npm test -- src/hooks/use-mobile-inbox-history.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing InboxShell keyboard/navigation tests**

Add tests for desktop Escape closing the selected conversation and restoring its button; no selection doing nothing; repeated/composing/default-prevented events ignored; an open customer dialog consuming first Escape; mobile select/arrow/back flows; details-before-thread back order; switching without stacking; and list-level browser back not intercepted.

```tsx
await user.keyboard("{Escape}");
expect(defaultInbox.closeConversation).toHaveBeenCalledOnce();
await waitFor(() => expect(screen.getByRole("button", { name: /Carlos/i })).toHaveFocus());
```

- [ ] **Step 6: Run shell navigation tests and verify RED**

Run: `npm test -- src/components/inbox/inbox-shell.test.tsx -t "Escape|browser back|mobile history"`

Expected: FAIL because Escape and history integration are absent.

- [ ] **Step 7: Integrate history and keyboard priority**

Use the history hook for mobile selection, details, arrow and dialog-close actions. Parameterize the local close helper so mobile back and desktop Escape both schedule focus restoration to the exact originating conversation button; ordinary desktop selection keeps its current focus behavior. Register one window `keydown` listener:

```ts
if (
  event.key !== "Escape" || event.repeat || event.isComposing || event.defaultPrevented ||
  !inbox.selectedId || detailsOpenRef.current || hasOpenDismissibleOverlay()
) return;
event.preventDefault();
backToList();
```

`hasOpenDismissibleOverlay()` checks visible open Radix dialog/listbox content, not arbitrary hidden DOM. Reuse the existing scheduled focus restoration and cancel it on unmount.

- [ ] **Step 8: Verify Task 4 and commit**

Run:

```powershell
npm test -- src/hooks/use-mobile-inbox-history.test.tsx src/components/inbox/inbox-shell.test.tsx
npx eslint src/hooks/use-mobile-inbox-history.ts src/hooks/use-mobile-inbox-history.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
npm run typecheck
```

Expected: focused tests, lint and TypeScript pass.

Commit:

```powershell
git add src/hooks/use-mobile-inbox-history.ts src/hooks/use-mobile-inbox-history.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: close conversations with keyboard and mobile back"
```

---

### Task 5: Full verification, browser acceptance, and app-only deployment

**Files:**
- Create: `.superpowers/sdd/release1-task-6-report.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: exact commits from Tasks 1–4 and current production release `060462d9841c57914afa6f8c4b7ccd3a980f4fe0`.
- Produces: immutable verified production release and durable evidence; only `xp-whatsapp-app` may change.

- [ ] **Step 1: Run the complete local release gate**

Point both `DATABASE_URL` and `TEST_DATABASE_URL` at the same dedicated PostgreSQL 18 database whose name ends in `_test`, then run:

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm audit --omit=dev --audit-level=high
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-kvm-deployment.ps1
```

Expected: all tracked tests pass except explicitly opt-in environment tests; lint, typecheck, Prisma validation, build, audit and KVM verifier exit 0. Run the real FFmpeg integration in Linux if Windows lacks the executable.

- [ ] **Step 2: Perform local browser acceptance**

With an isolated local database and two users, verify:

1. attendant opens a conversation, applies two labels, and both panel and list show them;
2. second session receives the change without reload;
3. clearing all labels removes all chips;
4. a forced save failure keeps the draft and permits retry;
5. desktop Escape closes the thread and restores focus;
6. mobile back closes details first, then thread, without leaving `/conversas`;
7. 390×844 has no horizontal overflow and all actions remain at least 44 px.

Expected: every item passes without console errors or unhandled promise rejections.

- [ ] **Step 3: Build and inspect the immutable Linux image**

Tag the full candidate revision and assert its revision label, Linux/amd64 platform, `nextjs` runtime user, UID/GID `1001:1001`, FFmpeg/FFprobe, migration 006, no application tests and no `.env` files.

- [ ] **Step 4: Run production read-only preflight and backup**

Record active release, app/database IDs, health/restarts, migration aggregate, local/public health, current Meta subscription counts, and a deterministic sorted snapshot of all non-app containers. Run the candidate `scripts/backup.sh` against `/srv/backups/example-app` with the canonical production env file and require all internal validators to pass.

- [ ] **Step 5: Deploy only the app with automatic app-only rollback**

Transfer the exact Git archive and image, resolve candidate Compose, require services `app,database` and the three canonical app networks, stop only `xp-whatsapp-app`, and run:

```sh
XP_WHATSAPP_IMAGE="xp-whatsapp:$REVISION" docker compose \
  --project-directory "$RELEASE" \
  --env-file /opt/apps/example-app/.env.production \
  -f "$RELEASE/deploy/kvm/docker-compose.yml" \
  up -d --no-deps --force-recreate --wait app
```

If health fails, recreate only the prior app image. Do not restart or edit PostgreSQL, Caddy, Meta, networks, volumes, DNS, or unrelated systems.

- [ ] **Step 6: Verify production and record evidence**

Require exact revision/image/UID/networks, restart zero, unchanged database ID, migration `9|0|0`, public and local health 200, protected route behavior, invalid webhook signature 401, zero new app error markers, three soak samples, read-only Meta `1 active object / 11 unique fields / one smb_message_echoes`, and byte-identical non-app snapshots.

Write exact counts, hashes, backup path, rollback revision and manual acceptance result to `.superpowers/sdd/release1-task-6-report.md` and `.superpowers/sdd/progress.md` without PII, credentials or provider identifiers.

- [ ] **Step 7: Commit deployment evidence**

```powershell
git add -f .superpowers/sdd/release1-task-6-report.md .superpowers/sdd/progress.md
git commit -m "docs: record conversation labels deployment"
```

Expected: clean worktree and production healthy on the exact documented revision.
