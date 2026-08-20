import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { MediaStatus, type MediaStatus as MediaStatusValue } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { LocalMediaStorage } from "./local-storage";
import type { MediaStorage } from "./storage";
import { mediaRuleForMime, validateMedia } from "./validation";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";
import { messageUuidSchema } from "@/modules/messages/schemas";
import { safeOriginalFilename } from "@/modules/messages/status";

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
  linkedToMessage: boolean;
};

export interface MediaServiceRepository {
  findById(id: string): Promise<MediaObjectRecord | null>;
  findVisibleById(id: string, actorId: string): Promise<MediaObjectRecord | null>;
  markAvailable(
    id: string,
    input: { storageKey: string; sizeBytes: bigint; sha256: string; mimeType: string },
  ): Promise<boolean>;
  markFailed(id: string, reason: string): Promise<void>;
}

export type MediaServiceDependencies = {
  repository: MediaServiceRepository;
  storage: MediaStorage;
  provider: WhatsAppProvider;
  inFlight: Map<string, Promise<void>>;
};

const mediaSelect = {
  id: true,
  storageKey: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  metaMediaId: true,
  status: true,
  failureReason: true,
  message: { select: { id: true } },
} as const;

type PrismaMediaRow = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }>;

function mapMedia(row: PrismaMediaRow): MediaObjectRecord {
  return {
    id: row!.id,
    storageKey: row!.storageKey,
    originalFilename: row!.originalFilename,
    mimeType: row!.mimeType,
    sizeBytes: row!.sizeBytes,
    sha256: row!.sha256,
    metaMediaId: row!.metaMediaId,
    status: row!.status,
    failureReason: row!.failureReason,
    linkedToMessage: Boolean(row!.message),
  };
}

const prismaMediaRepository: MediaServiceRepository = {
  async findById(id) {
    const row = await prisma.mediaObject.findUnique({ where: { id }, select: mediaSelect });
    return row ? mapMedia(row) : null;
  },
  async findVisibleById(id, _actorId) {
    const row = await prisma.mediaObject.findFirst({
      where: { id, message: { isNot: null } },
      select: mediaSelect,
    });
    return row ? mapMedia(row) : null;
  },
  async markAvailable(id, input) {
    const result = await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING },
      data: {
        storageKey: input.storageKey,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        mimeType: input.mimeType,
        status: MediaStatus.AVAILABLE,
        failureReason: null,
      },
    });
    return result.count === 1;
  },
  async markFailed(id, reason) {
    await prisma.mediaObject.updateMany({
      where: { id, status: MediaStatus.PENDING },
      data: { status: MediaStatus.FAILED, failureReason: reason },
    });
  },
};

const defaultInFlight = new Map<string, Promise<void>>();
const defaultDependencies: MediaServiceDependencies = {
  repository: prismaMediaRepository,
  storage: new LocalMediaStorage(getServerEnv().MEDIA_ROOT),
  provider: getWhatsAppProvider(),
  inFlight: defaultInFlight,
};

function hashMatches(expected: string | null, bytes: Uint8Array): boolean {
  if (!expected) return true;
  const digest = createHash("sha256").update(bytes);
  const hex = digest.copy().digest("hex");
  const base64 = digest.digest("base64");
  return expected === hex || expected === base64;
}

async function persistPendingMedia(
  id: string,
  dependencies: MediaServiceDependencies,
): Promise<void> {
  const media = await dependencies.repository.findById(id);
  if (!media) throw new HttpError(404, "Mídia não encontrada");
  if (media.status === MediaStatus.AVAILABLE) return;
  if (media.status !== MediaStatus.PENDING || !media.metaMediaId) {
    throw new HttpError(424, "Mídia indisponível");
  }

  try {
    const rule = mediaRuleForMime(media.mimeType);
    const metadata = await dependencies.provider.getMediaMetadata(media.metaMediaId);
    if (
      metadata.id !== media.metaMediaId ||
      metadata.mimeType !== rule.mimeType ||
      metadata.sizeBytes <= 0n ||
      metadata.sizeBytes > BigInt(rule.maximumBytes)
    ) {
      throw new Error("Invalid Meta media metadata");
    }
    const downloaded = await dependencies.provider.downloadMedia({
      url: metadata.url,
      maximumBytes: rule.maximumBytes,
    });
    if (
      downloaded.mimeType !== rule.mimeType ||
      BigInt(downloaded.bytes.byteLength) !== metadata.sizeBytes ||
      !hashMatches(media.sha256, downloaded.bytes) ||
      !hashMatches(metadata.sha256, downloaded.bytes)
    ) {
      throw new Error("Downloaded media mismatch");
    }
    validateMedia({
      bytes: downloaded.bytes,
      mimeType: rule.mimeType,
      filename: media.originalFilename || undefined,
    });
    const stored = await dependencies.storage.put({
      bytes: downloaded.bytes,
      mimeType: rule.mimeType,
      filename: safeOriginalFilename(media.originalFilename),
    });
    await dependencies.repository.markAvailable(id, {
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      mimeType: rule.mimeType,
    });
  } catch (error) {
    await dependencies.repository.markFailed(id, "Falha ao obter mídia");
    throw error;
  }
}

export function ensureMediaAvailable(
  mediaId: string,
  dependencies: MediaServiceDependencies = defaultDependencies,
): Promise<void> {
  const id = messageUuidSchema.parse(mediaId);
  const existing = dependencies.inFlight.get(id);
  if (existing) return existing;

  let task: Promise<void>;
  task = persistPendingMedia(id, dependencies).finally(() => {
    if (dependencies.inFlight.get(id) === task) dependencies.inFlight.delete(id);
  });
  dependencies.inFlight.set(id, task);
  return task;
}

export async function getMediaForDownload(
  actorId: string,
  mediaId: string,
  dependencies: MediaServiceDependencies = defaultDependencies,
) {
  const parsedActorId = messageUuidSchema.parse(actorId);
  const id = messageUuidSchema.parse(mediaId);
  let media = await dependencies.repository.findVisibleById(id, parsedActorId);
  if (!media) throw new HttpError(404, "Mídia não encontrada");
  if (media.status === MediaStatus.PENDING) {
    await ensureMediaAvailable(id, dependencies);
    media = await dependencies.repository.findVisibleById(id, parsedActorId);
  }
  if (!media || media.status !== MediaStatus.AVAILABLE || !media.storageKey) {
    throw new HttpError(424, "Mídia indisponível");
  }
  const rule = mediaRuleForMime(media.mimeType);
  return {
    stream: await dependencies.storage.open(media.storageKey),
    mimeType: rule.mimeType,
    sizeBytes: media.sizeBytes,
    filename: safeOriginalFilename(media.originalFilename),
    kind: rule.kind,
  };
}
