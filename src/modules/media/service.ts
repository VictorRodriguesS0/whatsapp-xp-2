import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { Prisma } from "@/generated/prisma/client";
import { MediaStatus, type MediaStatus as MediaStatusValue } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import {
  MAX_MEDIA_DOWNLOAD_ATTEMPTS,
  type MediaStateDto,
  toMediaStateDto,
} from "@/modules/conversations/types";
import { messageUuidSchema } from "@/modules/messages/schemas";
import { safeOriginalFilename } from "@/modules/messages/status";
import type { RealtimeEvent } from "@/modules/realtime/events";
import { publishRealtime } from "@/modules/realtime/hub";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";
import { LocalMediaStorage } from "./local-storage";
import {
  parseSingleByteRange,
  type ByteRange,
  UnsatisfiableByteRangeError,
} from "./byte-range";
import { MediaTaskLimiter } from "./task-limiter";
import type { MediaStorage } from "./storage";
import { stageMediaStream, type StagedMediaFile } from "./temp-file";
import { MediaValidationError, mediaRuleForMime, validateMediaFile } from "./validation";

const DOWNLOAD_LEASE_MS = 2 * 60_000;
const MAXIMUM_BACKOFF_MS = 30_000;
export { MAX_MEDIA_DOWNLOAD_ATTEMPTS };

export class MediaRangeNotSatisfiableError extends HttpError {
  constructor(readonly sizeBytes: bigint) {
    super(416, "Intervalo de mídia inválido");
    this.name = "MediaRangeNotSatisfiableError";
  }
}

export type MediaDownload = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  sizeBytes: bigint;
  filename: string;
  kind: "image" | "audio" | "video" | "document";
  range?: ByteRange;
};

export type MediaObjectRecord = {
  id: string;
  storageKey: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string | null;
  metaMediaId: string | null;
  status: MediaStatusValue;
  failureReason: string | null;
  terminalTransitionId: string | null;
  linkedToMessage: boolean;
  downloadLeaseId: string | null;
  downloadLeaseUntil: Date | null;
  downloadNextAttemptAt: Date | null;
  downloadAttempts: number;
};

export interface MediaServiceRepository {
  findById(id: string): Promise<MediaObjectRecord | null>;
  findVisibleById(id: string, actorId: string): Promise<MediaObjectRecord | null>;
  findRealtimeTarget(id: string): Promise<{ messageId: string; conversationId: string } | null>;
  resetFailed(id: string): Promise<boolean>;
  claimPending(id: string, input: { leaseId: string; now: Date; leaseUntil: Date }): Promise<MediaObjectRecord | null>;
  finalizeExhausted(id: string, now: Date, reason: string, transitionId: string): Promise<boolean>;
  renewLease(id: string, leaseId: string, leaseUntil: Date): Promise<boolean>;
  markAvailable(id: string, leaseId: string, input: { storageKey: string; sizeBytes: bigint; sha256: string; mimeType: string }): Promise<boolean>;
  markPermanentFailure(id: string, leaseId: string, reason: string, transitionId: string): Promise<boolean>;
  releaseTransientFailure(id: string, leaseId: string, input: { reason: string; nextAttemptAt: Date }): Promise<void>;
}

export type MediaServiceDependencies = {
  repository: MediaServiceRepository;
  storage: MediaStorage;
  provider: WhatsAppProvider;
  mediaRoot: string;
  inFlight: Map<string, Promise<void>>;
  now?: () => Date;
  createUuid?: () => string;
  taskLimiter?: MediaTaskLimiter;
  leaseMs?: number;
  leaseRenewIntervalMs?: number;
  publishRealtime?: (event: Extract<RealtimeEvent, { type: "media.updated" }>) => void;
};

const mediaSelect = {
  id: true, storageKey: true, originalFilename: true, mimeType: true, sizeBytes: true, sha256: true,
  metaMediaId: true, status: true, failureReason: true, terminalTransitionId: true,
  downloadLeaseId: true, downloadLeaseUntil: true,
  downloadNextAttemptAt: true, downloadAttempts: true, message: { select: { id: true } },
} as const;
type PrismaMediaRow = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }>;

