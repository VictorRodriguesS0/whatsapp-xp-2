// @vitest-environment node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaStatus, MessageStatus, MessageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { validateMediaFile } from "@/modules/media/validation";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import { createConversationRecordingsRouteHandler } from "./route";

const execFileAsync = promisify(execFile);
const mediaRoot = process.env.MEDIA_ROOT ?? join(tmpdir(), "xp-audio-route-integration-media");
const sourceRoots: string[] = [];

async function directoryIsEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

describe.skipIf(
  process.env.RUN_FFMPEG_INTEGRATION !== "1" || !process.env.TEST_DATABASE_URL,
)("recording route Linux integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await rm(mediaRoot, { recursive: true, force: true });
    await mkdir(mediaRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(mediaRoot, { recursive: true, force: true });
    await Promise.all(sourceRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("converts, stores, and delivers one voice message without retaining raw temporaries", async () => {
    const { conversation, victor } = await seedReadFixture();
    const sourceRoot = await mkdtemp(join(tmpdir(), "xp-audio-route-source-"));
    sourceRoots.push(sourceRoot);
    const sourcePath = join(sourceRoot, "capture.webm");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2",
      "-c:a", "libopus", "-y", sourcePath,
    ]);

    const form = new FormData();
    form.append("clientRequestId", randomUUID());
    form.append("file", new File([await readFile(sourcePath)], "capture.webm", { type: "audio/webm; codecs=opus" }));

    const actor = { id: victor.id, name: victor.name, email: victor.email, role: victor.role };
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      mediaRoot,
    });
    const response = await handler(
      new Request("http://localhost/api/recordings", { method: "POST", body: form }),
      { params: Promise.resolve({ id: conversation.id }) },
    );

    expect(response.status).toBe(201);
    await expect(prisma.message.count()).resolves.toBe(1);
    await expect(prisma.mediaObject.count()).resolves.toBe(1);
    await expect(prisma.message.findFirstOrThrow({
      select: { type: true, status: true, whatsappMessageId: true, mediaObjectId: true },
    })).resolves.toMatchObject({
      type: MessageType.AUDIO,
      status: MessageStatus.SENT,
      whatsappMessageId: expect.stringMatching(/^demo-/),
      mediaObjectId: expect.any(String),
    });
    await expect(prisma.mediaObject.findFirstOrThrow({
      select: { mimeType: true, status: true, sizeBytes: true, storageKey: true },
    })).resolves.toMatchObject({
      mimeType: "audio/ogg",
      status: MediaStatus.AVAILABLE,
      sizeBytes: expect.any(BigInt),
      storageKey: expect.any(String),
    });

    const media = await prisma.mediaObject.findFirstOrThrow({ select: { sizeBytes: true, storageKey: true } });
    expect(media.sizeBytes).toBeGreaterThan(0n);
    expect(media.sizeBytes).toBeLessThan(16n * 1024n * 1024n);
    await expect(validateMediaFile({ path: join(mediaRoot, media.storageKey!), mimeType: "audio/ogg" }))
      .resolves.toMatchObject({ mimeType: "audio/ogg", kind: "audio" });
    expect(await directoryIsEmpty(join(mediaRoot, ".recordings"))).toBe(true);
    expect(await directoryIsEmpty(join(mediaRoot, ".staging"))).toBe(true);
    expect((await readdir(mediaRoot, { recursive: true })).some((name) => name.endsWith(".webm"))).toBe(false);
  });
});
