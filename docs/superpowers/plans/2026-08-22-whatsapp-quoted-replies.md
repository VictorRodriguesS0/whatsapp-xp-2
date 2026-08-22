# WhatsApp Quoted Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir respostas citadas persistentes e acessíveis para texto e todas as mídias já enviadas pelo sistema, além de receber e reconciliar citações vindas do cliente ou do aplicativo WhatsApp Business.

**Architecture:** Adicionar uma autorrelação opcional em `Message` e preservar separadamente o ID oficial da mensagem original. O servidor resolve e autoriza a referência, persiste-a antes da chamada externa e envia `context.message_id`; webhooks normais e ecos fazem a mesma resolução de forma transacional e reconciliam eventos fora de ordem. DTOs expõem apenas `canReply` e uma prévia segura, enquanto a interface mantém o rascunho local, o associa ao envio otimista e oferece botão, teclado e gesto móvel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL 18, Zod, Vitest/Testing Library, WhatsApp Cloud API Graph v23.0, Tailwind CSS, Docker/Compose, Caddy e KVM existente.

## Global Constraints

- Usar somente a WhatsApp Cloud API oficial; `context.message_id` fica no objeto raiz de payloads de texto e mídia.
- A interface envia somente `replyToMessageId` interno; IDs oficiais da Meta nunca são aceitos do navegador nem expostos em DTOs.
- `context.id` e IDs persistidos usam validação exata: 1 a 512 caracteres, sem trim, espaços ou controles Unicode U+0000–U+001F/U+007F–U+009F.
- Uma referência local só pode apontar para mensagem da mesma conversa e com ID oficial válido.
- Resposta citada não contorna janela de atendimento, templates, rate limits ou qualquer regra da Meta.
- Não registrar conteúdo, telefone, IDs oficiais, contexto bruto ou credenciais em logs/realtime.
- Eventos realtime continuam carregando somente tipos e IDs internos.
- O gesto móvel usa `touch-action: pan-y`, limiar horizontal de 56 px e cancela ao detectar deslocamento vertical dominante de 12 px.
- Todos os controles têm alvo mínimo de 44 px, foco visível e suporte a movimento reduzido.
- A migração é aditiva; rollback de aplicação não remove colunas nem reverte dados.
- Publicação recria somente `xp-whatsapp-app`; PostgreSQL, Caddy, redes, volumes, assinatura Meta e demais serviços permanecem intocados.

---

### Task 1: Persist reply references and expose a safe read contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608220003_quoted_replies/migration.sql`
- Create: `prisma/quoted-reply-contract.test.ts`
- Create: `src/modules/messages/reply-context.ts`
- Create: `src/modules/messages/reply-context.test.ts`
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/service.integration.test.ts`

**Interfaces:**
- Consumes: `Message`, `MessageContent`, `MessageDto`, `parseMessageContent` and the existing bounded public DTO pattern.
- Produces: `whatsappMessageIdSchema`, `QuotedReplyDto`, `quotedReplyPreview(source)`, `MessageDto.canReply` and `MessageDto.replyTo` for every later task.

- [ ] **Step 1: Write failing schema and migration contract tests**

Add assertions that the migration creates nullable columns, the self-FK and both indexes, keeps legacy rows null, rejects an invalid local UUID reference, allows several replies to one original and applies through the normal migration ledger.

```ts
expect(columns).toMatchObject({
  reply_to_message_id: { is_nullable: "YES", data_type: "uuid" },
  reply_to_whatsapp_message_id: { is_nullable: "YES", data_type: "text" },
});
expect(foreignKeys).toContainEqual({
  column_name: "reply_to_message_id",
  foreign_table_name: "messages",
  foreign_column_name: "id",
  delete_rule: "SET NULL",
});
expect(indexes).toEqual(expect.arrayContaining([
  "messages_reply_to_message_id_idx",
  "messages_reply_external_lookup_idx",
]));
```

- [ ] **Step 2: Run the database contract test to verify RED**

Run: `npm test -- prisma/quoted-reply-contract.test.ts`

Expected: FAIL because `reply_to_message_id` and `reply_to_whatsapp_message_id` do not exist.

- [ ] **Step 3: Add the additive migration and Prisma self-relation**

Create the migration with this exact SQL:

```sql
ALTER TABLE "messages"
  ADD COLUMN "reply_to_message_id" UUID,
  ADD COLUMN "reply_to_whatsapp_message_id" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_message_id_fkey"
  FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_reply_to_message_id_idx"
  ON "messages"("reply_to_message_id");

CREATE INDEX "messages_reply_external_lookup_idx"
  ON "messages"("conversation_id", "reply_to_whatsapp_message_id");
```

Add these fields and relation names to `Message`:

```prisma
replyToMessageId           String?   @map("reply_to_message_id") @db.Uuid
replyToWhatsappMessageId   String?   @map("reply_to_whatsapp_message_id")
replyToMessage             Message?  @relation("MessageReplies", fields: [replyToMessageId], references: [id], onDelete: SetNull)
replies                    Message[] @relation("MessageReplies")

