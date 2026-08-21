// @vitest-environment node

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { StagedMediaFile } from "../media/temp-file";
import {
  convertRecording,
  RAW_RECORDING_MAX_BYTES,
  runBoundedProcess,
  type RunBoundedProcess,
} from "./converter";

const roots: string[] = [];
const outputId = "123e4567-e89b-42d3-a456-426614174000";
const validOgg = Buffer.concat([
  Buffer.from("OggS\0\x02", "binary"),
  Buffer.alloc(8 + 4 + 4 + 4),
  Buffer.from([1, 19]),
  Buffer.from("OpusHead\x01\x01\x80\xbb\0\0\0\0\0\0", "binary"),
]);

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "xp-recording-"));
  roots.push(value);
  return value;
}

async function source(
  rootPath: string,
  mimeType = "audio/webm",
  bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("webm")]),
): Promise<StagedMediaFile> {
  const path = join(rootPath, "source-upload-name.webm");
  await writeFile(path, bytes);
  return {
    path,
    filename: "untrusted upload name.webm",
    mimeType,
    sizeBytes: BigInt(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    cleanup: async () => { await unlink(path).catch(() => undefined); },
  };
}

function outputPath(rootPath: string): string {
  return join(rootPath, ".recordings", outputId, `${outputId}.ogg`);
}

function probe(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    streams: [{ codec_type: "audio", codec_name: "opus", channels: 1, sample_rate: "48000" }],
    format: { duration: "1.2" },
    ...overrides,
  });
}

