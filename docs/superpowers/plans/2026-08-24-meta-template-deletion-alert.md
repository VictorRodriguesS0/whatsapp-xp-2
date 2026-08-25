# Meta Template Deletion Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `TEMPLATE_PENDING_DELETION` when Meta confirms the same template is deleted, including the already-stale production alert for template `2126281431294415`.

**Architecture:** Keep webhook transitions resource-scoped, teach `DELETED` to resolve the pending-deletion code, and use only a complete successful Graph reconciliation to close pending-deletion alerts whose template IDs are absent. Preserve the informational deletion event in history and keep acknowledgement independent from operational resolution.

**Tech Stack:** Next.js 16.3.1, TypeScript 7.0.2, Prisma 7.9.1, PostgreSQL 18, Vitest, WhatsApp Graph API v23.0, Docker Compose.

## Global Constraints

- Work in `C:\Users\developer\Documents\ChatGPT\WHATSAPP XP 2\.worktrees\whatsapp-quoted-replies` on `codex/whatsapp-quoted-replies`.
- Follow TDD: RED, minimum GREEN implementation, focused test twice, then commit.
- Resolve alerts only for the same `snapshotId` and `resourceId`; never close another template's alert.
- A failed, partial, oversized, timed-out, or malformed Graph sync must not resolve anything.
- Acknowledgement never changes operational `active` state.
- Logs and verification output must not contain tokens, phone numbers, contact data, or raw Graph payloads.
- Before deployment, audit all worktrees and the current production revision; do not overwrite parallel work.
- Production root is `/opt/apps/example-app`; recreate only `xp-whatsapp-app` and preserve PostgreSQL container `4804d7dee603`.
- Create and validate a backup before replacing the app. Do not change Caddy, DNS, networks, volumes, Meta subscriptions, or unrelated KVM containers.

---

## File Structure

- `src/modules/meta-health/severity.ts`: declares that a `DELETED` template transition resolves `TEMPLATE_PENDING_DELETION`.
- `src/modules/meta-health/severity.test.ts`: unit regression for the transition description.
- `src/modules/meta-health/repository.ts`: resolves missing-template deletion alerts inside the successful reconciliation transaction.
- `src/modules/meta-health/repository.ts` repository interface implementation: accepts the complete set of template IDs already returned by the Graph client.
- `src/modules/meta-health/service.test.ts`: memory-repository proof that failures and incomplete results do not resolve alerts.
- `src/modules/meta-health/service.integration.test.ts`: PostgreSQL proof for same-resource resolution and cross-resource isolation.
- `docs/verification/2026-08-24-template-deletion-alert-release.md`: local, artifact, deploy, production reconciliation, and rollback evidence.

### Task 1: Describe the terminal template transition correctly

**Files:**
- Modify: `src/modules/meta-health/severity.test.ts`
- Modify: `src/modules/meta-health/severity.ts`

**Interfaces:**
- Produces `describeMetaTransition("message_template_status_update", "DELETED").resolvesCodes === ["TEMPLATE_PENDING_DELETION"]`.
- Consumed by webhook normalization and repository transition application without changing their call signatures.

- [ ] **Step 1: Write the RED transition test**

Add this assertion to `marks positive transitions as informational resolutions`:

```ts
expect(
  describeMetaTransition("message_template_status_update", "DELETED"),
).toMatchObject({
  severity: "INFO",
  active: false,
  alertCode: "TEMPLATE_DELETED",
  resolvesCodes: ["TEMPLATE_PENDING_DELETION"],
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/modules/meta-health/severity.test.ts
```

Expected: FAIL because `DELETED` currently returns `resolvesCodes: []`.

- [ ] **Step 3: Add the minimum transition mapping**

Replace the generic `PENDING`/`DELETED` loop with explicit transitions:

```ts
transition(
  "message_template_status_update",
  "PENDING",
  info("TEMPLATE", "Template enviado para análise", "TEMPLATE_PENDING"),
);
transition(
  "message_template_status_update",
  "DELETED",
  info("TEMPLATE", "Template excluído na Meta", "TEMPLATE_DELETED", [
    "TEMPLATE_PENDING_DELETION",
  ]),
);
```

