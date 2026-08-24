# Responsive PWA redesign — local release verification

Date: 2026-08-24

Immutable starting revision: `19206cd69a5ad288a5739600ed6a880ac803d503`

Scope: Task 9 local regression, accessibility, responsive and online-only PWA verification. No production system or production database was accessed.

## Test environment

- The exact optimized Next.js build was served locally with `npm run start` on `127.0.0.1:3197`.
- PostgreSQL 18 ran on localhost against the isolated database `xp_atendimento_task9_test`; all 18 repository migrations and the documented synthetic seed were applied. The database name ends in `_test` and no production connection was used.
- The provider remained in local demo mode. Browser activity used only repository-provided synthetic employees, contacts and messages. Credentials, tokens, phone values and message bodies are not recorded here.
- Primary Browser acceptance used the in-app Browser through its supported browser-client interface. After its tabs were closed for the final full-suite run, that backend was no longer selectable; the documented troubleshooting path found the connected Chrome extension, also controlled through browser-client, and it was used only to replace the final breakpoint captures. No standalone Playwright process was substituted.

## Release contract and automated gates

The new `src/responsive-pwa-release.test.ts` reads the production source tree and requires the theme provider, manifest, `standalone`, the maskable icon, responsive clamps and breakpoints, `ResponsiveSettingsList`, safe-area handling and the deliberate absence of service-worker or Workbox registration.

TDD evidence:

- RED: a temporary one-unit desktop-clamp fault made the combined release contract fail; restoring the approved clamp returned all four assertions to GREEN.
- RED: the first 320 px browser render showed horizontal overflow. A regression assertion first rejected `min-inline-size: 20rem` and `scrollbar-gutter: stable both-edges`; removing those two global rules returned the contract to GREEN and made `scrollWidth === clientWidth` in the rendered build.
- RED: closing the mobile client drawer restored focus to a hidden desktop details control. A component regression reproduced this. The shell now remembers the actual opening control, and both the focused test and rendered Browser flow return focus to `Mais opções`.
- RED: final screenshot inspection showed the conversation queue invisible at tablet and desktop widths after a thread was opened. Computed style proved the mobile transition selector still applied `opacity: 0` outside the mobile breakpoint. The contract first required the combined mobile/reduced-motion media query; scoping the transition to `max-width: 767px` returned 11 focused tests to GREEN. The exact production build was regenerated and every affected 768–1440 capture was replaced with the visible two-/three-column result.
- Two pre-existing source-location contracts were updated to their current redesign owners: conversation search in `thread-header.tsx` and the Meta health badge in `conversation-sidebar.tsx`.

Required final gate order and observed results:

| Gate | Result |
| --- | --- |
| `npm run icons:generate` | exit 0 |
| `npm test -- src/responsive-pwa-release.test.ts` | 1 file, 4 tests passed |
| `npm run lint` | exit 0, no lint error |
| `npm run typecheck` | exit 0 |
| `npm run db:validate` | schema valid |
| `npm test` | 179 files passed, 2 skipped; 1508 tests passed, 3 skipped; 1511 total |
| `npm run build` | exit 0; Next.js 16.3.1 optimized build; `/manifest.webmanifest` emitted |
| `git diff --check` | exit 0; only configured LF/CRLF conversion notices |

One repeated full-suite attempt saw a Prisma CLI child process run out of memory while the suite was concurrent. The exact migration contract then passed alone (12/12), and the final full suite passed in full after the already-open production server and browser tabs were closed. This was an observed host-memory transient, not recorded as a migration failure.

## Browser viewport and theme matrix

At every row below the rendered document satisfied `document.documentElement.scrollWidth === document.documentElement.clientWidth`. Pages with a vertical scrollbar reported the correspondingly reduced client width, but no horizontal overflow.

| Viewport | Theme evidence | Rendered coverage |
| --- | --- | --- |
| 320×568 | light, dark, system | login, list, thread, composer, message menu, details drawer, audio, image, PDF/document, reaction, reply, file preview, recording preview, gallery, users cards, 200% zoom |
| 390×844 | light, dark | login, keyboard/form focus, list, empty search, message search, users cards/dialog, attendance settings, loading/reconnect, send failure |
| 768×1024 | light, dark | two-pane inbox and client drawer |
| 900×1100 | light, dark | two-pane inbox |
| 1024×768 | light, dark | two-pane inbox |
| 1280×800 | light, dark | full three-pane inbox |
| 1440×900 | light, dark, system | full three-pane inbox, users table, attendance settings and Meta safe-error state |

