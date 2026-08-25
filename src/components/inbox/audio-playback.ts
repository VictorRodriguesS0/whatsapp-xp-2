"use client";

export type AudioPlaybackSpeed = 1 | 1.5 | 2;

const playbackSpeeds = [1, 1.5, 2] as const;
const playbackSpeedStorageKey = "xp-audio-playback-speed-v1";
const speedListeners = new Set<(speed: AudioPlaybackSpeed) => void>();

let activeAudio: HTMLAudioElement | null = null;

function isAudioPlaybackSpeed(value: number): value is AudioPlaybackSpeed {
  return playbackSpeeds.includes(value as AudioPlaybackSpeed);
}

function defaultReadStorage(): Pick<Storage, "getItem"> | undefined {
  return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
}

function defaultWriteStorage(): Pick<Storage, "setItem"> | undefined {
  return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
}

export function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—:—";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function nextAudioPlaybackSpeed(speed: AudioPlaybackSpeed): AudioPlaybackSpeed {
  return playbackSpeeds[(playbackSpeeds.indexOf(speed) + 1) % playbackSpeeds.length]!;
}

export function readAudioPlaybackSpeed(storage = defaultReadStorage()): AudioPlaybackSpeed {
  try {
    const value = Number(storage?.getItem(playbackSpeedStorageKey));
    return isAudioPlaybackSpeed(value) ? value : 1;
  } catch {
    return 1;
  }
}

export function setAudioPlaybackSpeed(
  speed: AudioPlaybackSpeed,
  storage = defaultWriteStorage(),
) {
  try {
    storage?.setItem(playbackSpeedStorageKey, String(speed));
  } catch {
    // A blocked sessionStorage must not disable audio playback.
  }
  for (const listener of [...speedListeners]) listener(speed);
}

export function subscribeAudioPlaybackSpeed(listener: (speed: AudioPlaybackSpeed) => void) {
  speedListeners.add(listener);
  return () => {
    speedListeners.delete(listener);
  };
}

export function claimAudioPlayback(element: HTMLAudioElement) {
  if (activeAudio && activeAudio !== element) activeAudio.pause();
  activeAudio = element;
}

export function releaseAudioPlayback(element: HTMLAudioElement) {
  if (activeAudio === element) activeAudio = null;
}
