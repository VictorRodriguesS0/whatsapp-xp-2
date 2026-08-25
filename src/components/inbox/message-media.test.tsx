import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxMessage } from "@/hooks/use-inbox";

import { MessageMedia } from "./message-media";

const baseMessage: InboxMessage = {
  id: "40000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "AUDIO",
  body: null,
  content: null,
  canReply: false,
  replyTo: null,
  mediaObjectId: "50000000-0000-4000-8000-000000000001",
  mediaState: {
    status: "PENDING",
    nextAttemptAt: "2026-08-21T15:00:01.000Z",
    canRetry: false,
  },
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  revokedAt: null,
  reactions: [],
  externalTimestamp: "2026-08-21T15:00:00.000Z",
  createdAt: "2026-08-21T15:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MessageMedia", () => {
  it.each([
    ["IMAGE", "image/jpeg", "Abrir imagem"],
    ["VIDEO", "video/mp4", "Abrir vídeo"],
  ] as const)("opens an available %s through an accessible trigger", (type, mediaMimeType, label) => {
    const onOpenMedia = vi.fn();
    render(<MessageMedia
      message={{
        ...baseMessage,
        type,
        mediaMimeType,
        mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
      }}
      onOpenMedia={onOpenMedia}
    />);

    const trigger = screen.getByRole("button", { name: label });
    fireEvent.click(trigger);

    expect(onOpenMedia).toHaveBeenCalledOnce();
    expect(onOpenMedia).toHaveBeenCalledWith(baseMessage.id);
    expect(trigger).toHaveFocus();
  });

  it.each(["INBOUND", "OUTBOUND"] as const)("previews an available %s PDF in its opening action", (direction) => {
    const onOpenMedia = vi.fn();
    render(<MessageMedia
      message={{
        ...baseMessage,
        direction,
        type: "DOCUMENT",
        body: "Nota fiscal.pdf",
        mediaMimeType: "application/pdf",
        mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
      }}
      onOpenMedia={onOpenMedia}
    />);

    const preview = screen.getByRole("img", { name: "Prévia da primeira página de Nota fiscal.pdf" });
    expect(preview).toHaveAttribute("src", `/api/media/${baseMessage.mediaObjectId}/thumbnail`);
    const trigger = screen.getByRole("button", { name: "Abrir PDF Nota fiscal.pdf" });
    fireEvent.click(trigger);

    expect(onOpenMedia).toHaveBeenCalledWith(baseMessage.id);
    expect(trigger).toHaveFocus();
  });

  it("keeps a non-PDF document as a direct download", () => {
    render(<MessageMedia
      message={{
        ...baseMessage,
        type: "DOCUMENT",
        mediaMimeType: "application/zip",
        mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
      }}
      onOpenMedia={vi.fn()}
    />);

    expect(screen.queryByRole("button", { name: "Abrir PDF" })).toBeNull();
    const download = screen.getByRole("link", { name: "Baixar documento" });
    expect(download).toHaveAttribute("download");
    expect(download).toHaveClass("bg-[var(--media-surface)]", "hover:bg-[var(--media-surface-hover)]");
  });

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
      new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })),
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

  it.each([
    ["network rejection", () => Promise.reject(new TypeError("network unavailable"))],
    ["HTTP 408", () => Promise.resolve(new Response(JSON.stringify({ error: "timeout" }), { status: 408 }))],
    ["HTTP 429", () => Promise.resolve(new Response(JSON.stringify({ error: "limited" }), { status: 429 }))],
    ["HTTP 503", () => Promise.resolve(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))],
  ])("rearms automatic recovery with backoff after a %s", async (_case, failRequest) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(failRequest)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })));

    const view = render(<MessageMedia message={baseMessage} />);
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not rearm permanent HTTP %s and replaces the spinner with a safe retry action",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ error: `private server detail ${status}` }), { status }),
      ));

      render(<MessageMedia message={baseMessage} />);
      await act(async () => Promise.resolve());
      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(screen.queryByText("Baixando áudio")).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");
      expect(screen.getByRole("alert")).not.toHaveTextContent(/private|server|detail|400|401|403|404|409|422/i);
      expect(screen.getByRole("button", { name: "Tentar novamente" })).toHaveClass("min-h-11");
    },
  );

  it("preserves a permanent-error action when only canRetry changes for the same automatic attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    const view = render(<MessageMedia message={baseMessage} />);

    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");

    view.rerender(<MessageMedia message={{
      ...baseMessage,
      mediaState: { ...baseMessage.mediaState!, canRetry: true },
    }} />);
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByText("Baixando áudio")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("clears a permanent-error action and retries when nextAttemptAt changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })));
    const view = render(<MessageMedia message={baseMessage} />);

    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");

    view.rerender(<MessageMedia message={{
      ...baseMessage,
      mediaState: { status: "PENDING", nextAttemptAt: "2026-08-21T15:00:03.000Z", canRetry: true },
    }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Baixando áudio");
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
  });

  it("clears a permanent-error action and retries when the media identity changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })));
    const nextMediaId = "50000000-0000-4000-8000-000000000002";
    const view = render(<MessageMedia message={baseMessage} />);

    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível baixar a mídia.");

    view.rerender(<MessageMedia message={{ ...baseMessage, mediaObjectId: nextMediaId }} />);
    await act(async () => Promise.resolve());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.querySelector("audio")).toHaveAttribute("src", `/api/media/${nextMediaId}`);
  });

  it("rearms without a hot loop when the server returns the same due PENDING state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: baseMessage.mediaState, error: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        error: null,
      })));

    const view = render(<MessageMedia message={baseMessage} />);
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector("audio")).toBeInTheDocument();
  });

  it("caps repeated transport-failure rearming at thirty seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T15:00:01.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    render(<MessageMedia message={baseMessage} />);
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledOnce();

    for (const expectedDelay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      const previousCalls = fetchMock.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(expectedDelay - 1));
      expect(fetchMock).toHaveBeenCalledTimes(previousCalls);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(fetchMock).toHaveBeenCalledTimes(previousCalls + 1);
    }
  });

  it("calls the server once to finalize a fifth PENDING attempt with no nextAttemptAt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { status: "FAILED", nextAttemptAt: null, canRetry: true },
      error: null,
    })));

    render(<MessageMedia message={{
      ...baseMessage,
      mediaState: { status: "PENDING", nextAttemptAt: null, canRetry: false },
    }} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it.each(["INBOUND", "OUTBOUND"] as const)("renders the controlled %s player only after media becomes available", (direction) => {
    const { container } = render(
      <MessageMedia
        message={{
          ...baseMessage,
          direction,
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
    expect(container.querySelector("audio")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Reproduzir áudio" })).toBeVisible();
    expect(container.querySelector(`[data-audio-player="${baseMessage.id}:${baseMessage.mediaObjectId}"]`)).toBeInTheDocument();
  });

  it("renders an available sticker from the authenticated route", () => {
    render(
      <MessageMedia
        message={{
          ...baseMessage,
          type: "STICKER",
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );

    expect(screen.getByRole("img", { name: "Figurinha" })).toHaveAttribute(
      "src",
      `/api/media/${baseMessage.mediaObjectId}`,
    );
  });

  it("uses sticker-specific pending and failed copy", () => {
    const view = render(<MessageMedia message={{ ...baseMessage, type: "STICKER" }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Baixando figurinha");
    view.rerender(
      <MessageMedia
        message={{
          ...baseMessage,
          type: "STICKER",
          mediaState: { status: "FAILED", nextAttemptAt: null, canRetry: false },
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Figurinha indisponível");
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
