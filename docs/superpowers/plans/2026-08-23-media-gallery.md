# Full-screen Media Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma galeria autenticada em tela cheia para imagens, vídeos e PDFs, com navegação equivalente ao WhatsApp e streaming parcial seguro.

**Architecture:** O DTO expõe somente o MIME validado; `ConversationView` deriva uma lista de itens elegíveis e abre `MediaViewerDialog`, enquanto `MessageMedia` preserva a recuperação existente e apenas encaminha a intenção de abertura. A rota autenticada continua sendo a única origem dos arquivos e passa a aceitar preview explícito e um intervalo HTTP por requisição, atendido diretamente pelo armazenamento local.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Tailwind CSS 4, Radix UI, Lucide, Vitest, Testing Library, Prisma/PostgreSQL.

## Global Constraints

- Não adicionar dependência de PDF.js nem alterar o banco de dados.
- Áudios, figurinhas e documentos não-PDF devem manter o comportamento atual.
- Somente `application/pdf` validado pode ser exibido como documento inline.
- O endpoint continua autenticado, privado, `no-store` e com `nosniff`.
- Apenas um intervalo HTTP válido pode ser atendido; intervalos múltiplos ou impossíveis retornam `416`.
- Não expor chave de armazenamento, hash, caminho local, ID da Meta ou detalhes internos de falha.
- Antes do deploy, auditar novamente todos os trabalhos paralelos e integrar apenas alterações concluídas e testadas.
- O deploy deve recriar somente o container da aplicação e preservar os demais sistemas da KVM.

---

## File map

- `src/modules/conversations/types.ts`: contrato público seguro de MIME.
- `src/modules/conversations/service.ts`: seleção e serialização do MIME validado.
- `src/modules/media/byte-range.ts`: parser puro de `Range` de um único intervalo.
- `src/modules/media/storage.ts`: contrato opcional de leitura parcial.
- `src/modules/media/local-storage.ts`: stream limitado por posição e comprimento.
- `src/modules/media/service.ts`: autorização, resolução do intervalo e abertura do stream correto.
- `src/app/api/media/[id]/route.ts`: headers `200`/`206`/`416`, preview e download.
- `src/hooks/use-inbox.ts`: MIME do preview otimista local.
- `src/components/inbox/media-gallery.ts`: derivação dos itens elegíveis e nomes seguros.
- `src/components/inbox/media-viewer-dialog.tsx`: overlay, navegação, gestos, zoom e visualizadores.
- `src/components/inbox/message-media.tsx`: gatilhos acessíveis para imagem, vídeo e PDF.
- `src/components/inbox/message-bubble.tsx`: encaminhamento do callback de abertura.
- `src/components/inbox/conversation-view.tsx`: estado do item ativo e ciclo de histórico do navegador.

### Task 1: Safe media MIME contract

**Files:**
- Modify: `src/modules/conversations/types.ts`
- Modify: `src/modules/conversations/service.ts`
- Modify: `src/modules/conversations/service.test.ts`
- Modify: `src/modules/conversations/service.integration.test.ts`

**Interfaces:**
- Produces: `MessageDto.mediaMimeType?: string | null` and `SafeMessageMediaRecord.mimeType: string`.

- [ ] **Step 1: Write the failing DTO tests**

Add assertions that an available PDF serializes as `mediaMimeType: "application/pdf"` and that the JSON still lacks `storageKey`, `sha256`, `metaMediaId`, `failureReason`, and lease fields.

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts`

Expected: the new MIME assertion fails because it is absent.

- [ ] **Step 3: Add the minimal safe field**

Extend `SafeMessageMediaRecord`, select `mimeType: true`, and serialize:

```ts
mediaMimeType: message.mediaObject?.mimeType ?? null,
```

Keep every provider/storage field out of `MessageDto`.

- [ ] **Step 4: Verify DTO tests pass**

Run the same command; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/conversations/types.ts src/modules/conversations/service.ts src/modules/conversations/service.test.ts src/modules/conversations/service.integration.test.ts
git commit -m "feat: expose safe media mime in conversations"
```

