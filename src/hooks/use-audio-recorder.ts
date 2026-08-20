"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MAXIMUM_DURATION_MS = 300_000;
const MAXIMUM_RECORDING_BYTES = 16 * 1024 * 1024;
const TICK_INTERVAL_MS = 250;
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"] as const;
const ALLOWED_MIME_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);

export type AudioRecording = {
  clientRequestId: string;
  durationMs: number;
  file: File;
  previewUrl: string;
};

export type AudioRecorderPhase = "idle" | "requesting" | "recording" | "preview" | "error";

type RecorderErrorEvent = Event & { error?: unknown };

function mimeEssence(value: string) {
  return value.trim().toLowerCase().split(";", 1)[0] ?? "";
}

function isCaptureSupported() {
  return typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined";
}

function captureErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permita o acesso ao microfone para gravar o áudio.";
  }
  if (name === "NotReadableError") {
    return "O microfone está em uso. Feche outros aplicativos e tente novamente.";
  }
  if (name === "NotFoundError") return "Nenhum microfone disponível foi encontrado.";
  return "Não foi possível acessar o microfone. Tente novamente.";
}

function recordingFilename(mimeType: string) {
  if (mimeType === "audio/ogg") return "gravacao.ogg";
  if (mimeType === "audio/mp4") return "gravacao.m4a";
  return "gravacao.webm";
}

export function useAudioRecorder(options: { scopeKey: string; maximumDurationMs?: number }) {
  const maximumDurationMs = Math.min(
    DEFAULT_MAXIMUM_DURATION_MS,
    Math.max(1, Math.floor(options.maximumDurationMs ?? DEFAULT_MAXIMUM_DURATION_MS)),
  );
  const [phase, setPhaseState] = useState<AudioRecorderPhase>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const phaseRef = useRef<AudioRecorderPhase>("idle");
  const generationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const setPhase = useCallback((next: AudioRecorderPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhaseState(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (tickTimerRef.current !== null) clearInterval(tickTimerRef.current);
    if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current);
    tickTimerRef.current = null;
    stopTimerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
  }, []);

  const releasePreview = useCallback(() => {
    const previewUrl = previewUrlRef.current;
    previewUrlRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, []);

  const resetState = useCallback((nextPhase: AudioRecorderPhase = "idle", nextError: string | null = null) => {
    if (!mountedRef.current) return;
    setDurationMs(0);
    setRecording(null);
    setError(nextError);
    setPhase(nextPhase);
  }, [setPhase]);

  const abandonCapture = useCallback((nextPhase: AudioRecorderPhase = "idle", nextError: string | null = null) => {
    generationRef.current += 1;
    clearTimers();
    startedAtRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    chunksRef.current = [];
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // The capture is already being released below.
      }
    }
    releaseStream();
    resetState(nextPhase, nextError);
  }, [clearTimers, releaseStream, resetState]);

  const discard = useCallback(() => {
    abandonCapture();
    releasePreview();
  }, [abandonCapture, releasePreview]);

  const stop = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    const recorder = recorderRef.current;
    clearTimers();
    if (!recorder) {
      abandonCapture("error", "A gravação foi interrompida. Tente novamente.");
      return;
    }
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      abandonCapture("error", "A gravação foi interrompida. Tente novamente.");
    }
  }, [abandonCapture, clearTimers]);

  const start = useCallback(async () => {
    if (phaseRef.current === "requesting" || phaseRef.current === "recording") return;
    if (!isCaptureSupported()) {
      resetState("error", "A gravação de áudio não é compatível com este navegador.");
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearTimers();
    chunksRef.current = [];
    setDurationMs(0);
    setRecording(null);
    setError(null);
    setPhase("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (captureError) {
      if (generation === generationRef.current) resetState("error", captureErrorMessage(captureError));
      return;
    }

    if (generation !== generationRef.current || !mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    streamRef.current = stream;
    const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
    } catch {
      releaseStream();
      resetState("error", "Não foi possível iniciar a gravação de áudio.");
      return;
    }

    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (generation !== generationRef.current || !event.data || event.data.size === 0) return;
      chunksRef.current.push(event.data);
    };
    recorder.onerror = (_event: RecorderErrorEvent) => {
      if (generation !== generationRef.current) return;
      abandonCapture("error", "A gravação foi interrompida. Tente novamente.");
    };
    recorder.onstop = () => {
      if (generation !== generationRef.current || !mountedRef.current) return;
      const startedAt = startedAtRef.current;
      const elapsed = startedAt === null
        ? 0
        : Math.min(Math.max(0, Date.now() - startedAt), maximumDurationMs);
      clearTimers();
      startedAtRef.current = null;
      recorderRef.current = null;
      releaseStream();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0]?.type || "" });
      chunksRef.current = [];
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      const mimeType = blob.type;
      const type = mimeEssence(mimeType);
      if (blob.size === 0 || blob.size > MAXIMUM_RECORDING_BYTES || !ALLOWED_MIME_TYPES.has(type)) {
        resetState("error", "Não foi possível preparar o áudio gravado.");
        return;
      }
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      const file = new File([blob], recordingFilename(type), { type: mimeType });
      setDurationMs(elapsed);
      setRecording({
        clientRequestId: crypto.randomUUID(),
        durationMs: elapsed,
        file,
        previewUrl,
      });
      setError(null);
      setPhase("preview");
    };

    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    tickTimerRef.current = setInterval(() => {
      if (generation !== generationRef.current || !mountedRef.current) return;
      setDurationMs(Math.min(Math.max(0, Date.now() - startedAt), maximumDurationMs));
    }, TICK_INTERVAL_MS);
    stopTimerRef.current = setTimeout(() => {
      if (generation === generationRef.current) stop();
    }, maximumDurationMs);
    try {
      recorder.start();
      setPhase("recording");
    } catch {
      abandonCapture("error", "Não foi possível iniciar a gravação de áudio.");
    }
  }, [abandonCapture, clearTimers, maximumDurationMs, releaseStream, resetState, setPhase, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abandonCapture();
      releasePreview();
    };
  }, [abandonCapture, releasePreview, options.scopeKey]);

  return {
    phase,
    supported: isCaptureSupported(),
    durationMs,
    recording,
    error,
    start,
    stop,
    cancel: discard,
    discard,
  };
}
