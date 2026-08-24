import "server-only";

import { randomUUID } from "node:crypto";

import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";

import {
  createMetaHealthGraphClient,
  MetaHealthGraphError,
  type MetaHealthGraphClient,
  type MetaHealthGraphErrorCode,
} from "./graph-client";
import {
  prismaMetaHealthRepository,
  type MetaAlertListInput,
  type MetaHealthRepository,
  type MetaHealthSnapshotRecord,
  type MetaTransitionInput,
} from "./repository";
import {
  deriveMetaHealthLabel,
  describeMetaTransition,
  META_HEALTH_STALE_AFTER_MS,
} from "./severity";
import type {
  MetaAlertPageDto,
  MetaHealthRemoteState,
  MetaHealthSummaryDto,
  MetaOperationalAlertDto,
  MetaOperationalField,
  MetaSyncResult,
} from "./types";

const SYNC_LEASE_MS = 60_000;
const MANUAL_REFRESH_INTERVAL_MS = 60_000;

type MetaHealthConfig = { phoneNumberId: string; wabaId: string };

type BaseDependencies = {
  repository?: MetaHealthRepository;
  config?: MetaHealthConfig;
  now?: () => Date;
};

type SyncDependencies = BaseDependencies & {
  client?: MetaHealthGraphClient;
  force?: boolean;
};

function defaultConfig(): MetaHealthConfig {
  const env = getServerEnv();
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    throw new HttpError(503, "Integração com a Meta não configurada");
  }
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  };
}

function defaultClient(): MetaHealthGraphClient {
  const env = getServerEnv();
  if (
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
    !env.WHATSAPP_ACCESS_TOKEN
  ) {
    throw new HttpError(503, "Integração com a Meta não configurada");
  }
  return createMetaHealthGraphClient({
    graphVersion: env.META_GRAPH_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    timeoutMs: env.META_HTTP_TIMEOUT_MS,
  });
}

function dtoDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function isStale(snapshot: MetaHealthSnapshotRecord, now: Date): boolean {
  return (
    snapshot.lastSuccessfulSyncAt === null ||
    now.getTime() - snapshot.lastSuccessfulSyncAt.getTime() > META_HEALTH_STALE_AFTER_MS
  );
}

function transition(
  sourceField: MetaOperationalField,
  providerEventCode: string,
  resourceId: string | null,
  occurredAt: Date,
  details: Record<string, string | null> | null,
): MetaTransitionInput {
  const description = describeMetaTransition(sourceField, providerEventCode);
  return {
    deduplicationKey: null,
    category: description.category,
    severity: description.severity,
    source: "RECONCILIATION",
    sourceField,
    eventCode: description.alertCode,
    resourceId,
    summary: description.summary,
    details,
    occurredAt,
    active: description.active,
    resolvesCodes: description.resolvesCodes,
  };
}

function reconciliationTransitions(
  snapshot: MetaHealthSnapshotRecord,
  remote: MetaHealthRemoteState,
  now: Date,
): MetaTransitionInput[] {
  const transitions: MetaTransitionInput[] = [];
  if (remote.qualityRating && remote.qualityRating !== snapshot.qualityRating) {
    transitions.push(
      transition(
        "phone_number_quality_update",
        remote.qualityRating,
        remote.phoneNumberId,
        now,
        { qualityRating: remote.qualityRating },
      ),
    );
  }
  if (
    remote.accountReviewStatus &&
    remote.accountReviewStatus !== snapshot.accountReviewStatus
  ) {
    transitions.push(
      transition(
        "account_review_update",
        remote.accountReviewStatus,
        remote.wabaId,
        now,
        { reviewStatus: remote.accountReviewStatus },
      ),
    );
  }
  if (
    remote.verifiedName !== snapshot.verifiedName &&
    remote.verifiedName !== null
  ) {
    transitions.push(
      transition("phone_number_name_update", "SYNCED", remote.phoneNumberId, now, {
        verifiedName: remote.verifiedName,
      }),
    );
  }
  for (const template of remote.templates) {
    transitions.push(
      transition("message_template_status_update", template.status, template.id, now, {
        name: template.name,
        language: template.language,
      }),
    );
  }
  return transitions;
}

function toAlertDto(alert: Awaited<ReturnType<MetaHealthRepository["acknowledgeAlert"]>> & {}): MetaOperationalAlertDto {
  return {
    id: alert.id,
    category: alert.category,
    severity: alert.severity,
    source: alert.source,
    sourceField: alert.sourceField,
    eventCode: alert.eventCode,
    resourceId: alert.resourceId,
    summary: alert.summary,
    details: alert.details,
    occurredAt: alert.occurredAt.toISOString(),
    active: alert.active,
    resolvedAt: dtoDate(alert.resolvedAt),
    acknowledgedAt: dtoDate(alert.acknowledgedAt),
    acknowledgedBy: alert.acknowledgedBy,
  };
}

