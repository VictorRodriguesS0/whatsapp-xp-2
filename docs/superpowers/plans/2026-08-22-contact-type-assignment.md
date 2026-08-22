# Contact Type Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every active attendant set or clear one contact type from the inbox and see the authoritative type in the customer panel and conversation list.

**Architecture:** Add an active-only attendant catalog beside the existing administrator definition routes, then extend `useInbox` with an authoritative contact-type PATCH action and realtime catalog reconciliation. Render the current type through focused selector/chip components, reuse the existing `contact.updated` event, and deploy the verified immutable image by recreating only `xp-whatsapp-app`.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 7, Prisma 7/PostgreSQL 18, Radix UI, Tailwind CSS 4, Vitest, Testing Library, Docker Compose.

## Global Constraints

- A contact has zero or one type; `Sem tipo` sends `contactTypeId: null`.
- Every active attendant may read active type definitions and change a contact type; only administrators may manage definitions.
- An inactive assigned type stays visible but cannot be newly selected.
- Server responses remain authoritative; failures preserve the last confirmed type.
- Type changes must not alter tags, responsibility, unread/response state, reminders, messages, WhatsApp provider state, or Meta subscriptions.
- Realtime events remain PII-free and reuse `contact.updated` plus `settings.updated/contact-types`.
- No schema change or Prisma migration is allowed for this slice.
- Execute this plan in an isolated branch based on `28c36c2`; cherry-pick only this plan commit onto that branch. Do not include the independent rich-inbound implementation commit `aaa24dc` in the contact-type image or deployment.
- The 390×844 layout must have no horizontal overflow and interactive controls must remain at least 44 px high.
- Production deployment may recreate only `xp-whatsapp-app`; PostgreSQL, Caddy, Meta, DNS, networks, volumes, and unrelated containers remain unchanged.
- Preserve unrelated commits and working-tree files, including the independently planned rich inbound message work.

## File Structure

- Modify `src/modules/contacts/types.ts`: add the active-type repository query.
- Modify `src/modules/contacts/service.ts`: implement ordered active-type access for active attendants.
- Modify `src/modules/contacts/service.test.ts`: cover authorization and active-only ordering.
- Create `src/app/api/contact-types/route.ts`: expose the attendant catalog.
- Create `src/app/api/contact-types/route.test.ts`: verify envelopes, authorization, and safe failures.
- Modify `src/lib/public-error.ts` and `src/lib/public-error.test.ts`: add safe type load/save copy.
- Modify `src/hooks/use-inbox.ts` and `src/hooks/use-inbox.test.tsx`: catalog state, PATCH mutation, stale guards, reconnect, and realtime reconciliation.
- Create `src/components/inbox/contact-type-chip.tsx`: visually distinct, color-safe type marker.
- Create `src/components/inbox/contact-type-chip.test.tsx`: valid/invalid color and compact presentation.
- Create `src/components/inbox/contact-type-selector.tsx`: controlled direct selector with inactive history and safe states.
- Create `src/components/inbox/contact-type-selector.test.tsx`: selection, clearing, pending, error, retry, and inactive behavior.
- Modify `src/components/inbox/customer-panel.tsx` and its test: render the selector above labels.
- Modify `src/components/inbox/conversation-list.tsx` and its test: show one type marker without disturbing queue indicators.
- Modify `src/components/inbox/inbox-shell.tsx` and its test: wire desktop and mobile panels to the hook.
- Create `.superpowers/sdd/release1-task-7-report.md`: sanitized verification and deployment ledger.
- Modify `.superpowers/sdd/progress.md`: durable release checkpoint.

---

### Task 1: Active contact-type catalog for attendants

**Files:**
- Modify: `src/modules/contacts/types.ts`
- Modify: `src/modules/contacts/service.ts`
- Modify: `src/modules/contacts/service.test.ts`
- Create: `src/app/api/contact-types/route.ts`
- Create: `src/app/api/contact-types/route.test.ts`

**Interfaces:**
- Consumes: `ContactActor`, `DefinitionRecord`, `DefinitionDto`, `requireUser`, `contactSuccessResponse`, `contactErrorResponse`.
- Produces: `ContactRepository.listActiveContactTypes(): Promise<DefinitionRecord[]>`; `listActiveContactTypes(actor, repository?): Promise<DefinitionDto[]>`; `GET /api/contact-types` returning `{ data: { items: DefinitionDto[] }, error: null }`.

- [ ] **Step 1: Write failing service tests for active-only attendant access**

Add `listActiveContactTypes` to the service imports and add these cases inside `describe("contact classification service")`:

