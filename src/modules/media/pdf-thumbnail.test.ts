import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "../../lib/http";
import { MediaTaskLimiter } from "./task-limiter";
import {
  getPdfThumbnail,
  PDF_THUMBNAIL_MAX_BYTES,
  type PdfThumbnailDependencies,
} from "./pdf-thumbnail";

const actorId = "00000000-0000-4000-8000-000000000001";
const mediaId = "30000000-0000-4000-8000-000000000001";
const workId = "40000000-0000-4000-8000-000000000001";
const pdf = Buffer.from("%PDF-1.7\n%%EOF", "ascii");
const digest = createHash("sha256").update(pdf).digest("hex");
const roots: string[] = [];

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function pngHeader(width = 640, height = 480): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function harness(options: {
  mimeType?: string;
  sha256?: string;
  png?: Buffer;
} = {}): Promise<{
  root: string;
  dependencies: PdfThumbnailDependencies;
  getMedia: ReturnType<typeof vi.fn>;
  runProcess: ReturnType<typeof vi.fn>;
}> {
  const root = await mkdtemp(join(tmpdir(), "xp-pdf-thumbnail-"));
  roots.push(root);
  const getMedia = vi.fn(async () => ({
    stream: byteStream(pdf),
    mimeType: options.mimeType ?? "application/pdf",
    sizeBytes: BigInt(pdf.byteLength),
    sha256: options.sha256 ?? digest,
    filename: "nota.pdf",
    kind: "document" as const,
  }));
  const runProcess = vi.fn(async ({ args }: { args: string[] }) => {
    const outputPrefix = args.at(-1)!;
    await writeFile(`${outputPrefix}.png`, options.png ?? pngHeader());
    return { stdout: "", stderr: "" };
  });

  return {
    root,
    getMedia,
    runProcess,
    dependencies: {
      getMediaForDownload: getMedia as PdfThumbnailDependencies["getMediaForDownload"],
      runProcess: runProcess as PdfThumbnailDependencies["runProcess"],
      mediaRoot: root,
      limiter: new MediaTaskLimiter(1, 1),
      inFlight: new Map(),
      createUuid: () => workId,
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PDF thumbnail service", () => {
  it("renders page one with fixed bounded Poppler arguments", async () => {
    const state = await harness();

    const thumbnail = await getPdfThumbnail(actorId, mediaId, state.dependencies);

    expect(await streamBytes(thumbnail.stream)).toEqual(pngHeader());
    expect(thumbnail.sizeBytes).toBe(33n);
    expect(state.runProcess).toHaveBeenCalledWith({
      command: "pdftoppm",
      args: [
        "-f", "1", "-l", "1", "-singlefile",
        "-scale-to-x", "640", "-scale-to-y", "-1",
        "-png", expect.stringMatching(/\.part$/), expect.stringContaining(workId),
      ],
      timeoutMs: 10_000,
      diagnosticLimitBytes: 8 * 1024,
    });
  });

  it("reuses the private cache while authorizing every caller", async () => {
    const state = await harness();

    await streamBytes((await getPdfThumbnail(actorId, mediaId, state.dependencies)).stream);
    await streamBytes((await getPdfThumbnail(actorId, mediaId, state.dependencies)).stream);

    expect(state.getMedia).toHaveBeenCalledTimes(2);
    expect(state.runProcess).toHaveBeenCalledTimes(1);
    const cached = await readFile(join(state.root, ".pdf-thumbnails", `${mediaId}-${digest}.png`));
    expect(cached).toEqual(pngHeader());
  });

  it("shares one generation between concurrent authorized callers", async () => {
    const state = await harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    state.runProcess.mockImplementationOnce(async ({ args }: { args: string[] }) => {
      await gate;
      await writeFile(`${args.at(-1)!}.png`, pngHeader());
      return { stdout: "", stderr: "" };
    });

    const first = getPdfThumbnail(actorId, mediaId, state.dependencies);
    const second = getPdfThumbnail(actorId, mediaId, state.dependencies);
    await vi.waitFor(() => expect(state.getMedia).toHaveBeenCalledTimes(2));
    release();

    expect(await streamBytes((await first).stream)).toEqual(pngHeader());
    expect(await streamBytes((await second).stream)).toEqual(pngHeader());
    expect(state.runProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects non-PDF media and invalid immutable digests", async () => {
    const wrongType = await harness({ mimeType: "text/plain" });
    const wrongDigest = await harness({ sha256: "NOT-A-DIGEST" });

    await expect(getPdfThumbnail(actorId, mediaId, wrongType.dependencies)).rejects.toMatchObject({ status: 424 });
    await expect(getPdfThumbnail(actorId, mediaId, wrongDigest.dependencies)).rejects.toMatchObject({ status: 424 });
    expect(wrongType.runProcess).not.toHaveBeenCalled();
    expect(wrongDigest.runProcess).not.toHaveBeenCalled();
  });

  it.each([
    ["truncated", Buffer.from("89504e470d0a1a0a", "hex")],
    ["too wide", pngHeader(641, 480)],
    ["empty dimension", pngHeader(640, 0)],
    ["oversized", Buffer.concat([pngHeader(), Buffer.alloc(PDF_THUMBNAIL_MAX_BYTES)])],
  ])("rejects and removes a %s renderer output", async (_label, output) => {
    const state = await harness({ png: output });

    await expect(getPdfThumbnail(actorId, mediaId, state.dependencies)).rejects.toMatchObject({
      status: 424,
      message: "Miniatura indisponível",
    });

    expect(await readdir(join(state.root, ".pdf-thumbnails", ".work"))).toEqual([]);
  });

  it("cleans staged and work files after a renderer timeout", async () => {
    const state = await harness();
    state.runProcess.mockRejectedValueOnce(new Error("timeout with secret details"));

    await expect(getPdfThumbnail(actorId, mediaId, state.dependencies)).rejects.toMatchObject({
      status: 424,
      message: "Miniatura indisponível",
    });

    expect(await readdir(join(state.root, ".staging"))).toEqual([]);
    expect(await readdir(join(state.root, ".pdf-thumbnails", ".work"))).toEqual([]);
  });

  it("preserves authorization errors without starting generation", async () => {
    const state = await harness();
    state.getMedia.mockRejectedValueOnce(new HttpError(404, "Mídia não encontrada"));

    await expect(getPdfThumbnail(actorId, mediaId, state.dependencies)).rejects.toMatchObject({
      status: 404,
      message: "Mídia não encontrada",
    });
    expect(state.runProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the cache directory is a symlink", async () => {
    const state = await harness();
    const outside = await mkdtemp(join(tmpdir(), "xp-pdf-thumbnail-outside-"));
    roots.push(outside);
    await symlink(outside, join(state.root, ".pdf-thumbnails"), process.platform === "win32" ? "junction" : "dir");

    await expect(getPdfThumbnail(actorId, mediaId, state.dependencies)).rejects.toMatchObject({ status: 424 });
    expect(state.runProcess).not.toHaveBeenCalled();
  });

  it("fails closed if the reserved work directory is replaced by a symlink", async () => {
    const state = await harness();
    const outside = await mkdtemp(join(tmpdir(), "xp-pdf-thumbnail-work-outside-"));
    roots.push(outside);
    state.runProcess.mockImplementationOnce(async ({ args }: { args: string[] }) => {
      const outputPrefix = args.at(-1)!;
      const workDirectory = dirname(outputPrefix);
      await rm(workDirectory, { recursive: true });
      await symlink(outside, workDirectory, process.platform === "win32" ? "junction" : "dir");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, `${workId}.png`), pngHeader());
      return { stdout: "", stderr: "" };
    });

    await expect(getPdfThumbnail(actorId, mediaId, state.dependencies)).rejects.toMatchObject({ status: 424 });
    expect(await readdir(outside)).toContain(`${workId}.png`);
  });
});
