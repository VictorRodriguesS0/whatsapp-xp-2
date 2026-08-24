# WhatsApp Contact Resync Re-onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-onboard the existing XP Eletrônicos WhatsApp Business App number and perform one official initial contact sync without deleting or replacing any history already stored by the atendimento system.

**Architecture:** Treat this as an operational Meta/KVM procedure, not an application release. Capture a read-only baseline and validated backup, complete official Embedded Signup in the user's authenticated browser, reconcile only identifiers or authorization that actually changed, invoke `smb_app_state_sync` once, and validate authoritative database/webhook aggregates. Keep all development worktrees isolated and never deploy their commits during this operation.

**Tech Stack:** Meta Business Manager and Embedded Signup, WhatsApp Cloud API Graph v23.0, Chrome authenticated session, Linux KVM over SSH, Docker Compose, PostgreSQL 18, Next.js production container.

## Global Constraints

- Work only in `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\complete-phone-sync` on `codex/complete-phone-sync` for documentation and evidence.
- Do not merge, cherry-pick, modify, reset, deploy, or clean any parallel worktree.
- Do not import historical messages; request only `sync_type=smb_app_state_sync`.
- Do not delete, restore, recreate, truncate, or migrate PostgreSQL or media volumes.
- Do not restart Docker, PostgreSQL, Caddy, DNS, networks, volumes, or unrelated KVM services.
- Do not recreate `xp-whatsapp-app` unless the re-onboarding changes an identifier or authorization required by the currently active image.
- If app recreation is required, use the exact already-running immutable image and `--no-deps`; no new code is built or deployed.
- Never print or commit access tokens, app secrets, environment files, message bodies, contact names, phone numbers, raw webhook payloads, or raw Graph error bodies.
- Before each Meta or KVM mutation, repeat the parallel-work and production-state readback; stop on a concurrent deployment or unstable health.
- Call `POST /{PHONE_NUMBER_ID}/smb_app_data` at most once after the successful re-onboarding. Never retry automatically.
- The user performs security confirmations, QR/PIN/2FA and final account-selection clicks in the authenticated Meta/WhatsApp interface.

---

## File Structure

- `.superpowers/sdd/contact-resync-preflight.md`: worktree inventory, production baseline, backup evidence and safe Meta readback.
- `.superpowers/sdd/contact-resync-operation.md`: onboarding checkpoints, identifier comparison, single sync result and recovery decisions.
- `docs/verification/2026-08-23-whatsapp-contact-resync.md`: final acceptance, preserved-history evidence and rollback coordinates.

### Task 1: Establish an immutable preflight and validated backup

**Files:**
- Create: `.superpowers/sdd/contact-resync-preflight.md`

**Interfaces:**
- Consumes the current Git worktree inventory, active KVM revision/image, current Meta account state and canonical backup tooling.
- Produces a go/no-go decision plus exact recovery coordinates without secrets or PII.

- [ ] **Step 1: Inventory every worktree immediately before external access**

Run locally:

```powershell
$paths = git worktree list --porcelain |
  Where-Object { $_ -like 'worktree *' } |
  ForEach-Object { $_.Substring(9) }
foreach ($path in $paths) {
  "WORKTREE=$path"
  git -C $path status --short
  git -C $path branch --show-current
  git -C $path log -1 --format='%H|%s'
}
git branch --all --verbose --no-abbrev
git log --all --since='2 days ago' --date=iso --pretty=format:'%H|%ad|%d|%s'
```

Expected: every worktree/HEAD/dirty state is known. Dirty untracked `.superpowers/` and `node_modules/` in old MVP skeletons are recorded but never altered. Stop if any clean feature worktree is currently performing a deploy or Meta mutation.

- [ ] **Step 2: Read production without exposing environment values**

Obtain the existing KVM SSH target interactively and run only these read operations:

```powershell
$kvm = Read-Host 'Informe o host SSH já autorizado da KVM'
ssh $kvm @'
set -eu
docker inspect --format '{{.Config.Image}}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}' xp-whatsapp-app
docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}|{{.State.StartedAt}}' xp-whatsapp-database
curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker exec xp-whatsapp-database sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL; SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL; SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NOT NULL;"'
'@
Invoke-WebRequest -UseBasicParsing -Uri 'https://whatsapp.xpeletronicos.com/api/health' | Select-Object StatusCode,Content
```

Expected: public/local health `200`, app/database healthy, restart count zero, at least 17 completed migrations, zero unfinished migrations and zero rolled-back migrations. Record the exact completed count and revision/image/container identities in the preflight report; later checks must match this baseline count.

