# WhatsApp Rich Inbound Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render inbound WhatsApp stickers, locations, shared contacts, button/list replies, orders, system events, and safe unknown-type fallbacks instead of the generic unsupported-message notice.

**Architecture:** Extend the persisted message domain with explicit message types and a validated, application-owned JSON union. Normalize Meta payloads at the webhook boundary, persist only sanitized fields, expose validated DTOs, and delegate UI rendering to focused components. Stickers reuse the existing authenticated media recovery pipeline; structured messages never expose raw webhook JSON.

**Tech Stack:** Node.js 22+, TypeScript 7, Next.js 16 App Router, React 19, Prisma 7/PostgreSQL, Zod 4, Vitest/Testing Library, Docker Compose on the production KVM.

## Global Constraints

- This release is inbound display only; do not add outbound sticker, location, contact, order, or interactive sending.
- Do not embed maps, call geocoding services, import shared contacts, or automate actions from interactive replies.
- Preserve webhook signature verification, authenticated media access, idempotency by WhatsApp message ID, and the existing Meta delivery rules.
- Persist only the whitelisted structured fields; never return raw Meta payloads, provider errors, tokens, filesystem paths, or infrastructure identifiers.
- Validate latitude in `[-90, 90]`, longitude in `[-180, 180]`, all string/list limits, and media MIME/size constraints.
- Existing `UNSUPPORTED` rows remain safe fallbacks because `webhook_events` does not retain original payloads; do not invent or backfill missing structured data.
- Preserve unrelated worktree changes, especially the existing contact-tag editor changes.
- Use TDD, run the named focused tests after every change, and create one focused commit per task.

## File Structure

- Create `src/modules/messages/content.ts`: the single parser and TypeScript union for persisted/public structured content.
- Create `src/modules/messages/content.test.ts`: hostile and valid JSON validation tests.
- Create `src/components/inbox/message-rich-content.tsx`: location, contacts, interactive, order, system, and unsupported cards.
- Create `src/components/inbox/message-rich-content.test.tsx`: UI, accessibility, link-safety, and malformed-content tests.
- Modify `prisma/schema.prisma` and create one additive migration: message enum values plus nullable JSON content.
- Modify `src/modules/webhooks/types.ts`, `normalize.ts`, fixtures, and tests: trusted-boundary normalization.
- Modify `src/modules/webhooks/process.ts` and tests: idempotent structured-content persistence.
- Modify `src/modules/conversations/types.ts`, `service.ts`, and tests: validated public DTOs.
- Modify `src/components/inbox/message-media.tsx` and tests: sticker recovery and rendering.
- Modify `src/components/inbox/message-bubble.tsx`, `conversation-list.tsx`, and tests: route rich types to components and show useful previews.
- Modify `docs/verification/`: record release evidence after production deployment.

---

### Task 1: Persisted structured-message contract

**Files:**
- Create: `src/modules/messages/content.ts`
- Create: `src/modules/messages/content.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608220001_rich_inbound_messages/migration.sql`
- Test: `prisma/rich-inbound-messages-contract.test.ts`

**Interfaces:**
- Produces: `MessageContent`, `parseMessageContent(value: unknown): MessageContent | null`, and `messageContentForPrisma(content: MessageContent | null): Prisma.InputJsonValue | Prisma.JsonNullValueInput`.
- Produces enum values `STICKER | LOCATION | CONTACTS | INTERACTIVE | ORDER | SYSTEM` and nullable `Message.content Json?`.

- [ ] **Step 1: Write failing schema-contract and parser tests**

```ts
// src/modules/messages/content.test.ts
import { describe, expect, it } from "vitest";
import { parseMessageContent } from "./content";

describe("parseMessageContent", () => {
  it("accepts a bounded location", () => {
    expect(parseMessageContent({
      kind: "location", latitude: -15.793889, longitude: -47.882778,
      name: "XP Eletrônicos", address: "Brasília - DF",
    })).toEqual({
      kind: "location", latitude: -15.793889, longitude: -47.882778,
      name: "XP Eletrônicos", address: "Brasília - DF",
    });
  });

  it.each([
    { kind: "location", latitude: 91, longitude: 0, name: null, address: null },
    { kind: "location", latitude: 0, longitude: -181, name: null, address: null },
    { kind: "contacts", contacts: [] },
    { kind: "interactive", interaction: "button", id: "", title: "Escolher" },
    { kind: "unknown", rawType: "token\u0000leak" },
  ])("rejects invalid persisted content %#", (value) => {
    expect(parseMessageContent(value)).toBeNull();
  });
});
```