@@index([replyToMessageId], map: "messages_reply_to_message_id_idx")
@@index([conversationId, replyToWhatsappMessageId], map: "messages_reply_external_lookup_idx")
```

- [ ] **Step 4: Run Prisma and migration checks to verify GREEN**

Run: `npm run db:validate && npm run db:generate && npm test -- prisma/quoted-reply-contract.test.ts prisma/temporal-contract.test.ts`

Expected: PASS; migration count advances once, the second `prisma migrate deploy` reports no pending migration, and legacy temporal contracts remain green.

- [ ] **Step 5: Write failing reply-context and DTO tests**

Cover exact IDs, every safe summary type, 160-character truncation, no HTML interpretation, `canReply` without exposing `whatsappMessageId`, available linked targets and unresolved external targets.

```ts
expect(whatsappMessageIdSchema.safeParse("wamid.reply-1").success).toBe(true);
expect(whatsappMessageIdSchema.safeParse(" wamid.reply-1").success).toBe(false);
expect(whatsappMessageIdSchema.safeParse("wamid.\u0000reply").success).toBe(false);
expect(quotedReplyPreview(textSource)).toMatchObject({
  available: true,
  messageId: textSource.id,
  summary: "Produto disponível amanhã",
});
expect(toConversationDetail(unresolvedRecord).messages[0].replyTo).toEqual({
  available: false,
});
expect(JSON.stringify(toConversationDetail(linkedRecord))).not.toContain("wamid.");
```

- [ ] **Step 6: Run the focused read-contract tests to verify RED**

Run: `npm test -- src/modules/messages/reply-context.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts`

Expected: FAIL because the parser, preview contract and nested selections do not exist.

- [ ] **Step 7: Implement the client-safe validator and preview builder**

Create `reply-context.ts` without `server-only` imports. Export these exact contracts:

```ts
import { z } from "zod";
import type { MessageDirection, MessageType } from "@/generated/prisma/enums";
import { parseMessageContent } from "@/modules/messages/content";

export const whatsappMessageIdSchema = z.string()
  .min(1)
  .max(512)
  .refine((value) => !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value));

export type QuotedReplyDto =
  | { available: false }
  | {
      available: true;
      messageId: string;
      direction: MessageDirection;
      type: MessageType;
      author: string;
      summary: string;
    };

export type QuotedReplySource = {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  body: string | null;
  content: unknown;
  sentBy: { name: string } | null;
  mediaOriginalFilename?: string | null;
};

export function quotedReplyPreview(source: QuotedReplySource): QuotedReplyDto {
  const content = parseMessageContent(source.content);
  const author = source.direction === "INBOUND" ? "Cliente" : source.sentBy?.name ?? "WhatsApp";
  const typeFallback: Record<string, string> = {
    IMAGE: "Imagem", VIDEO: "Vídeo", DOCUMENT: "Documento", AUDIO: "Áudio",
    STICKER: "Figurinha", LOCATION: "Localização", CONTACTS: "Contato",
    INTERACTIVE: "Resposta interativa", ORDER: "Pedido", SYSTEM: "Atualização do WhatsApp",
    UNSUPPORTED: "Mensagem",
  };
  const structured = content?.kind === "interactive" ? content.title
    : content?.kind === "location" ? content.name ?? content.address
    : content?.kind === "contacts" ? content.contacts[0]?.name
    : content?.kind === "system" ? content.text
    : null;
  const raw = source.body || structured || source.mediaOriginalFilename || typeFallback[source.type] || "Mensagem";
  const summary = raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
  return { available: true, messageId: source.id, direction: source.direction, type: source.type, author, summary };
}
```

- [ ] **Step 8: Extend conversation selects, records and DTOs**

Add `whatsappMessageId`, `replyToWhatsappMessageId` and one-level `replyToMessage` selection. Do not recursively select another quote.

```ts
const replyPreviewSelect = {
  id: true,
  direction: true,
  type: true,
  body: true,
  content: true,
  sentByUser: { select: userSelect },
  mediaObject: { select: { originalFilename: true } },
} as const;
```

Extend `MessageDto` exactly:

```ts
canReply: boolean;
replyTo: QuotedReplyDto | null;
```

Map it without returning either official ID:

```ts
canReply: whatsappMessageIdSchema.safeParse(message.whatsappMessageId).success,
replyTo: message.replyToMessage
  ? quotedReplyPreview({
      id: message.replyToMessage.id,
      direction: message.replyToMessage.direction,
      type: message.replyToMessage.type,
      body: message.replyToMessage.body,
      content: message.replyToMessage.content,
      sentBy: message.replyToMessage.sentByUser,
      mediaOriginalFilename: message.replyToMessage.mediaObject?.originalFilename ?? null,
    })
  : message.replyToWhatsappMessageId ? { available: false } : null,
