# Full device sync — Release 2 production verification

Date: 2026-08-24

## Scope

- Normalize future WhatsApp message edits and revokes received through both
  `messages` and `smb_message_echoes`.
- Reconcile mutations against the original message with identity validation,
  provider-event deduplication and monotonic timestamp/event-id ordering.
- Preserve an immutable internal revision trail while exposing only the current
  message state to the inbox.
- Show `editada` for edited messages and a content-safe `Mensagem apagada`
  tombstone for revoked messages.
- Preserve company-wide read state, manual unread, assignments, response state,
  per-user reads, WhatsApp read synchronization, media rows and reactions.
- Keep Graph API version and Meta webhook subscription unchanged.

## Source and production baseline

- Deployed revision: `2c5d7504d3cdb31e3657fa0f357939a7f82ec92a`.
- Schema commit: `cc16fe4`.
- Mutation implementation commit: `f5d9a4f`.
- Compatibility and schema-contract commits: `2b8c7df`, `2c5d750`.
- Previous production release and immediate code rollback:
  `03547ed91f6bbc8e79879223993f409a504abe76`.
- The separate `codex/whatsapp-quoted-replies` policy/template worktree was clean
  at `b9eff633`, was not active in production, and was intentionally left
  untouched instead of being silently mixed into this release.

## Verification evidence

- Prisma schema validation: passed.
- All 19 migrations applied from an empty PostgreSQL 18 database: passed.
- Migration idempotency: passed inside the KVM test network.
- TypeScript typecheck: passed.
- ESLint: passed.
- Production Next.js build: passed in the exact Linux builder image.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Exact KVM test image, isolated database and network:
  - 160 test files passed;
  - 1,448 tests passed;
  - 2 opt-in integration tests skipped by their existing flags;
  - no failed assertions.
- Focused contracts covered edit/revoke normalization, identity quarantine,
  recent-target retry, stale-target completion, immutable snapshots, monotonic
  ordering, post-revoke suppression, media/reaction preservation, current-state
  search, strict ID-only realtime invalidation and safe UI rendering.
- A tunnel-based full run first exposed one stale temporal-column count and
  network-sensitive timeouts. The count was corrected from 28 to 30 for the two
  new nullable message timestamps. The final KVM-local gate passed the same
  migration and media tests without the tunnel latency.

## Production deployment

- Validated preventive backup:
  `/srv/backups/example-app/example-backup`.
- Immutable image:
  `xp-whatsapp:2c5d7504d3cdb31e3657fa0f357939a7f82ec92a`.
- Image ID:
  `sha256:b2572eac2709ec80c2b6ea9aa39cefca54c1896b43213b0fc77d1cf68f40f499`.
- Active release:
  `/opt/apps/example-app/releases/2c5d7504d3cdb31e3657fa0f357939a7f82ec92a`.
- Previous environment file:
  `/opt/apps/example-app/.env.production.backup`.
- Only `xp-whatsapp-app` was stopped and recreated. The production database kept
  container ID
  `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`,
  its original start time and zero restarts.
- The new app container is
  `0e156bea6c62c76ab16fa8455ef8b873a50598eec0db9422264e6cc0b53f67ec`,
  runs as `1001:1001`, is healthy and has zero restarts.
- Migration aggregate after rollout: `19/0/0`
  (completed/incomplete/rolled back). The Release 2 migration itself is
  `1/0/0`.
- The normalized snapshot of every non-app container stayed byte-identical,
  with SHA-256
  `a341ab44881b7fe1980cc4efe986e6d855e8da8528d0b3af4e72095ae08748f5`.
- `current`, `XP_WHATSAPP_IMAGE`, the running image and OCI revision label all
  resolve to the deployed revision.

## Production acceptance

- Local health, public health and login returned HTTP 200.
- Unauthenticated conversations and Meta-health APIs returned HTTP 401.
- A webhook request with an invalid signature returned HTTP 401.
- Three public-health samples separated by 20 seconds passed with the app
  `running/healthy`, zero restarts and zero fatal/unhandled/migration/5xx log
  markers.
- The new revision trail contained zero rows immediately after deployment and
  no historical message was marked as edited or mutated.
- Read-only Meta verification confirmed Graph `v23.0` and the same 12 fields:
  `account_alerts`, `account_review_update`, `account_update`, `calls`,
  `message_template_quality_update`, `message_template_status_update`,
  `messages`, `phone_number_name_update`, `phone_number_quality_update`,
  `security`, `smb_app_state_sync`, `smb_message_echoes`.
- No Meta subscription, token, callback, Caddy, DNS, volume, network, database
  container or unrelated service was changed.
- Temporary test containers, networks, transport archives, snapshots and the
  test-image tag were removed. The production image, release, backup and Release
  1 rollback image were retained.
