# PDF Conversation Thumbnail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render and cache the first page of every available inbound or outbound PDF, then show that authenticated thumbnail inside the conversation bubble while preserving the full-screen viewer and safe fallback.

**Architecture:** The Node server authorizes the original media, derives a cache identity from the immutable media UUID and SHA-256, and uses bounded `pdftoppm` execution to publish a validated PNG atomically under `MEDIA_ROOT/.pdf-thumbnails`. A dedicated authenticated route streams that derivative. A focused React component loads the thumbnail and falls back to the existing document card if generation or loading fails.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest/Testing Library, Node streams and private filesystem APIs, Poppler `pdftoppm`, Tailwind CSS, Docker/KVM.

## Global Constraints

- Apply the feature to both received and sent PDFs with validated MIME `application/pdf`.
- Render only page 1 at a maximum width of 640px.
- Run `pdftoppm` with fixed arguments, `shell: false`, a 10-second timeout, one active generation globally, and a 4 MiB output limit.
- Keep the original media endpoint, full-screen viewer, non-PDF document behavior, Meta rules and database schema unchanged.
- Require an active authorized user for every thumbnail request; never expose paths, hashes, provider identifiers or internal errors.
- Keep browser responses `private, no-store`; cache only the regenerable PNG under the private media volume.
- Exclude `.pdf-thumbnails` from backups and recreate it on demand after restore.
- Use TDD for every behavior change and commit after each independently verified task.
- Do not use subagents. Audit parallel worktrees immediately before production deployment.

---

## File Structure

- Create `src/modules/media/pdf-thumbnail.ts`: authorization-aware orchestration, private cache paths, bounded rendering, PNG validation, atomic publication and streaming.
- Create `src/modules/media/pdf-thumbnail.test.ts`: renderer, cache, concurrency, containment, cleanup and failure tests.
- Create `src/app/api/media/[id]/thumbnail/route.ts`: authenticated HTTP contract.
- Create `src/app/api/media/[id]/thumbnail/route.test.ts`: route authorization, validation, headers and error contract.
- Create `src/components/inbox/pdf-message-preview.tsx`: loading, loaded and fallback bubble UI.
- Create `src/components/inbox/pdf-message-preview.test.tsx`: interaction, accessibility and state tests.
- Modify `src/modules/media/service.ts`: include the existing immutable SHA-256 in the internal `MediaDownload` value.
- Modify `src/modules/media/service.test.ts`: verify the digest contract and reject missing digest for available media.
- Modify `src/modules/recordings/converter.ts`: allow the existing bounded process runner to invoke `pdftoppm` without weakening spawn options.
- Modify `src/components/inbox/message-media.tsx`: delegate eligible PDF rendering to `PdfMessagePreview`.
- Modify `src/components/inbox/message-media.test.tsx`: cover received/sent integration and preserve non-PDF behavior.
- Modify `Dockerfile`: install `poppler-utils` in the shared runtime base.
- Modify `scripts/backup.sh`, `scripts/backup.ps1`, `scripts/test-deployment.ps1`: exclude and regression-test the regenerable cache plus runtime dependency.
- Create `docs/verification/2026-08-23-pdf-conversation-thumbnail.md`: exact release, tests, parallel audit, backup, deployment and browser evidence.

### Task 1: Runtime dependency and regenerable-cache policy

**Files:**
- Modify: `Dockerfile`
- Modify: `scripts/backup.sh`
- Modify: `scripts/backup.ps1`
- Modify: `scripts/test-deployment.ps1`

**Interfaces:**
- Produces: runtime command `pdftoppm` and backup exclusion for `./.pdf-thumbnails`.
- Consumes: existing Debian Bookworm base and validated media-volume backup workflow.

- [ ] **Step 1: Write failing deployment assertions**

Add exact assertions beside the existing FFmpeg and transient-directory checks:

```powershell
if ($Dockerfile -notmatch 'openssl\s+ffmpeg\s+poppler-utils') {
  throw 'O runtime final deve instalar poppler-utils para miniaturas PDF.'
}
foreach ($BackupScript in @($BackupShell, $BackupPowerShell)) {
  if ($BackupScript -notmatch "--exclude='\./\.pdf-thumbnails'") {
    throw 'Backup deve excluir miniaturas PDF regeneráveis.'
  }
}
```

- [ ] **Step 2: Run the deployment test and verify RED**

Run: `pwsh -NoProfile -File scripts/test-deployment.ps1`

Expected: FAIL with `O runtime final deve instalar poppler-utils para miniaturas PDF.`

- [ ] **Step 3: Add the minimal runtime package and exclusions**

Change the base installation to:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ffmpeg poppler-utils \
    && rm -rf /var/lib/apt/lists/*
```

Add `--exclude='./.pdf-thumbnails'` to both media archive commands without changing helper ownership, volume selection or archive validation.

- [ ] **Step 4: Run the deployment test and verify GREEN**

Run: `pwsh -NoProfile -File scripts/test-deployment.ps1`

Expected: `Deployment mutation tests passed.`

- [ ] **Step 5: Commit**

```powershell
git add Dockerfile scripts/backup.sh scripts/backup.ps1 scripts/test-deployment.ps1
git commit -m "build: add bounded PDF thumbnail runtime"
```

### Task 2: Immutable source identity for derivatives

**Files:**
- Modify: `src/modules/media/service.ts`
- Modify: `src/modules/media/service.test.ts`

**Interfaces:**
- Produces: `MediaDownload.sha256: string` from the already validated stored object.
- Consumes: `MediaObjectRecord.sha256` and `getMediaForDownload(actorId, mediaId, dependencies, options)`.

- [ ] **Step 1: Write the failing service tests**

Add assertions that an available PDF download exposes its digest internally and that an available record without a digest fails closed:

```ts
const state = await harness();
await ensureMediaAvailable(mediaId, state.dependencies);
const download = await getMediaForDownload(actorId, mediaId, state.dependencies);
expect(download.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

state.repository.record = { ...state.repository.record, sha256: null };
await expect(getMediaForDownload(actorId, mediaId, state.dependencies))
  .rejects.toMatchObject({ status: 424 });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/modules/media/service.test.ts`

Expected: FAIL because `MediaDownload` does not expose `sha256` and null digest is currently accepted.

- [ ] **Step 3: Implement the minimal digest contract**

Extend the internal type and fail before opening storage when the immutable digest is absent:

```ts
export type MediaDownload = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  filename: string;
  kind: "image" | "audio" | "video" | "document";
  range?: ByteRange;
};

if (!media.sha256) throw new HttpError(424, "Mídia indisponível");
```

Return `sha256: media.sha256` without adding it to any JSON DTO or response header.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/modules/media/service.test.ts`

Expected: all media service tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/media/service.ts src/modules/media/service.test.ts
git commit -m "refactor: expose immutable media identity internally"
```

### Task 3: Bounded PDF thumbnail service

**Files:**
- Create: `src/modules/media/pdf-thumbnail.ts`
- Create: `src/modules/media/pdf-thumbnail.test.ts`
- Modify: `src/modules/recordings/converter.ts`

**Interfaces:**
- Consumes: `getMediaForDownload`, `stageMediaStream`, `ensurePrivateDirectoryTree`, `MediaTaskLimiter`, and `RunBoundedProcess`.
- Produces: `getPdfThumbnail(actorId: string, mediaId: string, dependencies?: PdfThumbnailDependencies): Promise<PdfThumbnail>` where `PdfThumbnail` is `{ stream: ReadableStream<Uint8Array>; sizeBytes: bigint }`.

Define the dependency seam exactly as:

```ts
export type PdfThumbnail = { stream: ReadableStream<Uint8Array>; sizeBytes: bigint };
export type PdfThumbnailDependencies = {
  getMediaForDownload: typeof getMediaForDownload;
  runProcess: RunBoundedProcess;
  mediaRoot: string;
  limiter: MediaTaskLimiter;
  inFlight: Map<string, Promise<string>>;
  createUuid: () => string;
};
```

- [ ] **Step 1: Write failing cache and rendering tests**

Build tests around an injected `getMediaForDownload`, runner, UUID source and temporary `mediaRoot`. Cover:

```ts
function pngHeader(width = 640, height = 480): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

const validPng640x480 = pngHeader();
const thumbnail = await getPdfThumbnail(actorId, mediaId, dependencies);
expect(await streamBytes(thumbnail.stream)).toEqual(validPng640x480);
expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
  command: "pdftoppm",
  timeoutMs: 10_000,
  args: expect.arrayContaining(["-f", "1", "-l", "1", "-singlefile", "-scale-to-x", "640", "-png"]),
}));
```

Also assert cache hit skips the runner, two authorized concurrent callers share one generation, non-PDF rejects safely, 4 MiB overflow rejects, malformed/truncated PNG rejects, timeout cleans staging, and symlink replacement of cache/work directories fails closed.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm test -- src/modules/media/pdf-thumbnail.test.ts`

Expected: FAIL because `pdf-thumbnail.ts` does not exist.

- [ ] **Step 3: Generalize the existing bounded runner command union**

Change only its command type; retain `shell: false`, hidden windows, bounded diagnostics, SIGTERM/SIGKILL escalation and all recording tests:

```ts
export type RunBoundedProcess = (input: {
  command: "ffmpeg" | "ffprobe" | "pdftoppm";
  args: string[];
  timeoutMs: number;
  diagnosticLimitBytes: number;
}) => Promise<ProcessResult>;
```

- [ ] **Step 4: Implement the private renderer and cache**

Use these fixed limits and arguments:

```ts
export const PDF_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_THUMBNAIL_TIMEOUT_MS = 10_000;

const args = [
  "-f", "1", "-l", "1", "-singlefile",
  "-scale-to-x", "640", "-scale-to-y", "-1",
  "-png", staged.path, outputPrefix,
];
```

Before joining the in-flight map, call `getMediaForDownload` for every actor so authorization is never shared. Require `application/pdf`, validate the digest as 64 lowercase hex characters and compute `<mediaId>-<sha256>.png` without user-controlled names. On a cache hit, cancel the newly opened source stream and return a fresh read stream. When an authorized caller joins an existing generation, cancel that caller's unused source stream before awaiting the shared cache path.

For a miss, use a `MediaTaskLimiter(1, 1)`, stage the bounded source, reserve a UUID-only 0700 work directory below `.pdf-thumbnails/.work`, run Poppler, verify a regular non-symlink PNG whose signature is `89504e470d0a1a0a`, parse positive IHDR width/height with width at most 640, enforce 1..4 MiB, `chmod 0600`, then rename atomically to the final cache path. Reopen and revalidate the published file before returning it. Always clean the staged PDF and owned work directory.

Map renderer failures to `HttpError(424, "Miniatura indisponível")`; preserve `401` and `404` errors from authorization.

- [ ] **Step 5: Run focused and adjacent tests**

Run: `npm test -- src/modules/media/pdf-thumbnail.test.ts src/modules/recordings/converter.test.ts src/modules/media/service.test.ts`

Expected: all tests PASS with no unhandled rejection or leaked temporary directory.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/media/pdf-thumbnail.ts src/modules/media/pdf-thumbnail.test.ts src/modules/recordings/converter.ts
git commit -m "feat: generate private PDF thumbnails"
```

### Task 4: Authenticated thumbnail route

**Files:**
- Create: `src/app/api/media/[id]/thumbnail/route.ts`
- Create: `src/app/api/media/[id]/thumbnail/route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `messageUuidSchema`, `getPdfThumbnail`.
- Produces: `GET /api/media/:id/thumbnail` with `image/png` body and private security headers.

- [ ] **Step 1: Write the failing route tests**

Use dependency injection through `createPdfThumbnailRouteHandlers`. Assert UUID validation occurs before service invocation, authorization errors retain status, successful output streams exact bytes, and headers equal:

```ts
expect(response.headers.get("content-type")).toBe("image/png");
expect(response.headers.get("content-length")).toBe(String(png.byteLength));
expect(response.headers.get("content-disposition")).toBe("inline; filename=\"preview.png\"");
expect(response.headers.get("cache-control")).toBe("private, no-store");
expect(response.headers.get("x-content-type-options")).toBe("nosniff");
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `npm test -- 'src/app/api/media/[id]/thumbnail/route.test.ts'`

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement the route**

Follow the existing media route pattern:

```ts
export function createPdfThumbnailRouteHandlers(dependencies = defaultDependencies) {
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const parsed = messageUuidSchema.safeParse((await context.params).id);
        if (!parsed.success) throw new HttpError(404, "Mídia não encontrada");
        const thumbnail = await dependencies.getPdfThumbnail(actor.id, parsed.data);
        return new Response(thumbnail.stream, { status: 200, headers: secureHeaders(thumbnail.sizeBytes) });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}
```

Return only generic errors and never add the route to the Caddy iframe exception.

- [ ] **Step 4: Run route and media tests**

Run: `npm test -- 'src/app/api/media/[id]/thumbnail/route.test.ts' src/app/api/media/[id]/route.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add 'src/app/api/media/[id]/thumbnail/route.ts' 'src/app/api/media/[id]/thumbnail/route.test.ts'
git commit -m "feat: serve authenticated PDF thumbnails"
```

### Task 5: WhatsApp-like PDF card in the conversation

**Files:**
- Create: `src/components/inbox/pdf-message-preview.tsx`
- Create: `src/components/inbox/pdf-message-preview.test.tsx`
- Modify: `src/components/inbox/message-media.tsx`
- Modify: `src/components/inbox/message-media.test.tsx`

**Interfaces:**
- Consumes: `mediaId`, filename, `onOpen()` and `/api/media/${encodeURIComponent(mediaId)}/thumbnail`.
- Produces: `PdfMessagePreview` with one accessible button and safe fallback.

- [ ] **Step 1: Write failing component tests**

Cover loading, load, error and interaction with both directions:

```tsx
render(<PdfMessagePreview filename="Nota fiscal.pdf" mediaId={mediaId} onOpen={onOpen} />);
const button = screen.getByRole("button", { name: "Abrir PDF Nota fiscal.pdf" });
expect(button).toHaveClass("min-h-11");
expect(screen.getByRole("img", { name: "Prévia da primeira página de Nota fiscal.pdf" }))
  .toHaveAttribute("src", `/api/media/${mediaId}/thumbnail`);
fireEvent.load(screen.getByRole("img"));
expect(screen.getByText("PDF")).toBeVisible();
fireEvent.click(button);
expect(onOpen).toHaveBeenCalledOnce();
```

On `error`, assert the thumbnail image is removed and the same button still shows the PDF icon and filename. In `MessageMedia`, exercise `direction: "INBOUND"` and `"OUTBOUND"`, then preserve the direct-download assertion for non-PDF documents.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm test -- src/components/inbox/pdf-message-preview.test.tsx src/components/inbox/message-media.test.tsx`

Expected: FAIL because `PdfMessagePreview` does not exist and the current PDF trigger has no image.

- [ ] **Step 3: Implement the focused preview component**

Use a single semantic button. Render a top-anchored preview area approximately `aspect-[4/3] w-[min(16rem,70vw)]`, a neutral loading surface, and a compact footer with `FileText`, truncated filename and `PDF`. Keep decorative elements `aria-hidden`; give the thumbnail an informative alt and the button the complete action label. On image error, switch to the current compact icon-and-filename layout.

Do not add gradients, nested cards, badges, extra download controls or animation libraries. Use existing CSS variables, a restrained rose PDF icon and visible keyboard focus.

- [ ] **Step 4: Integrate with `MessageMedia`**

Replace only the eligible PDF branch:

```tsx
return (
  <PdfMessagePreview
    filename={message.localFileName || message.body || "Documento PDF"}
    mediaId={mediaId!}
    onOpen={() => onOpenMedia(message.id)}
    buttonRef={(element) => { reconciledFocusTarget.current = element; }}
  />
);
```

Define `buttonRef?: React.Ref<HTMLButtonElement>` on `PdfMessagePreview`. If an otherwise eligible local optimistic PDF has no `mediaId` yet, keep the compact icon-and-filename trigger until its persisted media identifier arrives.

- [ ] **Step 5: Run focused UI tests and refine accessibility**

Run: `npm test -- src/components/inbox/pdf-message-preview.test.tsx src/components/inbox/message-media.test.tsx src/components/inbox/message-bubble.test.tsx src/components/inbox/conversation-view.test.tsx`

Expected: all tests PASS; the opening button retains focus before the dialog and receives focus again after closing.

- [ ] **Step 6: Commit**

```powershell
git add src/components/inbox/pdf-message-preview.tsx src/components/inbox/pdf-message-preview.test.tsx src/components/inbox/message-media.tsx src/components/inbox/message-media.test.tsx
git commit -m "feat: preview PDFs inside conversation bubbles"
```

### Task 6: Full verification, parallel integration audit and production deployment

**Files:**
- Create: `docs/verification/2026-08-23-pdf-conversation-thumbnail.md`
- Inspect before deployment: every active worktree, branch and production release manifest.

**Interfaces:**
- Consumes: all prior tasks and the immutable KVM release workflow.
- Produces: deployed image, rollback evidence and browser proof without restarting database or gateway.

- [ ] **Step 1: Run static and focused verification**

Run:

```powershell
npm run lint
npm run typecheck
npm test -- src/modules/media/pdf-thumbnail.test.ts 'src/app/api/media/[id]/thumbnail/route.test.ts' src/components/inbox/pdf-message-preview.test.tsx src/components/inbox/message-media.test.tsx
pwsh -NoProfile -File scripts/test-deployment.ps1
pwsh -NoProfile -File scripts/verify-kvm-deployment.ps1
git diff --check
```

Expected: every command exits 0 with no failed test.

- [ ] **Step 2: Run the complete suite and production build**

Run:

```powershell
npm test
npm run build
```

Expected: all non-optional tests PASS and Next.js production build exits 0.

- [ ] **Step 3: Audit parallel work immediately before deployment**

Record `git worktree list --porcelain`, recent branch heads, dirty state of each active worktree and commits newer than the current integration base. Integrate only completed code with known ancestry; leave planning-only or uncommitted work untouched. Re-run focused tests after any integration.

- [ ] **Step 4: Build and test the exact immutable Linux image**

Build from a clean Git archive of the final code revision. Inside the candidate image, verify `pdftoppm -v`, run migrations against a disposable database, execute the complete test suite with the documented test origin, and remove the disposable database afterward.

- [ ] **Step 5: Back up and deploy only the application**

Create a validated database/media backup, snapshot app/database/gateway/non-app container IDs, keep the previous image as rollback, promote a release directory named by the exact Git revision, and recreate only `xp-whatsapp-app` with `--no-deps --force-recreate --wait`. Do not reload Caddy and do not restart PostgreSQL or other KVM systems.

- [ ] **Step 6: Verify production behavior**

Confirm:

- `/api/health` returns 200;
- unauthenticated thumbnail returns 401;
- authenticated thumbnail returns a valid PNG with the secure headers;
- one received and one sent PDF show page-1 previews;
- the first request generates and the second reuses the cache;
- clicking each card opens the full PDF viewer;
- a forced thumbnail failure in the component/browser test environment shows the compact fallback without breaking open/download; production data is not corrupted to test this state;
- desktop and mobile viewport render without overflow or console errors;
- database, gateway and all non-app container IDs remain unchanged;
- app runs as `1001:1001`, stays healthy and has zero restart growth during the soak sample.

- [ ] **Step 7: Record evidence and commit**

Write exact revision, image ID, backup path, migration state, test counts, parallel audit, container hashes, browser results and rollback reference to the verification document.

```powershell
git add docs/verification/2026-08-23-pdf-conversation-thumbnail.md
git commit -m "docs: record PDF thumbnail production verification"
```
