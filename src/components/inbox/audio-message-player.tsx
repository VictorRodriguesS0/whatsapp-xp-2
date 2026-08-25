"use client";

import { Pause, Play } from "lucide-react";
import type { CSSProperties, Ref } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  claimAudioPlayback,
  formatAudioTime,
  nextAudioPlaybackSpeed,
  readAudioPlaybackSpeed,
  releaseAudioPlayback,
  setAudioPlaybackSpeed,
  subscribeAudioPlaybackSpeed,
  type AudioPlaybackSpeed,
} from "./audio-playback";

const playbackError = "Não foi possível reproduzir este áudio.";

function validDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0;
}

function speedLabel(speed: AudioPlaybackSpeed) {
  return `${String(speed).replace(".", ",")}×`;
}

export function AudioMessagePlayer({
  source,
  identity,
  buttonRef,
}: {
  source: string;
  identity: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<AudioPlaybackSpeed>(() => readAudioPlaybackSpeed());
  const [error, setError] = useState<string | null>(null);
  const durationAvailable = validDuration(duration);
  const progress = durationAvailable ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const nextSpeed = nextAudioPlaybackSpeed(speed);

  useEffect(() => subscribeAudioPlaybackSpeed(setSpeed), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    setCurrentTime(0);
    setDuration(Number.NaN);
    setPlaying(false);
    setError(null);
    return () => {
      if (!audio) return;
      if (!audio.paused) audio.pause();
      releaseAudioPlayback(audio);
    };
  }, [identity, source]);

  const syncDuration = useCallback((audio: HTMLAudioElement) => {
    setDuration(validDuration(audio.duration) ? audio.duration : Number.NaN);
    setCurrentTime(Number.isFinite(audio.currentTime) && audio.currentTime >= 0 ? audio.currentTime : 0);
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (playing) {
      audio.pause();
      return;
    }
    if (validDuration(audio.duration) && audio.currentTime >= audio.duration) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
    claimAudioPlayback(audio);
    audio.playbackRate = speed;
    try {
      await audio.play();
    } catch {
      releaseAudioPlayback(audio);
      setPlaying(false);
      setError(playbackError);
    }
  }, [playing, speed]);

  const changeSpeed = useCallback(() => {
    const next = nextAudioPlaybackSpeed(speed);
    setAudioPlaybackSpeed(next);
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.playbackRate = next;
  }, [speed]);

  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio || !validDuration(audio.duration)) return;
    const next = Math.min(audio.duration, Math.max(0, value));
    audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  const railStyle = {
    backgroundImage: "repeating-linear-gradient(to right, color-mix(in srgb, var(--muted) 42%, transparent) 0 3px, transparent 3px 6px)",
  } satisfies CSSProperties;
  const progressStyle = {
    backgroundImage: "repeating-linear-gradient(to right, var(--accent) 0 3px, transparent 3px 6px)",
    width: `${progress}%`,
  } satisfies CSSProperties;

  return (
    <div className="w-[19rem] max-w-full" data-audio-player={identity}>
      <audio
        aria-hidden="true"
        className="hidden"
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onEnded={(event) => {
          setCurrentTime(Number.isFinite(event.currentTarget.currentTime) ? event.currentTarget.currentTime : 0);
          setPlaying(false);
          releaseAudioPlayback(event.currentTarget);
        }}
        onError={() => { setPlaying(false); setError(playbackError); }}
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onPause={(event) => { setPlaying(false); releaseAudioPlayback(event.currentTarget); }}
        onPlay={(event) => { claimAudioPlayback(event.currentTarget); setPlaying(true); setError(null); }}
        onTimeUpdate={(event) => {
          const value = event.currentTarget.currentTime;
          setCurrentTime(Number.isFinite(value) && value >= 0 ? value : 0);
        }}
        preload="metadata"
        ref={audioRef}
        src={source}
      />

      <div className="flex min-w-0 items-center gap-2">
        <button
          aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white outline-none transition-colors hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          onClick={() => void togglePlayback()}
          ref={buttonRef}
          type="button"
        >
          {playing ? <Pause aria-hidden="true" className="size-5 fill-current" /> : <Play aria-hidden="true" className="ml-0.5 size-5 fill-current" />}
        </button>

        <div className="relative h-11 min-w-0 flex-1 rounded-sm focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2 h-3 overflow-hidden" style={railStyle}>
            <div className="h-full transition-[width] duration-150 motion-reduce:transition-none" style={progressStyle} />
          </div>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 font-mono text-[11px] leading-none tabular-nums text-[var(--muted)]">
            {`${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`}
          </span>
          <input
            aria-label="Posição do áudio"
            aria-valuetext={`${formatAudioTime(currentTime)} de ${formatAudioTime(duration)}`}
            className="absolute inset-0 z-10 h-11 w-full cursor-pointer opacity-0 disabled:cursor-default"
            disabled={!durationAvailable}
            max={durationAvailable ? duration : 0}
            min={0}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            step="0.1"
            type="range"
            value={durationAvailable ? Math.min(currentTime, duration) : 0}
          />
        </div>

        <button
          aria-label={`Velocidade ${speedLabel(speed)}; alterar para ${speedLabel(nextSpeed)}`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums text-[var(--muted)] outline-none transition-colors hover:bg-black/5 hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] motion-reduce:transition-none"
          onClick={changeSpeed}
          type="button"
        >
          {speedLabel(speed)}
        </button>
      </div>

      {error ? <p className="mt-1 text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
    </div>
  );
}
