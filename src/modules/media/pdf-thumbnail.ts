import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { getServerEnv } from "../../lib/env";
import { HttpError } from "../../lib/http";
import { runBoundedProcess, type RunBoundedProcess } from "../recordings/converter";
import { closingFileHandleStream, ensurePrivateDirectoryTree } from "./local-storage";
import { getMediaForDownload } from "./service";
import { stageMediaStream, type StagedMediaFile } from "./temp-file";
import { MediaTaskLimiter } from "./task-limiter";
import { DOCUMENT_MAX_BYTES } from "./validation";

export const PDF_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_THUMBNAIL_TIMEOUT_MS = 10_000;

const PROCESS_DIAGNOSTIC_LIMIT_BYTES = 8 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PdfThumbnail = {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: bigint;
};

export type PdfThumbnailDependencies = {
  getMediaForDownload: typeof getMediaForDownload;
  runProcess: RunBoundedProcess;
  mediaRoot: string;
  limiter: MediaTaskLimiter;
  inFlight: Map<string, Promise<string>>;
  createUuid: () => string;
};

type WorkReservation = {
  directory: string;
  outputPath: string;
  dev: number;
  ino: number;
};

const defaultDependencies: PdfThumbnailDependencies = {
  getMediaForDownload,
  runProcess: runBoundedProcess,
  mediaRoot: getServerEnv().MEDIA_ROOT,
  limiter: new MediaTaskLimiter(1, 1),
  inFlight: new Map(),
  createUuid: randomUUID,
};

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return Boolean(fromRoot)
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(fromRoot);
}

async function cancelStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await stream.cancel();
  } catch {
    // The authorized source is unused on cache hits and shared generations.
  }
}

async function ensurePrivateDirectoryTreeRaceSafe(target: string): Promise<void> {
  try {
    await ensurePrivateDirectoryTree(target, true);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    // A concurrent request may create the same tree. Re-run the complete
    // validation instead of trusting the object that won the race.
    await ensurePrivateDirectoryTree(target, true);
  }
}

async function prepareRoots(configuredRoot: string): Promise<{
  mediaRoot: string;
  cacheRoot: string;
  workRoot: string;
}> {
  const lexicalMediaRoot = resolve(configuredRoot);
  await ensurePrivateDirectoryTreeRaceSafe(lexicalMediaRoot);
  const mediaRoot = await realpath(lexicalMediaRoot);
  const mediaStat = await lstat(mediaRoot);
  if (!mediaStat.isDirectory() || mediaStat.isSymbolicLink()) throw new Error("invalid media root");

  const lexicalCacheRoot = resolve(mediaRoot, ".pdf-thumbnails");
  if (!contained(mediaRoot, lexicalCacheRoot)) throw new Error("invalid cache root");
  await ensurePrivateDirectoryTreeRaceSafe(lexicalCacheRoot);
  const cacheRoot = await realpath(lexicalCacheRoot);
  if (!contained(mediaRoot, cacheRoot)) throw new Error("invalid cache root");

  const lexicalWorkRoot = resolve(cacheRoot, ".work");
  if (!contained(cacheRoot, lexicalWorkRoot)) throw new Error("invalid work root");
  await ensurePrivateDirectoryTreeRaceSafe(lexicalWorkRoot);
  const workRoot = await realpath(lexicalWorkRoot);
  if (!contained(cacheRoot, workRoot)) throw new Error("invalid work root");

  return { mediaRoot, cacheRoot, workRoot };
}

async function reserveWorkDirectory(workRoot: string, createUuid: () => string): Promise<WorkReservation> {
  const id = createUuid();
  if (!UUID_PATTERN.test(id)) throw new Error("invalid work id");
  const directory = resolve(workRoot, id);
  if (!contained(workRoot, directory)) throw new Error("invalid work directory");
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("invalid work directory");
  return {
    directory,
    outputPath: resolve(directory, `${id}.png`),
    dev: directoryStat.dev,
    ino: directoryStat.ino,
  };
}

async function validateWorkReservation(reservation: WorkReservation, workRoot: string): Promise<void> {
  const directoryStat = await lstat(reservation.directory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || directoryStat.dev !== reservation.dev
    || directoryStat.ino !== reservation.ino
  ) {
    throw new Error("replaced work directory");
  }
  const physicalDirectory = await realpath(reservation.directory);
  if (!contained(workRoot, physicalDirectory) || physicalDirectory !== reservation.directory) {
    throw new Error("invalid work directory");
  }
}

async function cleanupWorkReservation(reservation: WorkReservation | undefined): Promise<void> {
  if (!reservation) return;
  let directoryStat;
  try {
    directoryStat = await lstat(reservation.directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || directoryStat.dev !== reservation.dev
    || directoryStat.ino !== reservation.ino
  ) {
    return;
  }
  const entries = await readdir(reservation.directory);
  if (entries.length === 1 && resolve(reservation.directory, entries[0]) === reservation.outputPath) {
    const outputStat = await lstat(reservation.outputPath);
    if (outputStat.isFile() && !outputStat.isSymbolicLink()) await unlink(reservation.outputPath);
  } else if (entries.length !== 0) {
    return;
  }
  await rmdir(reservation.directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) return;
    throw error;
  });
}

