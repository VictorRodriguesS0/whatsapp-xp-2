import type { MessageStatus, MessageType } from "@/generated/prisma/enums";
import type { MessageContent } from "@/modules/messages/content";
import type { MetaOperationalField } from "@/modules/meta-health/types";

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
  replyToWhatsappMessageId: string | null;
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
  replyToWhatsappMessageId: string | null;
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

export type NormalizedReactionEvent = {
  kind: "reaction";
  whatsappMessageId: string;
  targetWhatsappMessageId: string;
  from: string;
  contactName: string | null;
  emoji: string;
  timestamp: Date;
  timestampRaw: string;
};

export type NormalizedReactionEchoEvent = {
  kind: "reactionEcho";
  whatsappMessageId: string;
  targetWhatsappMessageId: string;
  to: string | null;
  toUserId: string | null;
  toParentUserId: string | null;
  emoji: string;
  timestamp: Date;
  timestampRaw: string;
  origin: "WHATSAPP_BUSINESS_APP";
};

export type NormalizedMetaOperationalEvent = {
  kind: "metaOperational";
  wabaId: string;
  field: MetaOperationalField;
  eventCode: string;
  resourceId: string | null;
  occurredAt: Date;
  details: Record<string, string | null> | null;
  deduplicationKey: string;
};

export type NormalizedWebhookEvent =
  | NormalizedMessageEvent
  | NormalizedStatusEvent
  | NormalizedMessageEchoEvent
  | NormalizedMessageEchoControlEvent
  | NormalizedReactionEvent
  | NormalizedReactionEchoEvent
  | NormalizedMetaOperationalEvent;

export type ProcessSummary = {
  processed: number;
  duplicates: number;
  quarantined?: number;
};
