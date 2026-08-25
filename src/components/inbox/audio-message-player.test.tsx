import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioMessagePlayer } from "./audio-message-player";
import { releaseAudioPlayback } from "./audio-playback";

function mediaState(audio: HTMLAudioElement, input: { currentTime?: number; duration?: number; paused?: boolean } = {}) {
  let currentTime = input.currentTime ?? 0;
  let playbackRate = 1;
  Object.defineProperties(audio, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => { currentTime = value; },
    },
    duration: { configurable: true, value: input.duration ?? 37 },
    paused: { configurable: true, value: input.paused ?? true },
    playbackRate: {
      configurable: true,
      get: () => playbackRate,
      set: (value: number) => { playbackRate = value; },
    },
  });
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();
  Object.defineProperties(audio, {
    pause: { configurable: true, value: pause },
    play: { configurable: true, value: play },
  });
  return { getCurrentTime: () => currentTime, getPlaybackRate: () => playbackRate, pause, play };
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("AudioMessagePlayer", () => {
  it("shows real metadata and accessible WhatsApp-style controls", () => {
    const buttonRef = vi.fn();
    const view = render(<AudioMessagePlayer buttonRef={buttonRef} identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    mediaState(audio, { duration: 37 });

    fireEvent.loadedMetadata(audio);

    expect(audio).toHaveAttribute("preload", "metadata");
    expect(audio).toHaveAttribute("src", "/api/media/audio-1");
    expect(screen.getByText("0:00 / 0:37")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toHaveClass("min-h-11", "min-w-11");
    expect(screen.getByRole("slider", { name: "Posição do áudio" })).toHaveAttribute("max", "37");
    expect(screen.getByRole("button", { name: "Velocidade 1×; alterar para 1,5×" })).toHaveClass("min-h-11");
    expect(buttonRef).toHaveBeenCalledWith(screen.getByRole("button", { name: "Reproduzir áudio" }));
  });

  it("updates elapsed time and seeks within the real duration", () => {
    const view = render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    const state = mediaState(audio, { currentTime: 8, duration: 37 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    expect(screen.getByText("0:08 / 0:37")).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "Posição do áudio" }), { target: { value: "12" } });

    expect(state.getCurrentTime()).toBe(12);
    expect(screen.getByText("0:12 / 0:37")).toBeVisible();
  });

  it("keeps safe controls when duration metadata is invalid", () => {
    const view = render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    mediaState(audio, { duration: Number.POSITIVE_INFINITY });

    fireEvent.loadedMetadata(audio);

    expect(screen.getByText("0:00 / —:—")).toBeVisible();
    expect(screen.getByRole("slider", { name: "Posição do áudio" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toBeEnabled();
  });

  it("cycles, stores and applies the preferred speed", async () => {
    const view = render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    const state = mediaState(audio);
    fireEvent.loadedMetadata(audio);

    fireEvent.click(screen.getByRole("button", { name: "Velocidade 1×; alterar para 1,5×" }));
    expect(screen.getByRole("button", { name: "Velocidade 1,5×; alterar para 2×" })).toBeVisible();
    expect(sessionStorage.getItem("xp-audio-playback-speed-v1")).toBe("1.5");

    fireEvent.click(screen.getByRole("button", { name: "Reproduzir áudio" }));
    await waitFor(() => expect(state.play).toHaveBeenCalledOnce());
    expect(state.getPlaybackRate()).toBe(1.5);
  });

  it("pauses the previous message before starting another", async () => {
    const view = render(<>
      <AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />
      <AudioMessagePlayer identity="message-2" source="/api/media/audio-2" />
    </>);
    const [first, second] = [...view.container.querySelectorAll("audio")];
    const firstState = mediaState(first!);
    const secondState = mediaState(second!);

    fireEvent.click(screen.getAllByRole("button", { name: "Reproduzir áudio" })[0]!);
    await waitFor(() => expect(firstState.play).toHaveBeenCalledOnce());
    fireEvent.play(first!);
    fireEvent.click(view.container.querySelector('[data-audio-player="message-2"] button[aria-label="Reproduzir áudio"]')!);

    await waitFor(() => expect(secondState.play).toHaveBeenCalledOnce());
    expect(firstState.pause).toHaveBeenCalledOnce();
    releaseAudioPlayback(second!);
  });

  it("reflects native play, pause and ended states", () => {
    const view = render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    mediaState(audio, { currentTime: 37, duration: 37 });
    fireEvent.loadedMetadata(audio);

    fireEvent.play(audio);
    expect(screen.getByRole("button", { name: "Pausar áudio" })).toBeVisible();
    fireEvent.pause(audio);
    expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toBeVisible();
    fireEvent.ended(audio);
    expect(screen.getByText("0:37 / 0:37")).toBeVisible();
  });

  it("shows only a sanitized error when playback is rejected", async () => {
    const view = render(<AudioMessagePlayer identity="message-1" source="/api/media/audio-1" />);
    const audio = view.container.querySelector("audio")!;
    const state = mediaState(audio);
    state.play.mockRejectedValueOnce(new Error("private codec /var/media/token"));

    fireEvent.click(screen.getByRole("button", { name: "Reproduzir áudio" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível reproduzir este áudio.");
    expect(alert).not.toHaveTextContent(/codec|var|media|token|private/i);
    expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toBeVisible();
  });
});