```

- [ ] **Step 9: Run focused and affected read tests**

Run: `npm test -- prisma/quoted-reply-contract.test.ts src/modules/messages/reply-context.test.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts src/modules/conversations/repository.test.ts`

Expected: PASS with available/fallback previews, no recursive payload and no official ID in serialized DTOs.

- [ ] **Step 10: Commit Task 1**

```bash
git add prisma/schema.prisma prisma/migrations/202608220003_quoted_replies prisma/quoted-reply-contract.test.ts src/modules/messages/reply-context.ts src/modules/messages/reply-context.test.ts src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts
git commit -m "feat: persist quoted reply references"
```

---

### Task 2: Send the persisted context through text, media and recordings

**Files:**
- Create: `src/modules/messages/reply-linking.server.ts`
- Create: `src/modules/messages/reply-linking.integration.test.ts`
- Modify: `src/modules/whatsapp/provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.ts`
- Modify: `src/modules/whatsapp/meta-provider.test.ts`
- Modify: `src/modules/whatsapp/demo-provider.ts`
- Modify: `src/modules/messages/schemas.ts`
- Modify: `src/modules/messages/service.ts`
- Modify: `src/modules/messages/service.test.ts`
- Modify: `src/modules/messages/service.integration.test.ts`
- Modify: `src/app/api/conversations/[id]/messages/route.ts`
- Modify: `src/app/api/conversations/[id]/messages/route.test.ts`
- Modify: `src/app/api/conversations/[id]/recordings/route.ts`
- Modify: `src/app/api/conversations/[id]/recordings/route.test.ts`
- Modify: `src/app/api/conversations/[id]/recordings/route.integration.test.ts`

**Interfaces:**
- Consumes: `whatsappMessageIdSchema`, the Task 1 columns/DTOs and the existing idempotent delivery state machine.
- Produces: optional `replyToMessageId` on every outbound input; optional `contextMessageId` on provider methods; `resolveReplyTarget` and `reconcileReplyLinks` for Task 3.

- [ ] **Step 1: Write failing provider payload tests**

Assert root-level context for all current send types and exact omission for normal sends.

```ts
await provider.sendText({ to: "5561999999999", body: "Resposta", contextMessageId: "wamid.original-1" });
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
  messaging_product: "whatsapp",
  to: "5561999999999",
  context: { message_id: "wamid.original-1" },
  type: "text",
});
```

Repeat the assertion for `image`, `audio`, `video` and `document`, and assert `context` is absent when `contextMessageId` is undefined.

- [ ] **Step 2: Run provider tests to verify RED**

Run: `npm test -- src/modules/whatsapp/meta-provider.test.ts`

Expected: FAIL because provider inputs reject `contextMessageId` and payloads omit `context`.

- [ ] **Step 3: Extend provider contracts and payload construction**

Use one exact optional context shape in `provider.ts`:

```ts
export type ProviderReplyContext = { contextMessageId?: string };

sendText(input: { to: string; body: string } & ProviderReplyContext): Promise<SendResult>;
sendMedia(input: {
  to: string;
  type: MediaMessageType;
  mediaId: string;
  caption?: string;
  filename?: string;
} & ProviderReplyContext): Promise<SendResult>;
```

In `meta-provider.ts`, build the root fragment once for each send:

```ts
const context = input.contextMessageId
  ? { context: { message_id: input.contextMessageId } }
  : {};
return this.send({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: input.to,
  ...context,
  type: "text",
  text: { body: input.body, preview_url: false },
});
```

Apply the same root fragment to media. The demo provider accepts and ignores the optional field while preserving its deterministic result.

- [ ] **Step 4: Run provider tests to verify GREEN**

Run: `npm test -- src/modules/whatsapp/meta-provider.test.ts`

Expected: PASS for quoted and ordinary text/media payloads.

- [ ] **Step 5: Write failing service, API and database-linking tests**

Cover same-conversation authorization, target without valid official ID, target from another conversation, atomic pending fields, mismatch on repeated `clientRequestId`, context preserved across retry, and reconciliation when `markSent` assigns the original ID after a reply arrived first.

```ts
await expect(sendMessage(actor, conversation.id, {
  type: "TEXT",
  clientRequestId,
  body: "Sim",
  replyToMessageId: original.id,
}, dependencies)).resolves.toMatchObject({
  replyTo: { available: true, messageId: original.id },
});
expect(provider.sendText).toHaveBeenCalledWith({
  to: contact.phone,
  body: "Sim",
  contextMessageId: original.whatsappMessageId,
});
```

For idempotency, the second request uses the same `clientRequestId` with another original and expects HTTP 409 with zero additional provider calls.

- [ ] **Step 6: Run outbound tests to verify RED**

Run: `npm test -- src/modules/messages/reply-linking.integration.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/app/api/conversations/[id]/messages/route.test.ts src/app/api/conversations/[id]/recordings/route.test.ts`

Expected: FAIL because outbound schemas, repository records and routes do not carry the reference.

- [ ] **Step 7: Add shared server-side linking primitives**

Create a server-only module with these exact signatures:

```ts
export type ReplyLinkClient = Pick<Prisma.TransactionClient, "message">;

