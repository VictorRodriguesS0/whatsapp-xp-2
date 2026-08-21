# Audio Recording and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated attendant record up to five minutes of voice in the inbox, preview it, convert it to OGG/Opus on the server, and send it through the existing idempotent WhatsApp media pipeline.

**Architecture:** A browser-only `useAudioRecorder` hook owns microphone permission, `MediaRecorder`, timers, the raw `File`, preview URL, and cleanup. A dedicated authenticated recording route streams at most 16 MB, admits work through process-local rate/concurrency limits, converts the browser file with bounded FFprobe/FFmpeg subprocesses, validates the final OGG/Opus file, and hands it to the existing `sendMessage` service with the original `clientRequestId`. The current message service remains the single owner of persistence, provider delivery, idempotency, SSE, retry, and conservative failure states.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, MediaRecorder/getUserMedia, Vitest/Testing Library, Busboy streaming multipart, Node `child_process.spawn`, FFmpeg/FFprobe, PostgreSQL/Prisma, Docker, WhatsApp Cloud API.

**Execution status (2026-08-20):** Tasks 1–4 and Task 5 Steps 1–6 are implemented and locally verified. Independent final review, KVM rollout, and the user-confirmed real WhatsApp playback remain pending.

## Global Constraints

- User flow: one action starts recording, one action stops it, and a preview must be shown before sending.
- Maximum raw upload: exactly 16 MiB; maximum duration: exactly 300 seconds.
- Preferred capture types, in order: `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/mp4`.
- Accepted raw MIME essences: `audio/webm`, `audio/ogg`, `audio/mp4`; no raw browser format enters the common attachment route.
- Final file: OGG container, Opus voice codec, mono, 48 kHz, about 24 kbit/s, metadata removed, persisted MIME `audio/ogg`.
- No caption, pause, waveform, editing, trimming, automatic sending, raw-file persistence, or database migration.
- `getUserMedia` runs only after the user activates the microphone control.
- Every stream track, timer, event handler, subprocess, file descriptor, temporary file, and object URL is released on every terminal branch.
- Server processes use `spawn` with `shell: false`, fixed program names, server-generated UUID paths, 10-second FFprobe timeout, 60-second FFmpeg timeout, and an 8 KiB diagnostic cap.
- Admission is process-local and fail-fast: at most one conversion per user, two in the process, and ten attempts per user per ten minutes.
- Existing same-origin, authentication, error-envelope, idempotency, provider, SSE, storage, backup, non-root UID 1001, and app-only KVM deployment contracts remain intact.
- Controls have accessible names and 44 px targets; status changes are announced; desktop, tablet, and 390 px mobile layouts must not overflow.

---

### Task 1: Bounded Recording Conversion Core

**Files:**
- Create: `src/modules/recordings/converter.ts`
- Create: `src/modules/recordings/converter.test.ts`
- Create: `src/modules/recordings/converter.integration.test.ts`
- Create: `src/modules/recordings/limiter.ts`
- Create: `src/modules/recordings/limiter.test.ts`

**Interfaces:**
- Consumes: `StagedMediaFile`, `ensurePrivateDirectoryTree`, `validateMediaFile`, and `HttpError`.
- Produces:

```ts
export const RAW_RECORDING_MAX_BYTES = 16 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 300;
export const RECORDING_OUTPUT_MIME = "audio/ogg";
export const RAW_RECORDING_MIME_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);

export type ProcessResult = { stdout: string; stderr: string };
export type RunBoundedProcess = (input: {
  command: "ffmpeg" | "ffprobe";
  args: string[];
  timeoutMs: number;
  diagnosticLimitBytes: number;
}) => Promise<ProcessResult>;

export async function convertRecording(
  input: { root: string; source: StagedMediaFile },
  dependencies?: { runProcess?: RunBoundedProcess; createUuid?: () => string },
): Promise<StagedMediaFile>;

export type RecordingAdmission = { release(): void };
export class RecordingAdmissionLimiter {
  tryAcquire(userId: string, now?: Date): RecordingAdmission | "BUSY" | "RATE_LIMITED";
}
```