- [ ] **Step 3: Snapshot all non-app containers deterministically**

Run on the KVM through the same SSH target:

```powershell
ssh $kvm @'
docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}' |
  grep -v '|xp-whatsapp-app|' |
  LC_ALL=C sort |
  sha256sum
'@
```

Expected: one SHA-256 digest is recorded before any mutation. Do not stop, restart or inspect environment variables of unrelated containers.

- [ ] **Step 4: Create and validate a fresh canonical backup**

Run:

```powershell
ssh $kvm @'
set -eu
cd /opt/apps/example-app/current
backup_output=$(./scripts/backup.sh /srv/backups/example-app --env-file /opt/apps/example-app/.env.production)
backup_dir=$(printf '%s\n' "$backup_output" | sed -n 's/^Backup validado em: //p' | tail -1)
test -n "$backup_dir"
test -d "$backup_dir"
find "$backup_dir" -maxdepth 1 -type f -printf '%f|%m|%s\n' | LC_ALL=C sort
sha256sum -c "$backup_dir/database.dump.sha256"
sha256sum -c "$backup_dir/media.tar.gz.sha256"
pg_restore --list "$backup_dir/database.dump" >/dev/null
tar -tzf "$backup_dir/media.tar.gz" >/dev/null
printf 'BACKUP_DIR=%s\n' "$backup_dir"
'@
```

Expected: both hash checks succeed, PostgreSQL dump/media archive validate, all sensitive artifacts are mode `0600`, and the absolute backup directory is recorded.

- [ ] **Step 5: Read the Meta baseline in the authenticated browser**

In Meta App Dashboard and WhatsApp Manager, read and record without copying secrets:

- WABA ID and Phone Number ID as opaque identifiers in the private operation report;
- displayed number ending only, not the full number;
- `is_on_biz_app=true`, Cloud API connected and account quality state;
- callback host `whatsapp.xpeletronicos.com`;
- one active subscription with `messages`, `smb_message_echoes` and `smb_app_state_sync` each present once;
- current system user has the app and WABA assigned.

Expected: state matches the healthy deployed integration. If it does not, stop before disconnecting and document the mismatch.

- [ ] **Step 6: Commit the preflight evidence**

Write only non-secret evidence to `.superpowers/sdd/contact-resync-preflight.md`, then run:

```powershell
git add .superpowers/sdd/contact-resync-preflight.md
git commit -m "docs: audit WhatsApp contact resync preflight"
```

Expected: one documentation-only commit; `git status --short` is clean.

### Task 2: Re-onboard the same number through the official flow

**Files:**
- Create: `.superpowers/sdd/contact-resync-operation.md`

**Interfaces:**
- Consumes the Task 1 baseline and the user's authenticated Meta/WhatsApp session.
- Produces a reconnected coexistence number and an exact old/new identifier comparison before any sync request.

- [ ] **Step 1: Repeat the no-concurrency gate**

Run the worktree, production and non-app checks again:

```powershell
$paths = git worktree list --porcelain |
  Where-Object { $_ -like 'worktree *' } |
  ForEach-Object { $_.Substring(9) }
foreach ($path in $paths) {
  "WORKTREE=$path"
  git -C $path status --short
  git -C $path branch --show-current
  git -C $path log -1 --format='%H|%s'
}
ssh $kvm @'
set -eu
docker inspect --format '{{.Config.Image}}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}' xp-whatsapp-app
docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}|{{.State.StartedAt}}' xp-whatsapp-database
curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}' | grep -v '|xp-whatsapp-app|' | LC_ALL=C sort | sha256sum
'@
```

Expected: no parallel deploy/Meta mutation, health remains stable, app/database identities match the recorded baseline and the non-app digest is byte-identical.

- [ ] **Step 2: Start official Embedded Signup for the existing business**

In the authenticated browser, open the XP Eletrônicos Meta app and start the official **Connect WhatsApp Business App / Embedded Signup** flow. Select the existing business portfolio and the same WhatsApp Business App number. Do not select a different number or create another portfolio/WABA merely to bypass an error.

Expected: Meta identifies the same number and shows the coexistence/share-data consent. If it instead requires destructive account deletion or number replacement, stop and record the exact screen without confirming.

- [ ] **Step 3: Authorize contacts but decline historical message import**

In the consent flow:

- authorize continued coexistence and contact sharing;
- do not opt into historical chat import for this operation;
- let the user complete WhatsApp PIN/QR/2FA confirmations;
- finish only after Meta reports the number connected.