function mapMedia(row: PrismaMediaRow): MediaObjectRecord {
  const { message, ...media } = row;
  return { ...media, linkedToMessage: Boolean(message) };
}

export const prismaMediaRepository: MediaServiceRepository = {
  async findById(id) {
    const row = await prisma.mediaObject.findUnique({ where: { id }, select: mediaSelect });
    return row ? mapMedia(row) : null;
  },
  async findVisibleById(id, _actorId) {
    const actor = await prisma.user.findFirst({
      where: { id: _actorId, active: true },
      select: { id: true },
    });
    if (!actor) return null;
    const row = await prisma.mediaObject.findFirst({ where: { id, message: { isNot: null } }, select: mediaSelect });
    return row ? mapMedia(row) : null;
  },
  async findRealtimeTarget(id) {
    return prisma.message.findUnique({
      where: { mediaObjectId: id },
      select: { id: true, conversationId: true },
    }).then((message) => message
      ? { messageId: message.id, conversationId: message.conversationId }
      : null);
  },
  async resetFailed(id) {
    const reset = await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.FAILED, message: { isNot: null } },
      data: {
        status: MediaStatus.PENDING,
        failureReason: null,
        terminalTransitionId: null,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
        downloadNextAttemptAt: null,
        downloadAttempts: 0,
      },
    });
    return reset.count === 1;
  },
  async claimPending(id, input) {
    const claimed = await prisma.mediaObject.updateMany({
      where: {
        id,
        status: MediaStatus.PENDING,
        downloadAttempts: { lt: MAX_MEDIA_DOWNLOAD_ATTEMPTS },
        AND: [
          { OR: [{ downloadLeaseUntil: null }, { downloadLeaseUntil: { lte: input.now } }] },
          { OR: [{ downloadNextAttemptAt: null }, { downloadNextAttemptAt: { lte: input.now } }] },
        ],
      },
      data: {
        terminalTransitionId: null,
        downloadLeaseId: input.leaseId,
        downloadLeaseUntil: input.leaseUntil,
        downloadAttempts: { increment: 1 },
      },
    });
    return claimed.count === 1 ? this.findById(id) : null;
  },
  async finalizeExhausted(id, now, reason, transitionId) {
    const finalized = await prisma.mediaObject.updateMany({
      where: {
        id,
        status: MediaStatus.PENDING,
        downloadAttempts: { gte: MAX_MEDIA_DOWNLOAD_ATTEMPTS },
        OR: [{ downloadLeaseUntil: null }, { downloadLeaseUntil: { lte: now } }],
      },
      data: {
        status: MediaStatus.FAILED,
        failureReason: reason,
        terminalTransitionId: transitionId,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
        downloadNextAttemptAt: null,
      },
    });
    return finalized.count === 1;
  },
  async renewLease(id, leaseId, leaseUntil) {
    const renewed = await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING, downloadLeaseId: leaseId },
      data: { downloadLeaseUntil: leaseUntil },
    });
    return renewed.count === 1;
  },
  async markAvailable(id, leaseId, input) {
    const result = await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING, downloadLeaseId: leaseId },
      data: {
        storageKey: input.storageKey, sizeBytes: input.sizeBytes, sha256: input.sha256, mimeType: input.mimeType,
        status: MediaStatus.AVAILABLE, failureReason: null, terminalTransitionId: null,
        downloadLeaseId: null, downloadLeaseUntil: null,
        downloadNextAttemptAt: null,
      },
    });
    return result.count === 1;
  },
  async markPermanentFailure(id, leaseId, reason, transitionId) {
    const failed = await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING, downloadLeaseId: leaseId },
      data: {
        status: MediaStatus.FAILED,
        failureReason: reason,
        terminalTransitionId: transitionId,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
        downloadNextAttemptAt: null,
      },
    });
    return failed.count === 1;
  },
  async releaseTransientFailure(id, leaseId, input) {
    await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING, downloadLeaseId: leaseId },
      data: {
        failureReason: input.reason,
        terminalTransitionId: null,
        downloadLeaseId: null,
        downloadLeaseUntil: null,
        downloadNextAttemptAt: input.nextAttemptAt,
      },
    });
  },
};