- [x] **Step 1: Write RED tests for process safety, media probing, output validation, and cleanup**

Create `converter.test.ts` with tests that require:

```ts
it("runs ffprobe and ffmpeg without a shell and with fixed voice arguments", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  // The injected runner returns source probe JSON, creates the expected output,
  // and returns final probe JSON.
  const result = await convertRecording({ root, source }, { runProcess, createUuid: () => outputId });
  expect(calls[0]).toMatchObject({ command: "ffprobe", timeoutMs: 10_000 });
  expect(calls[1].command).toBe("ffmpeg");
  expect(calls[1].args).toEqual(expect.arrayContaining([
    "-nostdin", "-hide_banner", "-loglevel", "error", "-map_metadata", "-1",
    "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus",
    "-application", "voip", "-b:a", "24k", "-t", "300", "-f", "ogg",
  ]));
  expect(calls[1].timeoutMs).toBe(60_000);
  expect(result).toMatchObject({ mimeType: "audio/ogg", filename: "gravacao.ogg" });
});
```

Add separate cases for unsupported raw MIME, no audio stream, zero/NaN duration, duration above 300 seconds, FFprobe timeout, FFmpeg timeout/crash, diagnostics above 8 KiB, invalid OGG bytes, non-Opus output, non-mono output, non-48 kHz output, changed output size/hash, and cleanup of the generated output after every failure. Test `runBoundedProcess` with an injected fake `spawn` and assert `{ shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }`, forced termination on timeout/overflow, and listener/timer cleanup.

- [x] **Step 2: Run the converter tests and verify RED**

Run:

```powershell
npx vitest run src/modules/recordings/converter.test.ts
```

Expected: FAIL because `converter.ts` does not exist.

- [x] **Step 3: Implement the minimal converter and bounded subprocess runner**

Implement these exact rules:

```ts
const probeArgs = (path: string) => [
  "-v", "error", "-select_streams", "a:0",
  "-show_entries", "stream=codec_type,codec_name,channels,sample_rate:format=duration",
  "-of", "json", path,
];

const convertArgs = (input: string, output: string) => [
  "-nostdin", "-hide_banner", "-loglevel", "error", "-i", input,
  "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "48000",
  "-c:a", "libopus", "-application", "voip", "-b:a", "24k",
  "-t", "300", "-f", "ogg", "-n", output,
];
```

Canonicalize only the MIME essence before checking `RAW_RECORDING_MIME_TYPES`. Create a private `.recordings` directory under `MEDIA_ROOT`; validate its real path remains below the real media root. Use a UUID-only `.ogg` output path. Parse FFprobe JSON through a Zod schema; validate the source duration and audio stream before conversion, then probe the result and require `opus`, one channel, 48000 Hz, and a duration in `(0, 300]`. Finally call:

```ts
await validateMediaFile({
  path: outputPath,
  filename: "gravacao.ogg",
  mimeType: RECORDING_OUTPUT_MIME,
});
```

Return a `StagedMediaFile` with a SHA-256, exact size, idempotent `cleanup()`, and no raw user filename in process arguments or diagnostics. Convert all public failures to short `HttpError` messages in Portuguese and never expose stderr.

- [x] **Step 4: Write and run RED/GREEN limiter tests**

Tests must prove one active conversion per user, two globally, fail-fast `BUSY`, ten admitted attempts in ten minutes, the eleventh `RATE_LIMITED`, expiry at the exact window boundary, idempotent release, and no rate debit for a request rejected solely because the concurrency ceiling is full.

Run:

```powershell
npx vitest run src/modules/recordings/limiter.test.ts
```

Expected before implementation: FAIL because `limiter.ts` does not exist. Implement a process-local `RecordingAdmissionLimiter` with opaque admission IDs and exact release ownership; rerun and require all tests PASS.