```ts
// prisma/rich-inbound-messages-contract.test.ts
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds rich types and nullable JSON without destructive SQL", async () => {
  const sql = await readFile("prisma/migrations/202608220001_rich_inbound_messages/migration.sql", "utf8");
  for (const value of ["STICKER", "LOCATION", "CONTACTS", "INTERACTIVE", "ORDER", "SYSTEM"]) {
    expect(sql).toContain(`ADD VALUE '${value}'`);
  }
  expect(sql).toContain('ADD COLUMN "content" JSONB');
  expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});
```

- [ ] **Step 2: Run tests and verify the red state**

Run: `npm test -- src/modules/messages/content.test.ts prisma/rich-inbound-messages-contract.test.ts`

Expected: FAIL because `content.ts` and the migration do not exist.

- [ ] **Step 3: Add the additive Prisma model and migration**

```prisma
enum MessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  STICKER
  LOCATION
  CONTACTS
  INTERACTIVE
  ORDER
  SYSTEM
  UNSUPPORTED
}

model Message {
  // existing fields remain unchanged
  content Json?
}
```

```sql
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'STICKER';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTACTS';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'INTERACTIVE';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'ORDER';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'SYSTEM';
ALTER TABLE "messages" ADD COLUMN "content" JSONB;
```

- [ ] **Step 4: Implement the closed content union**

```ts
// src/modules/messages/content.ts
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

const short = z.string().min(1).max(256);
const optionalShort = short.nullable();
const phone = z.object({ phone: z.string().min(1).max(32), type: optionalShort });
const sharedContact = z.object({ name: short, phones: z.array(phone).max(10) });

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("location"), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), name: optionalShort, address: z.string().min(1).max(512).nullable() }),
  z.object({ kind: z.literal("contacts"), contacts: z.array(sharedContact).min(1).max(20), truncated: z.boolean() }),
  z.object({ kind: z.literal("interactive"), interaction: z.enum(["button", "list"]), id: z.string().min(1).max(256), title: short }),
  z.object({ kind: z.literal("order"), catalogId: z.string().min(1).max(256).nullable(), productCount: z.number().int().min(0).max(1_000) }),
  z.object({ kind: z.literal("system"), text: z.string().min(1).max(512).nullable() }),
  z.object({ kind: z.literal("unknown"), rawType: z.string().regex(/^[a-z0-9_]{1,64}$/) }),
]);

export type MessageContent = z.infer<typeof schema>;
export function parseMessageContent(value: unknown): MessageContent | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
export function messageContentForPrisma(content: MessageContent | null) {
  return content === null ? Prisma.DbNull : content as Prisma.InputJsonValue;
}
```

- [ ] **Step 5: Generate Prisma and run focused validation**

Run: `npm run db:generate && npm run db:validate && npm test -- src/modules/messages/content.test.ts prisma/rich-inbound-messages-contract.test.ts`

Expected: Prisma commands succeed and both test files PASS.

- [ ] **Step 6: Commit the domain contract**

```powershell
git add prisma/schema.prisma prisma/migrations/202608220001_rich_inbound_messages/migration.sql prisma/rich-inbound-messages-contract.test.ts src/modules/messages/content.ts src/modules/messages/content.test.ts src/generated
git commit -m "feat: define rich inbound message content"
```

### Task 2: Normalize Meta rich message payloads

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`

**Interfaces:**
- Consumes: `MessageContent` from Task 1.
- Produces: `NormalizedMessageEvent.content: MessageContent | null` and equivalent echo content; stickers produce `type: STICKER`, `content: null`, and `NormalizedMedia`.

- [ ] **Step 1: Add representative fixtures and failing normalization assertions**

```ts
it("normalizes a sticker as recoverable media", () => {
  expect(normalizeWebhook(inboundStickerFixture)[0]).toMatchObject({
    type: "STICKER", body: null, content: null,
    media: { metaMediaId: "meta-sticker-1", mimeType: "image/webp", sha256: null },
  });
});

