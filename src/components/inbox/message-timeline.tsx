import type { ReactNode, RefObject } from "react";

export function MessageTimeline({ label, historyRef, empty, children }: {
  label: string;
  historyRef: RefObject<HTMLDivElement | null>;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div aria-label={label} className="message-timeline min-h-0 flex-1 space-y-2 overflow-y-auto p-4" ref={historyRef} role="log">
      {empty ? <p className="py-12 text-center text-sm text-[var(--muted)]">Ainda não há mensagens nesta conversa.</p> : null}
      {children}
    </div>
  );
}
