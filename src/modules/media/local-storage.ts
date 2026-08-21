import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

import type { MediaStorage, MediaStoragePutInput, MediaStorageStreamInput, StoredMedia } from "./storage";
import { closeWithCleanup, writeAll } from "./file-io";

const STORAGE_KEY_PATTERN = /^(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

type LocalMediaStorageOptions = {
  now?: () => Date;
  randomUUID?: () => string;
};

export class InvalidStorageKeyError extends Error {
  constructor() {
    super("Chave de mídia inválida");
    this.name = "InvalidStorageKeyError";
  }
}

export class MediaStorageLimitError extends Error {
  constructor() {
    super("Mídia excede o limite permitido");
    this.name = "MediaStorageLimitError";
  }
}

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new InvalidStorageKeyError();
  }
}

export async function ensurePrivateDirectoryTree(target: string, enforcePrivateTarget = false): Promise<void> {
  const absolute = resolve(target);
  const parsed = parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;

  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const currentStat = await lstat(current);
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) throw new InvalidStorageKeyError();
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      const createdStat = await lstat(current);
      if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) throw new InvalidStorageKeyError();
    }
    const physical = await realpath(current);
    if (physical !== current && process.platform !== "win32") throw new InvalidStorageKeyError();
  }

  if (enforcePrivateTarget) {
    await chmod(absolute, 0o700);
    const mode = (await stat(absolute)).mode & 0o777;
    if (process.platform !== "win32" && (mode & 0o007) !== 0) throw new InvalidStorageKeyError();
  }
}

type ReadableFileHandle = {
  read(buffer: Uint8Array): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
};

export function closingFileHandleStream(handle: ReadableFileHandle): ReadableStream<Uint8Array> {
  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= handle.close();
    return closePromise;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const buffer = new Uint8Array(64 * 1024);
        const { bytesRead } = await handle.read(buffer);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel() {
      await close();
    },
  });
}

export class LocalMediaStorage implements MediaStorage {
  private readonly now: () => Date;
  private readonly createUuid: () => string;

  constructor(
    private readonly configuredRoot: string,
    options: LocalMediaStorageOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createUuid = options.randomUUID ?? randomUUID;
  }

  private async ensureDirectoryTree(target: string, enforcePrivateTarget = false): Promise<void> {
    await ensurePrivateDirectoryTree(target, enforcePrivateTarget);
  }

  private async root(): Promise<string> {
    const configured = resolve(this.configuredRoot);
    await this.ensureDirectoryTree(configured, true);
    const root = await realpath(configured);
    const stat = await lstat(root);
    if (!stat.isDirectory()) {
      throw new InvalidStorageKeyError();
    }
    return root;
  }

  private async containedSegments(root: string, segments: readonly string[], create = false): Promise<string> {
    let current = root;
    for (const segment of segments) {
      const candidate = resolve(current, segment);
      assertContained(root, candidate);
      try {
        const candidateStat = await lstat(candidate);
        if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new InvalidStorageKeyError();
      } catch (error) {
        if (!create || !(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        await mkdir(candidate, { mode: 0o700 });
        await chmod(candidate, 0o700);
        const createdStat = await lstat(candidate);
        if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) throw new InvalidStorageKeyError();
      }
      const physical = await realpath(candidate);
      assertContained(root, physical);
      current = physical;
    }
    return current;
  }

  async put(input: MediaStoragePutInput): Promise<StoredMedia> {
    return this.putStream({
      filename: input.filename,
      mimeType: input.mimeType,
      maximumBytes: input.bytes.byteLength,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(input.bytes);
          controller.close();
        },
      }),
    });
  }

  async putStream(input: MediaStorageStreamInput): Promise<StoredMedia> {
    const now = this.now();
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const uuid = this.createUuid();
    const key = `${year}/${month}/${uuid}`;

    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError();
    }

    const root = await this.root();
    const physicalPartition = await this.containedSegments(root, [year, month], true);

    const target = resolve(physicalPartition, uuid);
    assertContained(root, target);
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    const handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
      0o600,
    );
    let completed = false;
    const reader = input.stream.getReader();
    const digest = createHash("sha256");
    let sizeBytes = 0;

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (sizeBytes + result.value.byteLength > input.maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw new MediaStorageLimitError();
        }
        await writeAll(handle, result.value);
        sizeBytes += result.value.byteLength;
        digest.update(result.value);
      }
      await handle.sync();
      const targetStat = await handle.stat();
      if (!targetStat.isFile() || targetStat.size !== sizeBytes) {
        throw new InvalidStorageKeyError();
      }
      const physicalTarget = await realpath(target);
      assertContained(root, physicalTarget);
      completed = true;
    } finally {
      try {
        if (!completed) await reader.cancel().catch(() => undefined);
      } finally {
        try {
          reader.releaseLock();
        } finally {
          await closeWithCleanup(handle, async () => {
            if (!completed) await unlink(target).catch(() => undefined);
          });
        }
      }
    }

    return {
      key,
      sizeBytes: BigInt(sizeBytes),
      sha256: digest.digest("hex"),
    };
  }

  async open(key: string): Promise<ReadableStream<Uint8Array>> {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError();
    }

    const root = await this.root();
    const keySegments = key.split("/");
    const partition = await this.containedSegments(root, keySegments.slice(0, -1));
    const candidate = resolve(partition, keySegments.at(-1)!);
    assertContained(root, candidate);
    const pathStat = await lstat(candidate);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new InvalidStorageKeyError();
    }
    const physical = await realpath(candidate);
    assertContained(root, physical);
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    const handle = await open(physical, constants.O_RDONLY | noFollow);
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) throw new InvalidStorageKeyError();
      return closingFileHandleStream(handle);
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new InvalidStorageKeyError();
    const root = await this.root();
    const keySegments = key.split("/");
    const partition = await this.containedSegments(root, keySegments.slice(0, -1));
    const candidate = resolve(partition, keySegments.at(-1)!);
    assertContained(root, candidate);
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw new InvalidStorageKeyError();
    await unlink(candidate);
  }
}
