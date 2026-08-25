# WhatsApp-Style Audio Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native message audio controls with a WhatsApp-style player that shows duration, enforces one active audio and cycles persistent session speeds of `1×`, `1.5×` and `2×`.

**Architecture:** Keep the authenticated media endpoint and native `<audio>` engine, but hide its browser controls behind a focused React component. Isolate playback ownership and session speed preference in small client modules, then connect both message players and the recording preview to the same coordinator.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library, native HTMLMediaElement and sessionStorage.

## Global Constraints

- Do not add a database migration, API route, audio conversion or dependency.
- Only `1`, `1.5` and `2` are valid speeds; a new browser session starts at `1×`.
- Only one application audio may play at a time; videos are outside this coordinator.
- Duration and progress are real media metadata; segmented visuals must not claim to be a true waveform.
- All interactive targets are at least 44px, keyboard accessible and visibly focused.
- Errors are sanitized and never expose HTTP, codec, filesystem or Meta details.
- Use TDD: each production behavior must be preceded by a test that fails for the intended reason.
- Do not use subagents. Audit all worktrees and the live KVM revision immediately before deployment.

---

## File structure

- Create `src/components/inbox/audio-playback.ts`: pure time/speed helpers, session preference subscription and the single-active-element coordinator.
- Create `src/components/inbox/audio-playback.test.ts`: unit contracts for formatting, storage, speed broadcasts and ownership.
- Create `src/components/inbox/audio-message-player.tsx`: controlled message player UI and native media event bridge.
- Create `src/components/inbox/audio-message-player.test.tsx`: component behavior, accessibility and failure tests.
- Modify `src/components/inbox/message-media.tsx`: render the new player for available audio.
- Modify `src/components/inbox/message-media.test.tsx`: integration contract for received, sent and reconciled audio.
- Modify `src/components/inbox/message-composer.tsx`: connect recording preview to exclusive playback.
- Modify `src/components/inbox/message-composer.test.tsx`: prove preview/message coordination and cleanup.
- Create `docs/verification/2026-08-24-whatsapp-audio-player.md`: exact release, test, browser and deployment evidence.

---

### Task 1: Playback primitives

**Files:**
- Create: `src/components/inbox/audio-playback.ts`
- Test: `src/components/inbox/audio-playback.test.ts`

**Interfaces:**
- Produces: `type AudioPlaybackSpeed = 1 | 1.5 | 2`.
- Produces: `formatAudioTime(seconds: number): string`.
- Produces: `readAudioPlaybackSpeed(storage?: Pick<Storage, "getItem">): AudioPlaybackSpeed`.
- Produces: `setAudioPlaybackSpeed(speed: AudioPlaybackSpeed, storage?: Pick<Storage, "setItem">): void`.
- Produces: `nextAudioPlaybackSpeed(speed: AudioPlaybackSpeed): AudioPlaybackSpeed`.
- Produces: `subscribeAudioPlaybackSpeed(listener: (speed: AudioPlaybackSpeed) => void): () => void`.
- Produces: `claimAudioPlayback(element: HTMLAudioElement): void` and `releaseAudioPlayback(element: HTMLAudioElement): void`.

- [ ] **Step 1: Write failing helper and coordinator tests**

```ts
it.each([
  [0, "0:00"],
  [65.9, "1:05"],
  [3_661, "1:01:01"],
  [Number.NaN, "—:—"],
  [Number.POSITIVE_INFINITY, "—:—"],
])("formats %s seconds", (seconds, expected) => {
  expect(formatAudioTime(seconds)).toBe(expected);
});

it("cycles only through the approved speeds", () => {
  expect(nextAudioPlaybackSpeed(1)).toBe(1.5);
  expect(nextAudioPlaybackSpeed(1.5)).toBe(2);
  expect(nextAudioPlaybackSpeed(2)).toBe(1);
});

it("falls back from corrupt or blocked session storage", () => {
  expect(readAudioPlaybackSpeed({ getItem: () => "9" })).toBe(1);
  expect(readAudioPlaybackSpeed({ getItem: () => { throw new Error("blocked"); } })).toBe(1);
});

it("pauses the previous owner and never pauses the claimant", () => {
  const first = document.createElement("audio");
  const second = document.createElement("audio");
  vi.spyOn(first, "pause");
  vi.spyOn(second, "pause");
  claimAudioPlayback(first);
  claimAudioPlayback(second);
  expect(first.pause).toHaveBeenCalledOnce();
  expect(second.pause).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/components/inbox/audio-playback.test.ts`

