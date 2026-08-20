// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalMediaStorage } from "./local-storage";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xp-media-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local media storage", () => {
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
});