Expected: the existing number is connected; no second number is added.

- [ ] **Step 4: Compare identifiers and permissions before touching KVM config**

Read back WABA ID, Phone Number ID, app assignment, system-user assets, permissions, callback and subscribed fields. Record a table with `unchanged`/`changed`, never token values.

Expected: if IDs and authorization are unchanged, skip Task 2 Step 5. If any required value changed, proceed only with the minimum configuration reconciliation.

- [ ] **Step 5: Reconcile changed runtime identifiers without deploying code**

Only when Task 2 Step 4 proves a required value changed:

1. create a mode-`0600` backup of `/opt/apps/example-app/.env.production` beside it;
2. edit only `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` values that changed;
3. retain the exact current `XP_WHATSAPP_IMAGE` and every unrelated variable;
4. rerun the worktree/deploy/no-concurrency gate;
5. recreate only the app:

```powershell
ssh $kvm @'
set -eu
cd /opt/apps/example-app/current/deploy/kvm
docker compose --env-file /opt/apps/example-app/.env.production up -d --no-deps --force-recreate --wait --wait-timeout 120 app
docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}' xp-whatsapp-app
'@
```

Expected: the same immutable image remains active, only app ID changes, health becomes healthy, database identity/start stays unchanged and the non-app snapshot hash is identical.

- [ ] **Step 6: Restore the required subscriptions append-only**

Use Meta's subscription editor/API to preserve every preflight field and ensure `messages`, `smb_message_echoes` and `smb_app_state_sync` are each subscribed once to the same callback. Do not remove/recreate the subscription object if an append-only update is available.

Expected: one active subscription, one callback and the three required fields exactly once.

- [ ] **Step 7: Record the re-onboarding checkpoint**

Create `.superpowers/sdd/contact-resync-operation.md` with timestamps, unchanged/changed identifiers, authorization/subscription aggregates and any app-only recreation evidence. Do not commit yet because the single sync result belongs in the same report.

### Task 3: Request the initial agenda exactly once

**Files:**
- Modify: `.superpowers/sdd/contact-resync-operation.md`

**Interfaces:**
- Consumes the reconnected Phone Number ID and token already held inside `xp-whatsapp-app`.
- Produces exactly one Graph request result and subsequent signed contact-sync webhook processing.

- [ ] **Step 1: Capture database baselines without contact data**

Run:

```powershell
ssh $kvm @'
docker exec xp-whatsapp-database sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM whatsapp_app_contacts; SELECT COUNT(*) FROM webhook_events WHERE event_type = '\''contactSyncBatch'\''; SELECT COUNT(*) FROM conversations;"'
'@
```

Expected: three aggregate counts are recorded; no names or phones are emitted.

- [ ] **Step 2: Execute one server-side Graph request**

Run this command once only:

```powershell
ssh $kvm @'
docker exec -i xp-whatsapp-app node <<'NODE'
const version = process.env.META_GRAPH_API_VERSION || "v23.0";
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;
if (!phoneId || !token) throw new Error("missing_runtime_whatsapp_credentials");
const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/smb_app_data`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" }),
  signal: AbortSignal.timeout(15000),
});
const body = await response.json().catch(() => ({}));
const requestId = typeof body?.request_id === "string" ? body.request_id :
  typeof body?.data?.request_id === "string" ? body.data.request_id : null;