export async function resolveReplyTarget(
  client: ReplyLinkClient,
  conversationId: string,
  replyToMessageId: string,
): Promise<{ id: string; whatsappMessageId: string } | null>;

export async function reconcileReplyLinks(
  client: ReplyLinkClient,
  input: { conversationId: string; messageId: string; whatsappMessageId: string },
): Promise<number>;

export async function reconcileConversationReplyLinks(
  client: ReplyLinkClient,
  conversationId: string,
): Promise<number>;
```

`resolveReplyTarget` uses `findFirst({ where: { id, conversationId } })` and returns null unless `whatsappMessageIdSchema` accepts the stored ID. `reconcileReplyLinks` performs this same-conversation update:

```ts
const result = await client.message.updateMany({
  where: {
    conversationId: input.conversationId,
    replyToMessageId: null,
    replyToWhatsappMessageId: input.whatsappMessageId,
  },
  data: { replyToMessageId: input.messageId },
});
return result.count;
```

`reconcileConversationReplyLinks` loads only unresolved references from the conversation, discards any stored external value that fails `whatsappMessageIdSchema`, fetches matching originals with one same-conversation `findMany`, and calls `updateMany` once per distinct match. This is the conversation-scoped repair used after an identity-driven merge; it never links across conversations.

- [ ] **Step 8: Extend schemas, service records and pending creation**

Add to both outbound schemas:

```ts
replyToMessageId: messageUuidSchema.optional(),
```

Add nullable `replyToMessageId`, `replyToWhatsappMessageId` and a one-level target preview to `MessageServiceRecord`. Add `replyToMessageId: string | null` to `PendingMessageInput`.

Inside the existing serializable `createPending` transaction, resolve the target before `message.create`:

```ts
const replyTarget = input.replyToMessageId
  ? await resolveReplyTarget(transaction, input.conversationId, input.replyToMessageId)
  : null;
if (input.replyToMessageId && !replyTarget) {
  throw new HttpError(409, "Mensagem original indisponível para resposta");
}
```

Persist both values and compare the nullable local target inside `assertSameIdempotentOperation`. Delivery always reads `message.replyToWhatsappMessageId` from the stored record:

```ts
contextMessageId: message.replyToWhatsappMessageId ?? undefined,
```

Change `markSent` to a transaction that updates the new `whatsappMessageId`, then calls `reconcileReplyLinks` before hydrating the record. This covers out-of-order replies that referenced an API message still pending at webhook time.

- [ ] **Step 9: Extend JSON, multipart and recording routes**

JSON parsing inherits the schema field. Add the multipart field explicitly:

```ts
const fields = outboundMediaFieldsSchema.parse({
  type: form.fields.type,
  clientRequestId: form.fields.clientRequestId,
  body: form.fields.body || undefined,
  replyToMessageId: form.fields.replyToMessageId || undefined,
});
```

The recordings route validates `replyToMessageId` from multipart fields and passes it to `sendMessage`. Keep the existing bounded streaming parser, same-origin check, cleanup ownership and payload limits unchanged.

- [ ] **Step 10: Run focused outbound tests to verify GREEN**

Run: `npm test -- src/modules/messages/reply-linking.integration.test.ts src/modules/whatsapp/meta-provider.test.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/app/api/conversations/[id]/messages/route.test.ts src/app/api/conversations/[id]/recordings/route.test.ts src/app/api/conversations/[id]/recordings/route.integration.test.ts`

Expected: PASS; exactly one provider call per logical request and exact context retained on every retry.

- [ ] **Step 11: Commit Task 2**

```bash
git add src/modules/messages/reply-linking.server.ts src/modules/messages/reply-linking.integration.test.ts src/modules/whatsapp/provider.ts src/modules/whatsapp/meta-provider.ts src/modules/whatsapp/meta-provider.test.ts src/modules/whatsapp/demo-provider.ts src/modules/messages/schemas.ts src/modules/messages/service.ts src/modules/messages/service.test.ts src/modules/messages/service.integration.test.ts src/app/api/conversations/[id]/messages/route.ts src/app/api/conversations/[id]/messages/route.test.ts src/app/api/conversations/[id]/recordings/route.ts src/app/api/conversations/[id]/recordings/route.test.ts src/app/api/conversations/[id]/recordings/route.integration.test.ts
git commit -m "feat: send quoted WhatsApp replies"
```

---

### Task 3: Ingest inbound and WhatsApp Business App reply context

**Files:**
- Modify: `src/modules/webhooks/types.ts`
- Modify: `src/modules/webhooks/normalize.ts`
- Modify: `src/modules/webhooks/normalize.test.ts`
- Modify: `src/test/fixtures/meta-webhooks.ts`
- Modify: `src/modules/webhooks/process.ts`
- Modify: `src/modules/webhooks/process.test.ts`
- Modify: `src/modules/webhooks/process.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 columns/validator and Task 2 `resolveReplyTarget`/`reconcileReplyLinks`.
- Produces: `replyToWhatsappMessageId: string | null` on normal and echo events, with transactional local linking and out-of-order backfill.