```ts
it("lists active contact types for an active attendant in repository order", async () => {
  const repository = createRepository({
    types: [
      definition(typeId, "Cliente", { position: 10, active: true }),
      definition("10000000-0000-4000-8000-000000000002", "Inativo", {
        position: 20,
        active: false,
      }),
    ],
  });

  await expect(listActiveContactTypes(attendant, repository)).resolves.toEqual([
    {
      id: typeId,
      displayName: "Cliente",
      color: "#176B52",
      position: 10,
      active: true,
    },
  ]);
});

it("rejects an inactive attendant before reading active contact types", async () => {
  let queried = false;
  const repository = createRepository();
  Object.assign(repository, {
    isActorActive: async () => false,
    listActiveContactTypes: async () => {
      queried = true;
      return [];
    },
  });

  await expect(listActiveContactTypes(attendant, repository)).rejects.toMatchObject({
    status: 403,
  });
  expect(queried).toBe(false);
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```powershell
npx vitest run src/modules/contacts/service.test.ts
```

Expected: FAIL because `listActiveContactTypes` and `ContactRepository.listActiveContactTypes` do not exist.

- [ ] **Step 3: Add the repository contract and test repository operation**

In `ContactRepository`, add:

```ts
listActiveContactTypes(): Promise<DefinitionRecord[]>;
```

In the real Prisma repository, place this beside `listContactTypes`:

```ts
listActiveContactTypes: () =>
  client.contactType.findMany({
    where: { active: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: definitionSelect,
  }),
```

In the `createRepository` test helper, implement the same contract over `typeRecords`:

```ts
listActiveContactTypes: async () =>
  typeRecords.filter(({ active }) => active),
```

Update the helper's explicit intersection type so `listActiveContactTypes()` and `listActiveContactTags()` are both declared.

- [ ] **Step 4: Implement the minimal service**

Add beside `listActiveContactTags`:

```ts
export async function listActiveContactTypes(
  actor: ContactActor,
  repository: ContactRepository = contactRepository,
): Promise<DefinitionDto[]> {
  await requireActiveActor(actor, repository);
  return (await repository.listActiveContactTypes()).map(toDefinitionDto);
}
```

- [ ] **Step 5: Run the service test and verify GREEN**

Run:

```powershell
npx vitest run src/modules/contacts/service.test.ts
```

Expected: all contact service tests pass.

- [ ] **Step 6: Write failing route tests**

Create `src/app/api/contact-types/route.test.ts` with the same strict route boundary used by the tag catalog:

```ts
// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactTypeCatalogRouteHandlers } from "./route";

const actor = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};
const type = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};

describe("active contact type catalog route", () => {
  it("returns the active catalog to an authenticated attendant", async () => {
    const calls: string[] = [];
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      listActiveContactTypes: async (receivedActor) => {
        calls.push("catalog");
        expect(receivedActor).toBe(actor);
        return [type];
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(calls).toEqual(["auth", "catalog"]);
    await expect(response.json()).resolves.toEqual({
      data: { items: [type] },
      error: null,
    });
  });

  it.each([
    [new HttpError(401, "Não autenticado"), 401, "UNAUTHORIZED"],
    [new HttpError(403, "Acesso negado"), 403, "FORBIDDEN"],
  ])("preserves safe authorization failures", async (failure, status, code) => {
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => {
        throw failure;
      },
      listActiveContactTypes: async () => [type],
    });

    const response = await GET();
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      error: { code },
    });
  });

  it("maps unexpected failures without leaking internals", async () => {
    const { GET } = createContactTypeCatalogRouteHandlers({
      requireUser: async () => actor,
      listActiveContactTypes: async () => {
        throw new Error("postgresql://secret@internal");
      },
    });

    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
  });
});
```

- [ ] **Step 7: Run the route test and verify RED**

Run:

```powershell
npx vitest run src/app/api/contact-types/route.test.ts
```

Expected: FAIL because `src/app/api/contact-types/route.ts` does not exist.

- [ ] **Step 8: Implement the attendant catalog route**

Create `src/app/api/contact-types/route.ts`:

```ts
import { requireUser } from "@/modules/auth/guards";
import { listActiveContactTypes } from "@/modules/contacts/service";

import {
  contactErrorResponse,
  contactSuccessResponse,
} from "../contacts/[id]/route";

export const runtime = "nodejs";

type ContactTypeCatalogRouteDependencies = {
  requireUser: typeof requireUser;
  listActiveContactTypes: typeof listActiveContactTypes;
};

const defaultDependencies: ContactTypeCatalogRouteDependencies = {
  requireUser,
  listActiveContactTypes,
};

