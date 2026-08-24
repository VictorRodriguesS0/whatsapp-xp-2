import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import type { AudioRecorderPhase, AudioRecording } from "@/hooks/use-audio-recorder";

import { MessageComposer } from "./message-composer";

const recorder = vi.hoisted(() => ({
  phase: "idle" as AudioRecorderPhase,
  supported: true,
  durationMs: 0,
  recording: null as AudioRecording | null,
  error: null as string | null,
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
}));
const useAudioRecorderMock = vi.hoisted(() => vi.fn(() => recorder));

vi.mock("@/hooks/use-audio-recorder", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-audio-recorder")>();
  return { ...original, useAudioRecorder: useAudioRecorderMock };
});

function props(overrides: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  return {
    conversationId: "conversation-one",
    onSendMedia: vi.fn().mockResolvedValue(null),
    onSendRecording: vi.fn().mockResolvedValue(null),
    onSendText: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function previewRecording(): AudioRecording {
  return {
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    durationMs: 65_000,
    file: new File(["voice"], "gravacao.webm", { type: "audio/webm" }),
    previewUrl: "blob:recording",
  };
}

describe("MessageComposer", () => {
  const reply = {
    available: true as const,
    messageId: "11111111-1111-4111-8111-111111111111",
    direction: "INBOUND" as const,
    type: "TEXT" as const,
    author: "Cliente",
    summary: "Tem esse produto?",
  };

  beforeEach(() => {
    recorder.phase = "idle";
    recorder.supported = true;
    recorder.durationMs = 0;
    recorder.recording = null;
    recorder.error = null;
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { quickReplies: [] }, error: null })));
  });

  it("keeps the composer keyboard-safe with stable safe-area and compact-width hooks", () => {
    const { container } = render(<MessageComposer {...props()} />);
    const composer = screen.getByTestId("message-composer");
    const styles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

    expect(composer).toHaveClass("message-composer", "relative");
    expect(composer.querySelector(".message-composer__row")).toBeTruthy();
    expect(screen.getByLabelText("Mensagem")).toHaveClass(
      "message-composer__field",
      "min-w-0",
      "bg-[var(--surface-elevated)]",
    );
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toHaveClass("min-h-11", "min-w-11");
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveClass("min-h-11", "min-w-11");
    expect(styles).toContain(".message-composer {");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain(".message-composer__field { min-width: 0;");
    expect(container.querySelector(".message-composer__state")).toBeNull();
  });

  it("filters shared quick replies and inserts the selected text without sending", async () => {
    const sendText = vi.fn().mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { quickReplies: [
      { id: "1", shortcut: "horario", message: "Atendemos das 9h às 17h30.", position: 10, active: true },
      { id: "2", shortcut: "pix", message: "Nossa chave é 123.", position: 20, active: true },
    ] }, error: null })));
    render(<MessageComposer {...props({ onSendText: sendText })} />);
    const message = screen.getByLabelText("Mensagem");
    fireEvent.change(message, { target: { value: "/17h" } });
    expect(await screen.findByRole("option", { name: /horario/i })).toBeVisible();
    expect(screen.queryByRole("option", { name: /pix/i })).not.toBeInTheDocument();
    fireEvent.keyDown(message, { key: "Enter" });
    expect(message).toHaveValue("Atendemos das 9h às 17h30.");
    expect(message).toHaveFocus();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("navigates suggestions with arrows, supports click, and dismisses with Escape", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { quickReplies: [
      { id: "1", shortcut: "endereco", message: "Estamos na Rua 1.", position: 10, active: true },
      { id: "2", shortcut: "horario", message: "Das 9h às 17h30.", position: 20, active: true },
    ] }, error: null })));
    render(<MessageComposer {...props()} />);
    const message = screen.getByLabelText("Mensagem");
    fireEvent.change(message, { target: { value: "/" } });
    await screen.findByRole("listbox", { name: "Respostas rápidas" });
    fireEvent.keyDown(message, { key: "ArrowDown" });
    fireEvent.keyDown(message, { key: "Enter" });
    expect(message).toHaveValue("Das 9h às 17h30.");
    fireEvent.change(message, { target: { value: "/end" } });
    await userEvent.click(await screen.findByRole("option", { name: /endereco/i }));
    expect(message).toHaveValue("Estamos na Rua 1.");
    fireEvent.change(message, { target: { value: "/" } });
    fireEvent.keyDown(message, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Respostas rápidas" })).not.toBeInTheDocument();
    expect(message).toHaveValue("/");
  });

  it("shows the quoted draft in idle and file states and sends the captured target", () => {
    const sendText = vi.fn().mockResolvedValue(null);
    const sendMedia = vi.fn().mockResolvedValue(null);
    const cancelReply = vi.fn();
    const rendered = render(<MessageComposer {...props({
      onCancelReply: cancelReply,
      onSendMedia: sendMedia,
      onSendText: sendText,
      replyTo: reply,
    })} />);

    expect(screen.getByText("Tem esse produto?")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Sim" } });
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
    expect(sendText).toHaveBeenCalledWith("Sim", reply.messageId);
    expect(cancelReply).toHaveBeenCalledOnce();

    cancelReply.mockClear();
    rendered.rerender(<MessageComposer {...props({
      onCancelReply: cancelReply,
      onSendMedia: sendMedia,
      onSendText: sendText,
      replyTo: reply,
    })} />);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["image"], "produto.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("Tem esse produto?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(sendMedia).toHaveBeenCalledWith(file, "", reply.messageId);
    expect(cancelReply).toHaveBeenCalledOnce();
  });

  it("keeps the quoted draft visible throughout recording and sends its target", async () => {
    const cancelReply = vi.fn();
    const sendRecording = vi.fn().mockResolvedValue({ id: "sent" });
    recorder.phase = "requesting";
    const rendered = render(<MessageComposer {...props({
      onCancelReply: cancelReply,
      onSendRecording: sendRecording,
      replyTo: reply,
    })} />);
    expect(screen.getByText("Tem esse produto?")).toBeVisible();

    recorder.phase = "recording";
    rendered.rerender(<MessageComposer {...props({
      onCancelReply: cancelReply,
      onSendRecording: sendRecording,
      replyTo: reply,
    })} />);
    expect(screen.getByText("Tem esse produto?")).toBeVisible();

    recorder.phase = "preview";
    recorder.recording = previewRecording();
    rendered.rerender(<MessageComposer {...props({
      onCancelReply: cancelReply,
      onSendRecording: sendRecording,
      replyTo: reply,
    })} />);
    expect(screen.getByText("Tem esse produto?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));

    await waitFor(() => expect(sendRecording).toHaveBeenCalledWith(
      recorder.recording!.file,
      recorder.recording!.clientRequestId,
      reply.messageId,
    ));
    expect(cancelReply).toHaveBeenCalledOnce();
  });

  it("lets quick replies consume Escape before cancelling the quoted draft", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { quickReplies: [
      { id: "1", shortcut: "horario", message: "Das 9h às 17h30.", position: 10, active: true },
    ] }, error: null })));
    const cancelReply = vi.fn();
    render(<MessageComposer {...props({ onCancelReply: cancelReply, replyTo: reply })} />);
    const message = screen.getByLabelText("Mensagem");
    fireEvent.change(message, { target: { value: "/" } });
    await screen.findByRole("listbox", { name: "Respostas rápidas" });

    fireEvent.keyDown(message, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Respostas rápidas" })).not.toBeInTheDocument();
    expect(cancelReply).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Escape" });
    expect(cancelReply).toHaveBeenCalledOnce();
  });

  it("renders a separate 44px cancel control for the quoted draft", () => {
    const cancelReply = vi.fn();
    render(<MessageComposer {...props({ onCancelReply: cancelReply, replyTo: reply })} />);

    const cancel = screen.getByRole("button", { name: "Cancelar resposta citada" });
    expect(cancel).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(cancel);
    expect(cancelReply).toHaveBeenCalledOnce();
  });

  it("keeps the composer usable and offers retry when the catalog fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(JSON.stringify({ data: { quickReplies: [] }, error: null })));
    const sendText = vi.fn().mockResolvedValue(null);
    render(<MessageComposer {...props({ onSendText: sendText })} />);
    expect(await screen.findByText("Respostas rápidas indisponíveis.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Mensagem normal" } });
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
    expect(sendText).toHaveBeenCalledWith("Mensagem normal");
    await userEvent.click(screen.getByRole("button", { name: "Tentar carregar respostas rápidas novamente" }));
    await waitFor(() => expect(screen.queryByText("Respostas rápidas indisponíveis.")).not.toBeInTheDocument());
  });

  it("sends text with Enter and preserves Shift+Enter for a new line", () => {
    const sendText = vi.fn().mockResolvedValue(null);
    render(<MessageComposer {...props({ onSendText: sendText })} />);
    const message = screen.getByLabelText("Mensagem");
    fireEvent.change(message, { target: { value: "Olá" } });
    fireEvent.keyDown(message, { key: "Enter", shiftKey: true });
    expect(sendText).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter" });
    expect(sendText).toHaveBeenCalledWith("Olá");
    expect(message).toHaveValue("");
  });

  it("previews an attachment and removes it without sending", () => {
    const sendMedia = vi.fn().mockResolvedValue(null);
    const { container } = render(<MessageComposer {...props({ onSendMedia: sendMedia })} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["pdf"], "pedido.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("pedido.pdf")).toBeVisible();
    expect(container.querySelector(".message-composer__state")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gravar áudio" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover anexo" }));
    expect(screen.queryByText("pedido.pdf")).not.toBeInTheDocument();
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("shows the microphone only for an empty composer and prevents repeated permission requests", async () => {
    const rendered = render(<MessageComposer {...props()} />);
    const microphone = screen.getByRole("button", { name: "Gravar áudio" });
    expect(microphone).toHaveClass("min-h-11");
    await userEvent.click(microphone);
    expect(recorder.start).toHaveBeenCalledOnce();

    recorder.phase = "requesting";
    rendered.rerender(<MessageComposer {...props()} />);
    expect(screen.getByRole("button", { name: "Solicitando acesso ao microfone" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Aguardando permissão do microfone")).toBeVisible();

    recorder.phase = "idle";
    rendered.rerender(<MessageComposer {...props()} />);
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "texto" } });
    expect(screen.queryByRole("button", { name: "Gravar áudio" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
  });

  it("shows a compact accessible recording row with a drift-free duration", () => {
    recorder.phase = "recording";
    recorder.durationMs = 65_999;
    render(<MessageComposer {...props()} />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Gravando áudio");
    expect(screen.getByRole("status")).not.toHaveTextContent("01:05");
    expect(screen.getByText("01:05")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("recording-status-dot")).toHaveClass("bg-[var(--danger)]");
    expect(screen.getByRole("button", { name: "Cancelar gravação" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Parar gravação" })).toHaveClass("min-h-11");
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });

  it("previews without a caption, restores focus on delete, and focuses preview after stop", async () => {
    recorder.phase = "recording";
    const rendered = render(<MessageComposer {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Parar gravação" }));
    expect(recorder.stop).toHaveBeenCalledOnce();

    recorder.phase = "preview";
    recorder.durationMs = 65_000;
    recorder.recording = previewRecording();
    rendered.rerender(<MessageComposer {...props()} />);
    const audio = screen.getByLabelText("Prévia da gravação");
    await waitFor(() => expect(audio).toHaveFocus());
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "metadata");
    expect(screen.getByText("01:05")).toBeVisible();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apagar gravação" }));
    expect(recorder.discard).toHaveBeenCalledOnce();
    recorder.phase = "idle";
    recorder.recording = null;
    rendered.rerender(<MessageComposer {...props()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveFocus());
  });

  it("discards only after a successful send and preserves preview after null or rejection", async () => {
    recorder.phase = "preview";
    recorder.durationMs = 65_000;
    recorder.recording = previewRecording();
    let resolveSend!: (value: unknown) => void;
    const onSendRecording = vi.fn(() => new Promise((resolve) => { resolveSend = resolve; }));
    const rendered = render(<MessageComposer {...props({ onSendRecording })} />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));
    expect(onSendRecording).toHaveBeenCalledWith(recorder.recording.file, recorder.recording.clientRequestId);
    expect(screen.getByRole("button", { name: "Enviando gravação" })).toBeDisabled();
    await act(async () => resolveSend(null));
    expect(recorder.discard).not.toHaveBeenCalled();

    const rejected = vi.fn().mockRejectedValue(new Error("offline"));
    rendered.rerender(<MessageComposer {...props({ onSendRecording: rejected })} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));
    await waitFor(() => expect(rejected).toHaveBeenCalledOnce());
    expect(recorder.discard).not.toHaveBeenCalled();

    const succeeded = vi.fn().mockResolvedValue({ id: "message" });
    rendered.rerender(<MessageComposer {...props({ onSendRecording: succeeded })} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar gravação" }));
    await waitFor(() => expect(recorder.discard).toHaveBeenCalledOnce());
  });

  it("cancels active capture when the conversation scope changes and obeys loading state", () => {
    recorder.phase = "recording";
    const rendered = render(<MessageComposer {...props({ disabled: true })} />);
    expect(screen.getByRole("button", { name: "Cancelar gravação" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Parar gravação" })).toBeDisabled();

    rendered.rerender(<MessageComposer {...props({ conversationId: "conversation-two" })} />);
    expect(useAudioRecorderMock).toHaveBeenLastCalledWith({ scopeKey: "conversation-two" });
    expect(recorder.cancel).toHaveBeenCalledOnce();
  });

  it("explains unsupported recording without blocking audio attachments", () => {
    recorder.supported = false;
    render(<MessageComposer {...props()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Este navegador não grava áudio. Você ainda pode anexar um arquivo de áudio.",
    );
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toBeEnabled();
  });

  it("clears a pending focus intent when the conversation changes", async () => {
    recorder.phase = "recording";
    const rendered = render(<MessageComposer {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Parar gravação" }));

    rendered.rerender(<MessageComposer {...props({ conversationId: "conversation-two" })} />);
    recorder.phase = "preview";
    recorder.recording = previewRecording();
    rendered.rerender(<MessageComposer {...props({ conversationId: "conversation-two" })} />);

    await waitFor(() => expect(screen.getByLabelText("Prévia da gravação")).not.toHaveFocus());
  });
});
