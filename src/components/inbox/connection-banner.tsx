import { WifiOff } from "lucide-react";

export function ConnectionStatus({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div aria-live="polite" className="flex min-h-9 shrink-0 items-center justify-center gap-2 border-b border-[var(--border)] bg-[var(--warning)] px-4 text-xs font-semibold text-[var(--text)]" role="status">
      <WifiOff aria-hidden="true" className="size-4" />
      Conexão interrompida. Reconectando…
    </div>
  );
}

export const ConnectionBanner = ConnectionStatus;
