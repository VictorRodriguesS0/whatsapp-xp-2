# Contact, Media Viewer, and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved operational visual direction with editable contact names, masked phones, category-colored initials, tags, an authenticated full-screen media viewer, and XP-branded app icons.

**Architecture:** Keep Meta identity immutable in the existing `Contact.name` field, add an optional preferred name plus normalized contact classification tables, and expose focused contact/settings APIs. Build display helpers and accessible React components over safe DTOs; continue serving every media byte through authenticated application routes.

**Tech Stack:** Next.js 16.3.1 App Router metadata, React 19.2.8, TypeScript 7, Prisma 7.9.1, PostgreSQL 18, Tailwind CSS 4, Radix UI, Next Image, Vitest/Testing Library, imagegen skill for raster edits.

## Global Constraints

- Release 0 must be deployed and verified before this plan starts.
- Visual direction is **A — Operacional equilibrado**; do not enlarge list rows into promotional cards.
- Do not claim or fetch personal WhatsApp profile photos; use initials unless a future authorized source is specified.
- Display name fallback is `preferredName` → Meta profile name → formatted phone.
- Store canonical WhatsApp/phone IDs without formatting; apply Brazilian display masks only at presentation boundaries.
- A contact has zero or one primary type and zero or more tags.
- Initial types are Cliente, Interessado, Fornecedor/Parceiro, and Não cliente; administrators may create, edit, order, color, and deactivate types/tags.
- State must never rely on color alone; show text/accessible labels.
- Every image/video/download route remains authenticated and must not expose storage keys or provider URLs.
- Targets remain 1440×900, 900×1100, and 390×844 with 44 px actions and full keyboard support.
- Logo editing must use the `imagegen` skill/tool after inspecting the supplied raster; preserve the black background and internal gradient, add the approved green outline, and create an original simplified favicon rather than copying the WhatsApp glyph.

---

## File Structure

- `prisma/schema.prisma`: preferred name, contact type, tag definitions, and join table.
- `prisma/migrations/202608210002_contact_classification/migration.sql`: additive schema and seeded default types.
- `src/modules/contacts/types.ts`: contact/type/tag DTOs.
- `src/modules/contacts/schemas.ts`: UUID, name, color, order, and assignment validation.
- `src/modules/contacts/service.ts`: contact display edit, classification CRUD, list filters, and transactional assignment.
- `src/modules/contacts/*.test.ts`: unit/PostgreSQL behavior.
- `src/lib/contact-display.ts`: pure name, initials, and Brazilian phone formatting.
- `src/app/api/contacts/[id]/route.ts`: preferred name and type mutation.
- `src/app/api/contacts/[id]/tags/route.ts`: replace the tag set atomically.
- `src/app/api/settings/contact-types/**` and `src/app/api/settings/contact-tags/**`: admin CRUD.
- `src/components/settings/contact-classification-screen.tsx`: admin management UI.
- `src/app/configuracoes/atendimento/page.tsx`: protected settings page.
- `src/modules/conversations/types.ts`, `service.ts`, `schemas.ts`: enriched contact DTO and type/tag filters.
- `src/hooks/use-inbox.ts`: filter/contact-edit calls and SSE reconciliation.
- `src/components/inbox/conversation-list.tsx`, `customer-panel.tsx`, `conversation-view.tsx`: approved contact presentation.
- `src/components/inbox/media-viewer.tsx`: accessible lightbox/gallery.
- `src/components/inbox/message-media.tsx`: viewer triggers and secure download action.
- `src/modules/media/service.ts` and `src/app/api/media/[id]/route.ts`: safe filename/disposition support.
- `public/brand/xp-atendimento-logo.png`: edited full logo.
- `src/app/icon.png` and `src/app/apple-icon.png`: simplified icons.
- `src/app/layout.tsx` and `src/app/login/page.tsx`: metadata and brand placement.

### Task 1: Add contact types, tags, and preferred names

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608210002_contact_classification/migration.sql`
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed.test.ts`
- Modify: `prisma/temporal-contract.test.ts`

