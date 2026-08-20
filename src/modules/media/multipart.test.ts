// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseMediaMultipartRequest } from "./multipart";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("streaming media multipart", () => {
  it("handles an early staging rejection immediately without an unhandled rejection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xp-multipart-reject-"));
    roots.push(directory);
    const invalidRoot = join(directory, "regular-file");
    await writeFile(invalidRoot, "not a directory");
    const boundary = "xp-boundary";
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7`,
    );
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) { controller.enqueue(prefix); return; }
        await new Promise((resolve) => setTimeout(resolve, 100));
        controller.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));
        controller.close();
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const started = Date.now();
    try {
      await expect(parseMediaMultipartRequest(request, invalidRoot)).rejects.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(Date.now() - started).toBeLessThan(80);
      expect(cancelled).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