- [ ] **Step 1: Write failing normalizer tests**

Add text, media, interactive and echo fixtures with:

```ts
context: {
  from: "5561999999999",
  id: "wamid.original-inbound-1",
},
```

Assert the event contains `replyToWhatsappMessageId: "wamid.original-inbound-1"`. Add absence and a forwarded-only context without `id` as null. Reject contexts whose explicit `id` is empty, longer than 512, contains whitespace/control, or whose `context` is not an object.

- [ ] **Step 2: Run normalizer tests to verify RED**

Run: `npm test -- src/modules/webhooks/normalize.test.ts`

Expected: FAIL because normalized events omit reply context and malformed contexts are not distinguished.

- [ ] **Step 3: Normalize context for messages and echoes**

Add this helper inside `normalize.ts`:

```ts
function replyContextId(message: UnknownRecord): string | null | undefined {
  if (!hasOwn(message, "context")) return null;
  const context = record(message.context);
  if (!context) return undefined;
  if (!hasOwn(context, "id")) return null;
  return exactIdentifier(context.id, 512) ?? undefined;
}
```

Call it before type-specific normalization. `undefined` rejects the whole candidate; `null` means no reply reference, including forwarded-only context. Add the resulting nullable field to `NormalizedMessageEvent` and `NormalizedMessageEchoEvent`. Control events keep their existing separate original-message contract.

- [ ] **Step 4: Run normalizer tests to verify GREEN**

Run: `npm test -- src/modules/webhooks/normalize.test.ts src/app/api/webhooks/meta/route.test.ts`

Expected: PASS with signed route behavior unchanged.

- [ ] **Step 5: Write failing processor unit and PostgreSQL tests**

Cover original-first, reply-first, unknown original, a reply in another conversation that references an ID existing only in the first conversation, duplicate webhook, API/echo overlap and conversation merge.

```ts
await processWebhookEvents([replyEvent], dependencies);
expect(await prisma.message.findUnique({
  where: { whatsappMessageId: replyEvent.whatsappMessageId },
  select: { replyToMessageId: true, replyToWhatsappMessageId: true },
})).toEqual({
  replyToMessageId: original.id,
  replyToWhatsappMessageId: original.whatsappMessageId,
});
```

For reply-first, assert local ID is initially null, insert the original, and assert it becomes the original UUID inside the later transaction.

- [ ] **Step 6: Run processor tests to verify RED**

Run: `npm test -- src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts`

Expected: FAIL because repository `createMessage` cannot receive or reconcile a reply reference.

- [ ] **Step 7: Persist and reconcile reply context transactionally**

Extend `WebhookRepository.createMessage` input with `replyToWhatsappMessageId: string | null`. In the Prisma implementation:

1. resolve the target by `whatsappMessageId` and `conversationId`;
2. create the new message with the external ID and nullable local ID;
3. call `reconcileReplyLinks` using the new message's own `whatsappMessageId`;
4. return only internal IDs.

Use this exact same-conversation lookup:

```ts
const replyTarget = input.replyToWhatsappMessageId
  ? await client.message.findFirst({
      where: {
        conversationId: input.conversationId,
        whatsappMessageId: input.replyToWhatsappMessageId,
      },
      select: { id: true },
    })
  : null;
```

Pass the normalized field from both `processMessage` and `processMessageEcho`. Existing API-created messages remain authoritative on duplicate echoes; do not overwrite their stored relation. Immediately after `mergeConversations` moves source messages into the canonical conversation, call `reconcileConversationReplyLinks` inside the same serializable transaction so references that only became resolvable through the merge converge before response state is refreshed.

- [ ] **Step 8: Run webhook and merge regressions to verify GREEN**

Run: `npm test -- src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts src/app/api/webhooks/meta/route.test.ts prisma/whatsapp-echo-identity-contract.test.ts`

Expected: PASS with out-of-order convergence, one row per `wamid`, and no cross-conversation link.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/modules/webhooks/types.ts src/modules/webhooks/normalize.ts src/modules/webhooks/normalize.test.ts src/test/fixtures/meta-webhooks.ts src/modules/webhooks/process.ts src/modules/webhooks/process.test.ts src/modules/webhooks/process.integration.test.ts
git commit -m "feat: ingest WhatsApp reply context"
```

---

### Task 4: Carry reply context through optimistic inbox state

**Files:**
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes: `MessageDto.canReply`, `MessageDto.replyTo`, `quotedReplyPreview` and the outbound API contract from Tasks 1–2.
- Produces: `sendText`, `sendMedia` and `sendRecording` with an optional local target ID while preserving the same target in pending aliases and retries.

- [ ] **Step 1: Write failing hook tests**

Cover text JSON, attachment multipart, recording multipart, optimistic preview, server confirmation, failure, retry, conversation switch and stale response isolation.

```ts
await result.current.sendText(conversationId, "Resposta", original.id);
expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
  type: "TEXT",
  body: "Resposta",
  replyToMessageId: original.id,
});
expect(result.current.conversation?.messages.at(-1)?.replyTo).toMatchObject({
  available: true,
  messageId: original.id,
});
```

Assert a target with `canReply: false` produces no fetch and no optimistic row.

- [ ] **Step 2: Run hook tests to verify RED**

Run: `npm test -- src/hooks/use-inbox.test.tsx`

Expected: FAIL because pending sends and public send methods do not accept a target.

- [ ] **Step 3: Add reply identity to pending sends**

Add a shared base:

```ts
type PendingReply = {
  replyToMessageId: string | null;
  replyTo: QuotedReplyDto | null;
};