**Interfaces:**
- Produces `Contact.preferredName`, `contactTypeId`, `ContactType`, `ContactTagDefinition`, and `ContactTagAssignment`.
- Preserves existing `Contact.name` as the latest Meta profile name for rollback compatibility.

- [ ] **Step 1: Write RED migration and seed tests**

Assert default type names/order/colors, unique normalized names, tag uniqueness, and safe deactivation without cascade deletion:

```ts
expect(await prisma.contactType.findMany({ orderBy: { position: "asc" } })).toMatchObject([
  { name: "Cliente", color: "#176B52", active: true, position: 10 },
  { name: "Interessado", color: "#2563EB", active: true, position: 20 },
  { name: "Fornecedor/Parceiro", color: "#B7791F", active: true, position: 30 },
  { name: "Não cliente", color: "#6D746F", active: true, position: 40 },
]);
```

- [ ] **Step 2: Run database tests to verify RED**

Run: `npm run test:db -- prisma/seed.test.ts prisma/temporal-contract.test.ts`

Expected: FAIL because classification tables and preferred name do not exist.

- [ ] **Step 3: Add the additive Prisma schema**

```prisma
model Contact {
  preferredName String?                @map("preferred_name")
  contactTypeId String?                @map("contact_type_id") @db.Uuid
  contactType   ContactType?           @relation(fields: [contactTypeId], references: [id], onDelete: SetNull)
  tagAssignments ContactTagAssignment[]
}

model ContactType {
  id         String    @id @default(uuid()) @db.Uuid
  name       String
  normalizedName String @unique @map("normalized_name")
  color      String
  position   Int
  active     Boolean   @default(true)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  contacts   Contact[]

  @@index([active, position])
  @@map("contact_types")
}

model ContactTagDefinition {
  id         String   @id @default(uuid()) @db.Uuid
  name       String
  normalizedName String @unique @map("normalized_name")
  color      String
  position   Int
  active     Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  assignments ContactTagAssignment[]

  @@index([active, position])
  @@map("contact_tag_definitions")
}

model ContactTagAssignment {
  contactId String @map("contact_id") @db.Uuid
  tagId     String @map("tag_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag       ContactTagDefinition @relation(fields: [tagId], references: [id], onDelete: Restrict)

  @@id([contactId, tagId])
  @@index([tagId, contactId])
  @@map("contact_tag_assignments")
}
```

The migration inserts the four defaults with fixed UUIDs/positions using `ON CONFLICT (normalized_name) DO NOTHING`; the seed uses upsert and never overwrites administrator changes after initial creation.

- [ ] **Step 4: Generate, migrate a disposable DB, and verify GREEN**

Run: `npm run db:generate; npm run db:validate; npm run db:deploy; npm run test:db -- prisma/seed.test.ts prisma/temporal-contract.test.ts`

Expected: all exit 0 and all new timestamps are `timestamp with time zone`.

- [ ] **Step 5: Commit the classification schema**

```bash
git add prisma/schema.prisma prisma/migrations/202608210002_contact_classification prisma/seed.ts prisma/seed.test.ts prisma/temporal-contract.test.ts src/generated/prisma
git commit -m "feat: add contact classification data"
```

### Task 2: Implement contact display and classification services

**Files:**
- Create: `src/lib/contact-display.ts`
- Create: `src/lib/contact-display.test.ts`
- Create: `src/modules/contacts/types.ts`
- Create: `src/modules/contacts/schemas.ts`
- Create: `src/modules/contacts/service.ts`
- Create: `src/modules/contacts/service.test.ts`
- Create: `src/modules/contacts/service.integration.test.ts`

**Interfaces:**
- Produces `resolveContactName`, `contactInitials`, and `formatContactPhone`.
- Produces `updateContact(actor, contactId, input)`, `replaceContactTags(actor, contactId, tagIds)`, and admin CRUD functions.

- [ ] **Step 1: Write RED display and service tests**

```ts
expect(resolveContactName({ preferredName: " Ana ", profileName: "Ana C.", phone: "5561999991234" })).toBe("Ana");
expect(formatContactPhone("5561999991234")).toBe("+55 (61) 99999-1234");
expect(contactInitials("Ana Carolina")).toBe("AC");
```

