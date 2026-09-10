import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { MetaConnectionAttempt } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requireAdmin } from "@/modules/auth/guards";
import type { SessionUser } from "@/modules/auth/session";
import { publishRealtime } from "@/modules/realtime/hub";
import { ACTIVE_ATTEMPT_STATES, createAttempt, saveConnectionVerification } from "./repository";
import { MetaConnectionError, type ConnectionAttemptDto, type ConnectionAttemptProof, type MetaConnectionClient, type MetaConnectionConfig } from "./types";

export type ConnectionActor = { user: SessionUser; sessionHash: string };
const ATTEMPT_TTL_MS = 15 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function dto(attempt: MetaConnectionAttempt, now: Date): ConnectionAttemptDto {
  const expired = attempt.expiresAt <= now && ACTIVE_ATTEMPT_STATES.includes(attempt.state);
  return { id: attempt.id, state: (expired ? "EXPIRED" : attempt.state) as ConnectionAttemptDto["state"], expiresAt: attempt.expiresAt.toISOString(), errorCode: attempt.errorCode };
}

export function isConnectionConfigured(config: MetaConnectionConfig): boolean {
  return config.enabled && new URL(config.appUrl).protocol === "https:" &&
    [config.appId, config.configId, config.phoneNumberId, config.wabaId, config.businessId].every((id) => /^\d{1,64}$/.test(id));
}

function publicError(error: unknown): string {
  return error instanceof MetaConnectionError ? error.code : "META_UNAVAILABLE";
}

