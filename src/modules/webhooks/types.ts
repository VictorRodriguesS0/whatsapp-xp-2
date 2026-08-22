import type { MessageStatus, MessageType } from "@/generated/prisma/enums";
import type { MessageContent } from "@/modules/messages/content";

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
  content: MessageContent | null;
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

export type NormalizedMessageEchoEvent = {
  kind: "messageEcho";
  whatsappMessageId: string;
  to: string | null;
  toUserId: string | null;
  toParentUserId: string | null;
  timestamp: Date;
  timestampRaw: string;
  type: MessageType;
  body: string | null;
  content: MessageContent | null;
  media: NormalizedMedia | null;
  origin: "WHATSAPP_BUSINESS_APP";
};

export type NormalizedMessageEchoControlEvent = {
  kind: "messageEchoControl";
  action: "EDIT" | "REVOKE";
  whatsappMessageId: string;
  originalWhatsappMessageId: string;
  to: string | null;
  toUserId: string | null;
  toParentUserId: string | null;
  timestamp: Date;
  timestampRaw: string;
  origin: "WHATSAPP_BUSINESS_APP";
};

export type NormalizedWebhookEvent =
  | NormalizedMessageEvent
  | NormalizedStatusEvent
  | NormalizedMessageEchoEvent
  | NormalizedMessageEchoControlEvent;

export type ProcessSummary = {
  processed: number;
  duplicates: number;
  quarantined?: number;
};
