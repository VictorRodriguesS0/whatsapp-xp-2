import "server-only";

import { Prisma, type MetaConnectionAttempt } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { connectionFromGraph, mergeConnectionEvidence, type GraphConnection } from "@/modules/meta-health/connection";

export const ACTIVE_ATTEMPT_STATES = ["WAITING", "EXCHANGING", "VERIFYING"];

export async function createAttempt(data: {
  phoneNumberId: string; userId: string; sessionHash: string; nonceHash: string; expiresAt: Date; createdAt: Date;
}): Promise<MetaConnectionAttempt> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtextextended(${`meta-connect:${data.phoneNumberId}`}, 0))`;
    await tx.metaConnectionAttempt.updateMany({
      where: { phoneNumberId: data.phoneNumberId, expiresAt: { lte: data.createdAt }, state: { in: ACTIVE_ATTEMPT_STATES } },
      data: { state: "EXPIRED" },
    });
    await tx.metaConnectionAttempt.deleteMany({ where: { expiresAt: { lt: new Date(data.createdAt.getTime() - 24 * 60 * 60_000) } } });
    const active = await tx.metaConnectionAttempt.count({ where: { phoneNumberId: data.phoneNumberId, state: { in: ACTIVE_ATTEMPT_STATES } } });
    if (active) throw new HttpError(409, "Já existe uma tentativa de reconexão em andamento", "ATTEMPT_BUSY");
    const recent = await tx.metaConnectionAttempt.count({ where: { phoneNumberId: data.phoneNumberId, createdAt: { gt: new Date(data.createdAt.getTime() - 15 * 60_000) } } });
    if (recent >= 6) throw new HttpError(429, "Aguarde antes de iniciar outra reconexão", "ATTEMPT_RATE_LIMITED");
    return tx.metaConnectionAttempt.create({ data });
  });
}

export async function saveConnectionVerification(input: {
  attemptId: string; leaseId: string; phoneNumberId: string; wabaId: string;
  connection: GraphConnection; subscribed: boolean; startedAt: Date; completedAt: Date;
}): Promise<void> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      await prisma.$transaction(async (tx) => {
        const attempt = await tx.metaConnectionAttempt.findFirst({ where: {
          id: input.attemptId, state: "VERIFYING", checkLeaseId: input.leaseId, expiresAt: { gt: input.completedAt },
        } });
        if (!attempt) return;
        const current = await tx.metaHealthSnapshot.upsert({
          where: { phoneNumberId: input.phoneNumberId },
          create: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId }, update: {},
        });
        const evidence = mergeConnectionEvidence(current, connectionFromGraph({ ...input.connection, subscribed: input.subscribed }, input.startedAt));
        if (evidence) await tx.metaHealthSnapshot.update({ where: { id: current.id }, data: evidence });
        const connected = evidence?.connectionState === "CONNECTED";
        if (connected) {
          await tx.metaOperationalAlert.updateMany({
            where: { snapshotId: current.id, eventCode: { in: ["ACCOUNT_OFFBOARDED", "PARTNER_REMOVED", "CONNECTION_DISCONNECTED"] }, occurredAt: { lte: input.startedAt }, active: true },
            data: { active: false, resolvedAt: input.completedAt },
          });
        }
        await tx.metaConnectionAttempt.update({ where: { id: attempt.id }, data: {
          state: connected && input.subscribed ? "CONNECTED" : "VERIFYING",
          errorCode: !input.subscribed ? "WEBHOOK_CONFIGURATION_REQUIRED" : connected ? null : "WAITING_FOR_META",
          checkLeaseId: null, checkLeaseUntil: null,
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || retry === 2) throw error;
    }
  }
}
