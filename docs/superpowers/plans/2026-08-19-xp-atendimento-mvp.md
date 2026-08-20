# XP Atendimento MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma central interna multiusuário conectada exclusivamente à WhatsApp Cloud API oficial, executável em demonstração e implantável de forma isolada na KVM da XP Eletrônicos.

**Architecture:** Monólito modular em Next.js 16 com Route Handlers, PostgreSQL 18 e Prisma 7. A aplicação usa sessões opacas persistidas, SSE em uma única instância, armazenamento local de mídia por abstração e provedores separados para demonstração e Meta.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, Prisma 7.9.1, PostgreSQL 18, Vitest 4.1.11, Zod 4.4.3, Docker Compose e Nginx.

## Global Constraints

- Usar somente WhatsApp Business Platform / Cloud API oficial da Meta.
- Executar em Node.js 22 ou superior, com módulos ESM e TypeScript estrito.
- Manter todos os usuários ativos com acesso a todas as conversas; responsável nunca filtra autorização.
- Persistir leitura por par `(conversation_id, user_id)`.
- Manter tokens Meta, App Secret, cookie e senhas exclusivamente no servidor.
- Usar PostgreSQL em container separado e mídia em volume persistente separado.
- Publicar a aplicação somente em `127.0.0.1:3100` na KVM.
- Não alterar processos, containers, diretórios ou banco de `xpeletronicos.com`.
- Manter `META_GRAPH_API_VERSION=v23.0` configurável por ambiente.
- Tratar texto, imagem, áudio, vídeo e documento nos dois sentidos.
- Não implementar presença, digitação, templates, CRM, catálogo, automação, IA ou distribuição de leads.

---

## File Map

### Configuration and deployment