type PendingText = PendingReply & {
  kind: "text";
  conversationId: string;
  clientRequestId: string;
  body: string;
};
```

Apply `PendingReply` to media as well. Resolve a target only from the authoritative currently selected conversation:

```ts
function pendingReply(conversation: InboxConversation | null, id?: string | null): PendingReply | null {
  if (!id) return { replyToMessageId: null, replyTo: null };
  const target = conversation?.messages.find((message) => message.id === id);
  if (!target?.canReply) return null;
  return { replyToMessageId: target.id, replyTo: quotedReplyPreview(target) };
}
```

The optimistic row has `canReply: false` and copies `pending.replyTo`. Confirmation replaces it with the server DTO.

- [ ] **Step 4: Send the reference through every request type**

Change public signatures to:

```ts
sendText(conversationId: string, body: string, replyToMessageId?: string | null): Promise<InboxMessage | null>;
sendMedia(conversationId: string, file: File, caption: string, replyToMessageId?: string | null): Promise<InboxMessage | null>;
sendRecording(conversationId: string, file: File, clientRequestId: string, replyToMessageId?: string | null): Promise<InboxMessage | null>;
```

JSON includes the field only when non-null. Multipart uses:

```ts
if (pending.replyToMessageId) form.set("replyToMessageId", pending.replyToMessageId);
```

Retained pending aliases continue to own the original `PendingSend`, so retry cannot change the quote. Confirmed-send caching remains keyed only by `clientRequestId` after the server has enforced context equality.

- [ ] **Step 5: Run hook and reconciliation tests to verify GREEN**

Run: `npm test -- src/hooks/use-inbox.test.tsx src/hooks/use-realtime.test.ts`

Expected: PASS with the same quote before/after confirmation, failure, retry and realtime refresh.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx
git commit -m "feat: reconcile quoted reply drafts"
```

---

### Task 5: Build accessible desktop and mobile reply interactions

**Files:**
- Create: `src/components/inbox/quoted-reply-preview.tsx`
- Create: `src/components/inbox/quoted-reply-preview.test.tsx`
- Create: `src/hooks/use-message-reply-gesture.ts`
- Create: `src/hooks/use-message-reply-gesture.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-bubble.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- Consumes: Task 4 send methods and Task 1 `QuotedReplyDto`.
- Produces: `QuotedReplyPreview`, accessible reply actions, 56 px swipe behavior, composer draft banner, original-message navigation and exact Escape priority.

- [ ] **Step 1: Write failing preview, gesture and bubble tests**

Assert available/fallback rendering, author/summary, no action on fallback, accessible button, keyboard focus, horizontal success at 56 px, no success at 55 px, vertical cancellation at 12 px and no interference with media/audio controls.

```tsx
render(<QuotedReplyPreview onNavigate={navigate} reply={{
  available: true,
  messageId: "11111111-1111-4111-8111-111111111111",
  direction: "INBOUND",
  type: "TEXT",
  author: "Cliente",
  summary: "Tem esse produto?",
}} />);
await user.click(screen.getByRole("button", { name: "Ir para mensagem original" }));
expect(navigate).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
```

- [ ] **Step 2: Run component/gesture tests to verify RED**

Run: `npm test -- src/components/inbox/quoted-reply-preview.test.tsx src/hooks/use-message-reply-gesture.test.tsx src/components/inbox/message-bubble.test.tsx`

Expected: FAIL because the components and gesture hook do not exist.

- [ ] **Step 3: Implement the bounded preview component**

`QuotedReplyPreview` receives:

```ts
type QuotedReplyPreviewProps = {
  reply: QuotedReplyDto;
  onNavigate?: (messageId: string) => void;
  onCancel?: () => void;
  compact?: boolean;
};
```

Render text only. Available replies use a button only when `onNavigate` exists; unavailable replies render `Mensagem original indisponível`. The cancel control is a separate 44 px button labelled `Cancelar resposta citada`.

- [ ] **Step 4: Implement the mobile gesture hook**

Export constants and a stable binding:

```ts
export const REPLY_SWIPE_THRESHOLD_PX = 56;
export const REPLY_SWIPE_VERTICAL_ABORT_PX = 12;