Service tests cover trimmed preferred name, `null` to remove it, inactive type/tag rejection, normalized duplicate 409, replace-set idempotency, admin-only CRUD, and transactional no-partial assignment.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/lib/contact-display.test.ts src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement pure display helpers**

```ts
export function resolveContactName(input: { preferredName: string | null; profileName: string; phone: string }) {
  return input.preferredName?.trim() || input.profileName.trim() || formatContactPhone(input.phone);
}

export function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : parts[0]?.slice(0, 2) || "?").toUpperCase();
}

export function formatContactPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const match = digits.match(/^55(\d{2})(\d{5})(\d{4})$/);
  if (match) return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
  const landline = digits.match(/^55(\d{2})(\d{4})(\d{4})$/);
  if (landline) return `+55 (${landline[1]}) ${landline[2]}-${landline[3]}`;
  return value.trim();
}
```

- [ ] **Step 4: Implement schemas and transactional services**

Use `z.string().trim().min(1).max(80)`, colors matching `^#[0-9A-F]{6}$`, position `0..10_000`, and UUID arrays with `max(20)`. Normalize names with Unicode NFKC, lowercase pt-BR, whitespace collapse, and diacritic removal only for uniqueness/search; preserve display spelling.

`replaceContactTags` verifies all requested tags are active before deleting/recreating the join set inside one serializable transaction. Deactivation updates `active=false`; no delete endpoint is exposed.

- [ ] **Step 5: Run unit and PostgreSQL tests**

Run: `npm test -- src/lib/contact-display.test.ts src/modules/contacts/service.test.ts src/modules/contacts/service.integration.test.ts`

Expected: PASS, including two administrators racing to create equivalent normalized names.

- [ ] **Step 6: Commit the contact domain**

```bash
git add src/lib/contact-display.ts src/lib/contact-display.test.ts src/modules/contacts
git commit -m "feat: manage contact identity and labels"
```

### Task 3: Add authenticated contact and admin settings APIs

**Files:**
- Create: `src/app/api/contacts/[id]/route.ts`
- Create: `src/app/api/contacts/[id]/route.test.ts`
- Create: `src/app/api/contacts/[id]/tags/route.ts`
- Create: `src/app/api/contacts/[id]/tags/route.test.ts`
- Create: `src/app/api/settings/contact-types/route.ts`
- Create: `src/app/api/settings/contact-types/route.test.ts`
- Create: `src/app/api/settings/contact-types/[id]/route.ts`
- Create: `src/app/api/settings/contact-types/[id]/route.test.ts`
- Create equivalent `contact-tags` route/test files.
- Modify: `src/modules/realtime/events.ts`

**Interfaces:**
- Produces `contact.updated` and `settings.updated` SSE invalidations.
- Uses standard `{ data, error }` envelopes for inbox routes; settings CRUD may follow the existing users route envelope only if tests preserve a single convention per route family.

- [ ] **Step 1: Write RED route tests**

For every mutation assert order: same-origin → auth/role → params/body validation → service → publication. Verify attendants can edit preferred name/type and assign tags, but only admins manage definitions.

- [ ] **Step 2: Run route tests to verify RED**

Run: `npm test -- src/app/api/contacts src/app/api/settings/contact-types src/app/api/settings/contact-tags`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement route factories with injectable dependencies**

Use the established pattern:

```ts
dependencies.assertSameOrigin(request);
const actor = await dependencies.requireAdmin();
const input = contactTypeInputSchema.parse(await request.json());
const item = await dependencies.createContactType(actor, input);
dependencies.publishRealtime({ type: "settings.updated", scope: "contact-classification" });
return Response.json({ data: item, error: null }, { status: 201 });
```

Map `ZodError`/`SyntaxError` to safe 400, normalized duplicate to 409, inactive/missing IDs to 400/404, and unexpected failures through `toErrorResponse`.

- [ ] **Step 4: Run all route tests**

Run: `npm test -- src/app/api/contacts src/app/api/settings/contact-types src/app/api/settings/contact-tags src/modules/realtime/hub.test.ts`