The system preference was selected through the theme menu and resolved to the Browser profile's dark preference. Switching system → light → dark changed the rendered `data-theme` value without reload.

All 46 synthetic captures are stored under `docs/verification/screenshots/2026-08-24-responsive-pwa/`. The folder includes the initial 320 px RED capture and the corresponding GREEN capture, plus descriptive files for every matrix family above.

## Accessibility evidence

- Login controls, conversation regions, message history (`log` with a conversation name), settings lists/tables, dialogs, menus, media controls and retry states exposed meaningful accessible names in Browser snapshots.
- Escape closed the message menu, customer drawer, user dialog and media viewer. Focus returned respectively to the message action, the real mobile `Mais opções` trigger, `Novo usuário` and the image trigger. Mobile back returned to the list.
- Focus-visible behavior is source-contracted and the live form/dialog focus target was observable. Component suites cover keyboard traversal and trapped modal interaction; the in-app Browser did not provide a separate native keyboard focus-ring audit report.
- At page scale 200%, the 320 px thread still satisfied equal document widths and remained operable. The retained capture is `320x568-light-thread-200-percent-zoom.png`.
- CDP emulation confirmed `prefers-reduced-motion: reduce`; after the short state transition completed, no running document animation remained. CSS forces near-zero animation/transition duration and automatic scroll behavior for reduced motion.
- Rendered theme variables produced these WCAG contrast ratios: light text/panel 18.88:1, muted/panel 5.81:1 and primary/foreground 6.23:1; dark text/panel 17.20:1, muted/panel 8.62:1 and primary/foreground 8.16:1.
- Controlled network latency rendered the named polite `status` for both loading conversations and reconnecting. Form failures use `alert`; persistent message history has a named `log` region.

## PWA and HTTP evidence

- `/manifest.webmanifest`: HTTP 200, `application/manifest+json`; name and short name `XP Atendimento`; `display: standalone`; `start_url: /conversas`; `scope: /`; theme/background `#050505`.
- `/icons/xp-192.png`: HTTP 200, PNG, 192×192, purpose `any`.
- `/icons/xp-512.png`: HTTP 200, PNG, 512×512, purpose `any`.
- `/icons/xp-maskable-512.png`: HTTP 200, PNG, 512×512, purpose `maskable`.
- The Browser found the manifest link, zero service-worker registrations and zero Cache Storage keys. HTTP checks returned 404 for `/sw.js`, `/service-worker.js` and `/workbox.js`, as required by the online-only design.
- The local in-app Browser profile did not expose Chromium's native install affordance or Application panel, and the run was local HTTP rather than the final HTTPS origin. Native Add to Home Screen/standalone-window confirmation therefore remains a factual Task 10 production-profile check; no cache or service worker was added to manufacture an obsolete PWA score.
- Lighthouse was not installed as a CLI, project dependency or local binary. No Lighthouse score is claimed.

## Functional smoke evidence

The local production build completed these UI flows with synthetic records: invalid and valid login, logout and login again; conversation and global message search; open/back; customer details; responsible options; type change and restoration; tag add/remove and restoration; text send; long URL wrapping; quoted reply; reaction; file preview and send; microphone permission, recording, preview and delete; audio/PDF/image rendering states; gallery open/Escape; pin; controlled send failure and successful retry; users/settings navigation; empty, loading and reconnect states.

A fresh authenticated inbox tab had no console error and no Next.js error overlay. Controlled failure states recovered after network restoration.

## Factual limitations

- The synthetic seed had audio, PDF and image records but no playable video fixture. Existing automated media suites cover video/document rendering and retry semantics; no live video result is claimed.
- Two seeded media objects had no recoverable local/provider bytes. Their thumbnail/media requests returned 424/500 and the UI exposed its unavailable-media/viewer states. The newly uploaded synthetic text document succeeded. Decoded pixels for the seeded image are not claimed.
- Meta credentials were intentionally absent. `/configuracoes/meta` rendered the safe retry page, while the production React client logged error 441 for the expected Server Component 503. This was investigated against the server log and retained as an environment limitation; no secret or external Meta configuration was invented.
- The controlled slow-network reload proved the reconnect live region and recovery. Production proxy/multi-tab SSE behavior, native install UI on HTTPS and standalone launch belong to the immutable production verification task.
- The Browser flow opened the user creation dialog and verified focus/Escape but did not create or alter an employee. User mutations remain covered by the passing automated suite.

The local server and Browser tabs were stopped after evidence collection. The isolated local test database remains available for reproducibility and is not a production resource.
