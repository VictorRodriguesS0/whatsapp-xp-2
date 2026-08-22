# Release 0 checkpoint B — shared inbox and media recovery

Status: `DONE_WITH_CONCERNS`

The technical release is complete and healthy. The only outstanding acceptance item is one authorized production inbound-media action; no existing production media row was retried without confirmation that it belongs to test data.

## Release identity

- Candidate code: `47423455195da6aa3beee68e18529e4895cc66fc`.
- Deployment start: `2026-08-22T01:42:32Z` (`2026-08-21T22:42:32-03:00`).
- Active release: `/opt/apps/example-app/releases/47423455195da6aa3beee68e18529e4895cc66fc`.
- OCI image: `xp-whatsapp:47423455195da6aa3beee68e18529e4895cc66fc`.
- Immutable image ID: `sha256:17283baa336a4091da2476485da3878b22c28b991c26cca1bfd903c73c4bd643`.
- Raw Git archive SHA-256: `19551862c7dd619599e89e962526c922999f3ecc11877871237f3da0e318d1e4`.
- Image tar SHA-256: `ed27d4e8aa75663996923f7017154a46f066eb45772deba07399e97330021ed0`.
- Transport gzip SHA-256: `8de568099943b8dc19951fdc0377852e4368bd87a05148895049f813e2c7dfb3`.
- Compose file SHA-256: `8ae98c2ca3c6092ed36d02ff1e4658c941e9d46475ec5bf6b53ff91369fe86d2`.
- Candidate resolved Compose SHA-256: `84f773a9aa45b260614d76591d125991068e6af9551c4cae7573eae8230e16c0`.

The source archive was produced with `core.autocrlf=false`; a prior CRLF-materialized archive was discarded. The imported image label points to the raw archive hash above. Runtime inspection confirmed Linux/amd64, revision exactness, healthcheck, entrypoint, FFmpeg/FFprobe, migration 005, user `nextjs`, UID/GID `1001:1001`, zero application test files outside dependencies, zero `.env` files, and no baked sensitive environment names.

## Local and release gates

- Fresh PostgreSQL 18 database ending `_test`, Linux/amd64, Node 22.23.2, npm 10.9.8, FFmpeg/FFprobe 5.1.9.
- Tracked suite: 76 files passed and 2 opt-in files skipped; 735 tests passed and 2 skipped.
- External real-FFmpeg recording integration: 1/1 passed.
- PostgreSQL-focused checkpoint suite: 5 files and 44 tests, passed twice.
- Lint, typecheck, Prisma validate/generate and the 16-route production build passed.
- Production and full dependency audits reported zero vulnerabilities.
- Shell syntax, migration-state runbook, backup parser, restore, Docker helper ownership, Compose verifier, KVM verifier, mutation verifier and both diff checks passed.
- The archive-only mutation invocation correctly could not read Git metadata; the same immutable script passed in the candidate worktree. The Docker helper check was rerun with a Docker 29 CLI and the socket after the dependency-only runner lacked that client. Neither was a product failure.
- The independent final review for the exact candidate was `Approved`, with no unresolved Critical or Important finding.

## Browser acceptance

Two independent local browser sessions used separate cookie jars and different demo users. No contact, phone, message payload, credential or provider identifier was recorded.

- A response created in one session appeared in the other without reload and cleared the shared awaiting-response indicator.
- A manual unread mark propagated to the peer session; reading from the other session cleared it globally.
- Pending inbound audio rendered the loading state without a native player, then became an authenticated playable control without document reload.
- Failed audio exposed one manual retry action; one click reconciled it to a playable control.
- At 390×844, document and body horizontal overflow were both absent, every visible action remained focusable, conversation actions were native buttons, no visible target measured below 40 px, and returning to the list restored focus to the conversation action.

The media provider used for this browser exercise was a disposable TLS mock on the isolated local Docker network. It did not use production data or Meta assets.

## Preflight, backup and rollout