Expected: PASS with no PII in SSE events or error bodies.

- [ ] **Step 5: Commit APIs**

```bash
git add src/app/api/contacts src/app/api/settings/contact-types src/app/api/settings/contact-tags src/modules/realtime/events.ts src/modules/realtime/hub.test.ts
git commit -m "feat: expose contact classification APIs"
```

### Task 4: Enrich conversation queries, search, and filters

**Files:**
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/schemas.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/repository.test.ts`
- Modify: `src/app/api/conversations/route.test.ts`

**Interfaces:**
- Extends `ContactDto` with `profileName`, `preferredName`, resolved `name`, formatted `phone`, `type`, and `tags`.
- Extends `ConversationListOptions` with `contactTypeId?: string` and `tagIds?: string[]`.

- [ ] **Step 1: Write RED DTO/search/filter tests**

Assert fallback names, formatted phone, search over preferred/original/canonical phone, active and inactive assigned definitions remaining readable, type filter, and AND semantics for multiple selected tags.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/conversations/service.test.ts src/modules/conversations/repository.test.ts src/app/api/conversations/route.test.ts`

Expected: FAIL because existing selects only return `name`, `phone`, and profile picture.

- [ ] **Step 3: Implement exact DTO/select shape**

```ts
export type ContactClassificationDto = { id: string; name: string; color: string; active: boolean };
export type ContactDto = {
  id: string;
  profileName: string;
  preferredName: string | null;
  name: string;
  phone: string;
  type: ContactClassificationDto | null;
  tags: ContactClassificationDto[];
};
```

Prisma selects load type and tag definitions ordered by position/id. `toContactDto` calls the pure helpers. Search uses OR across `preferredName`, existing `name`, and canonical phone. Tag filtering uses one `some` predicate per tag ID so all requested tags must exist.

- [ ] **Step 4: Run conversation and route tests**

Run: `npm test -- src/modules/conversations/service.test.ts src/modules/conversations/repository.test.ts src/app/api/conversations/route.test.ts`

Expected: PASS and existing cursor pagination remains stable.

- [ ] **Step 5: Commit conversation enrichment**

```bash
git add src/modules/conversations src/app/api/conversations/route.test.ts
git commit -m "feat: enrich contact presentation and filters"
```

### Task 5: Build the contact classification settings UI

**Files:**
- Create: `src/components/settings/contact-classification-screen.tsx`
- Create: `src/components/settings/contact-classification-screen.test.tsx`
- Create: `src/app/configuracoes/atendimento/page.tsx`
- Create: `src/app/configuracoes/atendimento/page.test.tsx`
- Create: `src/app/configuracoes/atendimento/loading.tsx`
- Create: `src/app/configuracoes/atendimento/error.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes admin settings routes from Task 3.
- Produces the protected `/configuracoes/atendimento` page and a visible admin navigation link.

- [ ] **Step 1: Write RED component/page tests**

Cover admin redirect, attendant redirect, create/edit/deactivate, duplicate 409 copy, color input plus text label, stable focus restoration, malformed/network errors, and 44 px actions.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/components/settings/contact-classification-screen.test.tsx src/app/configuracoes/atendimento/page.test.tsx src/components/inbox/inbox-shell.test.tsx`

Expected: FAIL because page/components do not exist.

- [ ] **Step 3: Implement the compact settings page**

Use two plain sections, **Tipos de contato** and **Etiquetas**, with ordered rows and an accessible edit dialog. Never render color as the only name. Use `useRouter` for navigation and the same safe fetch/error patterns as `UsersScreen`.

- [ ] **Step 4: Run UI tests and lint affected files**

Run: `npm test -- src/components/settings/contact-classification-screen.test.tsx src/app/configuracoes/atendimento/page.test.tsx src/components/inbox/inbox-shell.test.tsx; npx eslint src/components/settings src/app/configuracoes/atendimento src/components/inbox/inbox-shell.tsx`

Expected: PASS with zero warnings.

- [ ] **Step 5: Commit settings UI**

```bash
git add src/components/settings src/app/configuracoes/atendimento src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: add contact classification settings"
```

