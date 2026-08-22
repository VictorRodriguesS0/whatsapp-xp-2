import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, unlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { ensurePrivateDirectoryTree, MediaStorageLimitError } from "./local-storage";
import { closeWithCleanup, writeAll } from "./file-io";

export type StagedMediaFile = {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  cleanup(): Promise<void>;
};

export async function stageMediaStream(input: {
  root: string;
  filename: string;
  mimeType: string;
  maximumBytes: number;
  stream: ReadableStream<Uint8Array>;
}): Promise<StagedMediaFile> {
  const root = resolve(input.root);
  await ensurePrivateDirectoryTree(root, true);
  const stagingRoot = resolve(root, ".staging");
  await ensurePrivateDirectoryTree(stagingRoot, true);
  const physicalRoot = await realpath(root);
  const physicalStaging = await realpath(stagingRoot);
  const stagingRelative = relative(physicalRoot, physicalStaging);
  if (!stagingRelative || stagingRelative.startsWith("..")) throw new Error("Diretório temporário inválido");

  const path = resolve(physicalStaging, `${randomUUID()}.part`);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600);
  const digest = createHash("sha256");
  let total = 0;
  let completed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    try {
      reader = input.stream.getReader();
    } catch (error) {
      try {
        void input.stream.cancel().catch(() => undefined);
      } catch {
        // Closing the local handle must not depend on source cancellation.
      }
      throw error;
    }
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (total + result.value.byteLength > input.maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw new MediaStorageLimitError();
      }
      await writeAll(handle, result.value);
      total += result.value.byteLength;
      digest.update(result.value);
    }
    await handle.sync();
    const stagedStat = await handle.stat();
    if (!stagedStat.isFile() || stagedStat.size !== total) throw new Error("Tamanho temporário incompatível");
    completed = true;
  } finally {
    try {
      reader?.releaseLock();
    } finally {
      await closeWithCleanup(handle, async () => {
        if (!completed) await unlink(path).catch(() => undefined);
      });
    }
  }

  let cleaned = false;
  return {
    path,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: BigInt(total),
    sha256: digest.digest("hex"),
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await unlink(path).catch((error: unknown) => {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      });
    },
  };
}