export function useMessageReplyGesture(enabled: boolean, onReply: () => void): {
  offset: number;
  handlers: Pick<import("react").HTMLAttributes<HTMLElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;
};
```

Track one primary touch/pen pointer. Cancel when vertical displacement is at least 12 px and dominates horizontal movement. Clamp positive horizontal offset to 72 px. Call `onReply` only at 56 px or more, then reset. Never activate for mouse; desktop uses the button.

Do not begin tracking when `event.target.closest('button, a, input, textarea, select, audio, video, [role="button"], [data-reply-swipe-ignore="true"]')` matches. Capture the accepted pointer on down and release it on up/cancel so playback, media expansion and composer controls retain their native gestures.

- [ ] **Step 5: Add reply action and quote rendering to each bubble**

Extend props:

```ts
type MessageBubbleProps = {
  message: InboxMessage;
  highlighted?: boolean;
  onReply?: (message: InboxMessage) => void;
  onNavigateReply?: (messageId: string) => void;
  onRetry?: (id: string) => void;
  registerElement?: (messageId: string, element: HTMLElement | null) => void;
};
```

The article uses `touch-action: pan-y`, gesture transform only while dragging, `tabIndex={-1}`, a reply button labelled `Responder à mensagem`, the quote before media/content/body and `data-highlighted` for the reduced-motion-safe highlight.

- [ ] **Step 6: Write failing composer, conversation and shell tests**

Cover the draft banner during idle/file/recording states, cancel button, send callback target, conversation change, click-to-original, focus/highlight timeout, fallback, overlays, quick-reply menu and Escape order.

```ts
fireEvent.keyDown(window, { key: "Escape" });
expect(screen.queryByText("Tem esse produto?")).not.toBeInTheDocument();
expect(screen.getByRole("heading", { name: contactName })).toBeVisible();
fireEvent.keyDown(window, { key: "Escape" });
expect(screen.queryByRole("heading", { name: contactName })).not.toBeInTheDocument();
```

- [ ] **Step 7: Run higher-level UI tests to verify RED**

Run: `npm test -- src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx`

Expected: FAIL because reply draft state and Escape priority are absent.

- [ ] **Step 8: Lift draft selection into InboxShell and wire sends**

Store `replyToMessageId: string | null` in `InboxShell`, derive the message from the selected conversation and clear it on thread close or conversation change. Pass it through `ConversationView` and the Task 4 methods.

The global Escape handler keeps this exact order:

```ts
if (hasOpenDismissibleOverlay()) return;
if (replyToMessageIdRef.current) {
  event.preventDefault();
  setReplyToMessageId(null);
  return;
}
event.preventDefault();
closeThreadLocally();
```

Starting a send captures the current ID, clears the draft immediately after the optimistic method is invoked, and leaves the quote owned by the pending message.

- [ ] **Step 9: Add navigation and highlighting in ConversationView**

Maintain a map of internal message IDs to article elements. On quote click, call `scrollIntoView` with `behavior: "auto"` under reduced motion and `"smooth"` otherwise, focus the article and set its highlighted ID. Clear the highlight after 1,500 ms and on conversation change/unmount.

Pass the selected available preview to `MessageComposer` in every recorder phase. Its `Escape` handler cancels quick replies first, then the quoted-reply draft, and calls `stopPropagation`/`preventDefault` for the handled layer.

- [ ] **Step 10: Run the complete UI slice to verify GREEN**

Run: `npm test -- src/components/inbox/quoted-reply-preview.test.tsx src/hooks/use-message-reply-gesture.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx src/hooks/use-inbox.test.tsx src/hooks/use-mobile-inbox-history.test.tsx`

Expected: PASS with no `act` warnings, no target below 44 px and no stale quote after navigation.

- [ ] **Step 11: Commit Task 5**

```bash
git add src/components/inbox/quoted-reply-preview.tsx src/components/inbox/quoted-reply-preview.test.tsx src/hooks/use-message-reply-gesture.ts src/hooks/use-message-reply-gesture.test.tsx src/components/inbox/message-bubble.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: add quoted reply interactions"
```

---

### Task 6: Verify the full slice and deploy app-only

**Files:**
- Modify: `README.md`
- Modify: `.superpowers/sdd/progress.md`
- Create: `.superpowers/sdd/quoted-replies-release-report.md`
- Verify: `deploy/kvm/docker-compose.yml`
- Verify: `scripts/backup.sh`
- Verify: `scripts/verify-kvm-deployment.ps1`

**Interfaces:**
- Consumes: Tasks 1–5 as one user-visible vertical slice and the existing immutable KVM release process.
- Produces: reviewed commits, immutable Linux image, validated backup, app-only production rollout, real Meta acceptance and documented rollback.

- [ ] **Step 1: Document operation and rollback**

Add to `README.md`:

- quoted replies use the existing `messages` and `smb_message_echoes` subscriptions;
- no Meta subscription update is required;
- free-form replies still require the current customer-service window;
- unavailable originals remain visible as fallback;
- rollback is app-only and the additive migration stays applied.

- [ ] **Step 2: Run focused PostgreSQL tests twice**

Run the schema, outbound and webhook integration set twice against the dedicated PostgreSQL 18 test database:

```bash
npm test -- prisma/quoted-reply-contract.test.ts src/modules/messages/reply-linking.integration.test.ts src/modules/messages/service.integration.test.ts src/modules/webhooks/process.integration.test.ts
npm test -- prisma/quoted-reply-contract.test.ts src/modules/messages/reply-linking.integration.test.ts src/modules/messages/service.integration.test.ts src/modules/webhooks/process.integration.test.ts
```

Expected: both runs PASS with identical row counts, no unresolved synthetic references after original arrival and no duplicate provider call.

- [ ] **Step 3: Run complete release gates**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm audit --omit=dev --audit-level=high
powershell -ExecutionPolicy Bypass -File scripts/verify-kvm-deployment.ps1
git diff --check
```

