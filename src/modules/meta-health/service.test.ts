import { randomUUID } from "node:crypto";

import { UserRole } from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MetaHealthGraphError, type MetaHealthGraphClient } from "./graph-client";
import type {
  CompleteMetaSyncInput,
  MetaAlertRecord,
  MetaHealthRepository,
  MetaHealthSnapshotRecord,
  MetaTransitionInput,
} from "./repository";
import {
  acknowledgeMetaAlert,
  applyMetaOperationalEvent,
  getMetaHealthSummary,
  syncMetaHealth,
} from "./service";
import type { MetaHealthRemoteState } from "./types";

const admin: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

const config = { phoneNumberId: "phone-1", wabaId: "waba-1" };
const start = new Date("2026-08-23T12:00:00.000Z");

function remote(overrides: Partial<MetaHealthRemoteState> = {}): MetaHealthRemoteState {
  return {
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    displayPhoneNumber: "+55 61 99999-0000",
    verifiedName: "XP Eletrônicos",
    qualityRating: "GREEN",
    accountReviewStatus: "APPROVED",
    templates: [],
    ...overrides,
  };
}

function createMemoryMetaHealthRepository(
  initial: Partial<MetaHealthSnapshotRecord> = {},
): MetaHealthRepository & { alerts: MetaAlertRecord[]; snapshot: MetaHealthSnapshotRecord } {
  const snapshot: MetaHealthSnapshotRecord = {
    id: randomUUID(),
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    displayPhoneNumber: null,
    verifiedName: null,
    qualityRating: null,
    accountReviewStatus: null,
    accountEvent: null,
    connectionState: "UNKNOWN",
    connectionObservedAt: null,
    connectionReason: null,
    messagingLimit: null,
    lastSyncAttemptAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncErrorCode: null,
    syncLeaseId: null,
    syncLeaseUntil: null,
    ...initial,
  };
  const alerts: MetaAlertRecord[] = [];

  const apply = (transition: MetaTransitionInput) => {
    if (
      transition.deduplicationKey &&
      alerts.some((alert) => alert.deduplicationKey === transition.deduplicationKey)
    ) return;
    const latest = alerts
      .filter(
        (alert) =>
          alert.sourceField === transition.sourceField &&
          alert.resourceId === transition.resourceId,
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    if (latest?.eventCode === transition.eventCode) return;

    for (const alert of alerts) {
      if (
        alert.active &&
        alert.resourceId === transition.resourceId &&
        transition.resolvesCodes.includes(alert.eventCode)
      ) {
        alert.active = false;
        alert.resolvedAt = transition.occurredAt;
      }
    }
    alerts.push({
      id: randomUUID(),
      snapshotId: snapshot.id,
      deduplicationKey: transition.deduplicationKey,
      category: transition.category,
      severity: transition.severity,
      source: transition.source,
      sourceField: transition.sourceField,
      eventCode: transition.eventCode,
      resourceId: transition.resourceId,
      summary: transition.summary,
      details: transition.details,
      occurredAt: transition.occurredAt,
      active: transition.active,
      resolvedAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
  };

  return {
    snapshot,
    alerts,
    async ensureSnapshot(phoneNumberId, wabaId) {
      snapshot.phoneNumberId = phoneNumberId;
      snapshot.wabaId = wabaId;
      return { ...snapshot };
    },
    async getSnapshotView() {
      return {
        snapshot: { ...snapshot },
        activeCodes: alerts.filter((alert) => alert.active).map((alert) => alert.eventCode),
        unacknowledgedCount: alerts.filter((alert) => !alert.acknowledgedAt).length,
      };
    },
    async tryAcquireSyncLease(input) {
      if (snapshot.syncLeaseUntil && snapshot.syncLeaseUntil > input.now) return false;
      snapshot.syncLeaseId = input.leaseId;
      snapshot.syncLeaseUntil = input.leaseUntil;
      snapshot.lastSyncAttemptAt = input.now;
      return true;
    },
    async completeSyncSuccess(input: CompleteMetaSyncInput) {
      if (snapshot.syncLeaseId !== input.leaseId) return false;
      Object.assign(snapshot, {
        displayPhoneNumber: input.remote.displayPhoneNumber,
        verifiedName: input.remote.verifiedName,
        qualityRating: input.remote.qualityRating,
        accountReviewStatus: input.remote.accountReviewStatus,
        lastSuccessfulSyncAt: input.now,
        lastSyncErrorCode: null,
        syncLeaseId: null,
        syncLeaseUntil: null,
      });
      input.transitions.forEach(apply);
      const presentTemplateIds = new Set(
        input.remote.templates.map(({ id }) => id),
      );
      for (const alert of alerts) {
        if (
          alert.snapshotId === input.snapshotId &&
          alert.active &&
          alert.eventCode === "TEMPLATE_PENDING_DELETION" &&
          alert.resourceId !== null &&
          !presentTemplateIds.has(alert.resourceId)
        ) {
          alert.active = false;
          alert.resolvedAt = input.now;
        }
      }
      return true;
    },
    async completeSyncFailure(input) {
      if (snapshot.syncLeaseId !== input.leaseId) return false;
      snapshot.lastSyncErrorCode = input.errorCode;
      snapshot.syncLeaseId = null;
      snapshot.syncLeaseUntil = null;
      return true;
    },
    async applyOperationalEvent(input) {
      Object.assign(snapshot, input.snapshotPatch);
      apply(input.transition);
    },
    async listAlerts() {
      return { alerts: [...alerts], nextCursor: null };
    },
    async acknowledgeAlert(id, user, now) {
      const alert = alerts.find((candidate) => candidate.id === id) ?? null;
      if (alert && !alert.acknowledgedAt) {
        alert.acknowledgedAt = now;
        alert.acknowledgedBy = { id: user.id, name: user.name };
      }
      return alert;
    },
  };
}

function clientWith(state: MetaHealthRemoteState): MetaHealthGraphClient {
  return { fetchState: vi.fn().mockResolvedValue(state) };
}

describe("Meta health reconciliation service", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates the first snapshot and reconciles Graph state", async () => {
    const repository = createMemoryMetaHealthRepository();
    await expect(
      syncMetaHealth(admin, {
        repository,
        client: clientWith(remote()),
        config,
        now: () => start,
      }),
    ).resolves.toEqual({ status: "SYNCED", success: true });
    expect(repository.snapshot).toMatchObject({ qualityRating: "GREEN", lastSyncErrorCode: null });
  });

  it("short-circuits a fresh automatic synchronization", async () => {
    const repository = createMemoryMetaHealthRepository({
      connectionState: "CONNECTED",
      connectionObservedAt: new Date(start.getTime() - 60_000),
      lastSuccessfulSyncAt: new Date(start.getTime() - 60_000),
    });
    const client = clientWith(remote());
    await expect(
      syncMetaHealth(admin, { repository, client, config, now: () => start }),
    ).resolves.toEqual({ status: "FRESH", success: true });
    expect(client.fetchState).not.toHaveBeenCalled();
  });

  it("returns BUSY while another valid lease owns synchronization", async () => {
    const repository = createMemoryMetaHealthRepository({
      syncLeaseId: randomUUID(),
      syncLeaseUntil: new Date(start.getTime() + 30_000),
    });
    await expect(
      syncMetaHealth(admin, {
        repository,
        client: clientWith(remote()),
        config,
        now: () => start,
        force: true,
      }),
    ).resolves.toEqual({ status: "BUSY", success: true });
  });

  it("recovers an expired synchronization lease", async () => {
    const repository = createMemoryMetaHealthRepository({
      syncLeaseId: randomUUID(),
      syncLeaseUntil: new Date(start.getTime() - 1),
    });
    await expect(
      syncMetaHealth(admin, {
        repository,
        client: clientWith(remote()),
        config,
        now: () => start,
        force: true,
      }),
    ).resolves.toEqual({ status: "SYNCED", success: true });
  });

  it("records one alert per transition and resolves it on recovery", async () => {
    const repository = createMemoryMetaHealthRepository();
    const dependencies = { repository, config, now: () => start, force: true };
    await syncMetaHealth(admin, { ...dependencies, client: clientWith(remote({ qualityRating: "RED" })) });
    await syncMetaHealth(admin, {
      ...dependencies,
      now: () => new Date(start.getTime() + 61_000),
      client: clientWith(remote({ qualityRating: "RED" })),
    });
    expect(repository.alerts.filter((alert) => alert.eventCode === "QUALITY_RED")).toHaveLength(1);

    await syncMetaHealth(admin, {
      ...dependencies,
      now: () => new Date(start.getTime() + 122_000),
      client: clientWith(remote({ qualityRating: "GREEN" })),
    });
    expect(repository.alerts.find((alert) => alert.eventCode === "QUALITY_RED")?.active).toBe(false);
  });

  it("preserves a critical snapshot when Graph synchronization fails", async () => {
    const repository = createMemoryMetaHealthRepository({
      qualityRating: "RED",
      lastSuccessfulSyncAt: new Date("2026-08-23T10:00:00Z"),
    });
    const client: MetaHealthGraphClient = {
      fetchState: vi.fn().mockRejectedValue(new MetaHealthGraphError("META_TIMEOUT")),
    };
    await expect(
      syncMetaHealth(admin, { repository, client, config, now: () => start, force: true }),
    ).resolves.toEqual({ status: "SYNCED", success: false });
    await expect(
      getMetaHealthSummary(admin, { repository, config, now: () => start }),
    ).resolves.toMatchObject({ label: "CRITICAL", lastSyncErrorCode: "META_TIMEOUT" });
  });

  it("preserves a pending deletion alert when Graph synchronization fails", async () => {
    const repository = createMemoryMetaHealthRepository();
    await applyMetaOperationalEvent(
      {
        wabaId: config.wabaId,
        field: "message_template_status_update",
        eventCode: "PENDING_DELETION",
        resourceId: "template-timeout",
        occurredAt: start,
        details: { name: "template-timeout", language: "pt_BR" },
        deduplicationKey: "template:timeout:pending-deletion",
      },
      { repository, config },
    );
    const client: MetaHealthGraphClient = {
      fetchState: vi.fn().mockRejectedValue(new MetaHealthGraphError("META_TIMEOUT")),
    };

    await expect(
      syncMetaHealth(admin, {
        repository,
        client,
        config,
        now: () => new Date(start.getTime() + 61_000),
        force: true,
      }),
    ).resolves.toEqual({ status: "SYNCED", success: false });
    expect(
      repository.alerts.find((alert) => alert.resourceId === "template-timeout"),
    ).toMatchObject({
      eventCode: "TEMPLATE_PENDING_DELETION",
      active: true,
      resolvedAt: null,
    });
  });

  it("resolves a pending deletion missing from a successful complete template snapshot", async () => {
    const repository = createMemoryMetaHealthRepository();
    await applyMetaOperationalEvent(
      {
        wabaId: config.wabaId,
        field: "message_template_status_update",
        eventCode: "PENDING_DELETION",
        resourceId: "template-gone",
        occurredAt: start,
        details: { name: "template-gone", language: "pt_BR" },
        deduplicationKey: "template:gone:pending-deletion",
      },
      { repository, config },
    );

    await expect(
      syncMetaHealth(admin, {
        repository,
        client: clientWith(remote({ templates: [] })),
        config,
        now: () => new Date(start.getTime() + 61_000),
        force: true,
      }),
    ).resolves.toEqual({ status: "SYNCED", success: true });
    expect(
      repository.alerts.find((alert) => alert.resourceId === "template-gone"),
    ).toMatchObject({
      eventCode: "TEMPLATE_PENDING_DELETION",
      active: false,
      resolvedAt: new Date(start.getTime() + 61_000),
    });
  });

  it("rate-limits repeated manual refreshes for sixty seconds", async () => {
    const repository = createMemoryMetaHealthRepository({
      lastSyncAttemptAt: new Date(start.getTime() - 30_000),
    });
    await expect(
      syncMetaHealth(admin, {
        repository,
        client: clientWith(remote()),
        config,
        now: () => start,
        force: true,
      }),
    ).resolves.toEqual({ status: "RATE_LIMITED", success: true });
  });

  it("acknowledges an alert idempotently", async () => {
    const repository = createMemoryMetaHealthRepository();
    await syncMetaHealth(admin, {
      repository,
      client: clientWith(remote({ qualityRating: "RED" })),
      config,
      now: () => start,
      force: true,
    });
    const id = repository.alerts[0]!.id;
    const first = await acknowledgeMetaAlert(admin, id, { repository, now: () => start });
    const second = await acknowledgeMetaAlert(admin, id, {
      repository,
      now: () => new Date(start.getTime() + 60_000),
    });
    expect(second.acknowledgedAt).toBe(first.acknowledgedAt);
  });

  it("applies a deduplicated webhook transition and updates the snapshot", async () => {
    const repository = createMemoryMetaHealthRepository();
    const event = {
      wabaId: "waba-1",
      field: "account_update" as const,
      eventCode: "DISABLED_UPDATE",
      resourceId: "waba-1",
      occurredAt: start,
      details: { currentLimit: "TIER_10K" },
      deduplicationKey: "meta:stable-webhook-key",
    };
    await applyMetaOperationalEvent(event, { repository, config });
    await applyMetaOperationalEvent(event, { repository, config });
    expect(repository.snapshot).toMatchObject({
      accountEvent: "DISABLED_UPDATE",
      messagingLimit: "TIER_10K",
    });
    expect(repository.alerts).toHaveLength(1);
    expect(repository.alerts[0]).toMatchObject({
      source: "WEBHOOK",
      eventCode: "ACCOUNT_DISABLED",
      severity: "CRITICAL",
    });
  });
});
