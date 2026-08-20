// @vitest-environment node

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RAW_RECORDING_MAX_BYTES } from "./converter";
import { parseRecordingMultipartRequest } from "./multipart";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("streaming recording multipart", () => {
  it("accepts only a client request id and one raw recording file", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-recording-multipart-"));
    roots.push(root);
    const form = new FormData();
    form.set("clientRequestId", "40000000-0000-4000-8000-000000000001");
    form.set("file", new File([new Uint8Array([1])], "recording.webm", { type: "audio/webm;codecs=opus" }));

    const parsed = await parseRecordingMultipartRequest(new Request("http://localhost/recordings", { method: "POST", body: form }), root);

    expect(parsed.fields).toEqual({ clientRequestId: "40000000-0000-4000-8000-000000000001" });
    expect(parsed.file).toMatchObject({ filename: "recording.webm", mimeType: "audio/webm", sizeBytes: 1n });
    await parsed.file.cleanup();
  });

  it("rejects unknown or duplicate fields and cleans staged files", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-recording-multipart-"));
    roots.push(root);
    const boundary = "xp-recording";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\nx\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nno\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    await expect(parseRecordingMultipartRequest(new Request("http://localhost/recordings", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    }), root)).rejects.toMatchObject({ status: 400 });
    await expect(readdir(join(root, ".staging"))).resolves.toEqual([]);
  });

  it("rejects Content-Length above the narrow request budget before body access", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-recording-multipart-"));
    roots.push(root);
    let accessed = false;
    const request = new Request("http://localhost/recordings", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(RAW_RECORDING_MAX_BYTES + 64 * 1024 + 1) },
      body: "--x--\r\n",
    });
    const originalBody = request.body;
    Object.defineProperty(request, "body", { get() { accessed = true; return originalBody; } });

    await expect(parseRecordingMultipartRequest(request, root)).rejects.toMatchObject({ status: 413 });
    expect(accessed).toBe(false);
  });

  it("stops a chunked request at the same narrow request budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-recording-multipart-"));
    roots.push(root);
    const request = new Request("http://localhost/recordings", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(RAW_RECORDING_MAX_BYTES + 64 * 1024 + 1));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(parseRecordingMultipartRequest(request, root)).rejects.toMatchObject({ status: 413 });
  });
});