- [x] **Step 5: Add an opt-in real FFmpeg integration test**

Create `converter.integration.test.ts` guarded by `RUN_FFMPEG_INTEGRATION=1`. Generate a short WebM/Opus source with FFmpeg, call `convertRecording`, probe the returned file, and assert OGG/Opus, mono, 48 kHz, duration greater than zero, size below 16 MiB, and cleanup. When the environment flag is absent, skip only this file's real-binary test.

- [x] **Step 6: Run Task 1 GREEN and commit**

Run:

```powershell
npx vitest run src/modules/recordings/converter.test.ts src/modules/recordings/limiter.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests PASS; typecheck and diff check exit 0.

Commit:

```powershell
git add src/modules/recordings
git commit -m "feat: add bounded audio conversion"
```

---

### Task 2: Streaming Recording API

**Files:**
- Modify: `src/modules/media/multipart.ts`
- Modify: `src/modules/media/multipart.test.ts`
- Create: `src/modules/recordings/multipart.ts`
- Create: `src/modules/recordings/multipart.test.ts`
- Create: `src/app/api/conversations/[id]/recordings/route.ts`
- Create: `src/app/api/conversations/[id]/recordings/route.test.ts`

**Interfaces:**
- Consumes: `assertSameOrigin`, `requireUser`, `conversationIdSchema`, `getConversation`, `clientRequestIdSchema`, `convertRecording`, `RecordingAdmissionLimiter`, and `sendMessage`.
- Produces: authenticated `POST /api/conversations/[id]/recordings` returning the existing `{ data, error }` envelope and `MessageDto` with status 201.

- [x] **Step 1: Write RED tests for a configurable streaming multipart core**

Refactor by test, not by copying. Add tests around a new internal/exported function:

```ts
export async function parseMultipartFileRequest(input: {
  request: Request;
  root: string;
  maximumFileBytes: number;
  maximumRequestBytes: number;
  allowedFields: readonly string[];
}): Promise<{ fields: Record<string, string>; file: StagedMediaFile }>;
```

Require the existing media parser to preserve its current limits and accepted fields. Require the recording wrapper to accept only `clientRequestId` plus one `file`, reject duplicate/unknown/truncated fields, reject missing/duplicate/empty files, reject `Content-Length` above `16 MiB + 64 KiB` before reading, stop a chunked request at the same bound, and clean staged data on parser/schema failure.

- [x] **Step 2: Run multipart tests and verify RED**

Run:

```powershell
npx vitest run src/modules/media/multipart.test.ts src/modules/recordings/multipart.test.ts
```

Expected: the new recording suite fails because its module and configurable parser do not exist; all pre-existing media cases remain GREEN.

- [x] **Step 3: Implement the generic parser and recording wrapper**

Keep Busboy, immediate rejection handling, streaming staging, size/hash calculation, and cleanup semantics. `parseRecordingMultipartRequest(request, root)` must call the generic parser with:

```ts
{
  maximumFileBytes: 16 * 1024 * 1024,
  maximumRequestBytes: 16 * 1024 * 1024 + 64 * 1024,
  allowedFields: ["clientRequestId"],
}
```

Do not call `request.formData()` or materialize the upload as an `ArrayBuffer`.

- [x] **Step 4: Write the recording route RED suite**

The route tests must assert this order and behavior:

1. cross-origin request rejected before authentication/body access;
2. unauthenticated request returns 401 before body access;
3. invalid conversation UUID and inaccessible conversation return the stable 400/404 envelopes before admission/body access;
4. `BUSY` and `RATE_LIMITED` return 429 before multipart parsing;
5. invalid `clientRequestId`, unsupported raw MIME, malformed multipart, and oversized data clean all staging files;
6. conversion receives the staged raw file and the actor's admission is released in `finally`;
7. `sendMessage` receives exactly:

```ts
{
  type: "AUDIO",
  clientRequestId,
  file: {
    filename: "gravacao.ogg",
    mimeType: "audio/ogg",
    path,
    sizeBytes,
    sha256,
    cleanup,
  },
}
```

8. raw and converted temporaries are cleaned after success, conversion failure, send failure, and lost client response;
9. the same `clientRequestId` can safely repeat and delegates idempotency to `sendMessage`.

- [x] **Step 5: Run the route suite and verify RED**

Run:

```powershell
npx vitest run "src/app/api/conversations/[id]/recordings/route.test.ts"
```

Expected: FAIL because the route does not exist.

- [x] **Step 6: Implement the route with dependency injection**

Export `createConversationRecordingsRouteHandler(overrides)` for tests and a production `POST`. Use this exact operation sequence:

```ts
assertSameOrigin(request);
const actor = await requireUser();
const conversationId = conversationIdSchema.parse((await context.params).id);
await getConversation(actor.id, conversationId);
const admission = limiter.tryAcquire(actor.id);
if (admission === "BUSY") throw new HttpError(429, "Aguarde a conversão de áudio atual");
if (admission === "RATE_LIMITED") throw new HttpError(429, "Muitas gravações em pouco tempo");
```

Inside one `try/finally`, parse the raw upload, canonicalize and allowlist its MIME essence, validate the `clientRequestId`, convert it, call `sendMessage`, and return status 201. Cleanup both staged files and release admission in nested `finally` blocks. Map all exceptions through the existing conversation error response; do not log source names, diagnostics, body bytes, IDs, or provider payloads.

- [x] **Step 7: Run Task 2 GREEN and commit**

Run:

```powershell
npx vitest run src/modules/media/multipart.test.ts src/modules/recordings/multipart.test.ts "src/app/api/conversations/[id]/recordings/route.test.ts" "src/app/api/conversations/[id]/messages/route.test.ts"
npm run lint
npm run typecheck
git diff --check
```

Expected: all focused suites PASS; lint/typecheck/diff exit 0.

Commit:

```powershell
git add src/modules/media/multipart.ts src/modules/media/multipart.test.ts src/modules/recordings/multipart.ts src/modules/recordings/multipart.test.ts "src/app/api/conversations/[id]/recordings"
git commit -m "feat: accept recorded audio uploads"
```

---

### Task 3: Browser Recording Hook

**Files:**
- Create: `src/hooks/use-audio-recorder.ts`
- Create: `src/hooks/use-audio-recorder.test.tsx`

**Interfaces:**
- Consumes: browser `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `URL.createObjectURL`, and `crypto.randomUUID` only after client mount/user action.
- Produces:

```ts
export type AudioRecording = {
  clientRequestId: string;
  durationMs: number;
  file: File;
  previewUrl: string;
};

export type AudioRecorderPhase = "idle" | "requesting" | "recording" | "preview" | "error";

export function useAudioRecorder(options: { scopeKey: string; maximumDurationMs?: number }): {
  phase: AudioRecorderPhase;
  supported: boolean;
  durationMs: number;
  recording: AudioRecording | null;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  discard(): void;
};
```

- [x] **Step 1: Write the complete hook RED suite**

Use deterministic fake `MediaStream`, tracks, `MediaRecorder`, timers, object URLs, and UUIDs. Cover:

- unsupported API without any permission request;
- MIME selection order and fallback validation from the final Blob type;
- one `getUserMedia({ audio: true })` call only after `start()`;
- repeated start protection while requesting/recording;
- permission denied, no device/busy, unsupported type, and interrupted capture messages in Portuguese;
- elapsed time derived from `Date.now()` and automatic `stop()` at exactly 300,000 ms;
- `stop()` produces a `File` whose MIME matches the Blob, creates one preview URL and one client UUID, and stops every track before preview;
- `cancel()` while requesting or recording ignores late permission/recorder callbacks;
- `discard()`, a changed `scopeKey`, and unmount stop tracks, clear timers/listeners, revoke exactly the owned URL once, and return to idle;
- zero-byte or disallowed final blobs are rejected without a preview.