Expected: all tracked tests pass with only documented opt-in skips; lint/typecheck/build/Prisma/audit/deployment/diff checks exit zero.

- [ ] **Step 4: Review the complete change**

Run `superpowers:requesting-code-review` over the spec, plan and full diff from the design base. Resolve every Critical/Major finding through a new RED→GREEN test and commit. Re-run Step 3 after any code change.

- [ ] **Step 5: Build and inspect the exact immutable Linux image**

Create an LF-only Git archive from the clean code commit, set `REVISION` to that full 40-character commit hash, build `xp-whatsapp:$REVISION`, and verify:

- Linux/amd64;
- revision label equals the full commit;
- runtime container user resolves to UID/GID `1001:1001` through Compose;
- healthcheck, FFmpeg and FFprobe present;
- migration `202608220003_quoted_replies` present;
- no application `.env`, test or spec files in runtime layers;
- standalone startup and `/api/health` return 200.

Run the real Linux recording conversion/delivery/persistence/cleanup integration against the dedicated database before accepting the image.

- [ ] **Step 6: Perform local browser acceptance on the immutable image**

At desktop and 390×844 mobile sizes, verify:

1. reply button by mouse and keyboard;
2. mobile swipe at/under threshold and vertical-scroll cancellation;
3. composer banner for text, file and recorded audio;
4. first Escape cancels quote, second closes thread;
5. optimistic quote, server confirmation, forced failure and retry;
6. click-to-original focus/highlight and unavailable fallback;
7. two authenticated tabs reconcile the sent quote without reload;
8. no overflow, console error, leaked object URL or control below 44 px.

- [ ] **Step 7: Run production read-only preflight and validated backup**

Record without exposing secrets/PII:

- exact app image/revision/health/restarts/user/networks;
- exact PostgreSQL container ID, start time, health and migration aggregate;
- deterministic hash/count of every non-app container;
- local/public health, login, privacy, deletion and protected routes;
- invalid webhook signature returns 401;
- Meta readback remains one active object, unique current fields, one callback and one `smb_message_echoes`.

Run `scripts/backup.sh` with the canonical production env file. Validate five restricted artifacts, sidecar hashes, PostgreSQL custom dump and media archive before deployment.

- [ ] **Step 8: Deploy only the application with automatic rollback**

Transfer the verified Git archive and image, validate resolved Compose services exactly `app,database` and app networks exactly `shared_gateway,xp_whatsapp_egress,xp_whatsapp_internal`, then run:

```bash
XP_WHATSAPP_IMAGE="xp-whatsapp:$REVISION" docker compose \
  --project-directory "$RELEASE" \
  --env-file /opt/apps/example-app/.env.production \
  -f "$RELEASE/deploy/kvm/docker-compose.yml" \
  up -d --no-deps --force-recreate --wait app
```

If image, revision, migration, health, public endpoints, database identity or non-app snapshot diverges, recreate only `app` with the recorded previous image/release and verify rollback health.

- [ ] **Step 9: Run production soak and controlled Meta acceptance**

Require three consecutive samples of `local 200 | public 200 | healthy | restart 0`, zero new error/5xx markers and unchanged Meta/non-app snapshots.

Then perform two controlled, content-sanitized tests:

1. from the central, reply with text to a known inbound message and confirm the receiving WhatsApp shows the official quote exactly once and the central keeps it after reload;
2. from the WhatsApp Business app, reply to a known message and confirm one echo/inbound row, correct local quote, no duplicate, correct conversation/activity/awaiting state and no false internal actor.

Record only aggregate counts, internal test UUIDs and hashes in the protected operational evidence; do not record phone, message content or official IDs in Git.

- [ ] **Step 10: Record the release and commit documentation**

Write `.superpowers/sdd/quoted-replies-release-report.md` with test totals, image/archive hashes, backup path, deployment time, sanitized invariants, acceptance result and exact app-only rollback. Update `.superpowers/sdd/progress.md` and commit:

```bash
git add README.md .superpowers/sdd/progress.md
git add -f .superpowers/sdd/quoted-replies-release-report.md
git commit -m "docs: record quoted replies deployment"
```

- [ ] **Step 11: Final verification**

Run a fresh `npm test`, `git diff --check`, `git status --short`, public health, runtime digest/revision, restart count, PostgreSQL identity and post-deploy log check. Expected: clean worktree, all tests green, exact candidate healthy with zero restarts, database unchanged and no post-deploy error/5xx marker.