Expected: FAIL because `audio-playback.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal primitives**

```ts
export type AudioPlaybackSpeed = 1 | 1.5 | 2;
const SPEEDS = [1, 1.5, 2] as const;
const STORAGE_KEY = "xp-audio-playback-speed-v1";
const listeners = new Set<(speed: AudioPlaybackSpeed) => void>();
let activeAudio: HTMLAudioElement | null = null;

export function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—:—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function nextAudioPlaybackSpeed(speed: AudioPlaybackSpeed) {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
}
```

Implement storage access inside `try/catch`, emit to a copied listener set after a successful in-memory choice, and make `releaseAudioPlayback` clear only the matching owner.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx vitest run src/components/inbox/audio-playback.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/audio-playback.ts src/components/inbox/audio-playback.test.ts
git commit -m "feat: coordinate exclusive audio playback"
```

---

### Task 2: Controlled message audio player

**Files:**
- Create: `src/components/inbox/audio-message-player.tsx`
- Test: `src/components/inbox/audio-message-player.test.tsx`

**Interfaces:**
- Consumes all exports from `audio-playback.ts`.
- Produces: `AudioMessagePlayer({ source, identity, buttonRef }: { source: string; identity: string; buttonRef?: (element: HTMLButtonElement | null) => void }): React.JSX.Element`.

- [ ] **Step 1: Write failing rendering and metadata tests**

```tsx
render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
const audio = screen.getByLabelText("Áudio da conversa");
Object.defineProperty(audio, "duration", { configurable: true, value: 37 });
fireEvent.loadedMetadata(audio);
expect(screen.getByText("0:00 / 0:37")).toBeVisible();
expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toHaveClass("min-h-11");
expect(screen.getByRole("slider", { name: "Posição do áudio" })).toHaveAttribute("max", "37");
expect(screen.getByRole("button", { name: "Velocidade 1×; alterar para 1,5×" })).toBeVisible();
```

Add separate tests for invalid duration (`—:—` and disabled slider), `timeupdate`, seeking to 12 seconds, `ended`, media error and rejected `play()`.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run src/components/inbox/audio-message-player.test.tsx`

Expected: FAIL because `AudioMessagePlayer` does not exist.

- [ ] **Step 3: Implement the native event bridge**

```tsx
const audioElement = useRef<HTMLAudioElement>(null);
const [duration, setDuration] = useState(Number.NaN);
const [currentTime, setCurrentTime] = useState(0);
const [playing, setPlaying] = useState(false);
const [speed, setSpeed] = useState<AudioPlaybackSpeed>(() => readAudioPlaybackSpeed());

function syncDuration(event: SyntheticEvent<HTMLAudioElement>) {
  const value = event.currentTarget.duration;
  setDuration(Number.isFinite(value) && value > 0 ? value : Number.NaN);
}