### Task 6: Apply the approved contact presentation in the inbox

**Files:**
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`
- Modify: `src/components/inbox/customer-panel.tsx`
- Modify: `src/components/inbox/customer-panel.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`

**Interfaces:**
- Consumes contact edit/tag APIs and enriched DTOs.
- Produces `updateContact` and `replaceContactTags` hook actions with stale-conversation guards.

- [ ] **Step 1: Write RED visual/interaction tests**

Test resolved name/phone, initials colored by type, textual type/tag labels, no broken profile-photo placeholder, edit preferred name, clear preferred name, type/tag changes, SSE refetch, stale A→B responses, keyboard focus, and mobile drawer behavior.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx src/components/inbox/conversation-list.test.tsx src/components/inbox/customer-panel.test.tsx src/components/inbox/conversation-view.test.tsx`

Expected: FAIL because current components render `profilePictureUrl` and raw phone only.

- [ ] **Step 3: Implement contact actions with race guards**

Capture `conversationId` and request sequence before PATCH/PUT. Update selected detail and matching list row only when the current selected ID still matches; always refetch after success and after ambiguous failure.

- [ ] **Step 4: Render the operational layout**

Remove `AvatarImage` from contact surfaces. Use the type color as a CSS custom property with a safe server-validated hex value and render type/tag text badges. Keep list density within the existing intrinsic 84 px row, truncating excess tags to a `+N` accessible summary.

- [ ] **Step 5: Run React/stop-slop review and focused tests**

Run the tests from Step 2 and `npx eslint src/hooks/use-inbox.ts src/components/inbox`.

Expected: PASS with no effect loops, remount-prone inline component definitions, inaccessible color-only state, or overflow.

- [ ] **Step 6: Commit inbox identity UI**

```bash
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/inbox
git commit -m "feat: improve contact identity in inbox"
```

### Task 7: Add authenticated full-screen image/video viewing and download

**Files:**
- Create: `src/components/inbox/media-viewer.tsx`
- Create: `src/components/inbox/media-viewer.test.tsx`
- Modify: `src/components/inbox/message-media.tsx`
- Modify: `src/components/inbox/message-media.test.tsx`
- Modify: `src/modules/media/service.ts`
- Modify: `src/modules/media/service.test.ts`
- Modify: `src/app/api/media/[id]/route.ts`
- Modify: `src/app/api/media/[id]/route.test.ts`

**Interfaces:**
- Extends media download result with `filename: string`.
- `GET /api/media/[id]?download=1` sets safe attachment disposition; the default remains inline.
- `MediaViewer` receives `{ items, activeId, onActiveIdChange, onClose }`.

- [ ] **Step 1: Write RED server and viewer tests**

Server tests cover authentication, UUID, `inline` vs `attachment`, CR/LF/quote filename sanitization, range/stream headers preserved, and no storage key leakage. UI tests cover open, close/restore focus, `Esc`, backdrop, next/previous within the current conversation, image zoom, video controls, download link, and reduced motion.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm test -- src/modules/media/service.test.ts "src/app/api/media/[id]/route.test.ts" src/components/inbox/media-viewer.test.tsx src/components/inbox/message-media.test.tsx`

Expected: FAIL because the viewer and filename/disposition contract do not exist.

- [ ] **Step 3: Implement secure filename/disposition support**

Return only the original filename sanitized to printable basename characters. Build the response header with both quoted ASCII fallback and RFC 5987 encoding:

```ts
const disposition = download
  ? `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  : "inline";
```

- [ ] **Step 4: Implement the dialog-based viewer**

Use the existing Radix `Dialog`. Keep trigger refs for restoration, trap focus while open, use native `<video controls>`, and implement image zoom buttons (100%–300%) plus pointer/scroll container. Navigation skips audio/documents and unavailable media.

- [ ] **Step 5: Run focused tests and browser QA**

Run Step 2 tests. Then verify a real authenticated image/video at all three viewports, no console error, no background scroll, and download response contains no provider URL.

- [ ] **Step 6: Commit media viewer**