async function context(dependencies: BaseDependencies) {
  const repository = dependencies.repository ?? prismaMetaHealthRepository;
  const config = dependencies.config ?? defaultConfig();
  const snapshot = await repository.ensureSnapshot(config.phoneNumberId, config.wabaId);
  return { repository, config, snapshot };
}

export async function getMetaHealthSummary(
  actor: SessionUser,
  dependencies: BaseDependencies = {},
): Promise<MetaHealthSummaryDto> {
  await requireAdmin(async () => actor);
  const now = dependencies.now?.() ?? new Date();
  const { repository, snapshot } = await context(dependencies);
  const view = await repository.getSnapshotView(snapshot.id);
  const stale = isStale(view.snapshot, now);
  return {
    label: deriveMetaHealthLabel(
      {
        qualityRating: view.snapshot.qualityRating,
        activeCodes: view.activeCodes,
        lastSuccessfulSyncAt: view.snapshot.lastSuccessfulSyncAt,
      },
      now,
    ),
    unacknowledgedCount: view.unacknowledgedCount,
    stale,
    phone: {
      displayPhoneNumber: view.snapshot.displayPhoneNumber,
      verifiedName: view.snapshot.verifiedName,
      qualityRating: view.snapshot.qualityRating,
    },
    account: {
      reviewStatus: view.snapshot.accountReviewStatus,
      event: view.snapshot.accountEvent,
      messagingLimit: view.snapshot.messagingLimit,
    },
    lastSuccessfulSyncAt: dtoDate(view.snapshot.lastSuccessfulSyncAt),
    lastSyncAttemptAt: dtoDate(view.snapshot.lastSyncAttemptAt),
    lastSyncErrorCode: view.snapshot.lastSyncErrorCode,
  };
}

export async function listMetaHealthAlerts(
  actor: SessionUser,
  input: MetaAlertListInput,
  dependencies: BaseDependencies = {},
): Promise<MetaAlertPageDto> {
  await requireAdmin(async () => actor);
  const { repository, snapshot } = await context(dependencies);
  const page = await repository.listAlerts(snapshot.id, input);
  return {
    alerts: page.alerts.map(toAlertDto),
    nextCursor: page.nextCursor
      ? { occurredAt: page.nextCursor.occurredAt.toISOString(), id: page.nextCursor.id }
      : null,
  };
}

export async function acknowledgeMetaAlert(
  actor: SessionUser,
  alertId: string,
  dependencies: Pick<BaseDependencies, "repository" | "now"> = {},
): Promise<MetaOperationalAlertDto> {
  await requireAdmin(async () => actor);
  const repository = dependencies.repository ?? prismaMetaHealthRepository;
  const alert = await repository.acknowledgeAlert(
    alertId,
    { id: actor.id, name: actor.name },
    dependencies.now?.() ?? new Date(),
  );
  if (!alert) throw new HttpError(404, "Alerta da Meta não encontrado");
  return toAlertDto(alert);
}

function publicErrorCode(error: unknown): MetaHealthGraphErrorCode {
  return error instanceof MetaHealthGraphError ? error.code : "META_UNAVAILABLE";
}

export async function syncMetaHealth(
  actor: SessionUser,
  dependencies: SyncDependencies = {},
): Promise<MetaSyncResult> {
  await requireAdmin(async () => actor);
  const now = dependencies.now?.() ?? new Date();
  const { repository, snapshot } = await context(dependencies);
  const force = dependencies.force ?? false;

  if (
    !force &&
    snapshot.lastSuccessfulSyncAt &&
    now.getTime() - snapshot.lastSuccessfulSyncAt.getTime() <= META_HEALTH_STALE_AFTER_MS
  ) {
    return { status: "FRESH", success: true };
  }
  if (
    force &&
    snapshot.lastSyncAttemptAt &&
    now.getTime() - snapshot.lastSyncAttemptAt.getTime() < MANUAL_REFRESH_INTERVAL_MS
  ) {
    return { status: "RATE_LIMITED", success: true };
  }

  const leaseId = randomUUID();
  const acquired = await repository.tryAcquireSyncLease({
    snapshotId: snapshot.id,
    leaseId,
    now,
    leaseUntil: new Date(now.getTime() + SYNC_LEASE_MS),
  });
  if (!acquired) return { status: "BUSY", success: true };

  try {
    const remote = await (dependencies.client ?? defaultClient()).fetchState();
    if (
      remote.phoneNumberId !== snapshot.phoneNumberId ||
      remote.wabaId !== snapshot.wabaId
    ) {
      throw new MetaHealthGraphError("META_INVALID_RESPONSE");
    }
    const saved = await repository.completeSyncSuccess({
      snapshotId: snapshot.id,
      leaseId,
      remote,
      transitions: reconciliationTransitions(snapshot, remote, now),
      now,
    });
    return saved
      ? { status: "SYNCED", success: true }
      : { status: "BUSY", success: true };
  } catch (error) {
    await repository.completeSyncFailure({
      snapshotId: snapshot.id,
      leaseId,
      errorCode: publicErrorCode(error),
    });
    return { status: "SYNCED", success: false };
  }
}
