import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { MediaStorage, MediaStoragePutInput, StoredMedia } from "./storage";

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

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new InvalidStorageKeyError();
  }
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

  private async root(): Promise<string> {
    const configured = resolve(this.configuredRoot);
    await mkdir(configured, { recursive: true });
    const root = await realpath(configured);
    const stat = await lstat(root);
    if (!stat.isDirectory()) {
      throw new InvalidStorageKeyError();
    }
    return root;
  }

  async put(input: MediaStoragePutInput): Promise<StoredMedia> {
    const now = this.now();
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const uuid = this.createUuid();
    const key = `${year}/${month}/${uuid}`;

    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError();
    }

    const root = await this.root();
    const partition = resolve(root, year, month);
    assertContained(root, partition);
    await mkdir(partition, { recursive: true });

    const partitionStat = await lstat(partition);
    const physicalPartition = await realpath(partition);
    if (!partitionStat.isDirectory() || partitionStat.isSymbolicLink()) {
      throw new InvalidStorageKeyError();
    }
    assertContained(root, physicalPartition);

    const target = resolve(physicalPartition, uuid);
    assertContained(root, target);
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    const handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
      0o600,
    );
    let completed = false;

    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
      const targetStat = await handle.stat();
      if (!targetStat.isFile()) {
        throw new InvalidStorageKeyError();
      }
      const physicalTarget = await realpath(target);
      assertContained(root, physicalTarget);
      completed = true;
    } finally {
      await handle.close();
      if (!completed) {
        await unlink(target).catch(() => undefined);
      }
    }

    return {
      key,
      sizeBytes: BigInt(input.bytes.byteLength),
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
    };
  }

  async open(key: string): Promise<ReadableStream<Uint8Array>> {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError();
    }

    const root = await this.root();
    const candidate = resolve(root, ...key.split("/"));
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
      const streamOptions = { type: "bytes", autoClose: true } as unknown as Parameters<
        typeof handle.readableWebStream
      >[0];
      return handle.readableWebStream(streamOptions) as ReadableStream<Uint8Array>;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }
}