- [ ] **Step 4: Run GREEN twice**

Run twice:

```powershell
npx vitest run src/modules/meta-health/severity.test.ts
```

Expected: PASS both times.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/meta-health/severity.ts src/modules/meta-health/severity.test.ts
git commit -m "fix: resolve deleted template alert"
```

### Task 2: Reconcile a missed deletion webhook after a complete Graph sync

**Files:**
- Modify: `src/modules/meta-health/repository.ts`
- Modify: `src/modules/meta-health/service.test.ts`
- Modify: `src/modules/meta-health/service.integration.test.ts`

**Interfaces:**
- Consumes `MetaHealthRemoteState.templates: Array<{ id: string; ... }>` from the existing bounded Graph client.
- Produces no public API changes. Successful `completeSyncSuccess` closes active `TEMPLATE_PENDING_DELETION` alerts whose `resourceId` is absent; unsuccessful sync paths remain unchanged.

- [ ] **Step 1: Write the RED PostgreSQL same-resource test**

Add a test that creates two active webhook alerts and then performs a successful sync returning only the second template:

```ts
it("resolves only pending deletions absent from a complete template snapshot", async () => {
  const actor = await prisma.user.create({
    data: {
      name: "Victor",
      email: "victor.template-delete@example.test",
      passwordHash: "not-used",
      role: UserRole.ADMIN,
    },
  });
  await applyMetaOperationalEvent(templateEvent("PENDING_DELETION", "old-1"), {
    config,
  });
  await applyMetaOperationalEvent(templateEvent("PENDING_DELETION", "keep-2"), {
    config,
  });
  await syncMetaHealth(actor, {
    config,
    force: true,
    now: () => new Date(now.getTime() + 61_000),
    client: clientWithTemplates([{ id: "keep-2", name: "keep", language: "pt_BR", status: "PENDING_DELETION" }]),
  });

  const page = await listMetaHealthAlerts(actor, { limit: 20 }, { config });
  expect(page.alerts.find((alert) => alert.resourceId === "old-1")).toMatchObject({
    eventCode: "TEMPLATE_PENDING_DELETION",
    active: false,
  });
  expect(page.alerts.find((alert) => alert.resourceId === "keep-2")).toMatchObject({
    eventCode: "TEMPLATE_PENDING_DELETION",
    active: true,
  });
});
```

Define `templateEvent` and `clientWithTemplates` in the same test file using existing fixture shapes; keep details limited to `name` and `language`.

- [ ] **Step 2: Write the RED failure-preservation test**

In `service.test.ts`, seed an active pending-deletion alert in the memory repository, make `fetchState` throw `new MetaHealthGraphError("META_TIMEOUT")`, call forced sync, and assert the alert remains active.

- [ ] **Step 3: Run both tests and verify RED**

```powershell
npx vitest run src/modules/meta-health/service.test.ts src/modules/meta-health/service.integration.test.ts
```

Expected: the absence-reconciliation assertion FAILS; timeout preservation remains PASS.

- [ ] **Step 4: Resolve absent IDs only inside `completeSyncSuccess`**

After applying remote transitions, add this transaction-scoped update:

```ts
const presentTemplateIds = input.remote.templates.map(({ id }) => id);
await transaction.metaOperationalAlert.updateMany({
  where: {
    snapshotId: input.snapshotId,
    active: true,
    eventCode: "TEMPLATE_PENDING_DELETION",
    resourceId: {
      not: null,
      ...(presentTemplateIds.length > 0
        ? { notIn: presentTemplateIds }
        : {}),
    },
  },
  data: { active: false, resolvedAt: input.now },
});
```

When the list is empty, omit `notIn` so every non-null pending-deletion resource is resolved. Do not run this update from `completeSyncFailure`, lease-loss, fresh-cache, rate-limited, or busy paths.

Mirror the exact behavior in `createMemoryMetaHealthRepository.completeSyncSuccess` so unit tests and production semantics stay aligned.

- [ ] **Step 5: Run focused GREEN twice**

```powershell
npx vitest run src/modules/meta-health/severity.test.ts src/modules/meta-health/service.test.ts src/modules/meta-health/service.integration.test.ts
```

Expected: PASS twice.

- [ ] **Step 6: Run webhook regression tests**

```powershell
npx vitest run src/modules/webhooks/normalize.test.ts src/modules/webhooks/process.test.ts
```

Expected: PASS; `DELETED` still persists one informational event and resolves only matching active codes.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/meta-health/repository.ts src/modules/meta-health/service.test.ts src/modules/meta-health/service.integration.test.ts
git commit -m "fix: reconcile deleted Meta templates"
```