async function validatePng(path: string): Promise<{ sizeBytes: bigint }> {
  const pathStat = await lstat(path);
  if (
    !pathStat.isFile()
    || pathStat.isSymbolicLink()
    || pathStat.size < 24
    || pathStat.size > PDF_THUMBNAIL_MAX_BYTES
  ) {
    throw new Error("invalid PNG output");
  }

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile()
      || openedStat.size !== pathStat.size
      || (process.platform !== "win32" && (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino))
    ) {
      throw new Error("changed PNG output");
    }
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    if (bytesRead !== header.byteLength || !header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString("ascii", 12, 16) !== "IHDR") {
      throw new Error("invalid PNG header");
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (width < 1 || width > 640 || height < 1) throw new Error("invalid PNG dimensions");
    return { sizeBytes: BigInt(openedStat.size) };
  } finally {
    await handle.close();
  }
}

async function openValidatedThumbnail(path: string): Promise<PdfThumbnail> {
  const validated = await validatePng(path);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  const openedStat = await handle.stat();
  if (!openedStat.isFile() || BigInt(openedStat.size) !== validated.sizeBytes) {
    await handle.close();
    throw new Error("changed cached thumbnail");
  }
  return {
    stream: closingFileHandleStream(handle),
    sizeBytes: validated.sizeBytes,
  };
}

async function existingCache(path: string): Promise<boolean> {
  try {
    await validatePng(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    let pathStat;
    try {
      pathStat = await lstat(path);
    } catch (statError) {
      if (statError instanceof Error && "code" in statError && statError.code === "ENOENT") return false;
      throw error;
    }
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw error;
    await unlink(path);
    return false;
  }
}

async function renderThumbnail(input: {
  source: ReadableStream<Uint8Array>;
  expectedSha256: string;
  mediaRoot: string;
  cacheRoot: string;
  workRoot: string;
  cachePath: string;
  dependencies: PdfThumbnailDependencies;
}): Promise<string> {
  let staged: StagedMediaFile | undefined;
  let reservation: WorkReservation | undefined;
  try {
    staged = await stageMediaStream({
      root: input.mediaRoot,
      filename: "source.pdf",
      mimeType: "application/pdf",
      maximumBytes: DOCUMENT_MAX_BYTES,
      stream: input.source,
    });
    if (staged.sha256 !== input.expectedSha256 || staged.sizeBytes < 1n) throw new Error("source identity mismatch");

    reservation = await reserveWorkDirectory(input.workRoot, input.dependencies.createUuid);
    const outputPrefix = reservation.outputPath.slice(0, -4);
    await input.dependencies.runProcess({
      command: "pdftoppm",
      args: [
        "-f", "1", "-l", "1", "-singlefile",
        "-scale-to-x", "640", "-scale-to-y", "-1",
        "-png", staged.path, outputPrefix,
      ],
      timeoutMs: PDF_THUMBNAIL_TIMEOUT_MS,
      diagnosticLimitBytes: PROCESS_DIAGNOSTIC_LIMIT_BYTES,
    });
    await validateWorkReservation(reservation, input.workRoot);
    await validatePng(reservation.outputPath);
    await chmod(reservation.outputPath, 0o600);

    if (await existingCache(input.cachePath)) return input.cachePath;
    await rename(reservation.outputPath, input.cachePath);
    await validatePng(input.cachePath);
    return input.cachePath;
  } finally {
    await staged?.cleanup().catch(() => undefined);
    await cleanupWorkReservation(reservation).catch(() => undefined);
  }
}

function safeError(error: unknown): never {
  if (error instanceof HttpError && (error.status === 401 || error.status === 404)) throw error;
  throw new HttpError(424, "Miniatura indisponível");
}

export async function getPdfThumbnail(
  actorId: string,
  mediaId: string,
  dependencies: PdfThumbnailDependencies = defaultDependencies,
): Promise<PdfThumbnail> {
  let download;
  try {
    download = await dependencies.getMediaForDownload(actorId, mediaId);
  } catch (error) {
    safeError(error);
  }

  if (download.mimeType.split(";", 1)[0]!.trim().toLowerCase() !== "application/pdf" || !SHA256_PATTERN.test(download.sha256)) {
    await cancelStream(download.stream);
    throw new HttpError(424, "Miniatura indisponível");
  }

  try {
    if (!UUID_PATTERN.test(mediaId)) throw new Error("invalid media id");
    const roots = await prepareRoots(dependencies.mediaRoot);
    const cacheKey = `${mediaId}-${download.sha256}`;
    const cachePath = resolve(roots.cacheRoot, `${cacheKey}.png`);
    if (!contained(roots.cacheRoot, cachePath)) throw new Error("invalid cache path");

    if (await existingCache(cachePath)) {
      await cancelStream(download.stream);
      return await openValidatedThumbnail(cachePath);
    }

    const active = dependencies.inFlight.get(cacheKey);
    if (active) {
      await cancelStream(download.stream);
      return await openValidatedThumbnail(await active);
    }

    const generation = dependencies.limiter.run(
      () => renderThumbnail({
        source: download.stream,
        expectedSha256: download.sha256,
        mediaRoot: roots.mediaRoot,
        cacheRoot: roots.cacheRoot,
        workRoot: roots.workRoot,
        cachePath,
        dependencies,
      }),
      "pdf-thumbnail",
    );
    dependencies.inFlight.set(cacheKey, generation);
    try {
      return await openValidatedThumbnail(await generation);
    } finally {
      if (dependencies.inFlight.get(cacheKey) === generation) dependencies.inFlight.delete(cacheKey);
    }
  } catch (error) {
    safeError(error);
  }
}