const mediaRoot = getServerEnv().MEDIA_ROOT;
const defaultTaskLimiter = new MediaTaskLimiter(4, 2);
const defaultDependencies: MediaServiceDependencies = {
  repository: prismaMediaRepository,
  storage: new LocalMediaStorage(mediaRoot),
  provider: getWhatsAppProvider(),
  mediaRoot,
  inFlight: new Map(),
  taskLimiter: defaultTaskLimiter,
  publishRealtime,
};

function parsePublicUuid(value: string, notFoundMessage: string): string {
  const result = messageUuidSchema.safeParse(value);
  if (!result.success) throw new HttpError(404, notFoundMessage);
  return result.data;
}

function hashesMatch(expected: string | null, actualHex: string): boolean {
  if (!expected) return true;
  const actualBase64 = Buffer.from(actualHex, "hex").toString("base64");
  return expected === actualHex || expected === actualBase64;
}

function transientBackoffMs(attempt: number): number {
  return Math.min(MAXIMUM_BACKOFF_MS, 1000 * 2 ** Math.max(0, Math.min(attempt - 1, 5)));
}

async function publishTerminalUpdate(
  id: string,
  dependencies: MediaServiceDependencies,
): Promise<void> {
  try {
    const target = await dependencies.repository.findRealtimeTarget(id);
    if (!target || !dependencies.publishRealtime) return;
    dependencies.publishRealtime({ type: "media.updated", ...target, mediaId: id });
  } catch {
    // The committed database state remains authoritative.
  }
}

async function commitTerminalFailure(
  id: string,
  reason: string,
  transitionId: string,
  dependencies: MediaServiceDependencies,
  commit: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await commit();
  } catch (error) {
    let current: MediaObjectRecord | null;
    try {
      current = await dependencies.repository.findById(id);
    } catch {
      throw error;
    }
    if (
      current?.status !== MediaStatus.FAILED ||
      current.failureReason !== reason ||
      current.terminalTransitionId !== transitionId
    ) throw error;
    return true;
  }
}

async function commitTerminalFailureAndPublish(
  id: string,
  reason: string,
  transitionId: string,
  dependencies: MediaServiceDependencies,
  commit: () => Promise<boolean>,
): Promise<void> {
  if (await commitTerminalFailure(id, reason, transitionId, dependencies, commit)) {
    await publishTerminalUpdate(id, dependencies);
  }
}