### Task 3: Verify, deploy, and close the existing production alert

**Files:**
- Create: `docs/verification/2026-08-24-template-deletion-alert-release.md`

**Interfaces:**
- Consumes the current production WABA, template ID `2126281431294415`, and `/api/meta-health/sync`.
- Produces one healthy immutable app image and an inactive historical alert with `resolvedAt`, without database migration.

- [ ] **Step 1: Run local gates**

```powershell
npx prisma validate
npm run lint
npm run typecheck
npx vitest run
npm run build
powershell -ExecutionPolicy Bypass -File scripts/verify-compose.ps1
powershell -ExecutionPolicy Bypass -File scripts/verify-kvm-deployment.ps1
```

Expected: all commands exit `0`. Record exact test totals.

- [ ] **Step 2: Audit parallel work and production baseline**

Run `git worktree list --porcelain`, `git status --short` in every worktree, `git log --oneline --decorate -20`, and read-only SSH inspection of `/opt/apps/example-app/current`, the configured image, app/database container IDs, image labels, health and restart counts. Stop if the candidate does not contain the deployed revision or any unreviewed parallel change would be overwritten.

- [ ] **Step 3: Verify the exact deleted resource before mutation**

From the production app container, perform a sanitized Graph GET for template ID `2126281431294415` and a WABA template list lookup. Expected: the ID is absent or Graph returns the documented unsupported/deleted response. Query PostgreSQL read-only and verify exactly one active `TEMPLATE_PENDING_DELETION` for that same resource ID.

- [ ] **Step 4: Build the immutable Linux image and smoke it**

Build `xp-whatsapp:<candidate-sha>` for Linux/amd64 with the established resource limits. Start it against an isolated PostgreSQL 18 database/network, apply migrations, and verify `/api/health`, login, Meta routes without auth (`401`), invalid webhook signature (`401`), runtime user `1001:1001`, expected networks, and zero restarts/OOM.

- [ ] **Step 5: Create and validate backup**

Use `/opt/apps/example-app/current/scripts/backup.sh` with a new absolute directory under `/srv/backups/example-app/`. Verify the manifest and hashes. Snapshot the deterministic non-app container state and preserve the current app image for rollback.

- [ ] **Step 6: Deploy app-only**

Create `/opt/apps/example-app/releases/<candidate-sha>`, load the immutable image, change only `XP_WHATSAPP_IMAGE` in `/opt/apps/example-app/.env.production`, atomically update `current`, and run Compose for service `app` only. Do not recreate the database.

- [ ] **Step 7: Trigger one authenticated forced Meta-health sync**

Use an ephemeral five-minute admin session, call `POST /api/meta-health/sync` with the production origin, and delete the session in `finally`. Expected: sync succeeds; the exact alert becomes `active=false` with non-null `resolved_at`; no other active alert changes.

- [ ] **Step 8: Production acceptance and report**

Verify the active-alert count is zero, the old warning appears only in history, public/login health is successful, app/database are healthy with zero restarts, the database container ID and non-app snapshot are unchanged, and three 20-second soak samples contain no fatal/unhandled/migration/5xx markers. Record the candidate SHA, image ID, backup, previous image, tests, Meta proof, before/after alert rows and rollback command in the verification report, then commit it:

```powershell
git add docs/verification/2026-08-24-template-deletion-alert-release.md
git commit -m "docs: verify template deletion alert release"
```