function successfulRunner(options: { finalProbe?: string; mutateOutput?: boolean } = {}): RunBoundedProcess {
  let probes = 0;
  return async ({ command, args }) => {
    if (command === "ffprobe") {
      probes += 1;
      if (probes === 2 && options.mutateOutput) await writeFile(args.at(-1)!, Buffer.concat([validOgg, Buffer.from("changed")]));
      return { stdout: probes === 1 ? probe() : options.finalProbe ?? probe(), stderr: "" };
    }
    const output = args.at(-1)!;
    await writeFile(output, validOgg);
    return { stdout: "", stderr: "" };
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("recording conversion", () => {
  it("runs ffprobe and ffmpeg without a shell and with fixed voice arguments", async () => {
    const rootPath = await root();
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    const runProcess: RunBoundedProcess = async (input) => {
      calls.push(input);
      return successfulRunner()(input);
    };

    const result = await convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess, createUuid: () => outputId });

    expect(calls[0]).toMatchObject({ command: "ffprobe", timeoutMs: 10_000 });
    expect(calls[0]!.args).toEqual(expect.arrayContaining([
      "-protocol_whitelist", "file",
      "-format_whitelist", "matroska,webm,ogg,mov,mp4,m4a,3gp,3g2,mj2",
    ]));
    expect(calls[1]).toMatchObject({ command: "ffmpeg", timeoutMs: 60_000 });
    expect(calls[1]!.args).toEqual(expect.arrayContaining([
      "-nostdin", "-hide_banner", "-loglevel", "error", "-map_metadata", "-1",
      "-protocol_whitelist", "file",
      "-format_whitelist", "matroska,webm,ogg,mov,mp4,m4a,3gp,3g2,mj2",
      "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus",
      "-application", "voip", "-b:a", "24k", "-t", "300", "-f", "ogg",
    ]));
    expect(calls[1]!.args.indexOf("-protocol_whitelist")).toBeLessThan(calls[1]!.args.indexOf("-i"));
    expect(calls[1]!.args.indexOf("-format_whitelist")).toBeLessThan(calls[1]!.args.indexOf("-i"));
    expect(result).toMatchObject({ mimeType: "audio/ogg", filename: "gravacao.ogg" });
    expect(result.path).toBe(outputPath(rootPath));
    expect(await readFile(result.path)).toEqual(validOgg);
    await result.cleanup();
    await result.cleanup();
    await expect(stat(result.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(rootPath, ".recordings", outputId))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["text/plain", "audio/wav"]) ("rejects unsupported raw MIME %s", async (mimeType) => {
    const rootPath = await root();
    const runner = successfulRunner();
    await expect(convertRecording({ root: rootPath, source: await source(rootPath, mimeType) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 400 });
  });

  it("canonicalizes the raw MIME essence", async () => {
    const rootPath = await root();
    const result = await convertRecording({ root: rootPath, source: await source(rootPath, "audio/webm; charset=binary") }, { runProcess: successfulRunner(), createUuid: () => outputId });
    await result.cleanup();
  });

  it("rejects a playlist disguised as browser audio before spawning a process", async () => {
    const rootPath = await root();
    let calls = 0;
    const runner: RunBoundedProcess = async () => {
      calls += 1;
      return { stdout: probe(), stderr: "" };
    };

    await expect(convertRecording({
      root: rootPath,
      source: await source(rootPath, "audio/webm", Buffer.from("#EXTM3U\nhttp://127.0.0.1/internal")),
    }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });

  it("rejects a raw recording over 16 MiB before spawning", async () => {
    const rootPath = await root();
    const staged = await source(rootPath);
    const oversized = { ...staged, sizeBytes: BigInt(RAW_RECORDING_MAX_BYTES + 1) };
    await expect(convertRecording({ root: rootPath, source: oversized }, { runProcess: successfulRunner() })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ["no audio stream", probe({ streams: [] })],
    ["zero duration", probe({ format: { duration: "0" } })],
    ["NaN duration", probe({ format: { duration: "NaN" } })],
    ["too-long duration", probe({ format: { duration: "300.01" } })],
  ])("rejects source probe with %s", async (_name, stdout) => {
    const rootPath = await root();
    const runner: RunBoundedProcess = async ({ command }) => ({ stdout: command === "ffprobe" ? stdout : "", stderr: "" });
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 400 });
    await expect(stat(outputPath(rootPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["timeout", "crash"]) ("maps ffprobe %s to a short public error", async (kind) => {
    const rootPath = await root();
    const runner: RunBoundedProcess = async () => { throw new Error(`${kind}: stderr secret`); };
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId }))
      .rejects.toMatchObject({ status: 422, message: expect.not.stringMatching(/secret|source-upload/i) });
  });

  it.each(["timeout", "crash"]) ("cleans generated output after ffmpeg %s", async (kind) => {
    const rootPath = await root();
    const runner: RunBoundedProcess = async ({ command, args }) => {
      if (command === "ffprobe") return { stdout: probe(), stderr: "" };
      await writeFile(args.at(-1)!, validOgg);
      throw new Error(`${kind}: stderr secret`);
    };
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 422 });
    await expect(stat(outputPath(rootPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(rootPath, ".recordings", outputId))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never removes a pre-existing colliding output after conversion failure", async () => {
    const rootPath = await root();
    const collisionDirectory = join(rootPath, ".recordings", outputId);
    const collisionOutput = outputPath(rootPath);
    await mkdir(collisionDirectory, { recursive: true });
    await writeFile(collisionOutput, Buffer.from("pre-existing"));
    const runner: RunBoundedProcess = async ({ command }) => {
      if (command === "ffprobe") return { stdout: probe(), stderr: "" };
      throw new Error("ffmpeg failed");
    };
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 422 });
    await expect(readFile(collisionOutput, "utf8")).resolves.toBe("pre-existing");
  });

  it("leaves a reserved directory intact when unexpected content is present during cleanup", async () => {
    const rootPath = await root();
    const result = await convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: successfulRunner(), createUuid: () => outputId });
    const unexpected = join(rootPath, ".recordings", outputId, "unexpected.txt");
    await writeFile(unexpected, "must survive");

    await result.cleanup();
    await result.cleanup();

    await expect(readFile(result.path)).resolves.toEqual(validOgg);
    await expect(readFile(unexpected, "utf8")).resolves.toBe("must survive");
  });

  it("leaves an external target intact when the reserved directory is swapped before realpath", async () => {
    const rootPath = await root();
    const outside = await root();
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "external must survive");

    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, {
      runProcess: successfulRunner(),
      createUuid: () => outputId,
      afterOutputDirectoryReservedForTest: async (reservedPath: string) => {
        await rmdir(reservedPath);
        await symlink(outside, reservedPath, "junction");
      },
    })).rejects.toMatchObject({ status: 422 });

    await expect(readFile(sentinel, "utf8")).resolves.toBe("external must survive");
  });

  it.each([
    ["invalid OGG bytes", Buffer.from("not audio"), probe()],
    ["non-Opus output", validOgg, probe({ streams: [{ codec_type: "audio", codec_name: "aac", channels: 1, sample_rate: "48000" }] })],
    ["non-mono output", validOgg, probe({ streams: [{ codec_type: "audio", codec_name: "opus", channels: 2, sample_rate: "48000" }] })],
    ["non-48 kHz output", validOgg, probe({ streams: [{ codec_type: "audio", codec_name: "opus", channels: 1, sample_rate: "44100" }] })],
  ])("rejects %s and removes generated output", async (_name, bytes, finalProbe) => {
    const rootPath = await root();
    let probes = 0;
    const runner: RunBoundedProcess = async ({ command, args }) => {
      if (command === "ffprobe") return { stdout: ++probes === 1 ? probe() : finalProbe as string, stderr: "" };
      await writeFile(args.at(-1)!, bytes as Buffer);
      return { stdout: "", stderr: "" };
    };
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 422 });
    await expect(stat(outputPath(rootPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects output changed after validation", async () => {
    const rootPath = await root();
    const runner = successfulRunner({ mutateOutput: true });
    await expect(convertRecording({ root: rootPath, source: await source(rootPath) }, { runProcess: runner, createUuid: () => outputId })).rejects.toMatchObject({ status: 422 });
  });
});