export function createMetaConnectionService(dependencies: {
  config: MetaConnectionConfig; client: MetaConnectionClient; now?: () => Date;
}) {
  const { config, client } = dependencies;
  const clock = dependencies.now ?? (() => new Date());
  function configured() {
    if (!isConnectionConfigured(config)) throw new HttpError(503, "A reconexão oficial ainda não foi habilitada na configuração da Meta", "SIGNUP_NOT_CONFIGURED");
  }
  async function owner(actor: ConnectionActor, id: string, nonce?: string, active = false) {
    await requireAdmin(async () => actor.user);
    const attempt = await prisma.metaConnectionAttempt.findFirst({ where: { id, userId: actor.user.id, sessionHash: actor.sessionHash, phoneNumberId: config.phoneNumberId } });
    if (!attempt) throw new HttpError(404, "Tentativa não encontrada");
    if (nonce !== undefined && !timingSafeEqual(Buffer.from(hash(nonce)), Buffer.from(attempt.nonceHash))) throw new HttpError(403, "Tentativa inválida");
    if (active && (attempt.expiresAt <= clock() || !ACTIVE_ATTEMPT_STATES.includes(attempt.state))) throw new HttpError(409, "Esta tentativa já foi encerrada. Atualize o estado da conexão.", "ATTEMPT_CLOSED");
    return attempt;
  }
  async function fail(id: string, errorCode: string) {
    await prisma.metaConnectionAttempt.updateMany({ where: { id, state: { in: ACTIVE_ATTEMPT_STATES } }, data: { state: "FAILED", errorCode, checkLeaseId: null, checkLeaseUntil: null } });
  }
  async function status(actor: ConnectionActor, id: string) { return dto(await owner(actor, id), clock()); }

  return {
    status,
    async latest(actor: ConnectionActor): Promise<ConnectionAttemptDto | null> {
      await requireAdmin(async () => actor.user);
      const attempt = await prisma.metaConnectionAttempt.findFirst({ where: { userId: actor.user.id, sessionHash: actor.sessionHash, phoneNumberId: config.phoneNumberId }, orderBy: { createdAt: "desc" } });
      return attempt ? dto(attempt, clock()) : null;
    },
    async start(actor: ConnectionActor): Promise<ConnectionAttemptDto & { nonce: string }> {
      await requireAdmin(async () => actor.user);
      configured();
      const now = clock();
      const current = await prisma.metaHealthSnapshot.findUnique({ where: { phoneNumberId: config.phoneNumberId } });
      if (current?.connectionState === "CONNECTED" && current.connectionObservedAt && now.getTime() - current.connectionObservedAt.getTime() < ATTEMPT_TTL_MS) {
        throw new HttpError(409, "A integração já está conectada. Atualize o diagnóstico antes de iniciar outro vínculo.", "ALREADY_CONNECTED");
      }
      const nonce = randomBytes(32).toString("base64url");
      const attempt = await createAttempt({ phoneNumberId: config.phoneNumberId, userId: actor.user.id, sessionHash: actor.sessionHash, nonceHash: hash(nonce), expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS), createdAt: now });
      return { ...dto(attempt, now), nonce };
    },
    async exchange(actor: ConnectionActor, input: ConnectionAttemptProof & { code: string }) {
      configured();
      const attempt = await owner(actor, input.id, input.nonce, true);
      if (attempt.state !== "WAITING") throw new HttpError(409, "O código desta tentativa já foi recebido", "CODE_ALREADY_RECEIVED");
      let claimed: number;
      try {
        claimed = (await prisma.metaConnectionAttempt.updateMany({ where: { id: attempt.id, state: "WAITING", expiresAt: { gt: clock() } }, data: { state: "EXCHANGING", codeHash: hash(input.code) } })).count;
      } catch {
        throw new HttpError(409, "Este código não pode ser reutilizado", "CODE_ALREADY_RECEIVED");
      }
      if (claimed !== 1) throw new HttpError(409, "O código desta tentativa já foi recebido", "CODE_ALREADY_RECEIVED");
      try {
        // Exchange immediately; session logging may arrive later than this callback.
        await client.exchangeCode(input.code);
        const authorized = await prisma.metaConnectionAttempt.updateMany({ where: { id: attempt.id, state: "EXCHANGING", expiresAt: { gt: clock() } }, data: { authorizedAt: clock() } });
        if (authorized.count) {
          await client.ensureSubscription();
          await prisma.metaConnectionAttempt.updateMany({ where: { id: attempt.id, state: "EXCHANGING", expiresAt: { gt: clock() } }, data: { state: "VERIFYING", errorCode: null } });
        }
      } catch (error) {
        await fail(attempt.id, publicError(error));
      }
      return status(actor, attempt.id);
    },
    async finish(actor: ConnectionActor, input: ConnectionAttemptProof & { wabaId: string; phoneNumberId?: string; businessId?: string }) {
      configured();
      const attempt = await owner(actor, input.id, input.nonce, true);
      if (input.wabaId !== config.wabaId || (input.phoneNumberId !== undefined && input.phoneNumberId !== config.phoneNumberId) || (input.businessId !== undefined && input.businessId !== config.businessId)) {
        await fail(attempt.id, "ASSET_MISMATCH");
      } else {
        await prisma.metaConnectionAttempt.updateMany({ where: { id: attempt.id, state: { in: ACTIVE_ATTEMPT_STATES }, expiresAt: { gt: clock() } }, data: { sessionInfoAt: clock() } });
      }
      return status(actor, attempt.id);
    },
    async reconcile(actor: ConnectionActor, input: { id: string }) {
      configured();
      const attempt = await owner(actor, input.id);
      if (dto(attempt, clock()).state !== "VERIFYING" || !attempt.authorizedAt || !attempt.sessionInfoAt) return dto(attempt, clock());
      const startedAt = clock();
      const leaseId = randomUUID();
      const claimed = await prisma.metaConnectionAttempt.updateMany({ where: {
        id: attempt.id, state: "VERIFYING", expiresAt: { gt: startedAt },
        AND: [
          { OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: new Date(startedAt.getTime() - 5_000) } }] },
          { OR: [{ checkLeaseUntil: null }, { checkLeaseUntil: { lte: startedAt } }] },
        ],
      }, data: { checkLeaseId: leaseId, checkLeaseUntil: new Date(startedAt.getTime() + 60_000), lastCheckAt: startedAt } });
      if (claimed.count) {
        try {
          const result = await client.verifyConnection();
          await saveConnectionVerification({ ...result, attemptId: attempt.id, leaseId, phoneNumberId: config.phoneNumberId, wabaId: config.wabaId, startedAt, completedAt: clock() });
          publishRealtime({ type: "meta-health.updated" });
        } catch (error) {
          await prisma.metaConnectionAttempt.updateMany({ where: { id: attempt.id, state: "VERIFYING", checkLeaseId: leaseId }, data: { errorCode: publicError(error), checkLeaseId: null, checkLeaseUntil: null } });
        }
      }
      return status(actor, attempt.id);
    },
    async cancel(actor: ConnectionActor, id: string) {
      await owner(actor, id);
      await prisma.metaConnectionAttempt.updateMany({ where: { id, state: { in: ACTIVE_ATTEMPT_STATES } }, data: { state: "CANCELLED", checkLeaseId: null, checkLeaseUntil: null } });
      return status(actor, id);
    },
  };
}
