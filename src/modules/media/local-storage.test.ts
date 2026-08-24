// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closingFileHandleStream, LocalMediaStorage } from "./local-storage";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xp-media-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local media storage", () => {
  it("closes the underlying file handle on EOF and cancellation", async () => {
    let eofClosed = 0;
    let reads = 0;
    const eofStream = closingFileHandleStream({
      async read(buffer: Uint8Array) {
        reads += 1;
        if (reads === 1) { buffer.set(new TextEncoder().encode("ok")); return { bytesRead: 2, buffer }; }
        return { bytesRead: 0, buffer };
      },
      async close() { eofClosed += 1; },
    });
    await expect(new Response(eofStream).text()).resolves.toBe("ok");
    expect(eofClosed).toBe(1);

    let cancelledClosed = 0;
    const cancelled = closingFileHandleStream({
      async read(buffer: Uint8Array) { buffer[0] = 1; return { bytesRead: 1, buffer }; },
      async close() { cancelledClosed += 1; },
    });
    await cancelled.cancel();
    expect(cancelledClosed).toBe(1);
  });
  it("uses a random server key partitioned by UTC year and month", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("conteúdo seguro");
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    const stored = await storage.put({
      filename: "../../token.txt",
      bytes,
      mimeType: "text/plain",
    });

    expect(stored.key).toBe("2026/08/123e4567-e89b-42d3-a456-426614174000");
    expect(stored.key).not.toContain("..");
    expect(stored.sizeBytes).toBe(BigInt(bytes.byteLength));
    expect(stored.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(readFile(join(root, ...stored.key.split("/")))).resolves.toEqual(
      Buffer.from(bytes),
    );
  });

  it("writes exclusively and never overwrites a colliding key", async () => {
    const root = await temporaryRoot();
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    await storage.put({
      filename: "first.txt",
      bytes: new TextEncoder().encode("first"),
      mimeType: "text/plain",
    });

    await expect(
      storage.put({
        filename: "second.txt",
        bytes: new TextEncoder().encode("second"),
        mimeType: "text/plain",
      }),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "2026", "08", "123e4567-e89b-42d3-a456-426614174000"), "utf8"),
    ).resolves.toBe("first");
  });

  it.each([
    "../outside",
    "2026/08/../../outside",
    "/absolute/file",
    "2026/08/not-a-uuid",
    "2026\\08\\123e4567-e89b-42d3-a456-426614174000",
  ])("rejects an untrusted storage key: %s", async (key) => {
    const storage = new LocalMediaStorage(await temporaryRoot());
    await expect(storage.open(key)).rejects.toThrow(/inválida/i);
  });

  it("opens only the regular file addressed by a valid contained key", async () => {
    const storage = new LocalMediaStorage(await temporaryRoot(), {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    const bytes = new TextEncoder().encode("streamed");
    const stored = await storage.put({ filename: "x.txt", bytes, mimeType: "text/plain" });

    const stream = await storage.open(stored.key);
    const result = new Uint8Array(await new Response(stream).arrayBuffer());

    expect(result).toEqual(bytes);
  });

  it("opens only the requested inclusive byte range", async () => {
    const storage = new LocalMediaStorage(await temporaryRoot(), {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    const stored = await storage.put({
      filename: "range.bin",
      bytes: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      mimeType: "application/octet-stream",
    });

    const stream = await storage.open(stored.key, { start: 2n, end: 5n });

    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    expect([...result]).toEqual([2, 3, 4, 5]);
  });

  it("creates the dedicated root and every partition with restrictive permissions", async () => {
    const parent = await temporaryRoot();
    const root = join(parent, "dedicated");
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    const stored = await storage.put({ filename: "x.txt", bytes: new TextEncoder().encode("x"), mimeType: "text/plain" });

    if (process.platform !== "win32") {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "2026"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "2026", "08"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, ...stored.key.split("/")))).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(process.platform === "win32")("rejects a symbolic-link ancestor before creating child directories", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(join(outside, "08"), { mode: 0o700 });
    await symlink(outside, join(root, "2026"), "dir");
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    await expect(storage.put({ filename: "x.txt", bytes: new TextEncoder().encode("x"), mimeType: "text/plain" }))
      .rejects.toThrow(/inválida/i);
    await expect(readFile(join(outside, "08", "123e4567-e89b-42d3-a456-426614174000")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a chunked stream incrementally and supports explicit orphan cleanup", async () => {
    const root = await temporaryRoot();
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 4) controller.enqueue(new Uint8Array(1024 * 1024).fill(pulls));
        else controller.close();
      },
    });

    const stored = await storage.putStream({ filename: "large.bin", mimeType: "application/octet-stream", stream, maximumBytes: 4 * 1024 * 1024 });

    expect(pulls).toBeGreaterThan(1);
    expect(stored.sizeBytes).toBe(4n * 1024n * 1024n);
    await storage.remove(stored.key);
    await expect(storage.open(stored.key)).rejects.toThrow();
  });

  it("cancels the source stream when target writing fails before EOF", async () => {
    const root = await temporaryRoot();
    const probe = await open(join(root, "prototype-probe"), "w");
    const fileHandlePrototype = Object.getPrototypeOf(probe) as { write: (...args: unknown[]) => Promise<unknown> };
    await probe.close();
    vi.spyOn(fileHandlePrototype, "write").mockRejectedValueOnce(new Error("simulated disk failure"));
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; },
    });
    const storage = new LocalMediaStorage(root, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    await expect(storage.putStream({
      filename: "audio.ogg",
      mimeType: "audio/ogg",
      stream,
      maximumBytes: 1024,
    })).rejects.toThrow("simulated disk failure");
    expect(cancelled).toBe(true);
    await expect(stat(join(root, "2026", "08", "123e4567-e89b-42d3-a456-426614174000")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
