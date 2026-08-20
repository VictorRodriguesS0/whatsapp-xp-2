import "server-only";

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, stat, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import { HttpError } from "../../lib/http";
import { ensurePrivateDirectoryTree } from "../media/local-storage";
import type { StagedMediaFile } from "../media/temp-file";
import { validateMediaFile } from "../media/validation";

export const RAW_RECORDING_MAX_BYTES = 16 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 300;
export const RECORDING_OUTPUT_MIME = "audio/ogg";
export const RAW_RECORDING_MIME_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);

export type ProcessResult = { stdout: string; stderr: string };
export type RunBoundedProcess = (input: {
  command: "ffmpeg" | "ffprobe";
  args: string[];
  timeoutMs: number;
  diagnosticLimitBytes: number;
}) => Promise<ProcessResult>;

type Spawn = (command: string, args: readonly string[], options: {
  shell: false;
  windowsHide: true;
  stdio: ["ignore", "pipe", "pipe"];
}) => ChildProcess;

const probeSchema = z.object({
  streams: z.array(z.object({
    codec_type: z.string(),
    codec_name: z.string(),
    channels: z.number().int(),
    sample_rate: z.string(),
  })).max(1),
  format: z.object({ duration: z.string() }),
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESS_DIAGNOSTIC_LIMIT_BYTES = 8 * 1024;
const TERMINATION_GRACE_MS = 1_000;

class ProcessFailure extends Error {}

function contained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return Boolean(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(pathFromRoot);
}

function canonicalMime(mimeType: string): string {
  return mimeType.split(";", 1)[0]!.trim().toLowerCase();
}

function probeArgs(path: string): string[] {
  return [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_type,codec_name,channels,sample_rate:format=duration",
    "-of", "json", path,
  ];
}

function convertArgs(input: string, output: string): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-i", input,
    "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "48000",
    "-c:a", "libopus", "-application", "voip", "-b:a", "24k",
    "-t", "300", "-f", "ogg", "-n", output,
  ];
}

function parseProbe(stdout: string): z.infer<typeof probeSchema> {
  try {
    return probeSchema.parse(JSON.parse(stdout));
  } catch {
    throw new ProcessFailure();
  }
}

function assertSourceProbe(stdout: string): void {
  const probe = parseProbe(stdout);
  const stream = probe.streams[0];
  const duration = Number(probe.format.duration);
  if (!stream || stream.codec_type !== "audio" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_RECORDING_SECONDS) {
    throw new HttpError(400, "Gravação de áudio inválida");
  }
}

function assertOutputProbe(stdout: string): void {
  const probe = parseProbe(stdout);
  const stream = probe.streams[0];
  const duration = Number(probe.format.duration);
  if (!stream || stream.codec_type !== "audio" || stream.codec_name !== "opus" || stream.channels !== 1 || stream.sample_rate !== "48000" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_RECORDING_SECONDS) {
    throw new ProcessFailure();
  }
}

async function validateOutput(path: string): Promise<{ sizeBytes: bigint }> {
  try {
    return await validateMediaFile({ path, filename: "gravacao.ogg", mimeType: RECORDING_OUTPUT_MIME });
  } catch (error) {
    // file-type identifies Opus as "audio/ogg; codecs=opus", while the shared
    // validator currently accepts only its MIME essence aliases. Keep its size
    // and structural checks, then close that compatibility gap locally.
    if (!(error instanceof Error) || error.message !== "Conteúdo incompatível com o tipo declarado") throw error;
    const bytes = await readFile(path);
    if (bytes.byteLength === 0 || bytes.byteLength > RAW_RECORDING_MAX_BYTES || !bytes.subarray(0, 4).equals(Buffer.from("OggS")) || !bytes.subarray(0, 64).includes(Buffer.from("OpusHead"))) {
      throw error;
    }
    return { sizeBytes: BigInt(bytes.byteLength) };
  }
}

