# Respostas rápidas compartilhadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um catálogo compartilhado de respostas rápidas, administrável por qualquer usuário autenticado e selecionável com `/` no compositor sem envio automático.

**Architecture:** Uma entidade Prisma `QuickReply` será exposta por rotas autenticadas apoiadas por um serviço de domínio com validação Zod. Uma tela de configurações gerenciará o catálogo; o inbox carregará os registros ativos e um componente de sugestões controlado pelo compositor fará filtro e navegação acessível.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Zod, Tailwind CSS, Vitest e Testing Library.

## Global Constraints

- Administradores e atendentes podem gerenciar o catálogo compartilhado.
- Selecionar uma resposta apenas preenche o campo e nunca envia automaticamente.
- Atalhos aceitam letras minúsculas sem acento, números, hífen e sublinhado e são armazenados sem `/`.
- A primeira versão usa texto fixo, sem variáveis, anexos, categorias ou importação do WhatsApp Business.
- Falha ao carregar o catálogo não pode bloquear texto, anexos ou áudio.
- A execução será inline e sem subagentes, conforme determinação do usuário.

---

### Task 1: Persistência e domínio do catálogo

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608220002_quick_replies/migration.sql`
- Create: `src/modules/quick-replies/service.ts`
- Create: `src/modules/quick-replies/service.test.ts`
- Regenerate: `src/generated/prisma/**`

**Interfaces:**
- Produces: `normalizeQuickReplyShortcut(value: string): string`, `listQuickReplies({ activeOnly?: boolean })`, `createQuickReply(input)`, `updateQuickReply(id, input)`.
- Produces entity: `{ id, shortcut, message, position, active, createdAt, updatedAt }`.

- [ ] **Step 1: Write failing domain tests** covering lowercase normalization, rejection of spaces/accents/empty messages, stable ordering and duplicate conflict.
- [ ] **Step 2: Run** `npm test -- src/modules/quick-replies/service.test.ts` and confirm failures are caused by the missing module.
- [ ] **Step 3: Add `QuickReply` schema and migration** with `shortcut TEXT UNIQUE`, non-empty checks for shortcut/message, `position INTEGER`, `active BOOLEAN`, timestamps and index `(active, position, shortcut)`.
- [ ] **Step 4: Implement the service** with Zod schemas and explicit `QuickReplyValidationError`, `QuickReplyConflictError` and `QuickReplyNotFoundError` classes.
- [ ] **Step 5: Generate and verify** with `npm run db:generate`, `npm run db:validate`, and the focused test; expect exit code 0.
- [ ] **Step 6: Commit** persistence, generated client, service and tests as `feat: add shared quick reply catalog`.

### Task 2: API autenticada

**Files:**
- Create: `src/app/api/quick-replies/route.ts`
- Create: `src/app/api/quick-replies/route.test.ts`
- Create: `src/app/api/quick-replies/[id]/route.ts`
- Create: `src/app/api/quick-replies/[id]/route.test.ts`

**Interfaces:**
- `GET /api/quick-replies?active=true` returns `{ quickReplies: QuickReplyDto[] }`.
- `POST /api/quick-replies` accepts `{ shortcut: string, message: string }`.
- `PATCH /api/quick-replies/:id` accepts any of `{ shortcut, message, active }`.

- [ ] **Step 1: Write failing route tests** for unauthenticated `401`, admin and attendant access, normalized creation, active-only listing, validation `400`, duplicate `409`, missing `404`, editing and activation toggles.
- [ ] **Step 2: Run** `npm test -- src/app/api/quick-replies/route.test.ts src/app/api/quick-replies/[id]/route.test.ts` and confirm the routes are absent.
- [ ] **Step 3: Implement collection and item routes** using the existing session helpers and map domain errors to the specified HTTP statuses without exposing internals.
- [ ] **Step 4: Re-run focused tests** and expect all assertions to pass.
- [ ] **Step 5: Commit** as `feat: expose quick reply management api`.

### Task 3: Tela de gerenciamento

**Files:**
- Create: `src/app/configuracoes/respostas-rapidas/page.tsx`
- Create: `src/app/configuracoes/respostas-rapidas/page.test.tsx`
- Create: `src/app/configuracoes/respostas-rapidas/loading.tsx`
- Create: `src/app/configuracoes/respostas-rapidas/error.tsx`
- Create: `src/components/settings/quick-replies-screen.tsx`
- Create: `src/components/settings/quick-replies-screen.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`

**Interfaces:**
- `QuickRepliesScreen` receives an authenticated initial list or fetches `/api/quick-replies` and supports create, edit, deactivate, reactivate and retry.

- [ ] **Step 1: Write failing UI/page tests** for both roles, list states, create/edit dialogs, duplicate feedback, deactivate/reactivate, disabled buttons while saving, expired session redirect and navigation from the inbox.
- [ ] **Step 2: Run focused tests** and confirm failures identify missing components/routes.
- [ ] **Step 3: Implement the page and screen** following the current classifications/users visual patterns, with accessible labels, multiline message field and `/atalho` preview.
- [ ] **Step 4: Add the inbox navigation entry** “Configurar respostas rápidas” for every authenticated role.
- [ ] **Step 5: Re-run focused tests** and expect exit code 0.
- [ ] **Step 6: Commit** as `feat: manage shared quick replies`.

### Task 4: Seletor `/` no compositor

**Files:**
- Create: `src/components/inbox/quick-reply-menu.tsx`
- Create: `src/components/inbox/quick-reply-menu.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify related tests for the files above.

**Interfaces:**
- `QuickReplyOption = { id: string; shortcut: string; message: string }`.
- `QuickReplyMenu` receives `{ items, query, activeIndex, onSelect, onActiveIndexChange, onDismiss }`.
- `MessageComposer` receives `quickReplies`, loading/error state and retry callback while retaining current send callbacks.

- [ ] **Step 1: Write failing pure/UI tests** for opening on leading `/`, filtering shortcut/message case-insensitively, hiding inactive records, Arrow navigation, Enter/click/touch selection, Escape dismissal, focus restoration, no auto-send and reset on conversation change.
- [ ] **Step 2: Run focused tests** and verify expected feature failures.
- [ ] **Step 3: Implement catalog loading** from `GET /api/quick-replies?active=true` without coupling failure to conversation loading.
- [ ] **Step 4: Implement accessible suggestion menu** as a listbox above the composer and integrate keyboard events without breaking Enter-to-send when the menu is closed.
- [ ] **Step 5: Implement selection** by replacing the entire `/query` with the fixed message, preserving focus and requiring explicit send.
- [ ] **Step 6: Add non-blocking load error and retry** while text, media and recording remain operational.
- [ ] **Step 7: Re-run composer, inbox and conversation tests** and expect all to pass.
- [ ] **Step 8: Commit** as `feat: insert quick replies from composer`.

### Task 5: Verificação e deploy incremental em produção

**Files:**
- Modify only if verification reveals an in-scope defect.

**Interfaces:**
- Production acceptance: authenticated user can manage `/horario`, type `/hor`, select it, revise it and explicitly send it.

- [ ] **Step 1: Run full verification**: `npm test`, `npm run lint`, `npm run typecheck`, `npm run db:validate`, and `npm run build`; all must exit 0.
- [ ] **Step 2: Inspect** `git diff --check` and `git status --short`; no accidental or unrelated changes may be included.
- [ ] **Step 3: Deploy using the repository's established KVM release procedure**, including the new Prisma migration before traffic reaches the new application image.
- [ ] **Step 4: Verify production health** and authenticate at `https://whatsapp.xpeletronicos.com/`.
- [ ] **Step 5: Perform manual production acceptance** for create, filter, select-without-send, edit, deactivate and mobile-sized interaction.
- [ ] **Step 6: Record the deployed commit and verification evidence** in the release documentation and commit it.
