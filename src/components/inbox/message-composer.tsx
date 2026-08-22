"use client";

import { Mic, Paperclip, Send, Square, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import type { AvailableQuotedReplyDto } from "@/modules/messages/reply-context";

import { QuickReplyMenu, type QuickReplyOption } from "./quick-reply-menu";
import { QuotedReplyPreview } from "./quoted-reply-preview";

type MessageComposerProps = {
  conversationId: string;
  disabled?: boolean;
  replyTo?: AvailableQuotedReplyDto | null;
  onCancelReply?: () => void;
  onSendText: (body: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendMedia: (file: File, caption: string, replyToMessageId?: string | null) => Promise<unknown>;
  onSendRecording: (file: File, clientRequestId: string, replyToMessageId?: string | null) => Promise<unknown>;
};

function formatDuration(durationMs: number) {
  const seconds = Math.floor(Math.max(0, durationMs) / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MessageComposer({
  conversationId,
  disabled,
  replyTo = null,
  onCancelReply,
  onSendText,
  onSendMedia,
  onSendRecording,
}: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sendingRecording, setSendingRecording] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recorderReady, setRecorderReady] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([]);
  const [quickRepliesError, setQuickRepliesError] = useState(false);
  const [quickReplyDismissed, setQuickReplyDismissed] = useState(false);
  const [quickReplyIndex, setQuickReplyIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const microphoneRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const focusIntentRef = useRef<"microphone" | "preview" | null>(null);
  const previousConversationIdRef = useRef(conversationId);
  const scopeRef = useRef(conversationId);
  const recordingIdRef = useRef<string | null>(null);
  const recorder = useAudioRecorder({ scopeKey: conversationId });

  scopeRef.current = conversationId;
  recordingIdRef.current = recorder.recording?.clientRequestId ?? null;

  useEffect(() => setRecorderReady(true), []);

  const loadQuickReplies = useCallback(async () => {
    setQuickRepliesError(false);
    try {
      const response = await fetch("/api/quick-replies?active=true");
      if (!response.ok) throw new Error("request failed");
      const payload = await response.json() as { data?: { quickReplies?: unknown } };
      if (!Array.isArray(payload.data?.quickReplies)) throw new Error("invalid response");
      const items = payload.data.quickReplies.filter((value): value is QuickReplyOption => {
        if (!value || typeof value !== "object") return false;
        const item = value as Record<string, unknown>;
        return typeof item.id === "string" && typeof item.shortcut === "string" && typeof item.message === "string";
      });
      setQuickReplies(items);
    } catch {
      setQuickRepliesError(true);
    }
  }, []);

  useEffect(() => { void loadQuickReplies(); }, [loadQuickReplies]);

  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return;
    previousConversationIdRef.current = conversationId;
    focusIntentRef.current = null;
    if (recorder.phase !== "idle" && recorder.phase !== "error") recorder.cancel();
    setSendingRecording(false);
    setSendError(null);
    setBody("");
    setQuickReplyDismissed(false);
    setQuickReplyIndex(0);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [conversationId, recorder]);

  useLayoutEffect(() => {
    if (focusIntentRef.current === "microphone" && recorder.phase === "idle") {
      focusIntentRef.current = null;
      microphoneRef.current?.focus();
    }
    if (focusIntentRef.current === "preview" && recorder.phase === "preview") {
      focusIntentRef.current = null;
      previewRef.current?.focus();
    }
  }, [recorder.phase]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (file) {
      const selectedFile = file;
      const replyToMessageId = replyTo?.messageId ?? null;
      setFile(null);
      setBody("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      const operation = replyToMessageId
        ? onSendMedia(selectedFile, text, replyToMessageId)
        : onSendMedia(selectedFile, text);
      if (replyToMessageId) onCancelReply?.();
      void operation;
      return;
    }
    if (!text) return;
    const replyToMessageId = replyTo?.messageId ?? null;
    setBody("");
    const operation = replyToMessageId
      ? onSendText(text, replyToMessageId)
      : onSendText(text);
    if (replyToMessageId) onCancelReply?.();
    void operation;
  }

  function cancelRecording() {
    focusIntentRef.current = "microphone";
    setSendError(null);
    recorder.cancel();
  }

  function discardRecording() {
    focusIntentRef.current = "microphone";
    setSendError(null);
    recorder.discard();
  }

  function stopRecording() {
    focusIntentRef.current = "preview";
    recorder.stop();
  }

  async function sendRecording() {
    const recording = recorder.recording;
    if (!recording || sendingRecording || disabled) return;
    const scopeAtSend = conversationId;
    const requestIdAtSend = recording.clientRequestId;
    const replyToMessageId = replyTo?.messageId ?? null;
    setSendingRecording(true);
    setSendError(null);
    try {
      const operation = replyToMessageId
        ? onSendRecording(recording.file, recording.clientRequestId, replyToMessageId)
        : onSendRecording(recording.file, recording.clientRequestId);
      if (replyToMessageId) onCancelReply?.();
      const result = await operation;
      if (
        result
        && scopeRef.current === scopeAtSend
        && recordingIdRef.current === requestIdAtSend
      ) {
        focusIntentRef.current = "microphone";
        recorder.discard();
      }
    } catch {
      if (scopeRef.current === scopeAtSend && recordingIdRef.current === requestIdAtSend) {
        setSendError("Não foi possível enviar a gravação. Tente novamente.");
      }
    } finally {
      if (scopeRef.current === scopeAtSend) setSendingRecording(false);
    }
  }

  const unavailable = Boolean(disabled);
  const duration = formatDuration(recorder.recording?.durationMs ?? recorder.durationMs);
  const quickReplyQuery = body.startsWith("/") && !body.includes("\n") ? body.slice(1).trim().toLocaleLowerCase("pt-BR") : null;
  const filteredQuickReplies = useMemo(() => quickReplyQuery === null ? [] : quickReplies.filter((item) => {
    const shortcut = item.shortcut.toLocaleLowerCase("pt-BR");
    const message = item.message.toLocaleLowerCase("pt-BR");
    return shortcut.includes(quickReplyQuery) || message.includes(quickReplyQuery);
  }), [quickReplies, quickReplyQuery]);
  const quickReplyMenuOpen = !quickReplyDismissed && quickReplyQuery !== null && filteredQuickReplies.length > 0;

  function selectQuickReply(item: QuickReplyOption) {
    setBody(item.message);
    setQuickReplyDismissed(true);
    setQuickReplyIndex(0);
    textareaRef.current?.focus();
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (
      event.key !== "Escape" ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.defaultPrevented
    ) return;
    if (quickReplyMenuOpen) {
      event.preventDefault();
      event.stopPropagation();
      setQuickReplyDismissed(true);
      return;
    }
    if (replyTo && onCancelReply) {
      event.preventDefault();
      event.stopPropagation();
      onCancelReply();
    }
  }

  return (
    <form
      className="border-t border-[var(--border)] bg-[var(--panel)] p-3"
      onKeyDown={handleComposerKeyDown}
      onSubmit={submit}
    >
      {replyTo ? (
        <div className="mb-2">
          <QuotedReplyPreview onCancel={onCancelReply} reply={replyTo} />
        </div>
      ) : null}
      {recorder.phase === "requesting" ? (
        <div className="flex min-h-11 items-center gap-3" role="status" aria-live="polite">
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">Aguardando permissão do microfone</span>
          <Button aria-label="Solicitando acesso ao microfone" disabled className="min-h-11" size="icon" variant="ghost">
            <Mic aria-hidden="true" className="size-5" />
          </Button>
        </div>
      ) : null}

      {recorder.phase === "recording" ? (
        <div className="flex min-h-11 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--text)]">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--danger)]" data-testid="recording-status-dot" />
            <span aria-label="Gravando áudio" className="truncate" role="status" aria-live="polite">Gravando áudio</span>
            <span aria-hidden="true" className="font-mono tabular-nums">{duration}</span>
          </div>
          <Button aria-label="Cancelar gravação" className="min-h-11" disabled={unavailable} onClick={cancelRecording} size="icon" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
          <Button aria-label="Parar gravação" className="min-h-11" disabled={unavailable} onClick={stopRecording} size="icon">
            <Square aria-hidden="true" className="size-4 fill-current" />
          </Button>
        </div>
      ) : null}

      {recorder.phase === "preview" && recorder.recording ? (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <audio
              aria-label="Prévia da gravação"
              className="h-11 min-w-0 flex-1"
              controls
              preload="metadata"
              ref={previewRef}
              src={recorder.recording.previewUrl}
              tabIndex={0}
            />
            <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--muted)]">{duration}</span>
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button aria-label="Apagar gravação" className="min-h-11" disabled={unavailable || sendingRecording} onClick={discardRecording} size="icon" variant="ghost">
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
            <Button
              aria-label={sendingRecording ? "Enviando gravação" : "Enviar gravação"}
              className="min-h-11"
              disabled={unavailable || sendingRecording}
              onClick={() => void sendRecording()}
              size="icon"
            >
              <Send aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {sendingRecording ? "Enviando gravação" : "Gravação pronta para enviar"}
          </span>
        </div>
      ) : null}

      {recorder.phase !== "requesting" && recorder.phase !== "recording" && recorder.phase !== "preview" ? (
        <>
          {file ? (
            <div className="mb-2 flex min-h-11 items-center justify-between gap-3 rounded-md bg-[var(--canvas)] px-3">
              <span className="min-w-0 truncate text-sm text-[var(--text)]">{file.name}</span>
              <Button aria-label="Remover anexo" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
            </div>
          ) : null}
          {quickReplyMenuOpen ? <QuickReplyMenu activeIndex={Math.min(quickReplyIndex, filteredQuickReplies.length - 1)} items={filteredQuickReplies} onSelect={selectQuickReply} /> : null}
          <label className="sr-only" htmlFor="message-body">Mensagem</label>
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              accept="image/jpeg,image/png,audio/*,video/mp4,video/3gpp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              className="sr-only"
              disabled={disabled}
              id="message-file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <Button aria-label="Anexar arquivo" disabled={disabled} onClick={() => fileInputRef.current?.click()} size="icon" variant="ghost"><Paperclip aria-hidden="true" className="size-5" /></Button>
            <textarea
              aria-activedescendant={quickReplyMenuOpen ? `quick-reply-${filteredQuickReplies[Math.min(quickReplyIndex, filteredQuickReplies.length - 1)]?.id}` : undefined}
              className="min-h-11 max-h-36 flex-1 resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2.5 text-base text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
              disabled={disabled}
              id="message-body"
              onChange={(event) => { setBody(event.target.value); setQuickReplyDismissed(false); setQuickReplyIndex(0); }}
              onKeyDown={(event) => {
                if (quickReplyMenuOpen && event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuickReplyDismissed(true);
                  return;
                }
                if (quickReplyMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  setQuickReplyIndex((current) => (current + direction + filteredQuickReplies.length) % filteredQuickReplies.length);
                  return;
                }
                if (quickReplyMenuOpen && event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  selectQuickReply(filteredQuickReplies[Math.min(quickReplyIndex, filteredQuickReplies.length - 1)]!);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={file ? "Legenda (opcional)" : "Escreva uma mensagem"}
              ref={textareaRef}
              rows={1}
              value={body}
            />
            {!body.trim() && !file ? (
              <Button asChild className="min-h-11" size="icon">
                <button
                  aria-label="Gravar áudio"
                  disabled={disabled}
                  onClick={() => void recorder.start()}
                  ref={microphoneRef}
                  type="button"
                >
                  <Mic aria-hidden="true" className="size-5" />
                </button>
              </Button>
            ) : (
              <Button aria-label="Enviar mensagem" disabled={disabled || (!body.trim() && !file)} size="icon" type="submit"><Send aria-hidden="true" className="size-4" /></Button>
            )}
          </div>
        </>
      ) : null}

      {(recorderReady && !recorder.supported) || recorder.error || sendError ? (
        <p
          className={`mt-2 text-sm ${recorder.error || sendError ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
          role="status"
          aria-live="polite"
        >
          {sendError
            ?? (!recorder.supported
              ? "Este navegador não grava áudio. Você ainda pode anexar um arquivo de áudio."
              : recorder.error)}
        </p>
      ) : null}
      {quickRepliesError ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>Respostas rápidas indisponíveis.</span>
          <button aria-label="Tentar carregar respostas rápidas novamente" className="font-bold text-[var(--accent)] underline" onClick={() => void loadQuickReplies()} type="button">Tentar novamente</button>
        </div>
      ) : null}
    </form>
  );
}
