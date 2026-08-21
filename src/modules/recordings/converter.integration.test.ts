// @vitest-environment node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stageMediaStream } from "../media/temp-file";
import { validateMediaFile } from "../media/validation";
import { convertRecording } from "./converter";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(process.env.RUN_FFMPEG_INTEGRATION !== "1")("real FFmpeg recording conversion", () => {
  it("creates a validated mono 48 kHz OGG/Opus recording", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-recording-integration-"));
    roots.push(root);
    const sourcePath = join(root, "source.webm");
    await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2", "-c:a", "libopus", "-y", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    const source = await stageMediaStream({
      root,
      filename: "source.webm",
      mimeType: "audio/webm",
      maximumBytes: 16 * 1024 * 1024,
      stream: new ReadableStream({ start(controller) { controller.enqueue(sourceBytes); controller.close(); } }),
    });

    const result = await convertRecording({ root, source });
    expect(result).toMatchObject({ mimeType: "audio/ogg", filename: "gravacao.ogg" });
    expect(result.sizeBytes).toBeLessThan(16n * 1024n * 1024n);
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,channels,sample_rate:format=duration", "-of", "json", result.path]);
    const inspected = JSON.parse(stdout) as { streams: Array<{ codec_name: string; channels: number; sample_rate: string }>; format: { duration: string } };
    expect(inspected.streams[0]).toMatchObject({ codec_name: "opus", channels: 1, sample_rate: "48000" });
    expect(Number(inspected.format.duration)).toBeGreaterThan(0);
    await expect(validateMediaFile({ path: result.path, filename: result.filename, mimeType: result.mimeType }))
      .resolves.toMatchObject({ mimeType: "audio/ogg", kind: "audio" });
    await result.cleanup();
  });
});