The final read-only preflight confirmed the active `cd61d93b66597d35c00394aca6ebe5d722ba7e74` runtime, app/database health, restart count zero, 34 total containers, 33 non-app containers, exact Compose, absent migration 005, public endpoints, webhook verification/rejection, preserved rollback images and exact Meta subscription.

An initial non-app hash alert was investigated before any transfer. The original expression did not sort the Docker network array, so five consecutive reads produced five different hashes without any container event. Sorting mounts and networks made the snapshot deterministic. Docker events showed only healthcheck execs and no non-app create/start/die/restart. The deterministic JSON snapshot saved before rollout is byte-identical after rollout and has SHA-256 `80f8dcd1953b9ffa9f45d5f29982c1ca333279e471fec342c54b4a30d2ac47df`.

The new backup is `/srv/backups/example-app/example-backup`:

- database dump: `f9324b333d07bae59ac9fd4742b5fc85fb7dbf4c309b5b640c63a640d47b561e`;
- media archive: `7f4ba263741225cbc1e4c05e80585f55e092dbfbfc9a28ced3a0f63a6fc2469d`;
- manifest: `b2e8d9641f47c5d7fcc5159944f94b39a20fa92b6d2cff15a7196b4d34fb90a3`.

All five files are mode 0600. Sidecars, manifest parser, media validator and `pg_restore --list` passed, and no owned helper container remained.

The canonical KVM Compose recreated only `xp-whatsapp-app` with `--no-deps --force-recreate --wait`. The database container ID stayed unchanged. Caddy, database container, volumes, networks, DNS, Meta subscription and unrelated systems were not restarted, reloaded, edited or recreated. After health and invariant checks passed, the `current` symlink was promoted atomically to the candidate release.

## Production verification

- App: healthy, revision exact, image ID exact, restart count zero, UID/GID 1001:1001, three networks.
- Migrations: `202608210005_media_terminal_transition` is `1/0/0`; aggregate migration state is `8/0/0`; `terminal_transition_id` exists once and remains nullable; Prisma status is current.
- Local/public health, login, privacy and deletion pages returned 200.
- Webhook verification returned 200 with the expected challenge; an invalid signature returned 401.
- App errors: 0; app 5xx: 0; gateway 5xx: 0; sensitive-value matches in post-deploy logs: 0.
- A subsequent 50-second soak performed five local/public health checks, all green, with the same zero error/5xx counts.
- The deterministic 33-container non-app snapshot is byte-identical, and total counts remain 34/33.
- Meta was read only: one subscription object, one active object, 11 fields, 11 unique fields and `smb_message_echoes` exactly once. Field hash remained `d0818032ffd578b85b7231ec63cbed019cccf27e54fe25934948e1d624e7dc3f`; callback hash remained `88fe739ae6d5b5b3f76e7a44189eae6f3c68628d2704bfdbd71e7bbbe010b7ff`.
- Before rollout, four historical retryable status-processing log entries were correlated to processed webhook rows; there were no failed rows or structured gateway 5xx. No candidate-correlated recurrence appeared.

The safe production media aggregate after rollout was 45 inbound `AVAILABLE`, 3 inbound `FAILED`, 0 due `PENDING`, and 0 terminal transitions since deployment. No identifier, payload, storage path or content hash tied to a conversation was inspected or emitted.

## Rollback and production acceptance

The immediate prior release `cd61d93b66597d35c00394aca6ebe5d722ba7e74` remains available for app-only rollback. The older compatibility image `xp-whatsapp:ef61c05` is also preserved at image ID `sha256:0778e0539b01001923819a715931e2f3ede8fa4e67020f586399c022fb03f7cf`. Migration 005 is additive and nullable, so the prior binary ignores it. A rollback must recreate only the app and must not revert committed data.

After rollout, the user sent one authorized short inbound audio and confirmed that recovery and playback succeeded in production without a page reload. This closes the human acceptance for checkpoint B. No contact, message, provider or storage identifier was recorded for that test.
