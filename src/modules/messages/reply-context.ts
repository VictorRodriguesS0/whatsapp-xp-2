import { z } from "zod";

import type {
  MessageDirection,
  MessageType,
} from "@/generated/prisma/enums";
import { parseMessageContent } from "@/modules/messages/content";

export const whatsappMessageIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value));

export type QuotedReplyDto =
  | { available: false }
  | {
      available: true;
      messageId: string;
      direction: MessageDirection;
      type: MessageType;
      author: string;
      summary: string;
    };

export type AvailableQuotedReplyDto = Extract<
  QuotedReplyDto,
  { available: true }
>;

export type QuotedReplySource = {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  body: string | null;
  content: unknown;
  sentBy: { name: string } | null;
  mediaOriginalFilename?: string | null;
};

export function quotedReplyPreview(
  source: QuotedReplySource,
): AvailableQuotedReplyDto {
  const content = parseMessageContent(source.content);
  const author = source.direction === "INBOUND"
    ? "Cliente"
    : source.sentBy?.name ?? "WhatsApp";
  const typeFallback: Record<string, string> = {
    IMAGE: "Imagem",
    VIDEO: "Vídeo",
    DOCUMENT: "Documento",
    AUDIO: "Áudio",
    STICKER: "Figurinha",
    LOCATION: "Localização",
    CONTACTS: "Contato",
    INTERACTIVE: "Resposta interativa",
    ORDER: "Pedido",
    SYSTEM: "Atualização do WhatsApp",
    UNSUPPORTED: "Mensagem",
  };
  const structured = content?.kind === "interactive"
    ? content.title
    : content?.kind === "location"
      ? content.name ?? content.address
      : content?.kind === "contacts"
        ? content.contacts[0]?.name
        : content?.kind === "system"
          ? content.text
          : null;
  const raw = source.body ||
    structured ||
    source.mediaOriginalFilename ||
    typeFallback[source.type] ||
    "Mensagem";
  const summary = raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;

  return {
    available: true,
    messageId: source.id,
    direction: source.direction,
    type: source.type,
    author,
    summary,
  };
}
