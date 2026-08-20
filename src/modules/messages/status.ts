import "server-only";

import { basename } from "node:path";

export function safeFailureReason(_error: unknown): string {
  return "Falha ao enviar mensagem";
}

export function safeOriginalFilename(filename: string): string {
  const safe = basename(filename.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\r\n";]/g, "_")
    .trim()
    .slice(0, 180);
  return safe || "arquivo";
}