describe("bounded process runner", () => {
  it("uses no shell, hides windows, and cleans listeners and timers after success", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
    const calls: unknown[] = [];
    const promise = runBoundedProcess({ command: "ffprobe", args: ["-version"], timeoutMs: 100, diagnosticLimitBytes: 32 }, { spawn: (...input: unknown[]) => { calls.push(input); return child as never; } });
    child.stdout.emit("data", Buffer.from("ok")); child.emit("close", 0, null);
    await expect(promise).resolves.toEqual({ stdout: "ok", stderr: "" });
    expect(calls[0]).toEqual(["ffprobe", ["-version"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
  });

  it("escalates an ignored timeout from SIGTERM to SIGKILL and rejects only after close", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (signal?: string) => boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const signals: string[] = [];
    child.kill = (signal = "SIGTERM") => {
      signals.push(signal);
      if (signal === "SIGKILL") setTimeout(() => child.emit("close", null, signal), 0);
      return true;
    };
    const promise = runBoundedProcess({ command: "ffmpeg", args: [], timeoutMs: 1, diagnosticLimitBytes: 4 }, { spawn: () => child as never, terminationGraceMs: 1 });
    await expect(promise).rejects.toThrow();
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
  });

  it("does not hang when termination fails and close is late", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (signal?: string) => boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const signals: string[] = [];
    child.kill = (signal = "SIGTERM") => { signals.push(signal); return false; };
    const promise = runBoundedProcess({ command: "ffmpeg", args: [], timeoutMs: 1, diagnosticLimitBytes: 4 }, { spawn: () => child as never, terminationGraceMs: 1 });
    setTimeout(() => child.emit("close", null, null), 30);
    await expect(promise).rejects.toThrow();
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.listenerCount("close")).toBe(0);
  });

  it("continues bounded shutdown when kill throws and close is late", async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { throw new Error("kill failed"); };
    const promise = runBoundedProcess({ command: "ffmpeg", args: [], timeoutMs: 1, diagnosticLimitBytes: 4 }, { spawn: () => child as never, terminationGraceMs: 1 });
    setTimeout(() => child.emit("close", null, null), 30);
    await expect(promise).rejects.toThrow();
    expect(child.listenerCount("close")).toBe(0);
  });

  it.each(["timeout", "diagnostic overflow"]) ("forces a bounded termination on %s", async (reason) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); let killed = 0; child.kill = () => { killed += 1; return true; };
    const promise = runBoundedProcess({ command: "ffmpeg", args: [], timeoutMs: reason === "timeout" ? 1 : 10_000, diagnosticLimitBytes: 4 }, { spawn: () => child as never, terminationGraceMs: 1 });
    if (reason === "diagnostic overflow") child.stderr.emit("data", Buffer.from("12345"));
    await expect(promise).rejects.toThrow();
    expect(killed).toBeGreaterThanOrEqual(2);
    expect(child.listenerCount("close")).toBe(0);
  });
});