it("normalizes location without retaining extra provider fields", () => {
  expect(normalizeWebhook(inboundLocationFixture)[0]).toMatchObject({
    type: "LOCATION", media: null,
    content: { kind: "location", latitude: -15.793889, longitude: -47.882778, name: "XP Eletrônicos", address: "Brasília - DF" },
  });
});

it.each([inboundContactsFixture, inboundButtonFixture, inboundListReplyFixture, inboundOrderFixture, inboundSystemFixture])(
  "normalizes a supported structured message",
  (fixture) => expect(normalizeWebhook(fixture)[0]).not.toMatchObject({ type: "UNSUPPORTED" }),
);
```

- [ ] **Step 2: Run the normalizer tests and verify failure**

Run: `npm test -- src/modules/webhooks/normalize.test.ts`

Expected: FAIL because the new types still normalize as `UNSUPPORTED`.

- [ ] **Step 3: Extend normalized event types and bounded parsers**

```ts
// types.ts additions to message and echo events
content: MessageContent | null;

// normalize.ts mapping
const typeMap = new Map<string, MessageType>([
  ["text", MessageType.TEXT], ["image", MessageType.IMAGE],
  ["audio", MessageType.AUDIO], ["video", MessageType.VIDEO],
  ["document", MessageType.DOCUMENT], ["sticker", MessageType.STICKER],
  ["location", MessageType.LOCATION], ["contacts", MessageType.CONTACTS],
  ["button", MessageType.INTERACTIVE], ["interactive", MessageType.INTERACTIVE],
  ["order", MessageType.ORDER], ["system", MessageType.SYSTEM],
]);
```

Implement dedicated `normalizeLocation`, `normalizeContacts`, `normalizeInteractive`, `normalizeOrder`, and `normalizeSystem` functions. Each function constructs a `MessageContent`, passes it through `parseMessageContent`, and returns `null` when required fields are invalid. For unknown types construct `{ kind: "unknown", rawType }` only when `rawType` matches `^[a-z0-9_]{1,64}$`; otherwise store no content.

For sticker media, require a valid media ID and `image/webp`; set `sha256` from the webhook when present and otherwise `null`. Do not relax requirements for image, audio, video, or document.

- [ ] **Step 4: Cover limits and malformed payload isolation**

```ts
it.each([
  ["invalid latitude", locationFixture({ latitude: 91 })],
  ["too many contacts", contactsFixture(21)],
  ["empty button id", buttonFixture({ payload: "" })],
  ["non-WEBP sticker", stickerFixture({ mime_type: "image/png" })],
])("rejects %s", (_name, fixture) => {
  expect(() => normalizeWebhook(fixture)).toThrow(WebhookPayloadError);
});
```

- [ ] **Step 5: Run normalizer tests**

Run: `npm test -- src/modules/webhooks/normalize.test.ts`

Expected: PASS, including existing text/media/echo/control cases.

- [ ] **Step 6: Commit trusted-boundary support**

```powershell
git add src/modules/webhooks/types.ts src/modules/webhooks/normalize.ts src/modules/webhooks/normalize.test.ts src/test/fixtures/meta-webhooks.ts
git commit -m "feat: normalize rich WhatsApp messages"
```

### Task 3: Persist and expose validated content

**Files:**
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/service.integration.test.ts`

**Interfaces:**
- Consumes: `NormalizedMessageEvent.content` and `parseMessageContent`.
- Produces: `MessageRecord.content: unknown` and `MessageDto.content: MessageContent | null`.

- [ ] **Step 1: Write failing repository, idempotency, and DTO tests**

```ts
it("persists a normalized location exactly once", async () => {
  const event = normalizedLocationEvent();
  await processWebhookEvents([event, event]);
  await expect(prisma.message.findMany({ select: { type: true, content: true } })).resolves.toEqual([{
    type: "LOCATION",
    content: { kind: "location", latitude: -15.793889, longitude: -47.882778, name: "XP Eletrônicos", address: "Brasília - DF" },
  }]);
});

it("replaces corrupt stored content with a safe null DTO", async () => {
  repository.message.content = { kind: "location", latitude: 999, longitude: 0 };
  const detail = await getConversationDetail(sessionUser, repository.message.conversationId, repository);
  expect(detail.messages[0].content).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts`