export function createContactTypeCatalogRouteHandlers(
  dependencies: ContactTypeCatalogRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const items = await dependencies.listActiveContactTypes(actor);
        return contactSuccessResponse({ items });
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const GET = createContactTypeCatalogRouteHandlers().GET;
```

- [ ] **Step 9: Verify Task 1 and commit**

Run:

```powershell
npx vitest run src/modules/contacts/service.test.ts src/app/api/contact-types/route.test.ts
npm run typecheck
```

Expected: both focused files and TypeScript pass.

Commit:

```powershell
git add src/modules/contacts/types.ts src/modules/contacts/service.ts src/modules/contacts/service.test.ts src/app/api/contact-types
git commit -m "feat: expose active contact types to attendants"
```

---

### Task 2: Inbox contact-type state and authoritative mutation

**Files:**
- Modify: `src/lib/public-error.ts`
- Modify: `src/lib/public-error.test.ts`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes: Task 1 `GET /api/contact-types`; existing `PATCH /api/contacts/:contactId`; `UpdatedContactDto`; `ContactClassificationRecord`; `contact.updated`; `settings.updated/contact-types`.
- Produces: hook fields `contactTypes`, `contactTypesLoading`, `contactTypesError`, `contactTypeSavePendingId`, `contactTypeSaveError`; methods `loadContactTypes(): Promise<void>` and `setContactType(contactId: string, contactTypeId: string | null): Promise<boolean>`.

- [ ] **Step 1: Write failing safe-error tests**

Extend `src/lib/public-error.test.ts`:

```ts
it("provides safe contact type load and save messages", () => {
  expect(publicErrorMessage("contact-types")).toBe(
    "Não foi possível carregar os tipos de contato.",
  );
  expect(publicErrorMessage("contact-type-save")).toBe(
    "Não foi possível atualizar o tipo de contato.",
  );
  expect(publicErrorMessage("contact-type-save", 429)).toBe(
    "Muitas solicitações. Aguarde um momento e tente novamente.",
  );
});
```

- [ ] **Step 2: Run the error test and verify RED**

Run:

```powershell
npx vitest run src/lib/public-error.test.ts
```

Expected: FAIL because both operation names are absent from `PublicErrorOperation` and `fallback`.

- [ ] **Step 3: Add the exact safe error operations**

Extend the union with:

```ts
| "contact-types"
| "contact-type-save"
```

Extend `fallback` with:

```ts
"contact-types": "Não foi possível carregar os tipos de contato.",
"contact-type-save": "Não foi possível atualizar o tipo de contato.",
```

- [ ] **Step 4: Run the error test and verify GREEN**

Run:

```powershell
npx vitest run src/lib/public-error.test.ts
```

Expected: all public-error tests pass.

- [ ] **Step 5: Write failing catalog/realtime hook tests**

Add a catalog fixture:

```ts
const contactType = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};
```

Add tests proving mount load, safe failure/retry, `settings.updated/contact-types`, and realtime sync. Every new fetch harness explicitly handles both classification catalogs:

```ts
if (url === "/api/contact-types") {
  typeFetches += 1;
  return response({ data: { items: [contactType] }, error: null });
}
if (url === "/api/contact-tags") {
  return response({ data: { items: [contactTag] }, error: null });
}
```

The catalog assertion is:

```ts
await waitFor(() => expect(hook.result.current.contactTypesLoading).toBe(false));
expect(hook.result.current.contactTypes).toEqual([contactType]);
expect(hook.result.current.contactTypesError).toBeNull();
```

For invalidation, emit `settings.updated/contact-tags` first and prove it does not increment `typeFetches`, then emit `settings.updated/contact-types` and prove it does. Call the fake EventSource `onopen` and prove a third type-catalog request occurs.

- [ ] **Step 6: Run the catalog hook tests and verify RED**

Run:

```powershell
npx vitest run src/hooks/use-inbox.test.tsx -t "contact type catalog|contact types"
```

Expected: FAIL because the hook exposes no type catalog state or loader.

- [ ] **Step 7: Implement guarded active-type catalog state**

Add state and refs beside the tag equivalents:

```ts
const [contactTypes, setContactTypes] = useState<ContactClassificationRecord[]>([]);
const [contactTypesLoading, setContactTypesLoading] = useState(true);
const [contactTypesError, setContactTypesError] = useState<string | null>(null);
const contactTypesRequest = useRef<{
  sequence: number;
  controller: AbortController;
} | null>(null);
```

Add the guarded loader:

```ts
const loadContactTypes = useCallback(async () => {
  contactTypesRequest.current?.controller.abort();
  const sequence = (contactTypesRequest.current?.sequence ?? 0) + 1;
  const controller = new AbortController();
  contactTypesRequest.current = { sequence, controller };
  setContactTypesLoading(true);
  setContactTypesError(null);
  try {
    const response = await fetch("/api/contact-types", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const result = await readEnvelope<{
      items: ContactClassificationRecord[];
    }>(response);
    if (contactTypesRequest.current?.sequence === sequence) {
      setContactTypes(result.items);
    }
  } catch (error) {
    if (!controller.signal.aborted && contactTypesRequest.current?.sequence === sequence) {
      setContactTypesError(publicErrorMessage("contact-types", errorStatus(error)));
    }
  } finally {
    if (contactTypesRequest.current?.sequence === sequence) {
      setContactTypesLoading(false);
    }
  }
}, []);
```

Call it on mount and realtime sync, abort it on unmount, and handle `settings.updated` by exact scope:

```ts
if (event.type === "settings.updated" && event.scope === "contact-types") {
  void Promise.all([loadContactTypes(), refreshList(), refreshConversation()]);
  return;
}
```

Do not make `contact-tags` reload the type catalog or vice versa.

- [ ] **Step 8: Run the catalog hook tests and verify GREEN**

Run:

```powershell
npx vitest run src/hooks/use-inbox.test.tsx -t "contact type catalog|contact types"
```

Expected: the new catalog and realtime cases pass.

- [ ] **Step 9: Write failing authoritative mutation tests**

Add tests for UUID assignment, clearing with `null`, duplicate suppression, server-truth reconciliation, safe retry, 401 navigation, and stale A/B isolation. The central success case uses an authoritative DTO:

```ts
const authoritativeType = {
  id: contactType.id,
  name: contactType.displayName,
  color: contactType.color,
  active: true,
};
const authoritativeContact = {
  ...updatedContact(item.contact.id, []),
  type: authoritativeType,
};
```

The fetch assertion must be exact:

```ts
expect(saveCall?.[1]).toMatchObject({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ contactTypeId: contactType.id }),
});
```

Call `setContactType(contactId, null)` in a separate test and assert:

```ts
expect(JSON.parse(String(clearCall?.[1]?.body))).toEqual({ contactTypeId: null });
```

For duplicate suppression, keep the PATCH unresolved, call the method twice for the same contact, assert the returned promises are identical and only one PATCH occurred. For stale isolation, start A, switch to B, complete B first, then fail A; B's type and visible error state must remain authoritative.

- [ ] **Step 10: Run the mutation tests and verify RED**

Run:

```powershell
npx vitest run src/hooks/use-inbox.test.tsx -t "set contact type|clear contact type|contact type save"
```

Expected: FAIL because `setContactType` and its state do not exist.

- [ ] **Step 11: Implement the authoritative mutation with per-contact stale guards**

Add state and in-flight ownership:

```ts
const [contactTypeSavePendingId, setContactTypeSavePendingId] = useState<string | null>(null);
const [contactTypeSaveErrors, setContactTypeSaveErrors] = useState<Map<string, string>>(
  () => new Map(),
);
const contactTypeSaveRequests = useRef(new Map<string, Promise<boolean>>());
```

Implement:

```ts
const setContactType = useCallback((
  contactId: string,
  contactTypeId: string | null,
): Promise<boolean> => {
  const inFlight = contactTypeSaveRequests.current.get(contactId);
  if (inFlight) return inFlight;

  const operation = (async () => {
    setContactTypeSavePendingId(contactId);
    setContactTypeSaveErrors((current) => {
      const next = new Map(current);
      next.delete(contactId);
      return next;
    });
    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactTypeId }),
      });
      const updated = await readEnvelope<UpdatedContactDto>(response);
      if (!mounted.current) return false;
      setConversations((current) => current.map((item) =>
        item.contact.id === contactId
          ? { ...item, contact: mergeUpdatedContact(item.contact, updated) }
          : item,
      ));
      setConversation((current) => current?.contact.id === contactId
        ? { ...current, contact: mergeUpdatedContact(current.contact, updated) }
        : current);
      void refreshList();
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      const selectedConversationId = selectedContactIdRef.current === contactId
        ? selectedIdRef.current
        : null;
      if (selectedConversationId) {
        await fetchConversation(selectedConversationId, false);
      }
      void refreshList();
      setContactTypeSaveErrors((current) => {
        const next = new Map(current);
        next.set(
          contactId,
          publicErrorMessage("contact-type-save", errorStatus(error)),
        );
        return next;
      });
      return false;
    } finally {
      contactTypeSaveRequests.current.delete(contactId);
      setContactTypeSavePendingId((current) => current === contactId ? null : current);
    }
  })();

  contactTypeSaveRequests.current.set(contactId, operation);
  return operation;
}, [fetchConversation, refreshList]);
```

Clear `contactTypeSaveRequests` on unmount. Return all catalog/save fields and actions, computing `contactTypeSaveError` from `selectedContactIdRef.current` exactly as tag errors are scoped.

- [ ] **Step 12: Run focused hook tests and verify GREEN**

Run:

```powershell
npx vitest run src/lib/public-error.test.ts src/hooks/use-inbox.test.tsx
```

Expected: all public-error and inbox-hook tests pass, including existing tag and realtime behavior.

- [ ] **Step 13: Verify Task 2 and commit**

Run:

```powershell
npx eslint src/lib/public-error.ts src/lib/public-error.test.ts src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
npm run typecheck
git diff --check
```

Expected: lint, TypeScript, and whitespace checks exit zero.

Commit:

```powershell
git add src/lib/public-error.ts src/lib/public-error.test.ts src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: synchronize contact types in inbox"
```

---

### Task 3: Direct selector and visible type markers

**Files:**
- Create: `src/components/inbox/contact-type-chip.tsx`
- Create: `src/components/inbox/contact-type-chip.test.tsx`
- Create: `src/components/inbox/contact-type-selector.tsx`
- Create: `src/components/inbox/contact-type-selector.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: Task 2 hook fields/actions; current `ContactClassificationDto | null`; active `ContactClassificationRecord[]`; existing Radix `Select` and `Button`.
- Produces: `ContactTypeChip({ color, name, compact? })`; `ContactTypeSelector({ contactId, currentType, availableTypes, loading, loadError, pending, saveError, onRetryLoad, onChange })`.