### Task 2: Single-range parser and bounded local reads

**Files:**
- Create: `src/modules/media/byte-range.ts`
- Create: `src/modules/media/byte-range.test.ts`
- Modify: `src/modules/media/storage.ts`
- Modify: `src/modules/media/local-storage.ts`
- Modify: `src/modules/media/local-storage.test.ts`

**Interfaces:**
- Produces: `parseSingleByteRange(value: string | null, size: bigint): ByteRange | null`, where `ByteRange = { start: bigint; end: bigint; length: bigint }`.
- Produces: `MediaStorage.open(key: string, range?: { start: bigint; end: bigint }): Promise<ReadableStream<Uint8Array>>`.

- [ ] **Step 1: Write parser tests**

Cover `bytes=0-3`, `bytes=4-`, `bytes=-4`, a range ending past EOF, whitespace rejection, wrong unit, empty input, zero-sized files, multiple ranges, reversed ranges and starts at/after EOF.

- [ ] **Step 2: Verify parser tests fail**

Run: `npm test -- src/modules/media/byte-range.test.ts`

Expected: module import failure.

- [ ] **Step 3: Implement strict parsing**

Use decimal-only `BigInt` parsing, reject commas and malformed syntax, clamp only the end to `size - 1`, and return `null` only when no header was sent. Throw a dedicated `UnsatisfiableByteRangeError` for malformed or impossible requests.

- [ ] **Step 4: Write bounded-stream tests**

Store known bytes, open `{ start: 2n, end: 5n }`, and assert exactly bytes 2–5 are emitted. Add cancellation and EOF tests proving the file handle closes once.

- [ ] **Step 5: Implement bounded reads**

Extend `closingFileHandleStream` with optional `{ start, length }`, read no more than the remaining length using explicit file positions, close at the boundary, and reject offsets beyond `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/modules/media/byte-range.test.ts src/modules/media/local-storage.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/media/byte-range.ts src/modules/media/byte-range.test.ts src/modules/media/storage.ts src/modules/media/local-storage.ts src/modules/media/local-storage.test.ts
git commit -m "feat: stream bounded media byte ranges"
```

### Task 3: Authenticated media preview and Range responses

**Files:**
- Modify: `src/modules/media/service.ts`
- Modify: `src/modules/media/service.test.ts`
- Modify: `src/app/api/media/[id]/route.ts`
- Modify: `src/app/api/media/[id]/route.test.ts`

**Interfaces:**
- Consumes: `parseSingleByteRange` and ranged `MediaStorage.open` from Task 2.
- Produces: `getMediaForDownload(actorId, mediaId, { rangeHeader? })` with optional `range` metadata.

- [ ] **Step 1: Write service tests**

Assert the service resolves a valid range against the authorized media size and passes `{ start, end }` to storage; assert malformed/multiple/impossible ranges become `HttpError(416, "Intervalo de mídia inválido")` and authorization still happens before storage access.

- [ ] **Step 2: Verify service tests fail**

Run: `npm test -- src/modules/media/service.test.ts`

Expected: the new options are ignored.

- [ ] **Step 3: Implement service range resolution**

Return the existing fields plus optional:

```ts
range?: { start: bigint; end: bigint; length: bigint };
```

Open the storage stream with the resolved bounds and keep full-response behavior unchanged when no header is present.

- [ ] **Step 4: Write route tests**

Cover full `200`, ranged `206`, `416` with `Content-Range: bytes */4`, PDF `?preview=1` inline, PDF default/download attachment, non-PDF `?preview=1` attachment, `Accept-Ranges: bytes`, injection-safe filenames and authentication-before-resolution.

- [ ] **Step 5: Verify route tests fail**

Run: `npm test -- 'src/app/api/media/[id]/route.test.ts'`

Expected: status/header assertions fail.

- [ ] **Step 6: Implement route semantics**

