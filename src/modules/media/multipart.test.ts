// @vitest-environment node

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseMediaMultipartRequest, parseMultipartFileRequest } from "./multipart";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("streaming media multipart", () => {
  it("uses configurable fields and limits without changing media defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-multipart-config-"));
    roots.push(root);
    const form = new FormData();
    form.set("request", "one");
    form.set("file", new File([new Uint8Array([1])], "x.bin", { type: "application/octet-stream" }));

    const parsed = await parseMultipartFileRequest({
      request: new Request("http://localhost/upload", { method: "POST", body: form }),
      root,
      maximumFileBytes: 1,
      maximumRequestBytes: 64 * 1024,
      maximumDurationMs: 1_000,
      allowedFields: ["request"],
    });

    expect(parsed.fields).toEqual({ request: "one" });
    expect(parsed.file.sizeBytes).toBe(1n);
    await parsed.file.cleanup();
  });

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

  it("aborts and cleans an active upload when the request signal is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-multipart-abort-"));
    roots.push(root);
    const boundary = "xp-abort";
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\npartial`,
    );
    const abortController = new AbortController();
    let pulls = 0;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      signal: abortController.signal,
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          pulls += 1;
          if (pulls === 1) { controller.enqueue(prefix); return; }
          await new Promise((resolve) => setTimeout(resolve, 150));
          controller.error(new Error("late source failure"));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const started = Date.now();
    setTimeout(() => abortController.abort(), 10);

    await expect(parseMultipartFileRequest({
      request,
      root,
      maximumFileBytes: 1024,
      maximumRequestBytes: 2048,
      maximumDurationMs: 1_000,
      allowedFields: [],
    })).rejects.toMatchObject({ status: 408 });
    expect(Date.now() - started).toBeLessThan(100);
    await expect(readdir(join(root, ".staging"))).resolves.toEqual([]);
  });

  it("enforces a bounded upload deadline and cleans an active file", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-multipart-timeout-"));
    roots.push(root);
    const boundary = "xp-timeout";
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\npartial`,
    );
    let pulls = 0;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          pulls += 1;
          if (pulls === 1) { controller.enqueue(prefix); return; }
          await new Promise((resolve) => setTimeout(resolve, 150));
          controller.error(new Error("late source failure"));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const started = Date.now();

    await expect(parseMultipartFileRequest({
      request,
      root,
      maximumFileBytes: 1024,
      maximumRequestBytes: 2048,
      maximumDurationMs: 20,
      allowedFields: [],
    })).rejects.toMatchObject({ status: 408 });
    expect(Date.now() - started).toBeLessThan(100);
    await expect(readdir(join(root, ".staging"))).resolves.toEqual([]);
  });
});