- [ ] **Step 1: Write failing chip tests**

Create `src/components/inbox/contact-type-chip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContactTypeChip } from "./contact-type-chip";

describe("ContactTypeChip", () => {
  it("renders a distinct textual type marker with a validated color", () => {
    render(<ContactTypeChip color="#176B52" name="Cliente" />);
    const marker = screen.getByText("Cliente");
    expect(marker).toHaveClass("rounded-md");
    expect(marker).toHaveStyle({ borderColor: "#176B52" });
  });

  it("uses a neutral fallback for an unsafe color and supports compact rows", () => {
    render(<ContactTypeChip color="url(javascript:bad)" compact name="Prospecto" />);
    const marker = screen.getByText("Prospecto");
    expect(marker).not.toHaveAttribute("style");
    expect(marker).toHaveClass("text-[10px]");
  });
});
```

- [ ] **Step 2: Run chip tests and verify RED**

Run:

```powershell
npx vitest run src/components/inbox/contact-type-chip.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the color-safe distinct type chip**

Create `src/components/inbox/contact-type-chip.tsx`:

```tsx
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function ContactTypeChip({
  color,
  name,
  compact = false,
}: {
  color: string;
  name: string;
  compact?: boolean;
}) {
  const style: CSSProperties | undefined = HEX_COLOR.test(color)
    ? { borderColor: color }
    : undefined;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border bg-[var(--canvas)] font-semibold text-[var(--text)]",
        compact ? "px-1.5 py-0.5 text-[10px] leading-none" : "px-2 py-1 text-xs",
      )}
      style={style}
      title={name}
    >
      {name}
    </span>
  );
}
```

- [ ] **Step 4: Run chip tests and verify GREEN**

Run:

```powershell
npx vitest run src/components/inbox/contact-type-chip.test.tsx
```

Expected: both chip tests pass.

- [ ] **Step 5: Write failing direct-selector tests**

Create `src/components/inbox/contact-type-selector.test.tsx`. Cover current and empty state, choosing one active type, clearing to `null`, pending/loading disabled state, safe save failure, catalog retry, and an inactive assigned type displayed but disabled.

The core interaction is:

```tsx
const onChange = vi.fn().mockResolvedValue(true);
render(
  <ContactTypeSelector
    availableTypes={[availableType]}
    contactId="20000000-0000-4000-8000-000000000001"
    currentType={null}
    loadError={null}
    loading={false}
    onChange={onChange}
    onRetryLoad={vi.fn()}
    pending={false}
    saveError={null}
  />,
);