async function outputSnapshot(path: string): Promise<{ sizeBytes: bigint; sha256: string }> {
  const bytes = await readFile(path);
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size !== bytes.byteLength) throw new ProcessFailure();
  return {
    sizeBytes: BigInt(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function createRunBoundedProcess(
  spawn: Spawn = nodeSpawn as Spawn,
  options: { terminationGraceMs?: number } = {},
): RunBoundedProcess {
  const terminationGraceMs = options.terminationGraceMs ?? TERMINATION_GRACE_MS;
  return ({ command, args, timeoutMs, diagnosticLimitBytes }) => new Promise<ProcessResult>((resolvePromise, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      reject(new ProcessFailure());
      return;
    }
    if (!child.stdout || !child.stderr) {
      try { child.kill("SIGKILL"); } catch { /* process cleanup is best-effort */ }
      reject(new ProcessFailure());
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    let settled = false;
    let terminating = false;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const clean = () => {
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (forceTimer) clearTimeout(forceTimer);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
    };
    const fail = () => {
      if (settled || terminating) return;
      terminating = true;
      try { child.kill("SIGTERM"); } catch { /* escalation still proceeds */ }
      escalationTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill("SIGKILL"); } catch { /* hard deadline prevents a hang */ }
        forceTimer = setTimeout(completeFailure, terminationGraceMs);
      }, terminationGraceMs);
    };
    const completeFailure = () => {
      if (settled) return;
      settled = true;
      clean();
      reject(new ProcessFailure());
    };
    const add = (target: Buffer[], value: Buffer | string) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += bytes.byteLength;
      if (total > diagnosticLimitBytes) { fail(); return; }
      target.push(bytes);
    };
    const onStdout = (value: Buffer | string) => add(stdout, value);
    const onStderr = (value: Buffer | string) => add(stderr, value);
    const onError = () => fail();
    const onClose = (code: number | null) => {
      if (settled) return;
      if (terminating) { completeFailure(); return; }
      settled = true;
      clean();
      if (code !== 0) { reject(new ProcessFailure()); return; }
      resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

export function runBoundedProcess(
  input: Parameters<RunBoundedProcess>[0],
  dependencies: { spawn?: Spawn; terminationGraceMs?: number } = {},
): Promise<ProcessResult> {
  return createRunBoundedProcess(dependencies.spawn, { terminationGraceMs: dependencies.terminationGraceMs })(input);
}

const defaultRunner = createRunBoundedProcess();

export async function convertRecording(
  input: { root: string; source: StagedMediaFile },
  dependencies: { runProcess?: RunBoundedProcess; createUuid?: () => string } = {},
): Promise<StagedMediaFile> {
  const mimeType = canonicalMime(input.source.mimeType);
  if (!RAW_RECORDING_MIME_TYPES.has(mimeType) || input.source.sizeBytes <= 0n || input.source.sizeBytes > BigInt(RAW_RECORDING_MAX_BYTES)) {
    throw new HttpError(400, "Gravação de áudio inválida");
  }
  const runProcess = dependencies.runProcess ?? defaultRunner;
  const createUuid = dependencies.createUuid ?? randomUUID;
  const id = createUuid();
  if (!UUID_PATTERN.test(id)) throw new HttpError(500, "Erro ao converter gravação");
  let outputPath: string | undefined;
  let outputDirectory: string | undefined;
  let ownsOutputDirectory = false;
  try {
    const configuredRoot = resolve(input.root);
    await ensurePrivateDirectoryTree(configuredRoot, true);
    const mediaRoot = await realpath(configuredRoot);
    const mediaRootStat = await lstat(mediaRoot);
    if (!mediaRootStat.isDirectory() || mediaRootStat.isSymbolicLink()) throw new ProcessFailure();
    const recordingsRoot = resolve(mediaRoot, ".recordings");
    if (!contained(mediaRoot, recordingsRoot)) throw new ProcessFailure();
    await ensurePrivateDirectoryTree(recordingsRoot, true);
    const physicalRecordingsRoot = await realpath(recordingsRoot);
    if (!contained(mediaRoot, physicalRecordingsRoot)) throw new ProcessFailure();
    outputDirectory = resolve(physicalRecordingsRoot, id);
    if (!contained(physicalRecordingsRoot, outputDirectory)) throw new ProcessFailure();
    await mkdir(outputDirectory, { mode: 0o700 });
    ownsOutputDirectory = true;
    outputDirectory = await realpath(outputDirectory);
    if (!contained(physicalRecordingsRoot, outputDirectory)) throw new ProcessFailure();
    outputPath = resolve(outputDirectory, `${id}.ogg`);
    if (!contained(outputDirectory, outputPath)) throw new ProcessFailure();

    const sourceProbe = await runProcess({ command: "ffprobe", args: probeArgs(input.source.path), timeoutMs: 10_000, diagnosticLimitBytes: PROCESS_DIAGNOSTIC_LIMIT_BYTES });
    assertSourceProbe(sourceProbe.stdout);
    await runProcess({ command: "ffmpeg", args: convertArgs(input.source.path, outputPath), timeoutMs: 60_000, diagnosticLimitBytes: PROCESS_DIAGNOSTIC_LIMIT_BYTES });
    const converted = await outputSnapshot(outputPath);
    const outputProbe = await runProcess({ command: "ffprobe", args: probeArgs(outputPath), timeoutMs: 10_000, diagnosticLimitBytes: PROCESS_DIAGNOSTIC_LIMIT_BYTES });
    assertOutputProbe(outputProbe.stdout);
    const validated = await validateOutput(outputPath);
    const completed = await outputSnapshot(outputPath);
    if (completed.sizeBytes !== converted.sizeBytes || completed.sha256 !== converted.sha256 || completed.sizeBytes !== validated.sizeBytes) throw new ProcessFailure();
    let cleaned = false;
    return {
      path: outputPath,
      filename: "gravacao.ogg",
      mimeType: RECORDING_OUTPUT_MIME,
      sizeBytes: completed.sizeBytes,
      sha256: completed.sha256,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        await unlink(outputPath!).catch((error: unknown) => {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        });
        await rm(outputDirectory!, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (outputDirectory && ownsOutputDirectory) await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "Não foi possível converter a gravação");
  }
}
