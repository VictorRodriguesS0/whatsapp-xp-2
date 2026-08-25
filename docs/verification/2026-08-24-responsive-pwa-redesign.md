# Responsive PWA redesign — local release verification

Date: 2026-08-24

Immutable starting revision: `19206cd69a5ad288a5739600ed6a880ac803d503`

Scope: Task 9 local regression, accessibility, responsive and online-only PWA verification. No production system, credential, customer record or production database was accessed.

## Test environment

- The optimized Next.js production build was served on `127.0.0.1:3197` with the matching local origin embedded at build time.
- PostgreSQL 18.6 ran on `127.0.0.1:5432` against the dedicated `xp_atendimento_task9_test` database. The repository migrations and synthetic seed were applied only there.
- The provider remained in local demo mode. Browser activity used repository-provided synthetic employees, contacts and messages.
- Browser acceptance used the required browser-client interface. The original run used the in-app Browser; after that backend stopped being selectable, the documented troubleshooting path selected the connected Chrome extension through the same browser-client. No standalone Playwright process was substituted.
- Lighthouse 12.8.2 was invoked transiently with `npx`; it was not added to `package.json` or the lockfile.

## RED → GREEN evidence

1. The original release contract first failed on a temporary desktop-clamp fault, then passed after the approved clamp was restored. It also drove the 320 px overflow fix, mobile drawer focus restoration and the tablet/desktop transition scoping fix.
2. The hardened no-service-worker contract was made RED with an isolated temporary fixture containing nested `sw.js`, `service-worker.prod.js`, `workbox-runtime.js`, a registration/import source and a Workbox dependency. The final recursive scanner detects every fixture artifact, scans production sources/config/package metadata and leaves no temporary file in the repository. The final release contract passes 5/5.
3. Authenticated Lighthouse found `label-content-name-mismatch` on conversation rows. A component test first failed because the button's `aria-label` replaced its visible content. The row now derives its accessible name from its contents, prefixes the action with screen-reader text and hides the decorative avatar fallback from the accessibility tree. The focused component/shell/release run passes 49/49, and the rebuilt inbox Lighthouse audit has no failed binary accessibility audit.

## Final automated gates

| Gate | Result |
| --- | --- |
| `npm run icons:generate` | pass |
| focused release + conversation list + inbox shell | 3 files, 49 tests passed |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run db:validate` | Prisma schema valid |
| `npm test` with explicit dedicated test DB and canonical test origin | 179 files passed, 2 skipped; 1510 tests passed, 3 skipped; 1513 total |
| `npm run build` | pass; Next.js 16.3.1 emitted `/manifest.webmanifest` |
| `git diff --check` | pass; line-ending conversion notices only |

The first full-suite invocation inherited the versioned Compose-oriented `.env`, because Vitest's `dotenv/config` does not load `.env.local`. All database tests consequently reported `Can't reach database server at database`, and origin tests saw the versioned 3187 origin. This was an environment failure, not a Prisma schema or migration failure. A read-only connectivity query then proved PostgreSQL 18.6 and `xp_atendimento_task9_test` on localhost. The single necessary rerun explicitly exported identical local `DATABASE_URL`/`TEST_DATABASE_URL` values plus the documented `http://localhost:3000` unit-test origin and passed in full. No failing database assertion was skipped or masked.

## Responsive and screenshot evidence

Every measured page satisfied `document.documentElement.scrollWidth === document.documentElement.clientWidth`. A page with a vertical scrollbar may have a client width smaller than the screenshot raster; the equality still proves no horizontal document overflow.

| Viewport | Theme and layout evidence |
| --- | --- |
| 320×568 | light, dark and system resolved dark; login, list/thread, drawers/composer/media/users; no horizontal overflow |
| 390×844 | light and dark; login/error, list/search/states, users/settings; no horizontal overflow |
| 768×1024 | light/dark, real selected conversation in two panes; customer pane hidden |
| 900×1100 | light/dark, real selected conversation in two panes; customer pane hidden |
| 1024×768 | light/dark, real selected conversation in two panes; customer pane hidden |
| 1280×800 | light/dark, real selected conversation and customer details in three panes |
| 1440×900 | light/dark/system resolved dark, real selected conversation and customer details in three panes; users and attendance settings |

The release folder contains 45 synthetic PNG files. A mechanical audit opened every file with Sharp and proved all 45 have PNG magic `89504e470d0a1a0a`, decoded format `png`, and raster dimensions exactly matching the filename. No screenshot was resized to satisfy its name: browser viewport calibration produced the required raster, and Sharp was used only for lossless PNG encoding.