```bash
git add src/components/inbox/media-viewer.tsx src/components/inbox/media-viewer.test.tsx src/components/inbox/message-media.tsx src/components/inbox/message-media.test.tsx src/modules/media/service.ts src/modules/media/service.test.ts src/app/api/media/[id]
git commit -m "feat: add secure media viewer"
```

### Task 8: Create and integrate XP brand assets

**Files:**
- Source: `C:/Users/developer/AppData/Local/Temp/codex-clipboard-f7c2beb6-51ad-4661-a1a3-9067303b5817.png`
- Create: `public/brand/xp-atendimento-logo.png`
- Create: `src/app/icon.png`
- Create: `src/app/apple-icon.png`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/login/page.tsx`
- Create: `src/app/login/page.test.tsx`

**Interfaces:**
- Produces a full logo with green outline and a simplified original favicon; no WhatsApp glyph copy.

- [ ] **Step 1: Write RED metadata/login tests**

Assert metadata icon declarations and login image dimensions/alt copy without layout shift:

```tsx
expect(metadata.icons).toMatchObject({ icon: "/icon.png", apple: "/apple-icon.png" });
expect(screen.getByRole("img", { name: "XP Eletrônicos" })).toHaveAttribute("src", expect.stringContaining("xp-atendimento-logo"));
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/app/login/page.test.tsx`

Expected: FAIL because assets/metadata/image do not exist.

- [ ] **Step 3: Generate the approved assets with the imagegen skill**

Read `imagegen/SKILL.md`, inspect the attached source with `view_image`, and use `image_gen.imagegen` with the source path. Prompt precisely: preserve black background and internal neon gradient; add a clean outer green outline close to the app accent; keep the full game-controller/receipt/XP mark for the large logo; create a separate simplified square chat-bubble/XP mark for tiny sizes; do not add the WhatsApp telephone glyph, text, watermark, or new objects.

If the source path is missing, stop this task and ask the user to attach it again; do not recreate the logo from memory. Save optimized outputs at the exact target paths and visually inspect each at 16, 32, 180, and large display sizes.

- [ ] **Step 4: Integrate Next metadata and login logo**

Use `next/image` with explicit dimensions, `priority`, and restrained sizing. Add:

```ts
export const metadata: Metadata = {
  title: "XP Atendimento",
  description: "Central interna de atendimento da XP Eletrônicos.",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};
```

- [ ] **Step 5: Run test/build and visual QA**

Run: `npm test -- src/app/login/page.test.tsx; npm run typecheck; npm run build`.

Inspect favicon/login at desktop and 390×844. Expected: crisp icon, no distortion/overflow, and no console warning.

- [ ] **Step 6: Commit brand assets**

```bash
git add public/brand/xp-atendimento-logo.png src/app/icon.png src/app/apple-icon.png src/app/layout.tsx src/app/login/page.tsx src/app/login/page.test.tsx
git commit -m "feat: add XP Atendimento brand assets"
```

### Task 9: Verify and publish Release 1

**Files:**
- Create: `docs/verification/2026-08-21-contact-media-branding-release.md`
- Modify: `README.md` only for new administrator navigation/asset operation notes.

**Interfaces:**
- Produces immutable Release 1 and evidence; preserves Release 0 behavior.

- [ ] **Step 1: Run all local gates**

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

Expected: all exit 0 and audit reports 0 vulnerabilities.

- [ ] **Step 2: Run PostgreSQL and browser acceptance**

Run contact/conversation/media integration tests twice. In two authenticated sessions verify preferred-name update, classification/tag SSE, search/filter, lightbox/download authorization, and unchanged shared read/response behavior. Verify 1440×900, 900×1100, and 390×844.

- [ ] **Step 3: Back up and deploy app-only**

Use the canonical KVM procedure: validated backup, immutable image/release, migrate, app-only recreate, health/login/webhook checks, non-app container snapshot comparison, and rollback readiness.

- [ ] **Step 4: Record evidence and commit**

Document image digest, migration, UI/browser results, media headers, asset checks, logs, backup checksum, and rollback target without PII/secrets.

```bash
git add docs/verification/2026-08-21-contact-media-branding-release.md README.md
git commit -m "docs: verify contact and media release"
```