- [x] **Step 2: Run the hook tests and verify RED**

Run:

```powershell
npx vitest run src/hooks/use-audio-recorder.test.tsx
```

Expected: FAIL because `use-audio-recorder.ts` does not exist.

- [x] **Step 3: Implement the minimal hook state machine**

Keep all mutable recorder/stream/timer/generation tokens in refs. A generation number must invalidate callbacks from any canceled or previous recording. Select the first supported MIME from the approved order; pass `{ mimeType, audioBitsPerSecond: 32_000 }` when a supported MIME exists and `{ audioBitsPerSecond: 32_000 }` for fallback. Accumulate `dataavailable` chunks, but accept the final Blob only when its MIME essence is one of the three allowed values and its size is in `(0, 16 MiB]`.

Use one short interval only to render elapsed time; compute `Math.min(Date.now() - startedAt, maximumDurationMs)` on each tick. Use a separate exact timeout for automatic stop. Never request permission during render/effect.

- [x] **Step 4: Run Task 3 GREEN and commit**

Run:

```powershell
npx vitest run src/hooks/use-audio-recorder.test.tsx
npm run lint
npm run typecheck
git diff --check
```

Expected: all hook tests PASS with no warning; lint/typecheck/diff exit 0.

Commit:

```powershell
git add src/hooks/use-audio-recorder.ts src/hooks/use-audio-recorder.test.tsx
git commit -m "feat: capture browser audio safely"
```

---

### Task 4: Composer, Optimistic State, and Accessible Interaction

**Files:**
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`
- Modify: `src/components/inbox/conversation-view.tsx`
- Modify: `src/components/inbox/conversation-view.test.tsx`
- Modify: `src/components/inbox/inbox-shell.tsx`
- Modify: `src/components/inbox/inbox-shell.test.tsx`
- Modify: `src/hooks/use-inbox.ts`
- Modify: `src/hooks/use-inbox.test.tsx`

**Interfaces:**
- Consumes: `useAudioRecorder({ scopeKey: conversationId })` and the dedicated recordings route.
- Produces:

```ts
MessageComposerProps.onSendRecording: (
  file: File,
  clientRequestId: string,
) => Promise<unknown>;

useInbox(...).sendRecording: (
  conversationId: string,
  file: File,
  clientRequestId: string,
) => Promise<InboxMessage | null>;
```

- [x] **Step 1: Write composer RED tests**

Test the user-visible contract:

- empty composer shows `Gravar áudio` instead of a disabled send button;
- text or an attachment keeps the current send behavior and hides the microphone;
- requesting shows a busy accessible state and blocks repeated activation;
- recording shows a red status dot, drift-free `mm:ss`, `Cancelar gravação`, and `Parar gravação`;
- preview renders `<audio controls>`, duration, `Apagar gravação`, and `Enviar gravação`, without a caption field;
- send awaits `onSendRecording(file, clientRequestId)`, displays `Enviando gravação`, discards on a truthy result, and preserves the preview on `null`/rejection;
- cancel/delete restores focus to `Gravar áudio`; stop focuses the preview controls; status changes are exposed through `role="status"`/`aria-live="polite"`;
- every action target has `min-h-11`/44 px and disabled state follows the conversation loading state;
- changing `conversationId` cancels and cleans an active recording.

- [x] **Step 2: Run composer tests and verify RED**

Run:

```powershell
npx vitest run src/components/inbox/message-composer.test.tsx
```

Expected: new cases FAIL because microphone states and `onSendRecording` are absent; the two existing composer tests remain GREEN.

- [x] **Step 3: Implement the composer states without duplicating recorder logic**

Add `Mic`, `Square`, and `Trash2` icons; keep existing typography, border, canvas/panel tokens, and cardless composition. The component calls only the hook API and owns only the network `sending` flag/focus refs. Format duration with a pure local helper covered by test. Use the native `<audio controls preload="metadata">` for preview. Do not introduce waveform, animation, a recording modal, or browser API access in the component.

- [x] **Step 4: Write RED tests for inbox transport and reconciliation**

Extend the pending media discriminant:

```ts
type PendingMedia = {
  kind: "media";
  source: "attachment" | "recording";
  conversationId: string;
  clientRequestId: string;
  body: string;
  file: File;
  type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  previewUrl?: string;
};
```

Require recordings to POST only `clientRequestId` and `file` to `/api/conversations/:id/recordings`, while attachments retain the existing messages route and fields. Assert optimistic `AUDIO/PENDING`, reuse of the hook-provided UUID, one optimistic row across retry, raw `File` preservation after conversion/network failure, retry through the recordings route while no persisted `mediaObjectId` exists, normal `/api/messages/:id/retry` after media persistence, SSE-before-HTTP deduplication, exactly-once preview URL revocation, and stale-conversation guards.

- [x] **Step 5: Run inbox tests and verify RED**

Run:

```powershell
npx vitest run src/hooks/use-inbox.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: new recording transport/propagation cases FAIL; existing pagination, media, focus, and SSE cases stay GREEN.

