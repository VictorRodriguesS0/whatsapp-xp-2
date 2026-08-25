# WhatsApp audio player — authenticated browser acceptance

Date: 2026-08-25 (America/Sao_Paulo)

## Scope and provenance

- Starting revision: `8548d464385821f62294997eeaf7a1d9d4f572fc` on `codex/final-responsive-fix`.
- The tested source tree contains the integrated production parent `4d1c2e3dcf7ee898c88c38e2e8841aa8b5ffa05b` and responsive parent `9e6e62ca9e9b5bd10290a2e499ec29d8f72d2d4a`.
- The unrelated catalog revision `f930` is not an ancestor.
- No production service, database, media, image, environment or deployment pointer was read or changed for this acceptance.

## Contrast correction

The player now owns explicit semantic tokens for the playback control, its hover state, its foreground, the elapsed progress and the remaining rail. The rail no longer reduces `--muted` to 42% opacity, and the playback icon no longer uses fixed white.

The regression test parses the real theme declarations and computes WCAG contrast for every control/track pair rendered over inbound and outbound bubbles. All values below exceed the required `3:1` functional/UI threshold:

| Theme | Pair | Ratio |
| --- | --- | ---: |
| Light | control foreground / control | 6.23:1 |
| Light | control foreground / control hover | 8.33:1 |
| Light | progress / inbound | 6.23:1 |
| Light | progress / outbound | 5.55:1 |
| Light | rail / inbound | 5.81:1 |
| Light | rail / outbound | 5.18:1 |
| Dark | control foreground / control | 8.16:1 |
| Dark | control foreground / control hover | 10.16:1 |
| Dark | progress / inbound | 6.55:1 |
| Dark | progress / outbound | 5.39:1 |
| Dark | rail / inbound | 7.65:1 |
| Dark | rail / outbound | 6.28:1 |

The rendered component/source assertions also require the five dedicated tokens, the two real track hooks and the 44-pixel playback target, and reject the former `text-white` and `color-mix(... --muted ...)` implementations.

## Disposable authenticated environment

- PostgreSQL `18.6` under WSL.
- Dedicated role `xp_audio_acceptance_20260825` and dedicated database `xp_audio_acceptance_20260825_test`.
- All 20 repository migrations applied from an empty database.
- One disposable synthetic admin, contact, conversation and authenticated session were created locally.
- Two synthetic OGG/Opus sine-wave files were generated locally and stored under the disposable `MEDIA_ROOT`; no production data or PII was used.
- The browser logged in through the visible application form with the synthetic account. Credentials and session values are intentionally omitted.
- The exact optimized Next.js `16.3.1` build compiled successfully and generated all 32 static pages before the browser run.

## Rendered browser acceptance

The exact optimized build was exercised in the Codex in-app Chromium browser.

### `390x844`, explicit dark theme

- Both real audio messages rendered: inbound duration `3.2065s`, outbound duration `4.4065s`.
- Normal playback control: `rgb(90, 167, 255)` with `rgb(5, 5, 5)` icon.
- Hover playback control: `rgb(128, 187, 255)` with the same foreground.
- Inbound/outbound bubble backgrounds: `rgb(27, 32, 39)` / `rgb(21, 52, 45)`.
- Computed progress/rail gradients resolved to `rgb(90, 167, 255)` / `rgb(169, 178, 191)` without opacity dilution.
- Playback and pause both changed the native `paused` state.
- Seeking through the real range overlay moved the first audio to `1.925323s` of `3.2065s`.
- Speed changed from `1×` to `1.5×`; the playing media element reported `playbackRate: 1.5`.
- Starting the second message paused the first and started the second, confirming exclusive playback.
- Keyboard-targeting the speed control left it as `document.activeElement`, matched `:focus-visible`, and kept a computed `44px × 44px` target.
- `scrollWidth`, body width and viewport width were all `390`; horizontal overflow was zero.

### `1440x900`, explicit light theme

- Conversation queue, active thread and customer inspector were simultaneously present.
- Normal playback control: `rgb(0, 95, 189)` with white icon.
- Hover playback control: `rgb(0, 77, 153)` with white icon.
- Inbound/outbound bubble backgrounds: `rgb(255, 255, 255)` / `rgb(231, 245, 239)`.
- Computed progress/rail gradients resolved to `rgb(0, 95, 189)` / `rgb(93, 102, 115)`.
- `scrollWidth`, body width and viewport width were all `1440`; horizontal overflow was zero.
- Browser console errors across the authenticated mobile and desktop run: zero.

The browser-control surface reliably verified keyboard focus and focus-visible rendering. Its synthetic key injection focused the native button but did not consistently dispatch a second activation; this report therefore does not overstate a browser-level Enter/Space activation. The controls remain native `button`/`input[type=range]` elements, and their activation/state behavior is covered by the real-component tests. No microphone or browser permission prompt was opened.

## Visual evidence

- [`390x844-dark-audio-player.png`](screenshots/2026-08-25-whatsapp-audio-player/390x844-dark-audio-player.png) — PNG magic `89504e470d0a1a0a`, exact `390x844`.
- [`1440x900-light-audio-player.png`](screenshots/2026-08-25-whatsapp-audio-player/1440x900-light-audio-player.png) — PNG magic `89504e470d0a1a0a`, exact `1440x900`.

Both captures were visually inspected after conversion from the browser transport image to real PNG bytes.

## Verification gates

- TDD RED: `src/app/globals.test.ts` and `src/components/inbox/audio-message-player.test.tsx` produced 4 expected failures and 19 passes because the semantic tokens/hooks did not exist.
- TDD GREEN: the same two files passed `23/23` tests.
- Fresh focused audio/media/globals/inbox suite: `8/8` files and `132/132` tests passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run db:validate`: schema valid, exit 0.
- `git diff --check`: exit 0 (Git emitted only the repository's Windows LF→CRLF notices).
- `npm run build`: Next.js `16.3.1` optimized build passed, TypeScript completed and `32/32` static pages generated.
- React best-practices review: the change introduces no hook, listener, data-fetch, component-boundary or bundle regression; it only replaces visual token sources and adds stable test/inspection hooks.

## Cleanup

The local server, browser tab/viewport override, keepalive process, synthetic database/role, media files, session data and ignored local environment file are removed after evidence capture. Production remains untouched.
