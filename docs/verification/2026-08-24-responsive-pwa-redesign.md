# Responsive PWA redesign — release verification

Date: 2026-08-24

Immutable starting revision: `19206cd69a5ad288a5739600ed6a880ac803d503`

Scope: Task 9 local regression, accessibility, responsive and online-only PWA verification, followed by the explicitly authorized Task 10 production release. Production checks used a disposable synthetic administrator and did not disclose or capture customer content, credentials or secrets.

Production candidate revision: `bdb6d758b8dc4439a2d3688d4b484a9488107a03`

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
- Chromium did not expose a native install button through this controlled profile. Zero CDP installability errors is the retained Task 9 native/Application evidence; the final HTTPS Chrome result is recorded below without claiming an installation.

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
- Task 9 proved localhost installability through zero CDP errors without adding a service worker. The final HTTPS-origin result, including the browser automation limitation, is recorded below.
- The Browser smoke opened but did not submit the user-creation dialog. User mutations remain covered by the passing automated suite.
- The local Task 9 test database remains available for reproducibility. The local server, production Browser tab, viewport override and temporary audit profiles/reports were stopped or removed after collection; the released production app remains online.

## Production release — Task 10

### Candidate provenance and immutable artifact

- The initial responsive candidate `7573545` was not a descendant of the then-live revision `6d67be6fc674450c35cb5756a0609f387a47cf12`. The release branch incorporated that exact live revision before promotion, preserving the live PDF/full-sync, service-window and Meta behavior. The resulting validated source candidate is `bdb6d758b8dc4439a2d3688d4b484a9488107a03`.
- The exact `git archive` is `source-bdb6d758b8dc4439a2d3688d4b484a9488107a03.tar.gz`, 7,867,364 bytes, SHA-256 `cc80e3b19791cb4b17cf3aaaf95ef8f347307a44efd9d611a4ed71146993290d`. Its release directory is `/opt/apps/example-app/releases/bdb6d758b8dc4439a2d3688d4b484a9488107a03`; the transport archive was removed after hash verification.
- The immutable Linux image is `xp-whatsapp:bdb6d758b8dc4439a2d3688d4b484a9488107a03`, image ID/digest `sha256:6bac3e2b26d2bf920e88ee684ace065bd503d40fbf7e91efa21a918755215bfd`. OCI revision and version labels are respectively the full candidate revision and `responsive-pwa-2026-08-24`. The superseded pre-fix image was not promoted and its exact rejected tag, image and release directory were removed in the follow-up below.
- Runtime inspection proved UID/GID `1001:1001`, available `ffmpeg`, `ffprobe` and `pdftoppm`, six valid PNG application icons with their named dimensions, and absence of application `.env` files and application test source outside dependencies.

### Linux release gates

- The complete suite ran inside the candidate Linux image against an isolated, unpublished `postgres:18-alpine` database under the release resource limits: 199/199 files and 1712/1712 tests passed in 686.92 seconds, including the ffmpeg integration path. All isolated runner, database and network resources were removed afterward.
- The exact archive also passed lint, typecheck, Prisma schema validation and optimized build. An archive-only CRLF portability failure in the dialog source contract was reproduced locally, fixed by accepting `\r?\n`, and rerun through the complete gates before the final image was built.
- Isolated runtime smoke returned HTTP 200 for health and validated the emitted manifest and all icon bytes before production mutation.

### Backup, deploy and rollback anchor

- A new backup was created at `/srv/backups/example-app/example-backup`: `database.dump` is 507,619 bytes and `media.tar.gz` is 24,089,644 bytes. The five-file bundle has mode `0600`; sidecars and manifest passed the canonical bundle verifier, PostgreSQL 18 `pg_restore --list`, and the media archive validator.
- The rollback anchor is live revision `6d67be6fc674450c35cb5756a0609f387a47cf12`, image ID `sha256:51bdcbe68d4d2c0d8200a64fe22e0bb80ba7a8923b5f2ca0e70cd9cc3bedc962`, with the pre-release environment copy at `/opt/apps/example-app/.env.production.backup`.
- The deploy recreated only `app` with Compose `--no-deps --force-recreate`. Its container changed from `36ffe74e8f10b97ff3f501a2bd8983efe2ef567ea14fd95d1767636e99a3a02a` to `45cc32d044db4a1a263b4d18aa5a24a64f20de2ea0cafd623ab08e537a6889d8`, started at `2026-08-24T23:49:42.954108408Z`, became healthy and remained at zero restarts.
- Before, immediately after and after soak, the database container remained `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`, started at `2026-08-22T23:57:15.699997655Z`. Normalized snapshots remained byte-identical for all 29 non-app containers, 12 networks and 47 volumes. App networks and mounts were unchanged; the current symlink and image variable point to the candidate; every non-image environment line is identical to the protected pre-release copy.

### HTTPS, authentication and responsive browser smoke