- [x] **Step 6: Implement recording transport and prop propagation**

Add `sendRecording` beside `sendMedia`. Factor `createPendingMedia` only if it removes real duplication without changing existing behavior. In `performSend`, choose the endpoint from `pending.source`; recording multipart must not include `type` or `body`. Propagate `onSendRecording` through `InboxShell` and `ConversationView`, and pass the selected conversation ID into `MessageComposer` as the recorder scope key.

When the composer begins sending, `useInbox` must synchronously own an immutable `File` and its own preview URL before the hook can discard its URL. Preserve the existing alias/reconciliation rules by `clientRequestId`.

- [x] **Step 7: Run Task 4 GREEN and commit**

Run:

```powershell
npx vitest run src/hooks/use-audio-recorder.test.tsx src/components/inbox/message-composer.test.tsx src/hooks/use-inbox.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx
npm run lint
npm run typecheck
git diff --check
```

Expected: all focused tests PASS with no React act, console, object-URL, or event-listener warnings.

Commit:

```powershell
git add src/hooks/use-inbox.ts src/hooks/use-inbox.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.tsx src/components/inbox/inbox-shell.test.tsx
git commit -m "feat: record and preview voice messages"
```

---

### Task 5: Runtime Packaging, Full Verification, and Production Rollout

**Files:**
- Modify: `Dockerfile`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-20-audio-recording.md`
- Create: `.superpowers/sdd/audio-recording-report.md`

**Interfaces:**
- Consumes: all prior tasks and the existing immutable KVM release process.
- Produces: a non-root production image containing FFmpeg/FFprobe and a verified app-only production release.

- [x] **Step 1: Write a RED runtime packaging assertion**

Extend the deployment verification script or add a focused test that requires the final Docker runtime to install both `ffmpeg` and `ffprobe` from Debian packages and forbids shell-based converter invocation. Run it before editing the Dockerfile and observe the expected failure because FFmpeg is absent.

- [x] **Step 2: Install FFmpeg/FFprobe in the image**

Change the base package installation to:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

Do not add a privileged user, extra volume, host binary mount, shell wrapper, or new public port.

- [x] **Step 3: Run the real Linux conversion and integration gates**

Build a test-capable image from the committed source and run:

```text
RUN_FFMPEG_INTEGRATION=1
src/modules/recordings/converter.integration.test.ts
src/app/api/conversations/[id]/recordings/route.test.ts
src/modules/messages/service.integration.test.ts
```

Use the isolated `_test` PostgreSQL database. Require real FFmpeg conversion, demo-provider delivery, one message row, one media row, no raw recording in the media volume, and an empty `.recordings`/`.staging` directory after completion.

- [x] **Step 4: Run all local quality gates**

Run each command independently and stop on the first failure:

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run db:generate
npm run build
npm audit --audit-level=high
pwsh scripts/verify-compose.ps1
pwsh scripts/verify-kvm-deployment.ps1
git diff --check
```