async function persistPendingMedia(id: string, dependencies: MediaServiceDependencies): Promise<void> {
  const initial = await dependencies.repository.findById(id);
  if (!initial) throw new HttpError(404, "Mídia não encontrada");
  if (initial.status === MediaStatus.AVAILABLE) return;
  if (initial.status !== MediaStatus.PENDING || !initial.metaMediaId) throw new HttpError(424, "Mídia indisponível");

  const clock = dependencies.now ?? (() => new Date());
  const now = clock();
  if (initial.downloadAttempts >= MAX_MEDIA_DOWNLOAD_ATTEMPTS) {
    const reason = "Falha ao obter mídia; intervenção necessária";
    const transitionId = (dependencies.createUuid ?? randomUUID)();
    await commitTerminalFailureAndPublish(
      id,
      reason,
      transitionId,
      dependencies,
      () => dependencies.repository.finalizeExhausted(id, now, reason, transitionId),
    );
    return;
  }
  const leaseId = (dependencies.createUuid ?? randomUUID)();
  const leaseMs = dependencies.leaseMs ?? DOWNLOAD_LEASE_MS;
  const renewEveryMs = dependencies.leaseRenewIntervalMs ?? Math.max(1_000, Math.floor(leaseMs / 3));
  const media = await dependencies.repository.claimPending(id, { leaseId, now, leaseUntil: new Date(now.getTime() + leaseMs) });
  if (!media) return;

  let staged: StagedMediaFile | undefined;
  let storedKey: string | undefined;
  let storedFileMayBeCommitted = false;
  let downloadedStream: ReadableStream<Uint8Array> | undefined;
  let downloadedStreamConsumed = false;
  let renewal = Promise.resolve();
  let leaseLost = false;
  const renewalTimer = setInterval(() => {
    renewal = renewal.then(async () => {
      if (!await dependencies.repository.renewLease(id, leaseId, new Date(clock().getTime() + leaseMs))) leaseLost = true;
    }).catch(() => { leaseLost = true; });
  }, renewEveryMs);
  renewalTimer.unref?.();
  try {
    const rule = mediaRuleForMime(media.mimeType);
    const metadata = await dependencies.provider.getMediaMetadata(media.metaMediaId!);
    if (metadata.id !== media.metaMediaId || mediaRuleForMime(metadata.mimeType).mimeType !== rule.mimeType || metadata.sizeBytes <= 0n || metadata.sizeBytes > BigInt(rule.maximumBytes)) {
      throw new MediaValidationError("Metadados remotos incompatíveis");
    }
    const downloaded = await dependencies.provider.downloadMedia({ url: metadata.url, maximumBytes: rule.maximumBytes });
    downloadedStream = downloaded.stream;
    if (mediaRuleForMime(downloaded.mimeType).mimeType !== rule.mimeType || (downloaded.sizeBytes !== null && downloaded.sizeBytes !== metadata.sizeBytes)) {
      throw new MediaValidationError("Download remoto incompatível");
    }
    staged = await stageMediaStream({
      root: dependencies.mediaRoot,
      filename: safeOriginalFilename(media.originalFilename),
      mimeType: rule.mimeType,
      maximumBytes: rule.maximumBytes,
      stream: downloaded.stream,
    });
    downloadedStreamConsumed = true;
    if (staged.sizeBytes !== metadata.sizeBytes || !hashesMatch(media.sha256, staged.sha256) || !hashesMatch(metadata.sha256, staged.sha256)) {
      throw new MediaValidationError("Conteúdo remoto incompatível");
    }
    await validateMediaFile({ path: staged.path, mimeType: rule.mimeType });
    const stored = await dependencies.storage.putStream({
      filename: staged.filename,
      mimeType: staged.mimeType,
      maximumBytes: rule.maximumBytes,
      stream: Readable.toWeb(createReadStream(staged.path)) as ReadableStream<Uint8Array>,
    });
    storedKey = stored.key;
    if (stored.sizeBytes !== staged.sizeBytes || stored.sha256 !== staged.sha256) throw new Error("Stored media mismatch");
    await renewal;
    if (leaseLost) throw new Error("Media download lease lost");
    const availableInput = {
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      mimeType: rule.mimeType,
    };
    try {
      const committed = await dependencies.repository.markAvailable(id, leaseId, availableInput);
      if (!committed) {
        await dependencies.storage.remove(stored.key).catch(() => undefined);
      } else {
        storedKey = undefined;
        await publishTerminalUpdate(id, dependencies);
      }
    } catch (error) {
      storedFileMayBeCommitted = true;
      let reconciliationFailed = false;
      let reconciled: MediaObjectRecord | null = null;
      try {
        reconciled = await dependencies.repository.findById(id);
      } catch {
        reconciliationFailed = true;
      }
      if (
        reconciled?.status === MediaStatus.AVAILABLE &&
        reconciled.storageKey === availableInput.storageKey &&
        reconciled.sizeBytes === availableInput.sizeBytes &&
        reconciled.sha256 === availableInput.sha256 &&
        reconciled.mimeType === availableInput.mimeType
      ) {
        storedKey = undefined;
        await publishTerminalUpdate(id, dependencies);
        return;
      }
      if (!reconciliationFailed) {
        storedFileMayBeCommitted = false;
      }
      throw error;
    }
  } catch (error) {
    if (downloadedStream && !downloadedStreamConsumed) {
      void downloadedStream.cancel().catch(() => undefined);
    }
    if (storedKey && !storedFileMayBeCommitted) {
      await dependencies.storage.remove(storedKey).catch(() => undefined);
    }
    if (error instanceof MediaValidationError || (error instanceof WhatsAppProviderError && error.kind === "rejected")) {
      const reason = "Mídia remota inválida";
      await commitTerminalFailureAndPublish(
        id,
        reason,
        leaseId,
        dependencies,
        () => dependencies.repository.markPermanentFailure(id, leaseId, reason, leaseId),
      );
    } else if (media.downloadAttempts >= MAX_MEDIA_DOWNLOAD_ATTEMPTS) {
      const reason = "Falha ao obter mídia; intervenção necessária";
      await commitTerminalFailureAndPublish(
        id,
        reason,
        leaseId,
        dependencies,
        () => dependencies.repository.markPermanentFailure(id, leaseId, reason, leaseId),
      );
    } else {
      const attempt = media.downloadAttempts;
      await dependencies.repository.releaseTransientFailure(id, leaseId, {
        reason: "Falha transitória ao obter mídia",
        nextAttemptAt: new Date(clock().getTime() + transientBackoffMs(attempt)),
      });
    }
    throw error;
  } finally {
    clearInterval(renewalTimer);
    await renewal;
    await staged?.cleanup().catch(() => undefined);
  }
}