const graphCode = Number.isInteger(body?.error?.code) ? body.error.code : null;
console.log(JSON.stringify({ ok: response.ok, status: response.status, requestId, graphCode }));
if (!response.ok) process.exitCode = 2;
NODE
'@
```

Expected success: HTTP status `200`, `ok=true` and an opaque request ID. Expected failure handling: record only status/request ID/Graph code, do not print raw response and do not run this command again.

- [ ] **Step 3: Monitor signed delivery with bounded polling**

For up to 20 minutes, poll every 30 seconds from the KVM using aggregate SQL and app health. Stop early when `whatsapp_app_contacts` or processed `CONTACT_SYNC` events increase, or on a failed event/health regression. Do not use a blocking sleep longer than 30 seconds and report progress at least once per minute.

Expected: at least one contact-sync webhook is processed unless Meta formally reports an empty address book. Failed webhook events trigger diagnosis before any further Meta action; the sync request is never repeated.

- [ ] **Step 4: Verify database invariants after delivery**

Run aggregate/invariant SQL:

```powershell
ssh $kvm @'
docker exec xp-whatsapp-database sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "
SELECT COUNT(*) FROM whatsapp_app_contacts;
SELECT COUNT(*) FROM whatsapp_app_contacts WHERE active AND full_name IS NOT NULL;
SELECT COUNT(*) FROM webhook_events WHERE event_type = '\''contactSyncBatch'\'' AND status = '\''PROCESSED'\'';
SELECT COUNT(*) FROM webhook_events WHERE event_type = '\''contactSyncBatch'\'' AND status = '\''FAILED'\'';
SELECT COUNT(*) FROM conversations;
SELECT COUNT(*) FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN whatsapp_app_contacts wac ON wac.id=ct.whatsapp_app_contact_id WHERE c.created_at >= NOW() - INTERVAL '\''30 minutes'\'' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id);
"'
'@
```

Expected: active named contacts and processed events are positive for a non-empty agenda, failed events zero, and zero newly created empty conversations.

- [ ] **Step 5: Commit the operation evidence**

Append the one-request result and safe aggregates to `.superpowers/sdd/contact-resync-operation.md`, then run:

```powershell
git add .superpowers/sdd/contact-resync-operation.md
git commit -m "docs: record WhatsApp contact resync operation"
```

Expected: one documentation-only commit; no runtime credential or PII appears in `git show --check --stat HEAD`.

### Task 4: Validate preservation and close the operation

**Files:**
- Create: `docs/verification/2026-08-23-whatsapp-contact-resync.md`

**Interfaces:**
- Consumes Task 1 baseline, Task 2 re-onboarding checkpoint and Task 3 aggregate result.
- Produces final human/technical acceptance and recovery coordinates.

- [ ] **Step 1: Verify application and infrastructure stability**

Run:

```powershell
ssh $kvm @'
set -eu
docker inspect --format '{{.Config.Image}}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}' xp-whatsapp-app
docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.Id}}|{{.State.StartedAt}}' xp-whatsapp-database
curl --fail --silent --show-error http://127.0.0.1:3100/api/health
docker exec xp-whatsapp-database sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL; SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL; SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NOT NULL;"'
docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}' | grep -v '|xp-whatsapp-app|' | LC_ALL=C sort | sha256sum
'@
Invoke-WebRequest -UseBasicParsing -Uri 'https://whatsapp.xpeletronicos.com/api/health' | Select-Object StatusCode,Content
```

Expected: public/local health `200`, app healthy/restarts zero, database ID and `StartedAt` unchanged, completed migration count equal to the recorded baseline with zero unfinished/rolled-back migrations, and the non-app hash byte-identical.

- [ ] **Step 2: Verify preserved application history**

Using an authenticated application session, open multiple pre-existing conversations and confirm messages, media, labels, contact types, responsible users, read state and pins remain present. Use only user-visible verification; do not write message content or contact identifiers to the report.

Expected: no missing historical data and no duplicate/empty conversation created by address-book-only rows.

- [ ] **Step 3: Perform controlled contact acceptance**

Ask the user to identify one existing saved contact by name in the application, then add or edit one test contact in WhatsApp Business App and wait for the existing webhook subscription to refresh it. Remove only that controlled test contact and verify fallback behavior without deleting its conversation/history.

Expected: initial name visible, future add/edit visible, removal clears only the imported name, and a manual `preferredName` remains authoritative throughout.

- [ ] **Step 4: Verify new-message coexistence both directions**

With a user-authorized test contact, send one short message from the WhatsApp Business App and verify one outbound echo in the system; send one short reply from the system within the open customer-service window and verify it in the app. Do not use an uninvolved customer.

Expected: exactly one row per message, shared response/read state converges, and no provider/webhook error is logged.

- [ ] **Step 5: Write and commit the final verification report**

Record revision/image, backup directory, old/new identifier equality, subscription aggregates, one-request outcome, database counts, health, non-app hash, human acceptance and recovery coordinates without PII. Run:

```powershell
git add docs/verification/2026-08-23-whatsapp-contact-resync.md
git commit -m "docs: verify WhatsApp contact resync"
git diff c049e0e18f61431ae8104c00d598bc942a24873f --check
git status --short
```

Expected: diff check passes, worktree is clean, and the branch contains documentation/evidence only.

- [ ] **Step 6: Hand off message-edit support as a separate design**

Report that agenda synchronization is complete. Start a new brainstorming/spec cycle for applying official `smb_message_echoes` `edit` content to stored outbound messages, including edit history/audit and UI **editada** state. Do not bundle that code into this operational branch.