- `package.json`: dependências e comandos de desenvolvimento, banco, testes e build.
- `tsconfig.json`: TypeScript estrito e alias `@/*`.
- `next.config.ts`: build standalone, limites e headers da aplicação.
- `eslint.config.mjs`: regras Next.js e TypeScript.
- `postcss.config.mjs`: plugin Tailwind 4.
- `vitest.config.ts`, `vitest.setup.ts`: testes Node e componentes.
- `prisma.config.ts`: schema, migration e seed do Prisma 7.
- `.env.example`: contrato completo de configuração sem credenciais.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`: imagens e serviços isolados.
- `deploy/nginx/whatsapp.xpeletronicos.com.conf`: proxy, SSE, uploads e HTTPS.
- `README.md`: desenvolvimento, Meta, produção, backup, atualização e diagnóstico.

### Database and shared server code

- `prisma/schema.prisma`: enums, tabelas, relações e índices.
- `prisma/migrations/*/migration.sql`: migration inicial versionada.
- `prisma/seed.ts`: usuários, contatos, conversas, leituras e mensagens demo.
- `src/generated/prisma/*`: cliente gerado pelo Prisma.
- `src/lib/env.ts`: leitura e validação de ambiente.
- `src/lib/db.ts`: singleton Prisma com `PrismaPg`.
- `src/lib/http.ts`: respostas, erros e proteção de origem.
- `src/lib/logger.ts`: logs JSON com redação de segredos.
- `src/lib/utils.ts`: classes CSS, datas e helpers sem regra de negócio.

### Domain modules

- `src/modules/auth/password.ts`: hash `scrypt` versionado.
- `src/modules/auth/session.ts`: criação, leitura e revogação de sessão.
- `src/modules/auth/guards.ts`: usuário obrigatório e perfil administrador.
- `src/modules/auth/rate-limit.ts`: limite em memória para uma instância.
- `src/modules/users/service.ts`, `schemas.ts`: gestão de usuários.
- `src/modules/conversations/service.ts`, `schemas.ts`, `types.ts`: busca, lista, histórico, leitura e responsável.
- `src/modules/messages/service.ts`, `status.ts`, `schemas.ts`: envio, retry e estados.
- `src/modules/media/storage.ts`, `local-storage.ts`, `validation.ts`, `service.ts`: mídia persistente.
- `src/modules/whatsapp/provider.ts`, `demo-provider.ts`, `meta-provider.ts`, `factory.ts`: integração intercambiável.
- `src/modules/webhooks/signature.ts`, `normalize.ts`, `process.ts`, `types.ts`: entrada Meta.
- `src/modules/realtime/hub.ts`, `events.ts`: publicação SSE.

### HTTP and interface

- `src/app/layout.tsx`, `globals.css`, `page.tsx`: raiz e tokens visuais.
- `src/app/login/page.tsx`: autenticação.
- `src/app/conversas/page.tsx`: carregamento autenticado da central.
- `src/app/configuracoes/usuarios/page.tsx`: carregamento autenticado da gestão.
- `src/app/api/**/route.ts`: adaptadores HTTP finos para os serviços.
- `src/components/ui/*`: Button, Input, Avatar, Badge, Spinner, Dialog e Select acessíveis.
- `src/components/auth/login-form.tsx`: estado do login.
- `src/components/inbox/*`: shell, lista, conversa, bolhas, compositor, mídia e detalhes.
- `src/components/users/*`: tabela e formulário de usuário.
- `src/hooks/use-inbox.ts`, `use-realtime.ts`: estado do cliente, fetch e reconexão.

---

### Task 1: Bootstrap executável e contrato de configuração

**Files:**
- Create: `package.json`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`
- Create: `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`
- Create: `.gitignore`, `.env.example`, `src/lib/env.ts`, `src/lib/utils.ts`, `src/lib/logger.ts`
- Test: `src/lib/env.test.ts`, `src/lib/utils.test.ts`

**Interfaces:**
- Produces: `parseServerEnv(input): ServerEnv`, `getServerEnv(): ServerEnv`, `cn(...inputs: ClassValue[]): string`.
- `ServerEnv` contains database, app, auth, provider, Meta and media settings used by every later task.

- [ ] **Step 1: Write configuration tests**

```ts
it("accepts demo mode without Meta credentials", () => {
  expect(parseServerEnv(validBase)).toMatchObject({ WHATSAPP_PROVIDER: "demo" });
});

it("requires every Meta credential in meta mode", () => {
  expect(() => parseServerEnv({ ...validBase, WHATSAPP_PROVIDER: "meta" }))
    .toThrow(/META_APP_SECRET/);
});
```

- [ ] **Step 2: Run tests and observe the missing module failure**

Run: `npm install && npm test -- src/lib/env.test.ts src/lib/utils.test.ts`

Expected: FAIL because `src/lib/env.ts` and `src/lib/utils.ts` do not exist.

- [ ] **Step 3: Create the project configuration and environment parser**

Use exact runtime dependencies from the header plus `@prisma/adapter-pg`, `pg`, `lucide-react`, `date-fns`, `clsx`, `tailwind-merge`, `class-variance-authority` and `dotenv`. Use ESLint, Prisma CLI, Testing Library, jsdom and type packages as development dependencies.

```ts
const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_NAME: z.string().default("XP Atendimento"),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  WHATSAPP_PROVIDER: z.enum(["demo", "meta"]).default("demo"),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  MEDIA_ROOT: z.string().default("./data/media"),
});
```

Add a `superRefine` requiring all six Meta values only in `meta` mode. Export `parseServerEnv` for tests and memoized `getServerEnv` for runtime.

Create `logger.info|warn|error(event, fields)` that writes one JSON object per line, redacts keys matching `password|token|secret|cookie|authorization`, and never accepts message bodies or binary data as default fields.

- [ ] **Step 4: Add the minimal root application**

```tsx
export default function RootPage() {
  redirect("/conversas");
}
```

Create `src/app/layout.tsx` with Portuguese metadata and `src/app/globals.css` importing Tailwind.

- [ ] **Step 5: Verify the bootstrap**

Run: `npm test -- src/lib/env.test.ts src/lib/utils.test.ts && npm run lint && npm run typecheck`

Expected: all tests pass and both static checks exit `0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts eslint.config.mjs postcss.config.mjs vitest.config.ts vitest.setup.ts .gitignore .env.example src
git commit -m "chore: bootstrap XP Atendimento application"
```

### Task 2: PostgreSQL schema, Prisma client and demonstration seed

**Files:**
- Create: `prisma.config.ts`, `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `prisma/migrations/202608190001_init/migration.sql`
- Create: `src/lib/db.ts`
- Create: `src/app/api/health/route.ts`
- Create: `src/modules/auth/password.ts`
- Test: `src/lib/db.test.ts`, `src/test/database.ts`, `src/modules/auth/password.test.ts`

**Interfaces:**
- Produces: `prisma: PrismaClient`, `resetTestDatabase(): Promise<void>`.
- Produces for tests: `seedReadFixture(): Promise<{ conversation: Conversation; victor: User; marcos: User }>`.
- Produces: `hashPassword(password): Promise<string>`, `verifyPassword(password, encoded): Promise<boolean>`.
- Produces enums `UserRole`, `MessageDirection`, `MessageType`, `MessageStatus`, `MediaStatus`, `WebhookStatus`.

- [ ] **Step 1: Write password and database integration tests**

```ts
it("rejects a changed password", async () => {
  const encoded = await hashPassword("Senha-Demo-2026!");
  expect(await verifyPassword("outra", encoded)).toBe(false);
});

it("keeps one independent read state per user", async () => {
  const { conversation, victor, marcos } = await seedReadFixture();
  await prisma.conversationRead.createMany({ data: [
    { conversationId: conversation.id, userId: victor.id, lastReadAt: new Date(1) },
    { conversationId: conversation.id, userId: marcos.id, lastReadAt: new Date(2) },
  ]});
  expect(await prisma.conversationRead.count({ where: { conversationId: conversation.id } })).toBe(2);
});
```

- [ ] **Step 2: Run the database test and confirm schema absence**

Run: `npm run test:db -- src/lib/db.test.ts`

Expected: FAIL because the password module, Prisma schema and generated client do not exist.

- [ ] **Step 3: Implement versioned `scrypt` password storage**

Use format `scrypt$v1$N$r$p$salt$key`, random 16-byte salt, `timingSafeEqual`, a minimum password length of 10 and no password logging.

```ts
const key = await scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
```

- [ ] **Step 4: Define all enums and models from the approved design**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db { provider = "postgresql" }

model ConversationRead {
  id                String   @id @default(uuid()) @db.Uuid
  conversationId    String   @map("conversation_id") @db.Uuid
  userId            String   @map("user_id") @db.Uuid
  lastReadMessageId String?  @map("last_read_message_id") @db.Uuid
  lastReadAt        DateTime @map("last_read_at")
  conversation      Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user              User @relation(fields: [userId], references: [id], onDelete: Restrict)
  lastReadMessage   Message? @relation("LastReadMessage", fields: [lastReadMessageId], references: [id], onDelete: SetNull)
  @@unique([conversationId, userId])
  @@map("conversation_reads")
}
```

Implement every field, relation, unique key and index from the design, including `clientRequestId`, `webhook_events` and `media_objects`.

- [ ] **Step 5: Configure Prisma 7 and the PostgreSQL adapter**

```ts
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: env("DATABASE_URL") },
});
```

Create a development-safe singleton with `new PrismaPg({ connectionString })` and `new PrismaClient({ adapter })`.

Add a health route that executes `SELECT 1`, returning `200 { status: "ok" }` or `503 { status: "unavailable" }` without database or environment details.

- [ ] **Step 6: Create and inspect the initial migration**

Run: `npm run db:generate && npm run db:migrate -- --name init`

Expected: Prisma generates the client and one migration containing all eight tables and their indexes.

- [ ] **Step 7: Implement the idempotent seed**

Seed Victor as `ADMIN`, Marcos and João as `ATTENDANT`, with a documented development password hashed through the production password helper. Add Carlos, Maria and Pedro, realistic electronics conversations, assignments, media examples and different read positions.

- [ ] **Step 8: Re-run database verification**

Run: `npm run db:seed && npm run test:db -- src/lib/db.test.ts && npm run db:validate`

Expected: seed can run twice, the test passes and Prisma validates the schema.

- [ ] **Step 9: Commit**

```bash
git add prisma prisma.config.ts src/generated src/lib/db.ts src/lib/db.test.ts src/test src/modules/auth/password.ts src/modules/auth/password.test.ts package.json package-lock.json
git commit -m "feat: add PostgreSQL schema and demo data"
```

### Task 3: Authentication, sessions and server authorization

**Files:**
- Create: `src/modules/auth/session.ts`, `guards.ts`, `rate-limit.ts`
- Create: `src/lib/http.ts`
- Create: `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `src/modules/auth/session.test.ts`, `guards.test.ts`

**Interfaces:**
- Consumes: `hashPassword` and `verifyPassword` from Task 2.
- Produces: `createSession(userId): Promise<string>`, `getCurrentUser(): Promise<SessionUser | null>`, `revokeCurrentSession(): Promise<void>`.
- Produces: `requireUser()`, `requireAdmin()`, `assertSameOrigin(request)`.

- [ ] **Step 1: Write failing session and authorization tests**

```ts
it("rejects an inactive user even with a valid session", async () => {
  sessionRepo.findByTokenHash.mockResolvedValue({ user: { active: false } });
  await expect(resolveSession("cookie-token", sessionRepo)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run auth tests and confirm failure**

Run: `npm test -- src/modules/auth`

Expected: FAIL because auth functions do not exist.

- [ ] **Step 3: Implement opaque database sessions**

Generate 32 random bytes, store `HMAC-SHA256(AUTH_SECRET, token)`, and return only the raw token in cookie `xp_atendimento_session`. Set `HttpOnly`, `SameSite=Lax`, `Path=/`, seven-day expiry and `Secure` outside development.

- [ ] **Step 4: Implement guards, origin checking and login rate limit**

`requireAdmin` must throw `403` for attendants. `assertSameOrigin` compares the request Origin with `NEXT_PUBLIC_APP_URL`. The rate limiter allows five failed attempts per email/IP in 15 minutes and resets after a successful login.

- [ ] **Step 5: Add thin login/logout handlers**

```ts
export async function POST(request: Request) {
  assertSameOrigin(request);
  const input = loginSchema.parse(await request.json());
  const user = await authenticate(input);
  const token = await createSession(user.id);
  return sessionCookieResponse({ user: toSessionUser(user) }, token);
}
```

- [ ] **Step 6: Verify auth behavior**

Run: `npm test -- src/modules/auth src/lib/http.test.ts && npm run typecheck`

Expected: hash, inactive-user, admin and origin tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth src/lib/http.ts src/app/api/auth
git commit -m "feat: add secure employee authentication"
```

### Task 4: Users administration service and API

**Files:**
- Create: `src/modules/users/schemas.ts`, `service.ts`, `types.ts`
- Create: `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/users/[id]/reset-password/route.ts`
- Test: `src/modules/users/service.test.ts`

**Interfaces:**
- Produces: `listUsers(actor)`, `createUser(actor, input)`, `updateUser(actor, id, input)`, `resetUserPassword(actor, id, password)`.
- Consumes: `requireAdmin`, `hashPassword`, Prisma user model.

- [ ] **Step 1: Write failing administrator tests**

```ts
it("prevents an attendant from creating users", async () => {
  await expect(createUser(attendant, validUser, repo)).rejects.toMatchObject({ status: 403 });
});

it("deactivates instead of deleting a referenced user", async () => {
  await updateUser(admin, marcosId, { active: false }, repo);
  expect(repo.update).toHaveBeenCalledWith(marcosId, expect.objectContaining({ active: false }));
  expect(repo.delete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the user service test**

Run: `npm test -- src/modules/users/service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement validated administrator operations**

Normalize e-mail, enforce unique email, allow only `ADMIN|ATTENDANT`, reject deactivating the last active administrator, invalidate all sessions after password reset or deactivation, and never expose `passwordHash`.

- [ ] **Step 4: Add authenticated Route Handlers**

Each mutation calls `assertSameOrigin`, `requireAdmin`, a Zod schema and the service. Map duplicate email to `409`, invalid input to `400`, unauthenticated to `401` and forbidden to `403`.

- [ ] **Step 5: Verify the users API layer**

Run: `npm test -- src/modules/users && npm run typecheck`

Expected: all authorization, deactivation and password reset tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/users src/app/api/users
git commit -m "feat: add employee administration API"
```

### Task 5: Conversation queries, individual reads and responsibility

**Files:**
- Create: `src/modules/conversations/types.ts`, `schemas.ts`, `service.ts`
- Create: `src/app/api/conversations/route.ts`
- Create: `src/app/api/conversations/[id]/messages/route.ts`
- Create: `src/app/api/conversations/[id]/read/route.ts`
- Create: `src/app/api/conversations/[id]/responsible/route.ts`
- Test: `src/modules/conversations/service.test.ts`

**Interfaces:**
- Produces: `listConversations(userId, { search, cursor })`, `getConversation(userId, id)`, `markRead(userId, id, messageId)`, `setResponsible(actor, id, userId|null)`.
- Produces DTOs `ConversationListItem`, `ConversationDetail`, `MessageDto` containing no secrets or internal hashes.

- [ ] **Step 1: Write failing visibility, read and assignment tests**

```ts
it("returns conversations assigned to another employee", async () => {
  const result = await listConversations(joao.id, {}, repo);
  expect(result.items.map((item) => item.id)).toContain(conversationAssignedToMarcos.id);
});

it("marks only the actor read state", async () => {
  await markRead(victor.id, conversation.id, latest.id, repo);
  expect(repo.upsertRead).toHaveBeenCalledWith(victor.id, conversation.id, latest.id);
  expect(repo.upsertRead).not.toHaveBeenCalledWith(marcos.id, expect.anything(), expect.anything());
});
```

- [ ] **Step 2: Run the domain tests**

Run: `npm test -- src/modules/conversations/service.test.ts`

Expected: FAIL because service methods do not exist.

- [ ] **Step 3: Implement ordered list and search**

Search normalized contact name and phone with case-insensitive Prisma filters. Sort by `lastMessageAt desc, id desc`, calculate unread inbound messages after the current user's `lastReadAt`, and return current responsible employee without filtering by it.

- [ ] **Step 4: Implement monotonic read state**

Verify the message belongs to the conversation. Update only when its effective timestamp is newer than the stored read message. Use transaction and compound unique `(conversationId, userId)`.

- [ ] **Step 5: Implement responsible actions**

Accept active target users only. `null` removes the responsible employee. Return the committed conversation so the transport from Task 6 can publish the updated state.

- [ ] **Step 6: Add authenticated conversation routes**

GET routes call `requireUser`; mutations also call `assertSameOrigin`. Use stable JSON shape `{ data, error: null }` and `{ data: null, error: { code, message } }`.

- [ ] **Step 7: Verify conversation rules**

Run: `npm test -- src/modules/conversations && npm run typecheck`

Expected: visibility, search, individual read and all assignment cases pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/conversations src/app/api/conversations
git commit -m "feat: add shared conversations and assignments"
```

### Task 6: Realtime SSE transport

**Files:**
- Create: `src/modules/realtime/events.ts`, `hub.ts`
- Create: `src/app/api/realtime/route.ts`
- Modify: `src/modules/conversations/service.ts`, `src/app/api/conversations/[id]/read/route.ts`, `src/app/api/conversations/[id]/responsible/route.ts`
- Modify: `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/users/[id]/reset-password/route.ts`
- Test: `src/modules/realtime/hub.test.ts`

**Interfaces:**
- Produces: `publishRealtime(event: RealtimeEvent): void`, `subscribeRealtime(signal): ReadableStream<Uint8Array>`.
- Event union: `conversation.updated`, `message.created`, `message.status`, `read.updated`, `responsible.updated`, `user.updated`.

- [ ] **Step 1: Write the failing broadcaster test**

```ts
it("publishes a typed event and removes aborted subscribers", async () => {
  const controller = new AbortController();
  const reader = subscribeRealtime(controller.signal).getReader();
  publishRealtime({ type: "conversation.updated", conversationId: "c1" });
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("conversation.updated");
  controller.abort();
  expect(realtimeSubscriberCount()).toBe(0);
});
```

- [ ] **Step 2: Run realtime tests**

Run: `npm test -- src/modules/realtime/hub.test.ts`

Expected: FAIL because the hub is missing.

- [ ] **Step 3: Implement SSE framing, heartbeat and cleanup**

Send `event: update\ndata: <json>\n\n`, heartbeat comments every 20 seconds, no-store headers and cleanup on abort. Keep the singleton on `globalThis` so development reload does not duplicate hubs.

- [ ] **Step 4: Add the authenticated SSE route**

Return `401` before opening the stream when no active session exists. Set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.

- [ ] **Step 5: Publish conversation events after committed mutations**

After `markRead`, `setResponsible` or a user mutation resolves successfully, publish the matching `read.updated`, `responsible.updated` or `user.updated` event from the corresponding Route Handler. Never publish inside an open transaction or when the service throws.

- [ ] **Step 6: Verify reconnection-safe transport**

Run: `npm test -- src/modules/realtime && npm run typecheck`

Expected: framing, heartbeat cleanup and authorization tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/realtime src/app/api/realtime
git commit -m "feat: add realtime conversation events"
```

### Task 7: Meta webhook verification, normalization and idempotent processing

**Files:**
- Create: `src/modules/webhooks/types.ts`, `signature.ts`, `normalize.ts`, `process.ts`
- Create: `src/app/api/webhooks/meta/route.ts`
- Create: `src/test/fixtures/meta-webhooks.ts`
- Test: `src/modules/webhooks/signature.test.ts`, `normalize.test.ts`, `process.test.ts`

**Interfaces:**
- Produces: `verifyMetaSignature(rawBody, signature, appSecret): boolean`.
- Produces: `normalizeWebhook(payload): NormalizedWebhookEvent[]`.
- Produces: `processWebhookEvents(events, dependencies): Promise<ProcessSummary>`.
- Consumes: Prisma transactions and `publishRealtime`; creates pending `media_objects` records without downloading them inside the webhook transaction.

- [ ] **Step 1: Write failing signature and payload tests**

```ts
it("rejects a signature created with another secret", () => {
  expect(verifyMetaSignature(body, sign(body, "wrong"), "correct")).toBe(false);
});

it("normalizes the documented inbound text payload", () => {
  expect(normalizeWebhook(inboundTextFixture)[0]).toMatchObject({
    kind: "message",
    whatsappMessageId: expect.stringMatching(/^wamid\./),
    type: "TEXT",
    body: "Hi!",
  });
});
```

- [ ] **Step 2: Run webhook tests and confirm failure**

Run: `npm test -- src/modules/webhooks`

Expected: FAIL because webhook modules do not exist.

- [ ] **Step 3: Implement raw-body HMAC and GET verification**

POST requires `sha256=` prefix and `timingSafeEqual`. GET returns `hub.challenge` only when `hub.mode=subscribe` and the verify token matches; otherwise return `403`.

- [ ] **Step 4: Normalize inbound messages and statuses**

Handle text, image, audio, video and document payloads. Preserve filename/caption safely. Convert unsupported types to `UNSUPPORTED` so the conversation still records that an event arrived. Normalize `sent`, `delivered`, `read` and `failed` without trusting arbitrary status strings.

- [ ] **Step 5: Implement transactional idempotency**

Use message key `message:<wamid>` and status key `status:<wamid>:<status>:<timestamp>`. Reclaim an existing `FAILED` webhook event, ignore `PROCESSED`, upsert contact/conversation, create the unique message, update `lastMessageAt`, commit, then publish SSE.

- [ ] **Step 6: Add the public webhook route**

Read `request.text()` before JSON parsing. Reject invalid signature with `401`. Return `200` for valid duplicates. Return `500` only for retryable processing failures and use redacted structured logging.

- [ ] **Step 7: Verify critical webhook cases**

Run: `npm test -- src/modules/webhooks`

Expected: valid/invalid signatures, documented text, each media type, duplicate message and out-of-order statuses all pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/webhooks src/app/api/webhooks src/test/fixtures
git commit -m "feat: process official Meta webhooks"
```

### Task 8: Media storage and WhatsApp providers

**Files:**
- Create: `src/modules/media/storage.ts`, `local-storage.ts`, `validation.ts`, `service.ts`
- Create: `src/modules/whatsapp/provider.ts`, `demo-provider.ts`, `meta-provider.ts`, `factory.ts`
- Create: `src/modules/messages/status.ts`, `schemas.ts`, `service.ts`
- Create: `src/app/api/media/[id]/route.ts`
- Create: `src/app/api/messages/[id]/retry/route.ts`
- Modify: `src/modules/webhooks/process.ts`, `src/app/api/webhooks/meta/route.ts`
- Modify: `src/app/api/conversations/[id]/messages/route.ts`
- Test: `src/modules/media/local-storage.test.ts`, `validation.test.ts`
- Test: `src/modules/whatsapp/meta-provider.test.ts`, `src/modules/messages/service.test.ts`

**Interfaces:**
- `MediaStorage.put(input): Promise<{ key, sizeBytes, sha256 }>` and `MediaStorage.open(key): Promise<ReadableStream>`.
- `WhatsAppProvider.sendText(input): Promise<SendResult>`, `uploadMedia(input): Promise<{ mediaId }>` and `sendMedia(input): Promise<SendResult>`.
- `sendMessage(actor, conversationId, input): Promise<MessageDto>`, `retryMessage(actor, messageId): Promise<MessageDto>`.

- [ ] **Step 1: Write failing storage, validation and provider tests**

```ts
it("never uses a supplied filename as the storage path", async () => {
  const stored = await storage.put({ filename: "../../token.txt", bytes, mimeType: "text/plain" });
  expect(stored.key).not.toContain("..");
});

it("uses the configured Graph version and bearer token", async () => {
  await provider.sendText({ to: "5561999999999", body: "Olá" });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v23.0/123/messages"),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-token" }) }));
});
```

- [ ] **Step 2: Run media/provider tests and confirm failure**

Run: `npm test -- src/modules/media src/modules/whatsapp src/modules/messages`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement safe local media storage**

Use random UUID keys partitioned by year/month, create directories recursively, write with exclusive mode, compute SHA-256 and verify resolved paths remain below `MEDIA_ROOT`. Serve with authenticated route, safe `Content-Disposition` and `X-Content-Type-Options: nosniff`.

- [ ] **Step 4: Implement centralized media validation**

Allow JPEG/PNG up to 5 MB; AAC/MP4/MPEG/AMR/Opus audio up to 16 MB; MP4/3GPP video up to 16 MB; PDF, text, Microsoft Office and OpenXML documents up to 100 MB. Reject mismatched declared MIME, empty files and larger content before Meta upload.

- [ ] **Step 5: Implement demo and Meta providers**

Demo returns deterministic `demo-<uuid>` IDs and simulated `SENT`. Meta calls `https://graph.facebook.com/${version}/${phoneNumberId}/messages`, uploads multipart media to `/${phoneNumberId}/media`, retrieves `/${mediaId}?phone_number_id=...`, and downloads the temporary URL with Bearer authorization. Parse Graph error code/message without leaking the access token.

- [ ] **Step 6: Implement message send, failure and retry rules**

Create `PENDING` before the external call. Require a unique `clientRequestId`; if it already exists return the existing message. On success store `whatsappMessageId` and `SENT`; on error store `FAILED` and a safe reason. Retry only `FAILED` outbound messages and create a fresh external attempt without duplicating the UI record. Reuse the in-memory limiter to allow at most 30 send attempts per active user per minute. Publish `message.created` or `message.status` only after each database write commits.

- [ ] **Step 7: Implement received-media persistence**

Use Next `after()` to start download after webhook response. If status is still `PENDING`, the authenticated media route invokes the same idempotent `ensureMediaAvailable(mediaId)` function before streaming.

- [ ] **Step 8: Verify all message types**

Run: `npm test -- src/modules/media src/modules/whatsapp src/modules/messages && npm run typecheck`

Expected: storage traversal, size/MIME, Graph request, demo, idempotent send, failure and retry tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/modules/media src/modules/whatsapp src/modules/messages src/app/api/media
git commit -m "feat: send and persist WhatsApp media"
```

### Task 9: Inbox interface, login and responsive realtime behavior

**Files:**
- Create: `src/app/globals.css`, `src/app/login/page.tsx`, `src/app/conversas/page.tsx`
- Create: `src/components/ui/button.tsx`, `input.tsx`, `avatar.tsx`, `badge.tsx`, `spinner.tsx`, `dialog.tsx`, `select.tsx`
- Create: `src/components/auth/login-form.tsx`
- Create: `src/components/inbox/inbox-shell.tsx`, `conversation-list.tsx`, `conversation-view.tsx`
- Create: `src/components/inbox/message-bubble.tsx`, `message-media.tsx`, `message-composer.tsx`, `customer-panel.tsx`, `connection-banner.tsx`
- Create: `src/hooks/use-inbox.ts`, `src/hooks/use-realtime.ts`
- Test: `src/components/inbox/conversation-list.test.tsx`, `message-bubble.test.tsx`, `src/hooks/use-realtime.test.ts`

**Interfaces:**
- Consumes conversation/message DTOs and REST routes from Tasks 5–8.
- Produces `InboxShell({ initialUser })` and authenticated employee workflow.

- [ ] **Step 1: Write failing interface behavior tests**

```tsx
it("shows unread count and the responsible employee", () => {
  render(<ConversationList items={[fixture]} selectedId={null} onSelect={vi.fn()} />);
  expect(screen.getByText("3")).toBeVisible();
  expect(screen.getByText("Marcos")).toBeVisible();
});

it("labels an outbound message with the internal sender only", () => {
  render(<MessageBubble message={outboundFixture} />);
  expect(screen.getByText("Marcos")).toBeVisible();
  expect(screen.getByText("Temos disponível sim.")).toBeVisible();
});
```

- [ ] **Step 2: Run component tests and confirm failure**

Run: `npm test -- src/components src/hooks`

Expected: FAIL because the interface is missing.

- [ ] **Step 3: Create the restrained visual system**

Define CSS variables for canvas `#f3f1ec`, panels `#fbfaf7`, text `#202522`, muted `#6d746f`, border `#ddd9d1`, accent `#176b52`, inbound `#ffffff`, outbound `#dff1e8`, danger `#b4443c`. Use system sans stack, 14–16 px body text, visible focus rings, 44 px touch targets where possible and minimal shadows.

- [ ] **Step 4: Implement login and server-side route protection**

The login page redirects authenticated users. The conversations page calls `getCurrentUser`, redirects unauthenticated users, and renders the client shell. Login errors distinguish invalid credentials, rate limit and network failure without revealing whether an email exists.

- [ ] **Step 5: Build the three-column desktop shell**

Use fixed left width around 340 px, flexible center and right width around 280 px. Include search, recent ordering, unread badge, empty/error/loading states, message history, sticky composer, upload preview and responsible actions.

- [ ] **Step 6: Implement responsive views**

Below 1024 px, make customer details a drawer. Below 720 px, display list or conversation as successive full-width views with a back action. Preserve search, assignment, upload and message status.

- [ ] **Step 7: Wire fetch state and SSE reconnection**

On `message.created` or `message.status`, refetch the open conversation and list; on `responsible.updated`, refetch list and details. Reconnect with exponential delays capped at 15 seconds, show a discreet offline banner and perform full sync on `open`.

- [ ] **Step 8: Implement optimistic but truthful sending**

Create one UUID `clientRequestId`, render a pending bubble, replace it with server data and show `Falha ao enviar` with retry on error. Never append the employee name to the body sent to the API.

- [ ] **Step 9: Verify interface behavior**

Run: `npm test -- src/components src/hooks && npm run lint && npm run typecheck`

Expected: list, messages, responsive state, send failure and SSE reconnection tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/app src/components src/hooks
git commit -m "feat: build realtime customer service inbox"
```

### Task 10: User management interface and global error states

**Files:**
- Create: `src/app/configuracoes/usuarios/page.tsx`, `loading.tsx`, `error.tsx`
- Create: `src/components/users/users-screen.tsx`, `user-form.tsx`, `reset-password-form.tsx`
- Create: `src/app/error.tsx`, `src/app/not-found.tsx`
- Test: `src/components/users/users-screen.test.tsx`, `user-form.test.tsx`

**Interfaces:**
- Consumes Tasks 3–4 users API and `SessionUser.role`.
- Produces the complete administrator workflow with no permanent delete action.

- [ ] **Step 1: Write failing administrator UI tests**

```tsx
it("offers deactivate but never permanent delete", () => {
  render(<UsersScreen currentUser={admin} initialUsers={[marcos]} />);
  expect(screen.getByRole("button", { name: /desativar/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /excluir/i })).toBeNull();
});
```

- [ ] **Step 2: Run the component tests**

Run: `npm test -- src/components/users`

Expected: FAIL because users components do not exist.

- [ ] **Step 3: Implement protected settings page**

Redirect attendants to `/conversas`. Render name, email, profile, active status and actions. Add create/edit dialog, profile selector, activate/deactivate confirmation and password reset with validation.

- [ ] **Step 4: Add global failure states**

Create route error boundaries with `Tentar novamente`, session-expired redirect, accessible not-found page and non-blocking toasts for API failures. Do not expose stack traces or raw Graph responses.

- [ ] **Step 5: Verify settings and errors**

Run: `npm test -- src/components/users src/app && npm run lint && npm run typecheck`

Expected: admin, no-delete, validation and error-state tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app src/components/users
git commit -m "feat: add employee management interface"
```

### Task 11: Docker, reverse proxy, production documentation and backups

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- Create: `deploy/nginx/whatsapp.xpeletronicos.com.conf`
- Create: `scripts/backup.ps1`, `scripts/backup.sh`, `scripts/restore.sh`
- Create: `README.md`
- Test: `scripts/verify-compose.ps1`

**Interfaces:**
- Produces containers `xp-whatsapp-app`, `xp-whatsapp-database`, internal network and persistent volumes.
- Produces documented deploy root `/opt/example-app` and public URL `https://whatsapp.xpeletronicos.com`.

- [ ] **Step 1: Write deployment configuration checks**

```powershell
$config = docker compose config
if ($config -notmatch '127.0.0.1:3100') { throw 'App must bind to loopback' }
if ($config -match '5432:5432') { throw 'Database must not publish PostgreSQL' }
if ($config -notmatch 'xp_whatsapp_media') { throw 'Media volume missing' }
```

- [ ] **Step 2: Run the deployment check and confirm failure**

Run: `pwsh -File scripts/verify-compose.ps1`

Expected: FAIL because Compose is not defined.

- [ ] **Step 3: Create a multi-stage production image**

Use `node:22-bookworm-slim`, `npm ci`, `npm run db:generate`, `npm run build`, a non-root `nextjs` user, standalone output, copied static/public/prisma assets, `/data/media` ownership and `CMD ["node", "server.js"]`.

- [ ] **Step 4: Create isolated Compose services**

Use `postgres:18-alpine`, database healthcheck, app dependency on healthy database, `127.0.0.1:${APP_PORT:-3100}:3000`, no database port, restart policy, memory-safe stop grace and volumes `xp_whatsapp_postgres` and `xp_whatsapp_media`.

- [ ] **Step 5: Create the dedicated Nginx server block**

Proxy only `whatsapp.xpeletronicos.com` to `127.0.0.1:3100`; pass forwarding headers; set `proxy_buffering off` and long read timeout for `/api/realtime`; set `client_max_body_size 105m`; add security headers and Certbot-compatible certificate paths.

- [ ] **Step 6: Write backup and restore scripts**

Back up PostgreSQL with `pg_dump --format=custom`, archive the named media volume through a temporary Alpine container, validate both outputs, and require explicit database/archive paths for restore. Scripts must never refer to the main site.

- [ ] **Step 7: Write the complete README**

Document development, environment keys, migrations, seed, demo credentials, tests, build, Compose, DNS A record, Nginx, Certbot, Meta app creation, permanent System User token, webhook subscription, real message tests, 24-hour customer-service window, logs, backup, restore, update, rollback and every manual dependency.

- [ ] **Step 8: Verify deployment artifacts**

Run: `pwsh -File scripts/verify-compose.ps1 && docker compose config && docker build -t xp-whatsapp:test .`

Expected: checks pass, Compose resolves two isolated services and Docker image builds successfully.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore deploy scripts README.md .env.example
git commit -m "docs: add isolated KVM deployment"
```

### Task 12: Full verification, visual refinement and production handoff

**Files:**
- Modify only files implicated by verification findings.
- Create: `docs/verification/2026-08-19-mvp-checklist.md`

**Interfaces:**
- Consumes every earlier task.
- Produces a reproducible verification record and a release-ready working tree.

- [ ] **Step 1: Start the local production-like stack**

Run: `Copy-Item .env.example .env; docker compose up -d database; npm run db:deploy; npm run db:seed; npm run dev`

Expected: database becomes healthy, seed completes and app listens locally.

- [ ] **Step 2: Exercise the acceptance flows**

Verify login, bad password, inactive user, all-conversation visibility, name/phone search, individual unread counters, assume/change/remove responsible, text send, each media type, retry failure, admin create/edit/deactivate/reset password and two browser sessions receiving SSE updates.

- [ ] **Step 3: Review responsive and accessibility behavior**

Inspect desktop at 1440×900, tablet at 900×1100 and mobile at 390×844. Confirm keyboard focus, labels, contrast, empty/loading/error states, no horizontal overflow and usable mobile navigation. Remove decorative UI that does not support the service workflow.

- [ ] **Step 4: Run the complete automated gate**

Run: `npm test -- --run && npm run lint && npm run typecheck && npm run db:validate && npm run build`

Expected: every command exits `0` with zero failing tests and zero lint/type errors.

- [ ] **Step 5: Run production artifact checks**

Run: `docker compose config && docker build -t xp-whatsapp:verified .`

Expected: Compose resolves and the image build exits `0`.

- [ ] **Step 6: Record evidence and remaining external dependencies**

The verification document must record commands, test count, checked flows and the only external blockers: KVM SSH access, DNS access, Meta app assets, permanent token and commercial number verification.

- [ ] **Step 7: Commit verification fixes and record**

```bash
git add src prisma docs README.md Dockerfile docker-compose.yml deploy scripts
git commit -m "test: verify XP Atendimento MVP"
```

- [ ] **Step 8: Deploy after credentials are supplied**

Copy the repository to `/opt/example-app`, create the production `.env`, run `docker compose build`, `docker compose run --rm app npm run db:deploy`, `docker compose up -d`, install the dedicated Nginx block, run Certbot for `whatsapp.xpeletronicos.com`, validate health and then configure the Meta callback. Stop and request the missing credential or access instead of guessing any secret.