export function ensureMediaAvailable(mediaId: string, dependencies: MediaServiceDependencies = defaultDependencies, limiterKey = "background"): Promise<void> {
  const id = parsePublicUuid(mediaId, "Mídia não encontrada");
  const existing = dependencies.inFlight.get(id);
  if (existing) return existing;
  let task: Promise<void>;
  const limiter = dependencies.taskLimiter ?? defaultTaskLimiter;
  task = limiter.run(() => persistPendingMedia(id, dependencies), limiterKey).finally(() => {
    if (dependencies.inFlight.get(id) === task) dependencies.inFlight.delete(id);
  });
  dependencies.inFlight.set(id, task);
  return task;
}

export async function recoverMedia(
  actorUserId: string,
  mediaId: string,
  manual: boolean,
  dependencies: MediaServiceDependencies = defaultDependencies,
): Promise<MediaStateDto> {
  const actorId = parsePublicUuid(actorUserId, "Usuário não encontrado");
  const id = parsePublicUuid(mediaId, "Mídia não encontrada");
  let media = await dependencies.repository.findVisibleById(id, actorId);
  if (!media) throw new HttpError(404, "Mídia não encontrada");

  if (media.status === MediaStatus.FAILED) {
    if (!manual) return toMediaStateDto(media, (dependencies.now ?? (() => new Date()))());
    await dependencies.repository.resetFailed(id);
    media = await dependencies.repository.findVisibleById(id, actorId);
    if (!media) throw new HttpError(404, "Mídia não encontrada");
  }

  if (media.status === MediaStatus.PENDING) {
    try {
      await ensureMediaAvailable(id, dependencies, actorId);
    } catch (error) {
      const current = await dependencies.repository.findVisibleById(id, actorId);
      if (!current || current.downloadLeaseId !== null) throw error;
    }
  }

  const current = await dependencies.repository.findVisibleById(id, actorId);
  if (!current) throw new HttpError(404, "Mídia não encontrada");
  return toMediaStateDto(current, (dependencies.now ?? (() => new Date()))());
}

export async function getMediaForDownload(
  actorId: string,
  mediaId: string,
  dependencies: MediaServiceDependencies = defaultDependencies,
  options: { rangeHeader?: string | null } = {},
): Promise<MediaDownload> {
  const parsedActorId = parsePublicUuid(actorId, "Usuário não encontrado");
  const id = parsePublicUuid(mediaId, "Mídia não encontrada");
  let media = await dependencies.repository.findVisibleById(id, parsedActorId);
  if (!media) throw new HttpError(404, "Mídia não encontrada");
  if (media.status === MediaStatus.PENDING) {
    await ensureMediaAvailable(id, dependencies, parsedActorId).catch(() => undefined);
    media = await dependencies.repository.findVisibleById(id, parsedActorId);
  }
  if (!media || media.status !== MediaStatus.AVAILABLE || !media.storageKey) throw new HttpError(424, "Mídia indisponível");
  const rule = mediaRuleForMime(media.mimeType);
  let range;
  try {
    range = parseSingleByteRange(options.rangeHeader ?? null, media.sizeBytes);
  } catch (error) {
    if (error instanceof UnsatisfiableByteRangeError) {
      throw new MediaRangeNotSatisfiableError(media.sizeBytes);
    }
    throw error;
  }
  return {
    stream: await dependencies.storage.open(media.storageKey, range ?? undefined), mimeType: rule.mimeType, sizeBytes: media.sizeBytes,
    filename: safeOriginalFilename(media.originalFilename), kind: rule.kind,
    range: range ?? undefined,
  };
}