Pass `request.headers.get("range")` to the service. Use `206` and range length when range metadata exists. Use inline disposition only when `preview=1` and MIME equals `application/pdf`; use attachment for explicit `download=1` and all other documents. Keep `nosniff`, `private, no-store`, safe filename encoding and stable public errors.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/modules/media/service.test.ts 'src/app/api/media/[id]/route.test.ts'`

Expected: PASS.

```bash
git add src/modules/media/service.ts src/modules/media/service.test.ts 'src/app/api/media/[id]/route.ts' 'src/app/api/media/[id]/route.test.ts'
git commit -m "feat: serve authenticated media previews and ranges"
```

### Task 4: Gallery model and accessible media triggers

**Files:**
- Modify: `src/hooks/use-inbox.ts`
- Create: `src/components/inbox/media-gallery.ts`
- Create: `src/components/inbox/media-gallery.test.ts`
- Modify: `src/components/inbox/message-media.tsx`
- Modify: `src/components/inbox/message-media.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`

**Interfaces:**
- Produces: `MediaGalleryItem = { messageId; mediaId; kind; mimeType; filename; source; downloadSource }`.
- Produces: `galleryItems(messages: InboxMessage[]): MediaGalleryItem[]` and `MessageMedia({ message, onOpenMedia? })`.

- [ ] **Step 1: Write gallery derivation tests**

Assert chronological inclusion of available/optimistic IMAGE and VIDEO plus only PDF DOCUMENT, while excluding audio, sticker, pending, failed and non-PDF documents. Assert safe fallback names.

- [ ] **Step 2: Verify gallery model tests fail**

Run: `npm test -- src/components/inbox/media-gallery.test.ts`

Expected: module import failure.

- [ ] **Step 3: Implement the pure gallery model**

Use `message.mediaMimeType ?? message.localMimeType`, generate authenticated preview URLs with `?preview=1`, and download URLs with `?download=1`. Add `localMimeType?: string` to `InboxMessage` and populate it from the optimistic `File.type`.

- [ ] **Step 4: Write trigger tests**

Assert image/video/PDF available states render buttons with labels `Abrir imagem`, `Abrir vídeo`, `Abrir PDF`; clicking calls `onOpenMedia(message.id)` exactly once; non-PDF documents retain their download link; sticker/audio remain unchanged.

- [ ] **Step 5: Implement accessible triggers**

Wrap eligible visual previews in real `button type="button"` controls, preserve sizing/recovery refs, and stop no events manually because the bubble already recognizes buttons as interactive.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- src/components/inbox/media-gallery.test.ts src/components/inbox/message-media.test.tsx src/hooks/use-inbox.test.tsx`

Expected: PASS.

```bash
git add src/hooks/use-inbox.ts src/components/inbox/media-gallery.ts src/components/inbox/media-gallery.test.ts src/components/inbox/message-media.tsx src/components/inbox/message-media.test.tsx src/components/inbox/message-bubble.tsx
git commit -m "feat: make conversation media gallery-ready"
```

### Task 5: Full-screen viewer

**Files:**
- Create: `src/components/inbox/media-viewer-dialog.tsx`
- Create: `src/components/inbox/media-viewer-dialog.test.tsx`

**Interfaces:**
- Consumes: `MediaGalleryItem` from Task 4.
- Produces: `MediaViewerDialog({ items, activeMessageId, onActiveMessageChange, onClose })`.

- [ ] **Step 1: Write dialog behavior tests**

Cover current `x de y`, accessible title, close, previous/next buttons, wrapping disabled at ends, `ArrowLeft`/`ArrowRight`, media remount by key, video pause cleanup, download/open links, PDF iframe source, and image zoom/reset controls.

- [ ] **Step 2: Verify dialog tests fail**

Run: `npm test -- src/components/inbox/media-viewer-dialog.test.tsx`

Expected: module import failure.

- [ ] **Step 3: Implement full-screen Radix dialog**

Compose `DialogPrimitive.Root/Portal/Overlay/Content` directly for a full viewport overlay. Keep the title visible in the header, use 44px controls and safe-area padding, mount exactly one media element keyed by message ID, and expose previous/next only when possible.

- [ ] **Step 4: Implement image interaction**

