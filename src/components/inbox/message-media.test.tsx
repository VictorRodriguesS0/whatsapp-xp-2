import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxMessage } from "@/hooks/use-inbox";

import { MessageMedia } from "./message-media";

const baseMessage: InboxMessage = {
  id: "40000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "AUDIO",
  body: null,
  mediaObjectId: "50000000-0000-4000-8000-000000000001",
  mediaState: {
    status: "PENDING",
    nextAttemptAt: "2026-08-21T15:00:01.000Z",
    canRetry: false,
  },
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  externalTimestamp: "2026-08-21T15:00:00.000Z",
  createdAt: "2026-08-21T15:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MessageMedia", () => {
  it("does not steal focus when pending media first renders", () => {
    const outsideControl = document.createElement("button");
    document.body.append(outsideControl);
    outsideControl.focus();

    render(<MessageMedia message={baseMessage} />);

    expect(outsideControl).toHaveFocus();
    outsideControl.remove();
  });

  it("shows an accessible pending audio state without a misleading player and recovers at the scheduled time once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: baseMessage.mediaState, error: null })),
    );
    const view = render(<MessageMedia message={baseMessage} />);

    expect(screen.getByRole("status")).toHaveTextContent("Baixando áudio");
    expect(view.container.querySelector("audio")).toBeNull();
    act(() => vi.advanceTimersByTime(999));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/${baseMessage.mediaObjectId}/recover`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ manual: false }),
        signal: expect.any(AbortSignal),
      }),
    );

    view.rerender(<MessageMedia message={{ ...baseMessage }} />);
    await act(async () => vi.runAllTimersAsync());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("renders the existing player only after media becomes available", () => {
    const { container } = render(
      <MessageMedia
        message={{
          ...baseMessage,
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
    expect(container.querySelector("audio")).toHaveAttribute("aria-label", "Reproduzir áudio");
  });

  it("uses a pending recovery response to schedule the next bounded attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "PENDING", nextAttemptAt: "2026-08-21T15:00:03.000Z", canRetry: false },
        error: null,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })));
    const view = render(<MessageMedia message={baseMessage} />);

    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(fetchMock).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1_999));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
  });

  it("does not spend an automatic attempt when an effect restart aborts its request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const signals: AbortSignal[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    const view = render(<MessageMedia message={baseMessage} />);
    await act(async () => vi.runOnlyPendingTimersAsync());

    view.rerender(<MessageMedia message={{
      ...baseMessage,
      mediaState: { ...baseMessage.mediaState!, canRetry: true },
    }} />);
    await act(async () => vi.runOnlyPendingTimersAsync());

    expect(signals[0].aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reconciles a successful manual retry response while waiting for realtime", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { status: "PENDING", nextAttemptAt: "2099-08-21T15:00:00.000Z", canRetry: false },
      error: null,
    })));
    const view = render(<MessageMedia message={{
      ...baseMessage,
      mediaState: { status: "FAILED", nextAttemptAt: null, canRetry: true },
    }} />);

    const retry = screen.getByRole("button", { name: "Tentar novamente" });
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Baixando áudio"));
    expect(screen.getByRole("status")).toHaveFocus();
    expect(view.container.querySelector("audio")).toBeNull();
  });

  it("offers a 44px manual retry, sends manual semantics, restores focus, and hides server details", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Graph OAuthException 190 /var/media/token" }), { status: 502 }),
    );
    render(
      <MessageMedia
        message={{
          ...baseMessage,
          mediaState: { status: "FAILED", nextAttemptAt: null, canRetry: true },
        }}
      />,
    );

    const retry = screen.getByRole("button", { name: "Tentar novamente" });
    expect(retry).toHaveClass("min-h-11");
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/${baseMessage.mediaObjectId}/recover`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ manual: true }) }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Graph|OAuthException|190|var|token/i);
    expect(retry).toHaveFocus();
  });

  it("aborts automatic recovery when the message changes and cancels future work on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    let recoverySignal: AbortSignal | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      recoverySignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const view = render(<MessageMedia message={baseMessage} />);

    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(fetchMock).toHaveBeenCalledOnce();
    view.rerender(
      <MessageMedia
        message={{
          ...baseMessage,
          mediaObjectId: "50000000-0000-4000-8000-000000000002",
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );
    expect(recoverySignal?.aborted).toBe(true);

    view.rerender(
      <MessageMedia
        message={{
          ...baseMessage,
          mediaObjectId: "50000000-0000-4000-8000-000000000003",
          mediaState: {
            status: "PENDING",
            nextAttemptAt: "2026-08-21T15:01:01.000Z",
            canRetry: false,
          },
        }}
      />,
    );
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