Expected: zero test failures/warnings; lint/typecheck/Prisma/build/verifiers exit 0; audit reports zero vulnerabilities.

- [x] **Step 5: Run browser QA before deployment**

Over HTTPS or a secure local context, verify microphone permission denied/allowed, start/stop, automatic five-minute stop using a shortened test clock, preview playback, delete, retry after simulated network failure, and send through the demo provider. Check 1440×900, 900×1100, and 390×844 for no horizontal overflow, keyboard focus restoration, 44 px controls, reduced motion, console cleanliness, and microphone track shutdown after every exit.

- [x] **Step 6: Build and inspect the immutable production image**

Tag the exact commit `xp-whatsapp:<commit>`. Verify:

```text
ffmpeg -version exits 0
ffprobe -version exits 0
effective UID is 1001
/api/health is 200
no application test files in standalone runtime
no token, app secret, database password, or verify token in image config/history
```

- [ ] **Step 7: Deploy only the application service to the KVM**

Create `/opt/apps/example-app/releases/<commit>` from the exact Git archive, import the immutable image, point `current` to the release, and run only:

```text
docker compose --project-directory <current> --env-file /opt/apps/example-app/.env.production \
  -f <current>/deploy/kvm/docker-compose.yml \
  up -d --no-deps --no-build --force-recreate app
```

Require the canonical Compose hash to converge. Preserve the PostgreSQL container/volume, Caddy identity/start time, all unrelated KVM containers, media volume, networks, and rollback release. Roll back automatically if the app is unhealthy or public health returns non-200.

- [ ] **Step 8: Verify production with a real recorded message**

After health, login, legal pages, webhook GET, and invalid-signature checks pass, ask the user to record a short voice note in the production UI and send it to the already connected WhatsApp conversation. Verify without printing content or customer identifiers:

- one outbound `AUDIO` message and one media object;
- stored MIME `audio/ogg`, status `AVAILABLE`, Opus structure, size below 16 MiB;
- provider message ID set and final status at least `SENT`;
- the receiving phone can play the voice note;
- SSE shows one optimistic/confirmed row across two authenticated sessions;
- no converter timeout/crash, media failure, duplicate row, raw recording persistence, secret, body, phone payload, or FFmpeg diagnostics in logs.

- [ ] **Step 9: Document, review, and commit evidence**

Update the README with supported browsers, permission instructions, five-minute limit, fallback attachment behavior, and FFmpeg operations. Record RED/GREEN evidence, exact test counts, image ID, release commit, Compose hash, production timestamps, real audio result, and residual constraints in `.superpowers/sdd/audio-recording-report.md`. Run an independent code/security/UX review; fix every Critical or Important finding through a new RED/GREEN cycle.

Finish with fresh gates, then:

```powershell
git add Dockerfile README.md docs/superpowers/plans/2026-08-20-audio-recording.md .superpowers/sdd/audio-recording-report.md
git commit -m "docs: record audio recording rollout"
git status --short
```

Expected: final commit succeeds and worktree is clean.

---

## Plan Self-Review

- Spec coverage: browser capture, state/cleanup, accessibility, raw streaming, conversion, limits, idempotency, optimistic retry, Docker, Linux conversion, Meta delivery, backup boundary, and production isolation each have an explicit task and gate.
- Placeholder scan: no deferred implementation marker or unspecified error/edge-case step remains.
- Type consistency: `clientRequestId`, `StagedMediaFile`, final `audio/ogg`, `sendRecording`, and the dedicated recordings endpoint are identical in their producing and consuming tasks.
- Scope: no database migration, transcription, waveform, editing, pause, or horizontal scaling was added.
