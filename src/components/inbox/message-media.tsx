import { FileText, ImageIcon } from "lucide-react";
import Image from "next/image";

import type { InboxMessage } from "@/hooks/use-inbox";

export function MessageMedia({ message }: { message: InboxMessage }) {
  if (message.type === "TEXT") return null;
  if (message.type === "UNSUPPORTED") {
    return <p className="text-sm italic text-[var(--muted)]">Tipo de mensagem não compatível.</p>;
  }

  const source = message.previewUrl ?? (message.mediaObjectId ? `/api/media/${encodeURIComponent(message.mediaObjectId)}` : null);
  if (!source) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
        <ImageIcon aria-hidden="true" className="size-4" />
        {message.status === "FAILED" ? "Mídia indisponível" : "Processando mídia"}
      </div>
    );
  }

  if (message.type === "IMAGE") {
    return <Image alt={message.body || message.localFileName || "Imagem da conversa"} className="max-h-80 h-auto w-auto max-w-full rounded-md object-contain" height={480} src={source} unoptimized width={640} />;
  }
  if (message.type === "AUDIO") return <audio className="max-w-full" controls preload="metadata" src={source} />;
  if (message.type === "VIDEO") return <video aria-label={message.body || "Vídeo da conversa"} className="max-h-80 max-w-full rounded-md" controls preload="metadata" src={source} />;
  return (
    <a className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 font-semibold text-[var(--accent)] outline-none hover:bg-white/50 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" download href={source}>
      <FileText aria-hidden="true" className="size-4" />
      {message.localFileName || message.body || "Baixar documento"}
    </a>
  );
}