async function togglePlayback() {
  const audio = audioElement.current;
  if (!audio) return;
  if (!audio.paused) return audio.pause();
  if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration) audio.currentTime = 0;
  claimAudioPlayback(audio);
  audio.playbackRate = speed;
  try { await audio.play(); } catch { releaseAudioPlayback(audio); setPlaying(false); setError("Não foi possível reproduzir este áudio."); }
}
```

The hidden engine must keep `preload="metadata"`, the authenticated `src`, `onPlay`, `onPause`, `onEnded`, `onTimeUpdate`, `onDurationChange`, `onLoadedMetadata` and `onError`. Cleanup pauses and releases the element.

- [ ] **Step 4: Implement the WhatsApp-style controls**

Use Lucide `Play` and `Pause` inside one 44px button, an accessible range input with segmented neutral background and an accent progress layer, tabular time, and a 44px speed button. Keep a stable minimum width without exceeding the message bubble:

```tsx
<div className="flex w-full min-w-0 max-w-[19rem] items-center gap-2" data-audio-player={identity}>
  <Button aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"} className="min-h-11 min-w-11 rounded-full" ref={buttonRef} size="icon" type="button">
    {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
  </Button>
  <div className="min-w-0 flex-1">
    <input aria-label="Posição do áudio" aria-valuetext={`${formatAudioTime(currentTime)} de ${formatAudioTime(duration)}`} max={Number.isFinite(duration) ? duration : 0} min={0} onChange={seek} type="range" value={currentTime} />
    <span className="font-mono text-xs tabular-nums">{`${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`}</span>
  </div>
  <Button className="min-h-11 min-w-11 px-2 font-semibold tabular-nums" type="button" variant="ghost">{speedLabel}</Button>
</div>
```

- [ ] **Step 5: Run the component test and verify GREEN**

Run: `npx vitest run src/components/inbox/audio-message-player.test.tsx`

Expected: PASS with no act, accessibility or console warnings.

- [ ] **Step 6: Refactor duplicated event cleanup and rerun**

Run: `npx vitest run src/components/inbox/audio-message-player.test.tsx src/components/inbox/audio-playback.test.ts`

Expected: both files PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/inbox/audio-message-player.tsx src/components/inbox/audio-message-player.test.tsx
git commit -m "feat: add WhatsApp-style message audio player"
```

---

### Task 3: Conversation and recording integration

**Files:**
- Modify: `src/components/inbox/message-media.tsx`
- Modify: `src/components/inbox/message-media.test.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-composer.test.tsx`

**Interfaces:**
- Consumes `AudioMessagePlayer` and `claimAudioPlayback`/`releaseAudioPlayback`.
- Preserves the public props of `MessageMedia` and `MessageComposer`.

- [ ] **Step 1: Replace the old integration assertions with failing player contracts**

```tsx
it.each(["INBOUND", "OUTBOUND"] as const)("renders the controlled %s audio player", (direction) => {
  render(<MessageMedia message={{ ...availableAudio, direction }} />);
  expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toBeVisible();
  expect(screen.getByLabelText("Áudio da conversa")).toHaveAttribute("src", `/api/media/${availableAudio.mediaObjectId}`);
  expect(screen.queryByRole("audio")).toBeNull();
});
```

Keep the existing pending/recovery assertions. Add a reconciliation test that changes `mediaObjectId` and expects the player engine source and `data-audio-player` identity to change.

In `message-composer.test.tsx`, mock the coordinator and assert `fireEvent.play(preview)` claims the preview, while pause/unmount releases it.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `npx vitest run src/components/inbox/message-media.test.tsx src/components/inbox/message-composer.test.tsx`

Expected: FAIL because messages still expose native controls and the preview does not coordinate ownership.

- [ ] **Step 3: Integrate `AudioMessagePlayer` in `MessageMedia`**

```tsx
if (message.type === "AUDIO") {
  return (
    <AudioMessagePlayer
      buttonRef={(element) => { reconciledFocusTarget.current = element; }}
      identity={mediaIdentity}
      source={source}
    />
  );
}
```

- [ ] **Step 4: Coordinate the composer preview**

```tsx
<audio
  aria-label="Prévia da gravação"
  controls
  onEnded={(event) => releaseAudioPlayback(event.currentTarget)}
  onPause={(event) => releaseAudioPlayback(event.currentTarget)}
  onPlay={(event) => claimAudioPlayback(event.currentTarget)}
  preload="metadata"
  ref={previewRef}
  src={recorder.recording.previewUrl}
/>
```

Add cleanup that pauses and releases the current preview when its URL changes or the component unmounts.

- [ ] **Step 5: Run integration tests and verify GREEN**

Run: `npx vitest run src/components/inbox/message-media.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx`

Expected: PASS, including optimistic audio reconciliation and recording workflows.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/message-media.tsx src/components/inbox/message-media.test.tsx src/components/inbox/message-composer.tsx src/components/inbox/message-composer.test.tsx
git commit -m "feat: integrate exclusive audio controls"
```

---

### Task 4: Quality gates and production release

**Files:**
- Create: `docs/verification/2026-08-24-whatsapp-audio-player.md`

**Interfaces:**
- Consumes the complete feature and existing deployment scripts.
- Produces an immutable KVM release and evidence document; no application API changes.

- [ ] **Step 1: Run focused and related tests**

Run:

```powershell
$env:DATABASE_URL='postgresql://xp_whatsapp:test-only-password@database:5432/xp_atendimento'
$env:AUTH_SECRET='test-only-auth-secret-with-more-than-32-characters'
$env:NEXT_PUBLIC_APP_URL='https://whatsapp.xpeletronicos.com'
npx vitest run src/components/inbox/audio-playback.test.ts src/components/inbox/audio-message-player.test.tsx src/components/inbox/message-media.test.tsx src/components/inbox/message-composer.test.tsx src/components/inbox/conversation-view.test.tsx src/components/inbox/inbox-shell.test.tsx
```

Expected: all selected files PASS with no warnings.

- [ ] **Step 2: Run static and production gates**

Run: `npm run lint`, `npm run typecheck`, `npm run build`, `./scripts/test-deployment.ps1`, and `./scripts/verify-kvm-deployment.ps1`.

Expected: every command exits zero.

- [ ] **Step 3: Audit parallel work immediately before deployment**

Compare `git worktree list --porcelain`, `git status --short` in every live worktree, recent branch commits, the KVM `current` symlink and the running image. The deploy candidate must contain the current production revision; stop if production has advanced to unrelated code that is not an ancestor.

- [ ] **Step 4: Build and verify the exact Linux artifact**

Create the source archive from `git archive HEAD`, build an immutable `xp-whatsapp:<full-sha>` image, verify its OCI revision label, non-root UID/GID, required runtime binaries, Next build and focused tests. Run the full suite against a disposable PostgreSQL database with `WHATSAPP_PROVIDER=demo`, then remove and confirm absence of that database.

- [ ] **Step 5: Back up and deploy only the application**

Use the existing validated backup script, preserve the previous image and environment file, extract to `/opt/apps/example-app/releases/<full-sha>`, recreate only `xp-whatsapp-app`, wait for Docker health, then promote `current` and `XP_WHATSAPP_IMAGE`. Database, gateway and unrelated container IDs must remain unchanged.

- [ ] **Step 6: Verify authenticated browser behavior**

Open a conversation already marked read with at least two audio messages. Confirm metadata duration, play/pause, seeking, `1× → 1,5× → 2×`, session persistence, starting the second pauses the first, recording preview exclusivity, responsive layout, focus behavior and zero console errors. Avoid changing unread/receipt state for unrelated customers.

- [ ] **Step 7: Record evidence and commit**

Write exact revision/image/container IDs, backup, test counts, audit result, browser evidence, health, migrations, logs and restarts to `docs/verification/2026-08-24-whatsapp-audio-player.md`.

```bash
git add docs/verification/2026-08-24-whatsapp-audio-player.md
git commit -m "docs: record audio player production verification"
```

- [ ] **Step 8: Final verification**

Run `git diff --check`, confirm `git status --short` is empty, public `/api/health` returns 200, the app container is healthy with zero restarts and its immutable image matches the deployed functional revision.
