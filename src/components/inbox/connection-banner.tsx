import { WifiOff } from "lucide-react";

export function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="flex min-h-9 items-center justify-center gap-2 border-b border-[var(--border)] bg-[var(--warning)] px-4 text-xs font-semibold text-[var(--text)]" role="status">
      <WifiOff aria-hidden="true" className="size-4" />
      Conexão interrompida. Reconectando…
    </div>
  );
}
