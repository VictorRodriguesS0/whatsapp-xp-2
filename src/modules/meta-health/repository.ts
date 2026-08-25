import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/modules/auth/session";

import type {
  MetaAlertCategory,
  MetaAlertSeverity,
  MetaAlertSource,
  MetaHealthRemoteState,
} from "./types";

export type MetaHealthSnapshotRecord = {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  accountReviewStatus: string | null;
  accountEvent: string | null;
  messagingLimit: string | null;
  lastSyncAttemptAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSyncErrorCode: string | null;
  syncLeaseId: string | null;
  syncLeaseUntil: Date | null;
};

export type MetaAlertRecord = {
  id: string;
  snapshotId: string;
  deduplicationKey: string | null;
  category: MetaAlertCategory;
  severity: MetaAlertSeverity;
  source: MetaAlertSource;
  sourceField: string;
  eventCode: string;
  resourceId: string | null;
  summary: string;
  details: Record<string, string | null> | null;
  occurredAt: Date;
  active: boolean;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: { id: string; name: string } | null;
};

export type MetaTransitionInput = Omit<
  MetaAlertRecord,
  | "id"
  | "snapshotId"
  | "resolvedAt"
  | "acknowledgedAt"
  | "acknowledgedBy"
> & {
  resolvesCodes: string[];
};

export type CompleteMetaSyncInput = {
  snapshotId: string;
  leaseId: string;
  remote: MetaHealthRemoteState;
  transitions: MetaTransitionInput[];
  now: Date;
};

export type MetaAlertCursor = { occurredAt: Date; id: string };

export type MetaAlertListInput = {
  limit: number;
  cursor?: MetaAlertCursor;
  active?: boolean;
};

export type MetaHealthRepository = {
  ensureSnapshot(phoneNumberId: string, wabaId: string): Promise<MetaHealthSnapshotRecord>;
  getSnapshotView(snapshotId: string): Promise<{
    snapshot: MetaHealthSnapshotRecord;
    activeCodes: string[];
    unacknowledgedCount: number;
  }>;
  tryAcquireSyncLease(input: {
    snapshotId: string;
    leaseId: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<boolean>;
  completeSyncSuccess(input: CompleteMetaSyncInput): Promise<boolean>;
  completeSyncFailure(input: {
    snapshotId: string;
    leaseId: string;
    errorCode: string;
  }): Promise<boolean>;
  applyOperationalEvent(input: {
    phoneNumberId: string;
    wabaId: string;
    transition: MetaTransitionInput;
    snapshotPatch?: Partial<
      Pick<
        MetaHealthSnapshotRecord,
        | "displayPhoneNumber"
        | "verifiedName"
        | "accountReviewStatus"
        | "accountEvent"
        | "messagingLimit"
      >
    >;
  }): Promise<void>;
  listAlerts(snapshotId: string, input: MetaAlertListInput): Promise<{
    alerts: MetaAlertRecord[];
    nextCursor: MetaAlertCursor | null;
  }>;
  acknowledgeAlert(
    id: string,
    user: Pick<SessionUser, "id" | "name">,
    now: Date,
  ): Promise<MetaAlertRecord | null>;
};

const snapshotSelect = {
  id: true,
  phoneNumberId: true,
  wabaId: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  accountReviewStatus: true,
  accountEvent: true,
  messagingLimit: true,
  lastSyncAttemptAt: true,
  lastSuccessfulSyncAt: true,
  lastSyncErrorCode: true,
  syncLeaseId: true,
  syncLeaseUntil: true,
} as const;

const alertSelect = {
  id: true,
  snapshotId: true,
  deduplicationKey: true,
  category: true,
  severity: true,
  source: true,
  sourceField: true,
  eventCode: true,
  resourceId: true,
  summary: true,
  details: true,
  occurredAt: true,
  active: true,
  resolvedAt: true,
  acknowledgedAt: true,
  acknowledgedByUser: { select: { id: true, name: true } },
} as const;

type AlertRow = Prisma.MetaOperationalAlertGetPayload<{ select: typeof alertSelect }>;
type Transaction = Prisma.TransactionClient;

function detailsFromJson(value: Prisma.JsonValue | null): Record<string, string | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bounded: Record<string, string | null> = {};
  for (const [key, candidate] of Object.entries(value).slice(0, 16)) {
    if (candidate === null || typeof candidate === "string") bounded[key] = candidate;
  }
  return bounded;
}

function hydrateAlert(row: AlertRow): MetaAlertRecord {
  return {
    ...row,
    category: row.category as MetaAlertCategory,
    severity: row.severity as MetaAlertSeverity,
    source: row.source as MetaAlertSource,
    details: detailsFromJson(row.details),
    acknowledgedBy: row.acknowledgedByUser,
  };
}

async function applyTransition(
  transaction: Transaction,
  snapshotId: string,
  transition: MetaTransitionInput,
): Promise<void> {
  if (transition.deduplicationKey) {
    const duplicate = await transaction.metaOperationalAlert.findUnique({
      where: { deduplicationKey: transition.deduplicationKey },
      select: { id: true },
    });
    if (duplicate) return;
  }

  const latest = await transaction.metaOperationalAlert.findFirst({
    where: {
      snapshotId,
      sourceField: transition.sourceField,
      resourceId: transition.resourceId,
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { eventCode: true },
  });
  if (latest?.eventCode === transition.eventCode) return;

  if (transition.resolvesCodes.length > 0) {
    await transaction.metaOperationalAlert.updateMany({
      where: {
        snapshotId,
        resourceId: transition.resourceId,
        active: true,
        eventCode: { in: transition.resolvesCodes },
      },
      data: { active: false, resolvedAt: transition.occurredAt },
    });
  }

  await transaction.metaOperationalAlert.create({
    data: {
      snapshotId,
      deduplicationKey: transition.deduplicationKey,
      category: transition.category,
      severity: transition.severity,
      source: transition.source,
      sourceField: transition.sourceField,
      eventCode: transition.eventCode,
      resourceId: transition.resourceId,
      summary: transition.summary,
      details: transition.details ?? Prisma.JsonNull,
      occurredAt: transition.occurredAt,
      active: transition.active,
    },
  });
}

async function serializable<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 2
      ) throw error;
    }
  }
  throw new Error("Unreachable Meta health transaction state");
}

