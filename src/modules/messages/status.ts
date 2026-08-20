import "server-only";

import { basename } from "node:path";

import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

export function safeFailureReason(error: unknown): string {
  if (!(error instanceof WhatsAppProviderError)) {
    return "Falha ao enviar mensagem";
  }

  const safe = error.message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/bearer\s+\S+/gi, "[REDACTED]")
    .trim()
    .slice(0, 240);
  return safe || "Falha ao enviar mensagem";
}

export function safeOriginalFilename(filename: string): string {
  const safe = basename(filename.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\r\n";]/g, "_")
    .trim()
    .slice(0, 180);
  return safe || "arquivo";
}
