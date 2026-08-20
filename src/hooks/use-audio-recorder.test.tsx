import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioRecorder } from "./use-audio-recorder";

const MAXIMUM_DURATION_MS = 300_000;

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  readonly track = new FakeTrack();

  getTracks() {
    return [this.track] as unknown as MediaStreamTrack[];
  }
}

type RecorderOptions = { mimeType?: string; audioBitsPerSecond?: number };

class FakeMediaRecorder {
  static supported = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  static finalBlob = new Blob(["audio"], { type: "audio/webm" });

  static isTypeSupported(type: string) {
    return this.supported.has(type);
  }

  readonly start = vi.fn();
  readonly stop = vi.fn(() => {
    this.ondataavailable?.({ data: FakeMediaRecorder.finalBlob } as BlobEvent);
    this.onstop?.(new Event("stop"));
  });
  readonly stream: MediaStream;
  readonly options?: RecorderOptions;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(stream: MediaStream, options?: RecorderOptions) {
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  emitStop(blob = FakeMediaRecorder.finalBlob) {
    this.ondataavailable?.({ data: blob } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }

  emitError(error: Error) {
    this.onerror?.({ error } as unknown as Event);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function installRecorderEnvironment(getUserMedia = vi.fn<() => Promise<MediaStream>>()) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: vi.fn(() => "recording-id") });
  return getUserMedia;
}

describe("useAudioRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T15:00:00.000Z"));
    FakeMediaRecorder.supported = new Set();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.finalBlob = new Blob(["audio"], { type: "audio/webm" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports unsupported capture without asking for permission", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", undefined);
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    expect(hook.result.current.supported).toBe(false);
    await act(() => hook.result.current.start());

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("A gravação de áudio não é compatível com este navegador.");
  });

  it("selects the first supported MIME type in the approved order", async () => {
    const stream = new FakeStream();
    const getUserMedia = installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    FakeMediaRecorder.supported = new Set(["audio/ogg;codecs=opus", "audio/mp4"]);
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({
      mimeType: "audio/ogg;codecs=opus",
      audioBitsPerSecond: 32_000,
    });
  });

  it("uses fallback options and validates the final Blob MIME", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({ audioBitsPerSecond: 32_000 });
    await act(() => hook.result.current.stop());

    expect(hook.result.current.recording?.file.type).toBe("audio/webm");
    expect(hook.result.current.phase).toBe("preview");
  });

  it("requests one stream only after start and protects repeated starts", async () => {
    const request = deferred<MediaStream>();
    const getUserMedia = installRecorderEnvironment(vi.fn(() => request.promise));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    expect(getUserMedia).not.toHaveBeenCalled();
    const start = hook.result.current.start();
    void hook.result.current.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
    request.resolve(new FakeStream() as unknown as MediaStream);
    await act(() => start);
    void hook.result.current.start();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(hook.result.current.phase).toBe("recording");
  });

  it.each([
    [new DOMException("denied", "NotAllowedError"), "Permita o acesso ao microfone para gravar o áudio."],
    [new DOMException("busy", "NotReadableError"), "O microfone está em uso. Feche outros aplicativos e tente novamente."],
    [new DOMException("missing", "NotFoundError"), "Nenhum microfone disponível foi encontrado."],
  ])("shows a safe Portuguese message for capture failures", async (failure, message) => {
    installRecorderEnvironment(vi.fn(async () => Promise.reject(failure)));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());

    expect(hook.result.current.phase).toBe("error");
    expect(hook.result.current.error).toBe(message);
  });

  it("derives elapsed time from the clock and stops at the exact maximum", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one", maximumDurationMs: MAXIMUM_DURATION_MS }));

    await act(() => hook.result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(12_250));
    expect(hook.result.current.durationMs).toBe(12_250);
    await act(() => vi.advanceTimersByTimeAsync(MAXIMUM_DURATION_MS - 12_250));

    expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
    expect(hook.result.current.recording?.durationMs).toBe(MAXIMUM_DURATION_MS);
  });

  it("stops tracks before creating the preview and returns a typed File with one UUID", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const createPreview = vi.spyOn(URL, "createObjectURL");
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());
    await act(() => hook.result.current.stop());

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(createPreview).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances[0]?.ondataavailable).toBeNull();
    expect(FakeMediaRecorder.instances[0]?.onstop).toBeNull();
    expect(FakeMediaRecorder.instances[0]?.onerror).toBeNull();
    expect(hook.result.current.recording).toMatchObject({ clientRequestId: "recording-id", previewUrl: "blob:preview" });
    expect(hook.result.current.recording?.file).toBeInstanceOf(File);
    expect(hook.result.current.recording?.file.type).toBe("audio/webm");
  });

  it("ignores a permission result that arrives after cancellation", async () => {
    const request = deferred<MediaStream>();
    installRecorderEnvironment(vi.fn(() => request.promise));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    const start = hook.result.current.start();
    act(() => hook.result.current.cancel());
    const lateStream = new FakeStream();
    request.resolve(lateStream as unknown as MediaStream);
    await act(() => start);

    expect(lateStream.track.stop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(hook.result.current.phase).toBe("idle");
  });

  it("ignores recorder callbacks from a canceled capture", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());
    const recorder = FakeMediaRecorder.instances[0]!;
    act(() => hook.result.current.cancel());
    act(() => recorder.emitStop());

    expect(hook.result.current.recording).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("maps interrupted capture to a safe Portuguese error", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());
    act(() => FakeMediaRecorder.instances[0]?.emitError(new DOMException("ended", "AbortError")));

    expect(hook.result.current.phase).toBe("error");
    expect(hook.result.current.error).toBe("A gravação foi interrompida. Tente novamente.");
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it("rejects zero-byte and unsupported final blobs without creating a preview", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const hook = renderHook(() => useAudioRecorder({ scopeKey: "one" }));

    await act(() => hook.result.current.start());
    FakeMediaRecorder.finalBlob = new Blob([], { type: "audio/webm" });
    await act(() => hook.result.current.stop());
    expect(hook.result.current.recording).toBeNull();
    expect(hook.result.current.error).toBe("Não foi possível preparar o áudio gravado.");

    await act(() => hook.result.current.start());
    FakeMediaRecorder.finalBlob = new Blob([new Uint8Array((16 * 1024 * 1024) + 1)], { type: "audio/webm" });
    await act(() => hook.result.current.stop());
    expect(hook.result.current.recording).toBeNull();

    await act(() => hook.result.current.start());
    FakeMediaRecorder.finalBlob = new Blob(["audio"], { type: "audio/wav" });
    await act(() => hook.result.current.stop());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("error");
  });

  it("releases owned resources exactly once on discard, scope change, and unmount", async () => {
    const stream = new FakeStream();
    installRecorderEnvironment(vi.fn(async () => stream as unknown as MediaStream));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const hook = renderHook(({ scopeKey }) => useAudioRecorder({ scopeKey }), { initialProps: { scopeKey: "one" } });

    await act(() => hook.result.current.start());
    await act(() => hook.result.current.stop());
    act(() => hook.result.current.discard());
    act(() => hook.result.current.discard());
    expect(revoke).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.start());
    await act(() => hook.result.current.stop());
    hook.rerender({ scopeKey: "two" });
    expect(revoke).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