async function findAlert(id: string): Promise<MetaAlertRecord | null> {
  const row = await prisma.metaOperationalAlert.findUnique({ where: { id }, select: alertSelect });
  return row ? hydrateAlert(row) : null;
}

export const prismaMetaHealthRepository: MetaHealthRepository = {
  ensureSnapshot(phoneNumberId, wabaId) {
    return prisma.metaHealthSnapshot.upsert({
      where: { phoneNumberId },
      create: { phoneNumberId, wabaId },
      update: { wabaId },
      select: snapshotSelect,
    });
  },

  async getSnapshotView(snapshotId) {
    const [snapshot, active, unacknowledgedCount] = await Promise.all([
      prisma.metaHealthSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, select: snapshotSelect }),
      prisma.metaOperationalAlert.findMany({
        where: { snapshotId, active: true },
        select: { eventCode: true },
      }),
      prisma.metaOperationalAlert.count({ where: { snapshotId, acknowledgedAt: null } }),
    ]);
    return {
      snapshot,
      activeCodes: active.map(({ eventCode }) => eventCode),
      unacknowledgedCount,
    };
  },

  async tryAcquireSyncLease({ snapshotId, leaseId, now, leaseUntil }) {
    const updated = await prisma.metaHealthSnapshot.updateMany({
      where: {
        id: snapshotId,
        OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }],
      },
      data: { syncLeaseId: leaseId, syncLeaseUntil: leaseUntil, lastSyncAttemptAt: now },
    });
    return updated.count === 1;
  },

  completeSyncSuccess(input) {
    return serializable(async (transaction) => {
      const updated = await transaction.metaHealthSnapshot.updateMany({
        where: { id: input.snapshotId, syncLeaseId: input.leaseId },
        data: {
          displayPhoneNumber: input.remote.displayPhoneNumber,
          verifiedName: input.remote.verifiedName,
          qualityRating: input.remote.qualityRating,
          accountReviewStatus: input.remote.accountReviewStatus,
          lastSuccessfulSyncAt: input.now,
          lastSyncErrorCode: null,
          syncLeaseId: null,
          syncLeaseUntil: null,
        },
      });
      if (updated.count !== 1) return false;
      for (const transition of input.transitions) {
        await applyTransition(transaction, input.snapshotId, transition);
      }
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
      return true;
    });
  },

  async completeSyncFailure({ snapshotId, leaseId, errorCode }) {
    const updated = await prisma.metaHealthSnapshot.updateMany({
      where: { id: snapshotId, syncLeaseId: leaseId },
      data: { lastSyncErrorCode: errorCode, syncLeaseId: null, syncLeaseUntil: null },
    });
    return updated.count === 1;
  },

  async applyOperationalEvent({ phoneNumberId, wabaId, transition, snapshotPatch }) {
    const snapshot = await prisma.metaHealthSnapshot.upsert({
      where: { phoneNumberId },
      create: { phoneNumberId, wabaId },
      update: { wabaId },
      select: { id: true },
    });
    await serializable(async (transaction) => {
      if (snapshotPatch && Object.keys(snapshotPatch).length > 0) {
        await transaction.metaHealthSnapshot.update({
          where: { id: snapshot.id },
          data: snapshotPatch,
        });
      }
      await applyTransition(transaction, snapshot.id, transition);
    });
  },

  async listAlerts(snapshotId, input) {
    const rows = await prisma.metaOperationalAlert.findMany({
      where: {
        snapshotId,
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.cursor
          ? {
              OR: [
                { occurredAt: { lt: input.cursor.occurredAt } },
                { occurredAt: input.cursor.occurredAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: alertSelect,
    });
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const tail = page.at(-1);
    return {
      alerts: page.map(hydrateAlert),
      nextCursor: hasMore && tail ? { occurredAt: tail.occurredAt, id: tail.id } : null,
    };
  },

  async acknowledgeAlert(id, user, now) {
    await prisma.metaOperationalAlert.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: now, acknowledgedByUserId: user.id },
    });
    return findAlert(id);
  },
};
