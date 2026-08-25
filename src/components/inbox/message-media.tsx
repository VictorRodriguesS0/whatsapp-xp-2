"use client";

import { FileText, ImageIcon, LoaderCircle, Play } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import type { MediaStateDto } from "@/modules/conversations/types";

import { AudioMessagePlayer } from "./audio-message-player";
import { PdfMessagePreview } from "./pdf-message-preview";

const MAX_TIMER_DELAY = 2_147_483_647;
const MAX_RECOVERY_REARM_DELAY = 30_000;
const recoveryError = "Não foi possível baixar a mídia.";

class RecoveryRequestError extends Error {
  constructor(readonly retryable: boolean) {
    super("Media recovery failed");
  }
}

const mediaNames = {
  IMAGE: "imagem",
  AUDIO: "áudio",
  VIDEO: "vídeo",
  DOCUMENT: "documento",
  STICKER: "figurinha",
} as const;

function isMediaMessageType(
  type: InboxMessage["type"],
): type is keyof typeof mediaNames {
  return type in mediaNames;
}

function mediaStateKey(state: MediaStateDto | null) {
  return state ? `${state.status}:${state.nextAttemptAt ?? "none"}:${state.canRetry}` : "none";
}

function recoveryRearmDelay(failureCount: number) {
  return Math.min(MAX_RECOVERY_REARM_DELAY, 1000 * 2 ** Math.max(0, Math.min(failureCount - 1, 5)));
}

function pendingRecoveryIsDue(state: MediaStateDto, now: number) {
  if (state.status !== "PENDING") return false;
  if (state.nextAttemptAt === null) return true;
  const timestamp = Date.parse(state.nextAttemptAt);
  return !Number.isNaN(timestamp) && timestamp <= now;
}

