# Full-screen media gallery production verification

## Released artifact

- Revision: `2f8f865aa9a70047fbb5223dbef146bc3d41e0cf`.
- Immutable image: `xp-whatsapp:2f8f865aa9a70047fbb5223dbef146bc3d41e0cf`.
- Image ID: `sha256:3e80f703ad544c688bd0091f083c53e1942fb35920b7733e5d41ce3fa0ba6ae7`.
- Release directory: `/opt/apps/example-app/releases/2f8f865aa9a70047fbb5223dbef146bc3d41e0cf`.
- Previous revision and rollback image: `c049e0e18f61431ae8104c00d598bc942a24873f`.
- Validated backup: `/srv/backups/example-app/example-backup`.

## Verification before deployment

- Local lint, typecheck and Next.js production build exited successfully.
- The Linux image was built from the clean Git archive of the exact revision under bounded CPU and memory.
- A complete KVM run against a dedicated PostgreSQL database passed 1,304 tests in 141 files; two optional FFmpeg integration tests were skipped by their existing feature flag.
- The first complete run inherited the production origin and therefore rejected the localhost-only HTTP fixtures. The three affected authentication files passed 12/12 after setting the documented test origin. No code change was required.
- Under an artificial 30 ms media lease and 0.5 CPU, one timing test alternated between pass and fail. The production lease remains two minutes and this path was unchanged by the release. The final complete suite passed with 1 CPU while still limited to 2 GiB RAM and 3 GiB memory plus swap.
- Every disposable database was removed; the post-run database count for `xp_media_gallery_%_test` was zero.

## Parallel-work audit

The audit was repeated immediately before deployment. The candidate contained the live production revision. No other worktree had a divergent committed code change. The only newer parallel material was documentation: a service-window design and an untracked plan, plus a Meta quality-alert design. These incomplete documents were not merged. The candidate worktree was clean.

## Application-only deployment

- Only `xp-whatsapp-app` was stopped and recreated.
- PostgreSQL container ID stayed `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`.
- The deterministic non-application container hash stayed `eda226152b0b98bf0eb4c9dae1c40992ca9d21cdc8f9d43656bc632bdd5c6c84`.
- Migration aggregate stayed clean at `17/0/0` (finished/incomplete/rolled back).
- The application runs as `1001:1001`, is healthy and had zero restarts during three soak samples.
- The canonical `current` symlink and `XP_WHATSAPP_IMAGE` entry were promoted only after candidate health passed. The prior environment file is retained at `/opt/apps/example-app/.env.production.backup`.

## Public and browser checks

- `GET /api/health`: HTTP 200 with `{"status":"ok"}`.
- `GET /login`: HTTP 200.
- Unauthenticated conversations and media preview requests: HTTP 401.
- Invalid Meta webhook signature: HTTP 401.
- Post-start logs contained zero unhandled/fatal/5xx markers and zero sensitive-value markers.
- Authenticated Chrome verification opened a read conversation containing an image, a video and a PDF. The viewer filled the viewport, loaded the image at its natural dimensions, exposed native video controls and navigated `1 de 3` through `3 de 3`. The original check observed the PDF iframe shell but did not prove that its document content rendered; the production hotfix below closes that verification gap.
- Escape closed the desktop viewer and restored focus to the opening thumbnail.
- In a 390 by 844 mobile viewport, browser Back closed only the viewer, kept the conversation and composer open, and restored focus to the image thumbnail.
- No browser console warning or error was emitted during the tested flow.

## PDF same-origin hotfix

- Configuration revision: `2c1ef9f0f8a18431144134e9bf2ee963a5cced16`.
- Root cause reproduced in the authenticated production viewer: Caddy added `X-Frame-Options: DENY` and `frame-ancestors 'none'` to the media preview response, so the browser refused the same-origin iframe.
- A regression assertion was added first and failed against the old configuration. It passed after limiting the exception to `/api/media/*?preview=1`.
- The exact Caddy 2.10.2 production image validated and adapted the candidate configuration before deployment.
- The site-specific gateway file was backed up at `/srv/backups/example-app/gateway-whatsapp-site-20260824T020458Z.caddy` before a graceful Caddy reload.
- The unauthenticated preview probe returned `SAMEORIGIN` plus `frame-ancestors 'self'`; download and page probes retained `DENY` plus `frame-ancestors 'none'`.
- `GET /api/health` remained healthy, all container IDs were unchanged and no application or database container was restarted.
- The original authenticated browser flow was repeated. The PDF rendered visibly inside the full-screen viewer with the browser PDF toolbar, one complete page and no console warning or error.