Expected: FAIL because repository inputs, selects, and DTOs omit `content`.

- [ ] **Step 3: Thread content through webhook persistence**

```ts
createMessage(input: {
  conversationId: string;
  whatsappMessageId: string;
  type: NormalizedMessageEvent["type"];
  body: string | null;
  content: MessageContent | null;
  mediaObjectId: string | null;
  direction: MessageDirection;
  status: MessageStatusValue;
  sentByUserId: string | null;
  externalTimestamp: Date;
}): Promise<{ id: string; conversationId: string }>;
```

Use `content: messageContentForPrisma(input.content)` in Prisma create calls. Pass `event.content` for inbound and app-echo events. Preserve the existing duplicate-message behavior: an API-authored row remains authoritative and no second media or message is created.

- [ ] **Step 4: Validate content at the DTO boundary**

```ts
// messageSelect
content: true,

// MessageRecord / MessageDto
content: unknown; // repository record
content: MessageContent | null; // DTO

// toMessageDto
content: parseMessageContent(message.content),
```

Add `content: null` to existing test builders so type errors reveal every caller that must use the new contract.

- [ ] **Step 5: Run persistence and conversation tests**

Run: `npm test -- src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts`

Expected: PASS with duplicate delivery producing one message and one sticker media object.

- [ ] **Step 6: Commit the persistence path**

```powershell
git add src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts
git commit -m "feat: persist rich inbound message content"
```

### Task 4: Render stickers through authenticated media recovery

**Files:**
- Modify: `src/modules/media/validation.ts`
- Modify: `src/modules/media/validation.test.ts`
- Modify: `src/components/inbox/message-media.tsx`
- Modify: `src/components/inbox/message-media.test.tsx`

**Interfaces:**
- Consumes: messages with `type: STICKER`, `mediaObjectId`, and existing `mediaState`.
- Produces: the same recovery behavior as other media and an inline WEBP `<img>` when available.

- [ ] **Step 1: Write failing sticker validation and UI tests**

```ts
it("accepts a signed WEBP sticker within the image limit", () => {
  const bytes = Uint8Array.from(Buffer.from("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ", "binary"));
  expect(validateMedia({ mimeType: "image/webp", filename: "sticker.webp", bytes })).toMatchObject({
    mimeType: "image/webp", kind: "image",
  });
});

it("renders an available sticker from the authenticated route", () => {
  render(<MessageMedia message={{ ...baseMessage, type: "STICKER", mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false } }} />);
  expect(screen.getByRole("img", { name: "Figurinha" })).toHaveAttribute("src", `/api/media/${baseMessage.mediaObjectId}`);
});

it("uses sticker-specific pending and failed copy", () => {
  render(<MessageMedia message={{ ...baseMessage, type: "STICKER" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Baixando figurinha");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/modules/media/validation.test.ts src/components/inbox/message-media.test.tsx`

Expected: FAIL because `STICKER` is not a media kind or render branch.

- [ ] **Step 3: Extend validation without weakening existing media rules**

Add `image/webp` to `rules` with kind `image`, `IMAGE_MAX_BYTES`, extension `.webp`, and a signature that requires ASCII `RIFF` at bytes 0–3 plus `WEBP` at bytes 8–11. Add `image/webp` to `detectedMimeAliases`. The webhook normalizer limits stickers to that MIME, while `validateMedia` and `validateMediaFile` keep content-sniffing mandatory after download. Do not accept PNG/JPEG declared as a sticker.

- [ ] **Step 4: Add the compact sticker render branch**

```tsx
const mediaNames = {
  IMAGE: "imagem", AUDIO: "áudio", VIDEO: "vídeo",
  DOCUMENT: "documento", STICKER: "figurinha",
} as const;

if (message.type === "STICKER") {
  return <img alt="Figurinha" className="h-auto max-h-48 w-auto max-w-48 object-contain" src={source} />;
}
```

