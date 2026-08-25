"use client";

import { FileText } from "lucide-react";
import { useState, type Ref } from "react";

export function PdfMessagePreview({
  filename,
  mediaId,
  onOpen,
  buttonRef,
}: {
  filename: string;
  mediaId: string;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const [thumbnail, setThumbnail] = useState<{
    mediaId: string;
    state: "loading" | "loaded" | "failed";
  }>({ mediaId, state: "loading" });
  const state = thumbnail.mediaId === mediaId ? thumbnail.state : "loading";
  const label = `Abrir PDF ${filename}`;

  if (state === "failed") {
    return (
      <button
        aria-label={label}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--media-surface)] px-3 text-left font-semibold text-[var(--accent)] outline-none transition-colors hover:bg-[var(--media-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={(event) => {
          event.currentTarget.focus();
          onOpen();
        }}
        ref={buttonRef}
        type="button"
      >
        <FileText aria-hidden="true" className="size-4 shrink-0 text-rose-600" />
        <span className="min-w-0 truncate">{filename}</span>
        <span className="shrink-0 text-xs text-[var(--muted)]">PDF</span>
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      className="group/pdf block min-h-11 w-[min(16rem,70vw)] max-w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--media-surface)] text-left outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-[var(--media-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      ref={buttonRef}
      type="button"
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-[var(--canvas)]">
        {state === "loading" ? (
          <span
            aria-label="Carregando prévia do PDF"
            className="absolute inset-0 flex items-center justify-center text-xs text-[var(--muted)]"
            role="status"
          >
            Carregando prévia…
          </span>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- This authenticated derivative has no stable source dimensions and must expose native load/error state. */}
        <img
          alt={`Prévia da primeira página de ${filename}`}
          className={`h-full w-full object-cover object-top ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
          height={480}
          onError={() => setThumbnail({ mediaId, state: "failed" })}
          onLoad={() => setThumbnail({ mediaId, state: "loaded" })}
          src={`/api/media/${encodeURIComponent(mediaId)}/thumbnail`}
          width={640}
        />
      </span>
      <span className="flex min-h-11 items-center gap-2 border-t border-[var(--border)] bg-[var(--media-surface)] px-3 transition-colors group-hover/pdf:bg-[var(--media-surface-hover)]">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-rose-600" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{filename}</span>
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">PDF</span>
      </span>
    </button>
  );
}