Maintain zoom between `1` and `4`, reset on item change, support buttons, wheel and double-click, and use pointer capture for panning only above scale 1. Apply `touch-action: none` only to the active image surface.

- [ ] **Step 5: Implement mobile swipe and cleanup**

Recognize a horizontal swipe only when horizontal distance is at least 50px and dominates vertical movement; do not navigate during image pan. Pause the active video on cleanup and return focus through Radix.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- src/components/inbox/media-viewer-dialog.test.tsx`

Expected: PASS.

```bash
git add src/components/inbox/media-viewer-dialog.tsx src/components/inbox/media-viewer-dialog.test.tsx
git commit -m "feat: add full-screen media viewer"
```

### Task 6: Conversation integration and browser-back behavior

**Files:**
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`

**Interfaces:**
- Consumes: `galleryItems`, `MediaViewerDialog`, and `MessageMedia.onOpenMedia`.

- [ ] **Step 1: Write integration tests**

Render a conversation with image, video and PDF; open from each bubble; navigate while staying in the conversation; close with `Escape`; assert focus returns; simulate `popstate` and assert the viewer closes while `onBack` is not called.

- [ ] **Step 2: Verify integration tests fail**

Run: `npm test -- src/components/inbox/conversation-view.test.tsx`

Expected: no viewer appears.

- [ ] **Step 3: Integrate state and callbacks**

Derive items with `useMemo`, keep `activeMediaMessageId`, pass `onOpenMedia` through `MessageBubble`, and render the viewer beside the conversation layout. Clear the active media when the conversation changes or the item disappears.

- [ ] **Step 4: Implement reversible history entry**

On open, call `history.pushState({ ...history.state, xpMediaViewer: true }, "")`. On `popstate`, close without calling the conversation back handler. On close controls/Escape, call `history.back()` only when the viewer owns the current marker; otherwise close locally. Remove listeners on cleanup.

- [ ] **Step 5: Run component suite and commit**

Run: `npm test -- src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/message-media.test.tsx src/components/inbox/media-viewer-dialog.test.tsx`

Expected: PASS.

```bash
git add src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/message-bubble.tsx
git commit -m "feat: integrate media gallery with conversations"
```

### Task 7: Verification, parallel audit and production release

**Files:**
- Modify: `docs/superpowers/plans/2026-08-23-media-gallery.md` only to mark completed checkboxes and append factual release evidence.

- [x] **Step 1: Run repository verification**

Run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

Expected: all commands exit 0.

- [x] **Step 2: Run browser verification**

Start the production build locally and verify authenticated desktop and mobile flows: image zoom/pan, video seek, complete PDF preview, arrows, swipe, Escape, browser back, focus restoration, download and non-PDF fallback. Confirm no console errors.

- [x] **Step 3: Audit parallel work immediately before deployment**

Run `git worktree list --porcelain`, `git status --short --branch` in every worktree, `git log --all --decorate --oneline --graph`, and ancestry comparisons against the live release. Review diffs for any branch advanced since feature start. Merge only completed/tested work and rerun Step 1 after any integration.

- [x] **Step 4: Build and validate an immutable release on the KVM**

Upload the audited Git archive to a new release directory, build a uniquely tagged image under the established CPU/RAM limits, run migrations as a no-op check, execute the complete test suite against an isolated test database, and record the image digest. Do not reuse a mutable tag.

- [x] **Step 5: Deploy application container only**

Take a database backup, snapshot the non-application container set, update only the application image reference, recreate only `xp-whatsapp-app`, then verify container identity, health endpoint, login page, authenticated conversations/media routes and that the non-application snapshot is unchanged. Roll back to the previous digest if any check fails.

- [x] **Step 6: Record evidence and commit**

Append the audited branch heads, immutable image digest, release directory, backup path, test/build results, HTTP checks and rollback reference without secrets.

```bash
git add docs/superpowers/plans/2026-08-23-media-gallery.md
git commit -m "docs: record media gallery production verification"
```

Release evidence is recorded in `docs/verification/2026-08-23-media-gallery.md`.
