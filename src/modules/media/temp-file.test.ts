// @vitest-environment node

import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stageMediaStream } from "./temp-file";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("secure staged media", () => {
  it("hashes and writes chunks incrementally to a 0600 temporary file that can be cleaned", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-stage-"));
    roots.push(root);
    let pulls = 0;
    const staged = await stageMediaStream({
      root,
      filename: "nota.pdf",
      mimeType: "application/pdf",
      maximumBytes: 8,
      stream: new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(new TextEncoder().encode("%PDF"));
          else if (pulls === 2) controller.enqueue(new TextEncoder().encode("-1.7"));
          else controller.close();
        },
      }),
    });

    expect(staged.sizeBytes).toBe(8n);
    expect(staged.sha256).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") expect((await stat(staged.path)).mode & 0o777).toBe(0o600);
    await staged.cleanup();
    await expect(access(staged.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels and removes the partial file immediately on overflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-stage-"));
    roots.push(root);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled = true; },
    });

    await expect(stageMediaStream({ root, filename: "x", mimeType: "x", maximumBytes: 8, stream }))
      .rejects.toThrow(/limite/i);
    expect(cancelled).toBe(true);
  });
});
