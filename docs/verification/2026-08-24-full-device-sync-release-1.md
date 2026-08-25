# Full device sync — Release 1 verification

Date: 2026-08-24

## Scope

- Reconcile outbound `smb_message_echoes` from the official WhatsApp Business app.
- Advance only the company-wide read boundary through the latest preceding inbound message.
- Preserve manually marked unread state and per-user read/audit/WhatsApp-read-sync records.
- Backfill historical processed official echoes with dry-run as the default.
- Preserve the PDF thumbnail release already running in production.
- Integrate the completed Meta health release found during the pre-deploy worktree audit.

## Source and production baseline

- Feature gate commit: `ee6e2bb5a36de58ed7143f3799cdce834edce45c`.
- Production release: `03547ed91f6bbc8e79879223993f409a504abe76`.
- Immutable image: `xp-whatsapp:03547ed91f6bbc8e79879223993f409a504abe76`.
- Image ID: `sha256:b7fccc8c23ff0014bf2ee65f75c93285f01107215602a991292bb6535abf2e8e`.
- Production baseline before this release: `cd0c5bbe2fa9254baa30c6178c91512ce577ce2f`.
- The WhatsApp policy/template worktree remained dirty and was intentionally left untouched.

## Verification evidence

- `prisma generate`: passed.
- `prisma validate`: passed.
- `eslint .`: passed.
- `tsc --noEmit`: passed.
- `next build`: passed on Windows and in the Linux builder image.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Static focused tests: 12 passed.
- PostgreSQL 18.6 isolated gate:
  - 18 migrations applied successfully from an empty database;
  - 159 test files passed;
  - 1,428 tests passed;
  - 2 optional integration tests skipped;
  - no failed assertions or unhandled errors.
- The official-echo backfill was validated separately against PostgreSQL 18:
  - dry-run made no changes;
  - apply advanced only the intended team boundary;
  - manual unread, assignment, response state, per-user reads, audits and WhatsApp read-sync were preserved;
  - the second dry-run returned zero candidates.

## Deployment constraints

- Re-audit all worktrees immediately before building the production image.
- Deploy only the application and its additive migration; do not restart Caddy or unrelated services.
- Run the committed backup script before migration/deploy.
- Recompute the production backfill candidate count; never rely on a previously observed count.
- Apply the backfill once, verify a zero-candidate second dry-run, and confirm collateral-state hashes remain unchanged.
- Do not change the configured Meta Graph version or webhook subscription fields in this release.

## Production deployment

- Validated preventive backup: `/srv/backups/example-app/example-backup`.
- Previous environment file: `/opt/apps/example-app/.env.production.backup`.
- The application-only rollout was promoted at `2026-08-24T04:22:37Z`.
- Only `xp-whatsapp-app` was recreated. PostgreSQL kept container ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585` and remained healthy with zero restarts.
- The normalized, sorted snapshot of all 29 non-application containers remained byte-identical with SHA-256 `90554dedaa59968d45122da5b4106b721fc1ae1bcb0fe02eceee50485060e47e`.
- `current`, `XP_WHATSAPP_IMAGE`, the running image and the OCI revision label all resolve to the production release.
- The app runs as `1001:1001` on exactly `shared_gateway`, `xp_whatsapp_egress` and `xp_whatsapp_internal`.
- The migration aggregate remained `18/0/0` (completed/incomplete/rolled back).

Two pre-promotion attempts were automatically rolled back to `cd0c5bbe2fa9254baa30c6178c91512ce577ce2f`. The first exposed an empty-line parsing defect in the network verifier; the second exposed a non-deterministic ad-hoc container hash. Neither attempt promoted the release or changed data. The final rollout used normalized JSON with sorted networks and mounts and passed a byte-for-byte comparison.

## Production backfill

- The production dry-run recomputed 28 candidates.
- The committed SQL advanced all 28 team read boundaries.
- Hashes for manual unread state, assignment, response state, per-user reads, audit events, WhatsApp read-sync, messages and source webhook events remained unchanged.
- A second dry-run returned zero candidates and applied zero rows.

## Production acceptance

- Local and public health returned HTTP 200.
- The login page returned HTTP 200.
- Unauthenticated conversation and Meta-health APIs returned HTTP 401.
- A webhook request with an invalid signature returned HTTP 401.
- Three health samples separated by 20 seconds passed with zero application restarts.
- Application logs since rollout contained zero fatal/unhandled/migration markers and zero 5xx markers.
- The read-only Meta check confirmed Graph `v23.0`, the expected callback and the same 12 subscribed fields, including `messages`, `smb_message_echoes` and `smb_app_state_sync`. No Meta setting was mutated.
- A fresh post-deploy focused gate applied all 18 migrations to a dedicated PostgreSQL 18 database and passed 73 tests in 5 files covering shared state, official-echo webhooks and the backfill. The temporary database, anonymous volume and SSH tunnel were removed afterward.

The immediate app-only rollback remains `cd0c5bbe2fa9254baa30c6178c91512ce577ce2f`. The backfilled team boundaries are valid shared state and must not be reverted.
