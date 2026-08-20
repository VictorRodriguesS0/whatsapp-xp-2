import type { MessageStatus, MessageType } from "@/generated/prisma/enums";

export type NormalizedMedia = {
  metaMediaId: string;
  mimeType: string;
  sha256: string | null;
  filename: string | null;
};

export type NormalizedMessageEvent = {
  kind: "message";
  whatsappMessageId: string;
  from: string;
  contactName: string | null;
  timestamp: Date;
  timestampRaw: string;
  type: MessageType;
  body: string | null;
  media: NormalizedMedia | null;
};

export type NormalizedStatusEvent = {
  kind: "status";
  whatsappMessageId: string;
  timestamp: Date;
  timestampRaw: string;
  status: Extract<MessageStatus, "SENT" | "DELIVERED" | "READ" | "FAILED">;
  failureReason: string | null;
};

export type NormalizedWebhookEvent =
  | NormalizedMessageEvent
  | NormalizedStatusEvent;

export type ProcessSummary = {
  processed: number;
  duplicates: number;
};