| Check | Local reverse-proxy path | Public HTTPS path |
| --- | --- | --- |
| health and login | 200 | 200 |
| unauthenticated `/conversas` | 307 to login | 307 to login |
| unauthenticated inbox/settings/realtime APIs | 401 | 401 |
| authenticated login, inbox page/API and settings page/API | 200 | 200 |
| authenticated SSE connection | 200 stream opened | 200 stream opened |
| manifest and six icon assets | 200, exact contract/PNG bytes | 200, exact contract/PNG bytes |

- A disposable synthetic administrator exercised the authenticated flow without outputting inbox rows or customer data. Cleanup removed exactly one synthetic user and its two sessions, then verified zero matching users and sessions. Reopening `/conversas` in that browser session redirected to `/login`.
- A fresh in-app Browser profile verified the inbox shell, authenticated settings authorization, light/dark theme switching and zero console errors or warnings. Widths 320 and 390 rendered the one-pane mobile list with the hidden thread inert and excluded from accessibility; width 900 rendered two panes; width 1440 rendered three panes. All four widths had no horizontal document overflow.
- No screenshot or authenticated DOM dump containing conversation data was retained. Browser probes were limited to structural counts, route, accessibility state, theme and overflow.

### HTTPS manifest and installation evidence

- CDP `Page.getAppManifest` recognized the public HTTPS manifest, returned its data and reported no manifest errors. The contract retained `display: standalone`, `start_url: /conversas`, scope `/`, the required `any` icons and the maskable icon.
- The initial browser-client target exposed neither `Page.getInstallabilityErrors`/`Page.getManifestIcons` nor a native install affordance or installation API. A subsequent fresh Chrome target also rejected `Schema.getDomains`, `Browser.getVersion`, `PWA.getOsAppState`, `Page.addScriptToEvaluateOnNewDocument` and the `Page.reload` initialization-script path as unsupported through its raw-CDP bridge. `Page.getAppManifest` remained available, returned no errors and resolved the default manifest ID to `https://whatsapp.xpeletronicos.com/conversas`.
- Because that Chrome bridge did not expose the `PWA` domain or a supported pre-navigation `beforeinstallprompt` probe, `PWA.install`, `PWA.launch` and `PWA.uninstall` were not called. No installation or standalone launch is claimed, and no installed PWA state required cleanup. The temporary Chrome target was closed. The ordinary controlled tab correctly reported both standalone and minimal-ui display modes as false.
- The no-service-worker and no-runtime-cache contract remained covered by the passing release suite; an unsupported Service Worker CDP method was not treated as positive runtime evidence.

### Soak and final state

| UTC sample | Local health | Public health | Container | Restarts | Image | Log lines since start | Critical matches |
| --- | ---: | ---: | --- | ---: | --- | ---: | ---: |
| 2026-08-25 00:04:29 | 200 | 200 | healthy | 0 | exact | 51 | 0 |
| 2026-08-25 00:04:49 | 200 | 200 | healthy | 0 | exact | 51 | 0 |
| 2026-08-25 00:05:09 | 200 | 200 | healthy | 0 | exact | 51 | 0 |

The three samples were separated by 20 seconds. The critical scan covered uncaught/unhandled errors, fatal/panic events, migration failures, Prisma client errors and address conflicts without emitting log bodies. No rollback criterion occurred, so the prepared app-only rollback was not invoked and remains available at the recorded anchor.

### Release follow-up closure

- Provenance: the unrelated historical `.superpowers/sdd/task-10-report.md` was restored exactly to its contents at `7573545`. This release record now lives at `.superpowers/sdd/task-10-responsive-pwa-report.md`.
- KVM hygiene began with `current` resolving exactly to the candidate and zero container/mount or symlink references to rejected revision `4b926a9c521cc3d6b966338afd507a0ce579788a` or image `sha256:b0a001de357c14c78c9f189506863f7e22235b394740bef01a39c60129bf706f`. The rejected tag, image and validated absolute release path under `/opt/apps/example-app/releases/` were then removed. The active app container ID did not change, stayed healthy with zero restarts, and both candidate and rollback images were preserved. The rejected artifact is recoverable by rebuilding an exact `git archive` from `4b926a9c521cc3d6b966338afd507a0ce579788a`.
- Review-timeout classification: `src/modules/webhooks/process.test.ts` reran with its default test timeout against a dedicated PostgreSQL 18 database whose name ended in `_test`. All 20 migrations applied and 28/28 tests passed. Vitest took 15.11 seconds, the slowest individual case took 4.148 seconds, and migrations plus the test command took 35.03 seconds. The earlier timeout is therefore classified as harness/environment timing rather than a product failure; no implementation change was warranted. The disposable database, internal network, SSH tunnel and its exact unused anonymous volume were removed afterward, returning the host to the 47-volume baseline.
- Final production recheck after every cleanup retained app container `45cc32d044db4a1a263b4d18aa5a24a64f20de2ea0cafd623ab08e537a6889d8`, health `healthy`, zero restarts, the exact candidate symlink/image and the immutable rollback image. No app deploy or environment-file mutation occurred during this follow-up.
