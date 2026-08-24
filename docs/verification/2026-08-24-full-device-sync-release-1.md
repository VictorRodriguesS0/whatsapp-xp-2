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
- Production baseline before this release: `41b8ac6ada5babfc6e280bb131d792baad6bf984`.
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