Use a native `img` intentionally so animated WEBP frames are not transformed. Keep recovery focus reconciliation, retry copy, and authenticated `/api/media/:id` URL unchanged.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/modules/media/validation.test.ts src/components/inbox/message-media.test.tsx`

Expected: PASS for static/animated-compatible rendering and all existing media recovery cases.

- [ ] **Step 6: Commit sticker support**

```powershell
git add src/modules/media/validation.ts src/modules/media/validation.test.ts src/components/inbox/message-media.tsx src/components/inbox/message-media.test.tsx
git commit -m "feat: display inbound WhatsApp stickers"
```

### Task 5: Render structured cards and conversation previews

**Files:**
- Create: `src/components/inbox/message-rich-content.tsx`
- Create: `src/components/inbox/message-rich-content.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/conversation-list.tsx`
- Modify: `src/components/inbox/conversation-list.test.tsx`

**Interfaces:**
- Consumes: `InboxMessage.content: MessageContent | null` and explicit message type.
- Produces: `MessageRichContent({ message }: { message: InboxMessage })` and `richMessagePreview(message: MessageDto): string | null`.

- [ ] **Step 1: Write failing accessible-card tests**

```tsx
it("renders location and a safe Maps link", () => {
  render(<MessageRichContent message={locationMessage} />);
  expect(screen.getByText("XP Eletrônicos")).toBeVisible();
  expect(screen.getByText("-15.793889, -47.882778")).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute(
    "href", "https://www.google.com/maps/search/?api=1&query=-15.793889%2C-47.882778",
  );
  expect(screen.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute("rel", "noopener noreferrer");
});

it("renders shared contacts without an import action", () => {
  render(<MessageRichContent message={contactsMessage} />);
  expect(screen.getByText("Maria Silva")).toBeVisible();
  expect(screen.getByText("+55 61 99999-0000")).toBeVisible();
  expect(screen.queryByRole("button", { name: /importar|salvar/i })).toBeNull();
});

it.each([
  [buttonMessage, "Resposta de botão", "Quero comprar"],
  [listMessage, "Resposta de lista", "Assistência técnica"],
  [orderMessage, "Pedido recebido", "2 produtos"],
  [systemMessage, "Atualização do WhatsApp", "Número alterado"],
  [unknownMessage, "Mensagem do tipo reação ainda não disponível", null],
])("renders safe rich content", (message, heading, text) => {
  render(<MessageRichContent message={message} />);
  expect(screen.getByText(heading)).toBeVisible();
  if (text) expect(screen.getByText(text)).toBeVisible();
  expect(screen.queryByText(/token|payload|filesystem/i)).toBeNull();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npm test -- src/components/inbox/message-rich-content.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-list.test.tsx`

Expected: FAIL because rich cards and previews do not exist.

- [ ] **Step 3: Implement small typed card renderers**

```tsx
export function MessageRichContent({ message }: { message: InboxMessage }) {
  const content = message.content;
  if (message.type === "LOCATION" && content?.kind === "location") return <LocationCard content={content} />;
  if (message.type === "CONTACTS" && content?.kind === "contacts") return <ContactsCard content={content} />;
  if (message.type === "INTERACTIVE" && content?.kind === "interactive") return <InteractiveCard content={content} />;
  if (message.type === "ORDER" && content?.kind === "order") return <OrderCard content={content} />;
  if (message.type === "SYSTEM" && content?.kind === "system") return <SystemCard content={content} />;
  if (message.type === "UNSUPPORTED" && content?.kind === "unknown") return <UnknownCard rawType={content.rawType} />;
  if (["LOCATION", "CONTACTS", "INTERACTIVE", "ORDER", "SYSTEM"].includes(message.type)) {
    return <p role="status">Conteúdo desta mensagem indisponível.</p>;
  }
  return null;
}
```

The location link must use `URLSearchParams({ api: "1", query: `${latitude},${longitude}` })`. Contact cards render at most the already-validated 20 contacts and show “Alguns contatos não foram exibidos” when `truncated` is true. Interactive IDs remain hidden.

- [ ] **Step 4: Route bubbles and list previews by explicit type**

```tsx
// message-bubble.tsx
<MessageMedia message={message} />
<MessageRichContent message={message} />

// conversation-list.tsx
const richPreview = {
  STICKER: "Figurinha", LOCATION: "Localização",
  CONTACTS: "Contato compartilhado", INTERACTIVE: "Resposta interativa",
  ORDER: "Pedido recebido", SYSTEM: "Atualização do WhatsApp",
} satisfies Partial<Record<LatestMessageType, string>>;
```

Prefer the interactive title as preview only after it has passed `parseMessageContent`; otherwise use “Resposta interativa”. Preserve current media pending/failed previews and body precedence for ordinary text/media captions.

- [ ] **Step 5: Run component tests and accessibility assertions**

Run: `npm test -- src/components/inbox/message-rich-content.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-list.test.tsx`

Expected: PASS with no overflow-prone raw payload text and 44px minimum touch target on the Maps action.

- [ ] **Step 6: Commit rich cards and previews**

```powershell
git add src/components/inbox/message-rich-content.tsx src/components/inbox/message-rich-content.test.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-list.tsx src/components/inbox/conversation-list.test.tsx
git commit -m "feat: render rich WhatsApp messages"
```

### Task 6: Full verification and production deployment

**Files:**
- Create: `docs/verification/2026-08-22-rich-inbound-messages.md`
- Modify only if a verified defect requires it: files owned by Tasks 1–5 and their tests.

**Interfaces:**
- Consumes: the complete release candidate from Tasks 1–5.
- Produces: verified production image, deployed additive migration, health evidence, and rollback reference.

- [ ] **Step 1: Run the complete local quality gate**

Run:

```powershell
npm run db:generate
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Expected: all commands exit 0; Vitest has no failing tests; production build succeeds; audit reports no production vulnerability requiring remediation.

- [ ] **Step 2: Verify compose and migration safety**

Run:

```powershell
./scripts/verify-compose.ps1
./scripts/test-deployment.ps1
docker compose -f deploy/kvm/docker-compose.yml config --quiet
```

Expected: all scripts exit 0 and Compose configuration is valid. Inspect the migration once more to confirm it has no drop, delete, or reset operation.

- [ ] **Step 3: Build the exact production candidate and record its identity**

Run the repository’s existing KVM build/deploy procedure using the current commit SHA as the immutable image tag. Before replacement, record the currently running image digest and database backup path in the verification document. Do not use `latest` as the only rollback reference.

Expected: candidate image builds successfully and the pre-deploy backup completes.

- [ ] **Step 4: Deploy the additive migration and candidate**

Use the existing KVM Compose deployment flow so the application entrypoint runs `prisma migrate deploy` before serving traffic. Replace only the WhatsApp application services; do not restart unrelated systems on the shared KVM.

Expected: migration `202608220001_rich_inbound_messages` is applied once, application and worker containers become healthy, and the public domain returns the authenticated application rather than a 404/502.

- [ ] **Step 5: Perform production smoke tests**

Verify in the authenticated production inbox:

1. Existing text, image, audio, video, document, labels, unread state, and Escape/mobile-back behavior still work.
2. Send one sticker, one location, one shared contact, one button/list reply when available, and confirm realtime appearance without refresh.
3. Sticker downloads through `/api/media/:id`, animates when animated, and remains protected from unauthenticated access.
4. Location opens the exact coordinates in Google Maps in a new tab.
5. Shared contact does not alter the conversation’s customer record.
6. Unknown sample shows safe copy and no provider payload.
7. Logs contain no token, raw contact card, raw location payload, or filesystem path.

Expected: every item passes; otherwise roll back to the recorded image digest while leaving the additive columns/enum values in place, then fix forward in a new commit.

- [ ] **Step 6: Record evidence and commit release verification**

Create the verification Markdown with values copied verbatim from `git rev-parse HEAD`, `docker image inspect`, the pre-deploy container inspection, `prisma migrate status`, and `Get-Date -Format o`. It must name migration `202608220001_rich_inbound_messages`, mark the automated gates and authenticated smoke tests PASS, and contain no example or placeholder values.

```powershell
git add docs/verification/2026-08-22-rich-inbound-messages.md
git commit -m "docs: verify rich inbound messages release"
```

Expected: the verification commit contains evidence only and production remains healthy.