The browser returned the previous compositor frame on the first capture after some breakpoint transitions. Contact-sheet inspection caught the empty/loading evidence. Those 11 matrix images were recaptured by discarding the stale frame and retaining a second Browser capture only after DOM assertions proved Pedro selected, message content visible and the expected two/three panes. Five contact sheets were visually inspected for all 45 release images.

The old RED overflow image, stale 320-named zoom image and ambiguous `system` filenames were removed. System captures now state the observed resolved theme as `system-dark`. CDP applied `pageScaleFactor: 2`; `visualViewport.scale` was 2, the visual viewport was 160×284, the document remained 320 px wide with equal scroll/client width, and the factual capture is `160x284-light-thread-200-percent-zoom.png`.

Screenshots: `docs/verification/screenshots/2026-08-24-responsive-pwa/`.

## Lighthouse and accessibility

| Page | Accessibility | Best Practices | Failed binary audits | Runtime error |
| --- | ---: | ---: | --- | --- |
| `/login` | 100 | 100 | none | none |
| authenticated `/conversas` | 100 | 100 | none | none |

The sanitized machine-readable summary is `docs/verification/2026-08-24-responsive-pwa-lighthouse-summary.json`. Full transient Lighthouse reports and authenticated headers were not committed.

- Escape closed the mobile customer dialog and restored focus to the actual `Mais opções` opener. The user dialog closed with Escape and restored focus to `Novo usuário`.
- CDP emulation made `prefers-reduced-motion: reduce` true; the measured thread transition was effectively zero (`0.00001s`).
- Original rendered contrast checks remained: light text/panel 18.88:1, muted/panel 5.81:1 and primary/foreground 6.23:1; dark text/panel 17.20:1, muted/panel 8.62:1 and primary/foreground 8.16:1.
- Controlled login failure exposed a named alert; message history exposed its named log. Loading/reconnect/live-region behavior remains covered by the retained rendered-state captures and passing component suites.

## Manifest, installability and online-only contract

- CDP `Page.getAppManifest` returned the local manifest with no errors: `display: standalone`, `start_url: /conversas`, scope `/`, 192/512 `any` icons and one 512 `maskable` icon.
- CDP `Page.getInstallabilityErrors` returned an empty list in a fresh localhost Chromium tab. Localhost reported `isSecureContext === true`.
- The normal Browser tab correctly reported `(display-mode: standalone) === false`; no standalone window was claimed.
- Runtime inspection returned zero service-worker registrations and zero Cache Storage keys.
- HTTP returned 200 for the manifest and all three icons. It returned 404 for `/sw.js`, `/service-worker.js`, `/service-worker.prod.js`, `/workbox.js` and `/workbox-runtime.js`.
- Chromium did not expose a native install button through this controlled profile. Zero CDP installability errors is the retained Task 9 native/Application evidence; Task 10 still revalidates the HTTPS install UI and standalone launch.

## Console and network evidence by smoke family

| Family | Browser actions | Console errors | Failed requests |
| --- | --- | ---: | --- |
| Auth negative | invalid synthetic login, visible error alert | 0 | one controlled 401 from `/api/auth/login` |
| Auth success | valid synthetic local login and navigation | 0 | no HTTP error; three canceled navigation requests (`ERR_ABORTED`) |
| Inbox | filter, clear, select thread, responsive layout assertion | 0 | one canceled search request after the filter was cleared |
| Composer | synthetic send on the stable Carlos fixture | 0 | send succeeded; one known seeded-media 500 and one canceled list refresh |
| Mobile details | open menu/details, Escape, focus restoration | 0 | one canceled list refresh |
| Users/settings | navigate from app menu, open dialog, Escape | 0 | none |
| PWA/Application | manifest/installability/service-worker/cache CDP inspection | 0 | none |

Expected/controlled failures are separated from clean families. A synthetic WhatsApp row created during smoke testing returned 409 on send and rendered the safe `Falha ao enviar`/retry state; it was not counted as a successful send. The stable Carlos fixture then completed a real local demo send without a send error. Seeded legacy media without recoverable bytes produced the retained 424/500 unavailable-media behavior. Meta remained intentionally unconfigured and its safe 503 retry state is retained separately; no production secret was invented.

## Limitations

- No playable video fixture existed. Automated media suites cover video semantics, but no live decoded video is claimed.
- Native install UI and standalone launch on the final HTTPS origin remain Task 10 checks. Task 9 proves localhost installability through zero CDP errors without adding a service worker.
- The Browser smoke opened but did not submit the user-creation dialog. User mutations remain covered by the passing automated suite.
- The local test database remains available for reproducibility. The production server, Browser tab, viewport override and temporary audit profiles/reports were stopped or removed after collection.