async function requestRecovery(mediaId: string, manual: boolean, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manual }),
      signal,
    });
  } catch {
    throw new RecoveryRequestError(true);
  }
  if (!response.ok) {
    throw new RecoveryRequestError(
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  let payload: { data?: MediaStateDto | null };
  try {
    payload = (await response.json()) as { data?: MediaStateDto | null };
  } catch {
    throw new RecoveryRequestError(false);
  }
  if (!payload.data) throw new RecoveryRequestError(false);
  return payload.data;
}

export function MessageMedia({
  message,
  onOpenMedia,
}: {
  message: InboxMessage;
  onOpenMedia?: (messageId: string) => void;
}) {
  const [manualRequestKey, setManualRequestKey] = useState<string | null>(null);
  const [manualError, setManualError] = useState<{ key: string; message: string } | null>(null);
  const [automaticError, setAutomaticError] = useState<{ identity: string; nextAttemptAt: string | null } | null>(null);
  const automaticAttempt = useRef<string | null>(null);
  const manualController = useRef<AbortController | null>(null);
  const focusAfterManualRequest = useRef<HTMLButtonElement | null>(null);
  const reconciledFocusTarget = useRef<HTMLElement | null>(null);
  const mediaId = message.mediaObjectId;
  const mediaIdentity = `${message.id}:${mediaId ?? "none"}`;
  const sourceMediaStateKey = mediaStateKey(message.mediaState);
  const [recoveredMediaState, setRecoveredMediaState] = useState<{
    identity: string;
    sourceKey: string;
    state: MediaStateDto;
  } | null>(null);
  const mediaState = recoveredMediaState?.identity === mediaIdentity && recoveredMediaState.sourceKey === sourceMediaStateKey
    ? recoveredMediaState.state
    : message.mediaState;
  const mediaIdentityRef = useRef(mediaIdentity);
  mediaIdentityRef.current = mediaIdentity;

  useEffect(() => () => {
    manualController.current?.abort();
    manualController.current = null;
    focusAfterManualRequest.current = null;
  }, [mediaIdentity]);

  useEffect(() => {
    if (manualRequestKey !== null) return;
    const action = focusAfterManualRequest.current;
    focusAfterManualRequest.current = null;
    if (!action) return;
    if (action.isConnected && action.dataset.mediaIdentity === mediaIdentity) {
      action.focus();
    } else {
      reconciledFocusTarget.current?.focus();
    }
  }, [manualRequestKey, mediaIdentity]);

  useEffect(() => {
    if (!mediaId || mediaState?.status !== "PENDING") return;
    const recoveryMediaId = mediaId;
    const nextAttemptAt = mediaState.nextAttemptAt;
    const timestamp = nextAttemptAt === null ? Date.now() : Date.parse(nextAttemptAt);
    if (Number.isNaN(timestamp)) return;
    const attemptKey = `${mediaIdentity}:${nextAttemptAt ?? "ready"}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let rearmCount = 0;

    const rearm = () => {
      rearmCount += 1;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(recoverWhenDue, recoveryRearmDelay(rearmCount));
    };

    function recoverWhenDue() {
      const remaining = timestamp - Date.now();
      if (remaining > 0) {
        timer = setTimeout(recoverWhenDue, Math.min(remaining, MAX_TIMER_DELAY));
        return;
      }
      if (automaticAttempt.current === attemptKey) return;
      const requestController = new AbortController();
      controller = requestController;
      void requestRecovery(recoveryMediaId, false, requestController.signal).then((state) => {
        if (requestController.signal.aborted || mediaIdentityRef.current !== mediaIdentity) return;
        setAutomaticError((current) => current?.identity === mediaIdentity ? null : current);
        if (pendingRecoveryIsDue(state, Date.now())) {
          if (mediaStateKey(state) === mediaStateKey(mediaState)) {
            setRecoveredMediaState({ identity: mediaIdentity, sourceKey: sourceMediaStateKey, state });
          }
          rearm();
          return;
        }
        automaticAttempt.current = attemptKey;
        setRecoveredMediaState({ identity: mediaIdentity, sourceKey: sourceMediaStateKey, state });
      }, (error: unknown) => {
        if (requestController.signal.aborted || mediaIdentityRef.current !== mediaIdentity) return;
        if (error instanceof RecoveryRequestError && error.retryable) {
          rearm();
          return;
        }
        automaticAttempt.current = attemptKey;
        setAutomaticError({ identity: mediaIdentity, nextAttemptAt });
      });
    }

    recoverWhenDue();
    return () => {
      if (timer !== null) clearTimeout(timer);
      controller?.abort();
    };
  }, [mediaId, mediaIdentity, mediaState?.canRetry, mediaState?.nextAttemptAt, mediaState?.status, sourceMediaStateKey]);

  const retryManually = useCallback(async (action: HTMLButtonElement) => {
    if (!mediaId || manualRequestKey === mediaIdentity) return;
    const requestIdentity = mediaIdentity;
    const controller = new AbortController();
    manualController.current?.abort();
    manualController.current = controller;
    setManualRequestKey(requestIdentity);
    setManualError(null);
    try {
      const state = await requestRecovery(mediaId, true, controller.signal);
      if (!controller.signal.aborted && mediaIdentityRef.current === requestIdentity) {
        setAutomaticError((current) => current?.identity === requestIdentity ? null : current);
        setRecoveredMediaState({ identity: requestIdentity, sourceKey: sourceMediaStateKey, state });
      }
    } catch {
      if (!controller.signal.aborted && mediaIdentityRef.current === requestIdentity) {
        setManualError({ key: requestIdentity, message: recoveryError });
      }
    } finally {
      if (manualController.current === controller) manualController.current = null;
      if (mediaIdentityRef.current === requestIdentity) {
        focusAfterManualRequest.current = action;
        setManualRequestKey((current) => current === requestIdentity ? null : current);
      }
    }
  }, [manualRequestKey, mediaId, mediaIdentity, sourceMediaStateKey]);

  if (message.type === "TEXT") return null;
  if (message.type === "UNSUPPORTED") {
    return <p className="text-sm italic text-[var(--muted)]">Tipo de mensagem não compatível.</p>;
  }
  if (!isMediaMessageType(message.type)) return null;

  const mediaName = mediaNames[message.type];
  const automaticRecoveryFailed = automaticError?.identity === mediaIdentity &&
    automaticError.nextAttemptAt === mediaState?.nextAttemptAt;
  if (mediaState?.status === "PENDING" && automaticRecoveryFailed) {
    const pending = manualRequestKey === mediaIdentity;
    return (
      <div
        className="text-sm text-[var(--muted)]"
        ref={(element) => { reconciledFocusTarget.current = element; }}
        tabIndex={-1}
      >
        <p role="alert">{recoveryError}</p>
        {mediaId ? (
          <Button
            aria-busy={pending || undefined}
            className="mt-1 px-0 text-[var(--accent)]"
            data-media-identity={mediaIdentity}
            disabled={pending}
            onClick={(event) => void retryManually(event.currentTarget)}
            size="small"
            variant="ghost"
          >
            {pending ? "Tentando novamente…" : "Tentar novamente"}
          </Button>
        ) : null}
      </div>
    );
  }
  if (mediaState?.status === "PENDING") {
    return (
      <span
        className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"
        ref={(element) => { reconciledFocusTarget.current = element; }}
        role="status"
        tabIndex={-1}
      >
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        <span>{`Baixando ${mediaName}`}</span>
      </span>
    );
  }
  if (mediaState?.status === "FAILED") {
    const pending = manualRequestKey === mediaIdentity;
    return (
      <div className="text-sm text-[var(--muted)]">
        <p role="status">{`${mediaName[0].toUpperCase()}${mediaName.slice(1)} indisponível`}</p>
        {mediaId ? (
          <Button
            aria-busy={pending || undefined}
            className="mt-1 px-0 text-[var(--accent)]"
            data-media-identity={mediaIdentity}
            disabled={pending}
            onClick={(event) => void retryManually(event.currentTarget)}
            size="small"
            variant="ghost"
          >
            {pending ? "Tentando novamente…" : "Tentar novamente"}
          </Button>
        ) : null}
        {manualError?.key === mediaIdentity ? <p className="mt-1 text-xs text-[var(--danger)]" role="alert">{manualError.message}</p> : null}
      </div>
    );
  }

  const source = message.previewUrl ?? (mediaId ? `/api/media/${encodeURIComponent(mediaId)}` : null);
  if (!source) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
        <ImageIcon aria-hidden="true" className="size-4" />
        {message.status === "FAILED" ? "Mídia indisponível" : "Processando mídia"}
      </div>
    );
  }

  if (message.type === "IMAGE") {
    const image = <Image alt={message.body || message.localFileName || "Imagem da conversa"} className="max-h-80 h-auto w-auto max-w-full rounded-md object-contain" height={480} src={source} unoptimized width={640} />;
    if (!onOpenMedia) return <span className="block" ref={(element) => { reconciledFocusTarget.current = element; }} tabIndex={-1}>{image}</span>;
    return <button aria-label="Abrir imagem" className="block cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={(event) => { event.currentTarget.focus(); onOpenMedia(message.id); }} ref={(element) => { reconciledFocusTarget.current = element; }} type="button">{image}</button>;
  }
  if (message.type === "STICKER") {
    // eslint-disable-next-line @next/next/no-img-element -- Native img preserves animated WEBP sticker frames without image transformation.
    return <img alt="Figurinha" className="h-auto max-h-48 w-auto max-w-48 object-contain" ref={(element) => { reconciledFocusTarget.current = element; }} src={source} tabIndex={-1} />;
  }
  if (message.type === "AUDIO") {
    return (
      <AudioMessagePlayer
        buttonRef={(element) => { reconciledFocusTarget.current = element; }}
        identity={mediaIdentity}
        source={source}
      />
    );
  }
  if (message.type === "VIDEO") {
    if (!onOpenMedia) return <video aria-label={message.body || "Vídeo da conversa"} className="max-h-80 max-w-full rounded-md" controls preload="metadata" ref={(element) => { reconciledFocusTarget.current = element; }} src={source} />;
    return (
      <button aria-label="Abrir vídeo" className="group/video relative block overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={(event) => { event.currentTarget.focus(); onOpenMedia(message.id); }} ref={(element) => { reconciledFocusTarget.current = element; }} type="button">
        <video aria-hidden="true" className="max-h-80 max-w-full" muted playsInline preload="metadata" src={source} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover/video:bg-black/25"><span className="flex size-12 items-center justify-center rounded-full bg-black/65 text-white"><Play aria-hidden="true" className="ml-0.5 size-6 fill-current" /></span></span>
      </button>
    );
  }
  if ((message.localMimeType ?? message.mediaMimeType) === "application/pdf" && onOpenMedia && mediaId) {
    const filename = message.localFileName || message.body || "Documento PDF";
    return (
      <PdfMessagePreview
        buttonRef={(element) => { reconciledFocusTarget.current = element; }}
        filename={filename}
        mediaId={mediaId}
        onOpen={() => onOpenMedia(message.id)}
      />
    );
  }
  if ((message.localMimeType ?? message.mediaMimeType) === "application/pdf" && onOpenMedia) {
    return (
      <button aria-label="Abrir PDF" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 font-semibold text-[var(--accent)] outline-none hover:bg-white/50 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={(event) => { event.currentTarget.focus(); onOpenMedia(message.id); }} ref={(element) => { reconciledFocusTarget.current = element; }} type="button">
        <FileText aria-hidden="true" className="size-4" />
        {message.localFileName || message.body || "Visualizar PDF"}
      </button>
    );
  }
  return (
    <a className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 font-semibold text-[var(--accent)] outline-none hover:bg-white/50 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" download href={source} ref={(element) => { reconciledFocusTarget.current = element; }}>
      <FileText aria-hidden="true" className="size-4" />
      {message.localFileName || message.body || "Baixar documento"}
    </a>
  );
}
