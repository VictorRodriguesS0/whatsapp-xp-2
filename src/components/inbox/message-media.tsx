"use client";

import { FileText, ImageIcon, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { InboxMessage } from "@/hooks/use-inbox";
import type { MediaStateDto } from "@/modules/conversations/types";

const MAX_TIMER_DELAY = 2_147_483_647;
const recoveryError = "Não foi possível baixar a mídia.";

const mediaNames = {
  IMAGE: "imagem",
  AUDIO: "áudio",
  VIDEO: "vídeo",
  DOCUMENT: "documento",
} as const;

function mediaStateKey(state: MediaStateDto | null) {
  return state ? `${state.status}:${state.nextAttemptAt ?? "none"}:${state.canRetry}` : "none";
}

async function requestRecovery(mediaId: string, manual: boolean, signal: AbortSignal) {
  const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manual }),
    signal,
  });
  const payload = (await response.json()) as { data?: MediaStateDto | null };
  if (!response.ok || !payload.data) throw new Error("Media recovery failed");
  return payload.data;
}

export function MessageMedia({ message }: { message: InboxMessage }) {
  const [manualRequestKey, setManualRequestKey] = useState<string | null>(null);
  const [manualError, setManualError] = useState<{ key: string; message: string } | null>(null);
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
    const nextAttemptAt = mediaState.nextAttemptAt;
    if (nextAttemptAt === null && !mediaState.canRetry) return;
    const timestamp = nextAttemptAt === null ? Date.now() : Date.parse(nextAttemptAt);
    if (Number.isNaN(timestamp)) return;
    const attemptKey = `${mediaIdentity}:${nextAttemptAt ?? "ready"}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const recoverWhenDue = () => {
      const remaining = timestamp - Date.now();
      if (remaining > 0) {
        timer = setTimeout(recoverWhenDue, Math.min(remaining, MAX_TIMER_DELAY));
        return;
      }
      if (automaticAttempt.current === attemptKey) return;
      controller = new AbortController();
      void requestRecovery(mediaId, false, controller.signal).then((state) => {
        if (controller?.signal.aborted || mediaIdentityRef.current !== mediaIdentity) return;
        automaticAttempt.current = attemptKey;
        setRecoveredMediaState({ identity: mediaIdentity, sourceKey: sourceMediaStateKey, state });
      }, () => undefined);
    };

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

  const mediaName = mediaNames[message.type];
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
    return <span className="block" ref={(element) => { reconciledFocusTarget.current = element; }} tabIndex={-1}><Image alt={message.body || message.localFileName || "Imagem da conversa"} className="max-h-80 h-auto w-auto max-w-full rounded-md object-contain" height={480} src={source} unoptimized width={640} /></span>;
  }
  if (message.type === "AUDIO") return <audio aria-label="Reproduzir áudio" className="max-w-full" controls preload="metadata" ref={(element) => { reconciledFocusTarget.current = element; }} src={source} />;
  if (message.type === "VIDEO") return <video aria-label={message.body || "Vídeo da conversa"} className="max-h-80 max-w-full rounded-md" controls preload="metadata" ref={(element) => { reconciledFocusTarget.current = element; }} src={source} />;
  return (
    <a className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 font-semibold text-[var(--accent)] outline-none hover:bg-white/50 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" download href={source} ref={(element) => { reconciledFocusTarget.current = element; }}>
      <FileText aria-hidden="true" className="size-4" />
      {message.localFileName || message.body || "Baixar documento"}
    </a>
  );
}