await user.click(screen.getByRole("combobox", { name: "Tipo de contato" }));
await user.click(screen.getByRole("option", { name: "Cliente" }));
expect(onChange).toHaveBeenCalledWith(
  "20000000-0000-4000-8000-000000000001",
  availableType.id,
);
```

For clearing, start with `currentType`, choose `Sem tipo`, and assert `onChange(contactId, null)`. For inactive history, pass an inactive `currentType` absent from `availableTypes`, assert its text remains visible and its option is disabled. For catalog failure, assert the combobox is disabled and `Tentar novamente` invokes `onRetryLoad`.

- [ ] **Step 6: Run selector tests and verify RED**

Run:

```powershell
npx vitest run src/components/inbox/contact-type-selector.test.tsx
```

Expected: FAIL because `ContactTypeSelector` does not exist.

- [ ] **Step 7: Implement the controlled direct selector**

Create `src/components/inbox/contact-type-selector.tsx` with this public contract and controlled data flow:

```tsx
"use client";

import { ContactRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ContactClassificationDto,
  ContactClassificationRecord,
} from "@/modules/conversations/types";

import { ContactTypeChip } from "./contact-type-chip";

export function ContactTypeSelector({
  contactId,
  currentType,
  availableTypes,
  loading,
  loadError,
  pending,
  saveError,
  onRetryLoad,
  onChange,
}: {
  contactId: string;
  currentType: ContactClassificationDto | null;
  availableTypes: ContactClassificationRecord[];
  loading: boolean;
  loadError: string | null;
  pending: boolean;
  saveError: string | null;
  onRetryLoad: () => void;
  onChange: (contactId: string, contactTypeId: string | null) => Promise<boolean>;
}) {
  const inactiveCurrent = currentType && !availableTypes.some(({ id }) => id === currentType.id)
    ? currentType
    : null;
  return (
    <section aria-labelledby="contact-type-heading" className="border-b border-[var(--border)] py-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]" id="contact-type-heading">
        <ContactRound aria-hidden="true" className="size-4" />
        Tipo de contato
      </h3>
      <div className="mt-3">
        {currentType
          ? <ContactTypeChip color={currentType.color} name={currentType.name} />
          : <span className="text-sm text-[var(--muted)]">Sem tipo</span>}
      </div>
      <label className="mt-4 block text-xs font-semibold text-[var(--muted)]" id="contact-type-select-label">
        Tipo de contato
      </label>
      <Select
        disabled={loading || pending || Boolean(loadError)}
        onValueChange={(value) => void onChange(contactId, value === "none" ? null : value)}
        value={currentType?.id ?? "none"}
      >
        <SelectTrigger aria-labelledby="contact-type-select-label" className="mt-1 min-h-11">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem tipo</SelectItem>
          {availableTypes.map((type) => (
            <SelectItem key={type.id} value={type.id}>{type.displayName}</SelectItem>
          ))}
          {inactiveCurrent ? (
            <SelectItem disabled value={inactiveCurrent.id}>
              {inactiveCurrent.name} (inativo)
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {pending ? <p className="mt-2 text-xs text-[var(--muted)]" role="status">Atualizando tipo de contato</p> : null}
      {loadError ? (
        <div className="mt-2" role="alert">
          <p className="text-sm text-[var(--danger)]">{loadError}</p>
          <Button className="mt-2" onClick={onRetryLoad} size="small" variant="secondary">Tentar novamente</Button>
        </div>
      ) : null}
      {saveError ? <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{saveError}</p> : null}
    </section>
  );
}
```

Keep the server-confirmed `currentType` as the `Select` value; do not add optimistic local selection state.

- [ ] **Step 8: Run selector tests and verify GREEN**

Run:

```powershell
npx vitest run src/components/inbox/contact-type-selector.test.tsx
```

Expected: all selector state and accessibility tests pass.

- [ ] **Step 9: Write failing panel, list, and shell wiring tests**

Extend `CustomerPanel` tests to assert:

```tsx
expect(screen.getByText("Tipo de contato")).toBeVisible();
expect(screen.getByText("Sem tipo")).toBeVisible();
```

Then render a current type, choose a different active option, and expect the callback to receive the contact ID and new type ID. Add the new props to the shared test fixture:

```ts
availableTypes: [availableType],
typesLoading: false,
typesError: null,
typeSavePending: false,
typeSaveError: null,
onRetryTypes: vi.fn(),
onSetContactType: vi.fn().mockResolvedValue(true),
```

Extend `ConversationList` tests with a typed fixture and assertions that the row contains exactly one accessible type marker, still contains unread/awaiting/responsible state, and does not render a type marker when `type` is null. Add an unsafe color case and assert no inline style reaches the marker.

Extend `InboxShell`'s `defaultInbox` with Task 2 fields and actions, then assert both desktop and mobile `CustomerPanel` instances receive and invoke `setContactType` for the selected contact.

- [ ] **Step 10: Run panel/list/shell tests and verify RED**

Run:

```powershell
npx vitest run src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: FAIL because the new props, selector, and list marker are not wired.

- [ ] **Step 11: Integrate the selector and list marker**

In `CustomerPanel`, add these props:

```ts
availableTypes: ContactClassificationRecord[];
typesLoading: boolean;
typesError: string | null;
typeSavePending: boolean;
typeSaveError: string | null;
onRetryTypes: () => void;
onSetContactType: (
  contactId: string,
  contactTypeId: string | null,
) => Promise<boolean>;
```

Render before the tags section:

```tsx
<ContactTypeSelector
  availableTypes={availableTypes}
  contactId={conversation.contact.id}
  currentType={conversation.contact.type}
  loadError={typesError}
  loading={typesLoading}
  onChange={onSetContactType}
  onRetryLoad={onRetryTypes}
  pending={typeSavePending}
  saveError={typeSaveError}
/>
```

In `ConversationList`, render one `ContactTypeChip` after responsibility and before tag chips:

```tsx
{item.contact.type ? (
  <span aria-label={`Tipo de contato de ${item.contact.name}`} className="mt-1.5 flex min-w-0">
    <ContactTypeChip
      color={item.contact.type.color}
      compact
      name={item.contact.type.name}
    />
  </span>
) : null}
```

In both `CustomerPanel` instances in `InboxShell`, pass:

```tsx
availableTypes={inbox.contactTypes}
onRetryTypes={() => void inbox.loadContactTypes()}
onSetContactType={inbox.setContactType}
typeSaveError={inbox.contactTypeSaveError}
typeSavePending={inbox.contactTypeSavePendingId === selectedListItem?.contact.id}
typesError={inbox.contactTypesError}
typesLoading={inbox.contactTypesLoading}
```

- [ ] **Step 12: Run all affected UI tests and verify GREEN**

Run:

```powershell
npx vitest run src/components/inbox/contact-type-chip.test.tsx src/components/inbox/contact-type-selector.test.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: all affected component tests pass without accessibility or React warnings.

- [ ] **Step 13: Run React quality checks and refactor only if needed**

Review the changed TSX files for stable hook ordering, controlled-value correctness, focused component responsibility, no derived-state effects, no nested component declarations, and no unsafe inline colors. If refactoring is needed, keep public contracts unchanged and rerun Step 12.

- [ ] **Step 14: Verify Task 3 and commit**

Run:

```powershell
npx eslint src/components/inbox/contact-type-chip.tsx src/components/inbox/contact-type-chip.test.tsx src/components/inbox/contact-type-selector.tsx src/components/inbox/contact-type-selector.test.tsx src/components/inbox/customer-panel.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
npm run typecheck
git diff --check
```

Expected: lint, TypeScript, and whitespace checks pass.

Commit:

```powershell
git add src/components/inbox/contact-type-chip.tsx src/components/inbox/contact-type-chip.test.tsx src/components/inbox/contact-type-selector.tsx src/components/inbox/contact-type-selector.test.tsx src/components/inbox/customer-panel.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: assign contact types from conversations"
```

---

### Task 4: Full verification, browser acceptance, and app-only production deployment

**Files:**
- Create: `.superpowers/sdd/release1-task-7-report.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: exact commits from Tasks 1–3; current production rollback release `208017f95fbe1925adef7ea840de6da78ca860a9`; canonical KVM Compose and backup scripts.
- Produces: immutable verified production release with only `xp-whatsapp-app` recreated and a sanitized durable evidence record.

- [ ] **Step 1: Run the complete local release gate against dedicated PostgreSQL 18**

Use one isolated database whose name ends in `_test` and set both `DATABASE_URL` and `TEST_DATABASE_URL` to it without printing credentials. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000`, then run:

```powershell
npx vitest run --exclude '.superpowers/sdd/audio-recording-full.integration.test.ts'
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm audit --omit=dev --audit-level=high
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-kvm-deployment.ps1
git diff --check
```

Expected: every tracked test passes except explicit opt-in skips; lint, typecheck, Prisma validation, build, audit, KVM verifier, and whitespace checks exit zero.

- [ ] **Step 2: Build and inspect the immutable Linux image**

Set the exact full code revision as the immutable tag and label:

```powershell
$revision = git rev-parse HEAD
docker build --label "org.opencontainers.image.revision=$revision" -t "xp-whatsapp:$revision" .
docker image inspect "xp-whatsapp:$revision"
```

Assert Linux/amd64, exact revision, runtime user `nextjs`, UID/GID `1001:1001`, healthcheck, FFmpeg/FFprobe, migration 006, and absence of application `.env`, test, or spec files. Run `.superpowers/sdd/audio-recording-full.integration.test.ts` inside Linux against the isolated PostgreSQL database and require conversion, delivery, exactly-once persistence, and temporary-file cleanup to pass 1/1.

- [ ] **Step 3: Perform two-session local browser acceptance**

Run the final image with an isolated seeded database and validate through the browser UI:

1. an attendant opens a contact with no type and selects `Cliente`;
2. the panel and conversation row show the `Cliente` marker after server confirmation;
3. a second authenticated session receives the same change without reload;
4. selecting `Sem tipo` removes both markers in both sessions;
5. a forced PATCH failure keeps the old type, displays the safe message, and a retry succeeds;
6. an assigned inactive type remains visible but cannot be newly selected;
7. desktop Escape and mobile back behavior from Release 1 Task 6 remain intact;
8. at 390×844 there is no horizontal overflow and every interactive action is at least 44 px;
9. browser console error and unhandled-rejection counts remain zero.

- [ ] **Step 4: Run production read-only preflight and validated backup**

Using the pinned SSH key and known-hosts file, record without secrets or PII:

- current app revision/image/container ID/health/restarts/UID/networks;
- exact database container ID and start time;
- aggregate migrations `9|0|0`;
- local/public health and protected-route behavior;
- invalid webhook signature status 401;
- a deterministic sorted snapshot of every non-app container;
- read-only Meta counts: one active subscription object, 11 unique fields, one callback, and `smb_message_echoes` exactly once.

Transfer the exact LF Git archive and immutable image. Resolve candidate Compose and require services exactly `app,database` and app networks exactly `shared_gateway,xp_whatsapp_egress,xp_whatsapp_internal`. Run the candidate `scripts/backup.sh` against `/srv/backups/example-app` with `/opt/apps/example-app/.env.production`; require a PostgreSQL custom dump, valid media archive, matching sidecars, five mode-0600 files, and no leftover helper container.

- [ ] **Step 5: Deploy only the application with automatic app-only rollback**

On the KVM, set `REVISION` to the exact candidate revision and `RELEASE` to `/opt/apps/example-app/releases/$REVISION`, then run:

```sh
XP_WHATSAPP_IMAGE="xp-whatsapp:$REVISION" docker compose \
  --project-directory "$RELEASE" \
  --env-file /opt/apps/example-app/.env.production \
  -f "$RELEASE/deploy/kvm/docker-compose.yml" \
  up -d --no-deps --force-recreate --wait app
```

If internal health, public health, exact revision/image, or unchanged database identity fails, recreate only the previous `xp-whatsapp:208017f95fbe1925adef7ea840de6da78ca860a9` application image with the same candidate Compose file. Never restart or edit PostgreSQL, Caddy, Meta, DNS, networks, volumes, or unrelated services.

- [ ] **Step 6: Verify production after rollout**

Require:

- exact image/revision, `healthy`, restart zero, UID/GID `1001:1001`, and the three canonical app networks;
- unchanged database container ID/start time and migrations `9|0|0`;
- local/public health, login, privacy, and deletion pages 200;
- anonymous classification settings render login content and no protected content;
- invalid webhook signature 401;
- three consecutive local/public soak samples `200|200|healthy|0`;
- zero post-deploy application error and 5xx markers;
- read-only Meta `1 active object / 11 fields / 11 unique fields / one callback / one smb_message_echoes`, with the previous field hash unchanged;
- total container count unchanged and the non-app snapshot byte-identical.

- [ ] **Step 7: Record sanitized evidence**

Create `.superpowers/sdd/release1-task-7-report.md` with the exact candidate revision/image digest, test counts, LF archive/image hashes, backup path, Compose hash, deployment UTC, endpoints, migration tuple, runtime checks, Meta counts/hashes, non-app count/hash, browser acceptance, and rollback revision. Do not include phones, contacts, messages, provider identifiers, credentials, tokens, secrets, or raw payloads.

Append a one-line Release 1 Task 7 checkpoint to `.superpowers/sdd/progress.md`.

- [ ] **Step 8: Verify evidence, commit, and perform the final read-only health check**

Run:

```powershell
git diff --check
git add -f .superpowers/sdd/release1-task-7-report.md .superpowers/sdd/progress.md
git diff --cached --check
git commit -m "docs: record contact type deployment"
git status --short
```

Then repeat public health, exact app revision/image, restart count, and database identity read-only checks. Expected: production remains healthy on the documented revision and only unrelated pre-existing working-tree files, if any, remain unstaged.
