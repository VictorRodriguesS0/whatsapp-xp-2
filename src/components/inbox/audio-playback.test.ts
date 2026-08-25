import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimAudioPlayback,
  formatAudioTime,
  nextAudioPlaybackSpeed,
  readAudioPlaybackSpeed,
  releaseAudioPlayback,
  setAudioPlaybackSpeed,
  subscribeAudioPlaybackSpeed,
} from "./audio-playback";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function audioElement() {
  const element = document.createElement("audio");
  const pause = vi.fn();
  Object.defineProperty(element, "pause", { configurable: true, value: pause });
  return { element, pause };
}

describe("audio playback helpers", () => {
  it.each([
    [0, "0:00"],
    [5.9, "0:05"],
    [65.9, "1:05"],
    [3_661, "1:01:01"],
    [-1, "—:—"],
    [Number.NaN, "—:—"],
    [Number.POSITIVE_INFINITY, "—:—"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatAudioTime(seconds)).toBe(expected);
  });

  it("cycles only through the approved speeds", () => {
    expect(nextAudioPlaybackSpeed(1)).toBe(1.5);
    expect(nextAudioPlaybackSpeed(1.5)).toBe(2);
    expect(nextAudioPlaybackSpeed(2)).toBe(1);
  });

  it("reads and writes the playback speed for the current session", () => {
    expect(readAudioPlaybackSpeed()).toBe(1);

    setAudioPlaybackSpeed(1.5);

    expect(sessionStorage.getItem("xp-audio-playback-speed-v1")).toBe("1.5");
    expect(readAudioPlaybackSpeed()).toBe(1.5);
  });

  it("falls back safely when session storage is corrupt or blocked", () => {
    expect(readAudioPlaybackSpeed({ getItem: () => "9" })).toBe(1);
    expect(readAudioPlaybackSpeed({ getItem: () => { throw new Error("blocked"); } })).toBe(1);
    expect(() => setAudioPlaybackSpeed(2, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("notifies mounted players when the preference changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioPlaybackSpeed(listener);

    setAudioPlaybackSpeed(2);
    unsubscribe();
    setAudioPlaybackSpeed(1.5);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(2);
  });
});

describe("audio playback coordinator", () => {
  it("pauses the previous owner and never pauses the claimant", () => {
    const first = audioElement();
    const second = audioElement();

    claimAudioPlayback(first.element);
    claimAudioPlayback(second.element);

    expect(first.pause).toHaveBeenCalledOnce();
    expect(second.pause).not.toHaveBeenCalled();
    releaseAudioPlayback(second.element);
  });

  it("keeps the current owner when a stale element releases itself", () => {
    const first = audioElement();
    const second = audioElement();

    claimAudioPlayback(first.element);
    claimAudioPlayback(second.element);
    releaseAudioPlayback(first.element);
    claimAudioPlayback(first.element);

    expect(second.pause).toHaveBeenCalledOnce();
    releaseAudioPlayback(first.element);
  });

  it("allows the released owner to be claimed again without pausing itself", () => {
    const audio = audioElement();

    claimAudioPlayback(audio.element);
    releaseAudioPlayback(audio.element);
    claimAudioPlayback(audio.element);

    expect(audio.pause).not.toHaveBeenCalled();
    releaseAudioPlayback(audio.element);
  });
});
