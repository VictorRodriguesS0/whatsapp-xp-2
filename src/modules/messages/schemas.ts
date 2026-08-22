import "server-only";

import { z } from "zod";

import { MessageType } from "@/generated/prisma/enums";

export const messageUuidSchema = z.string().uuid();
export const clientRequestIdSchema = z.string().uuid();

export const outboundTextSchema = z.object({
  type: z.literal(MessageType.TEXT),
  clientRequestId: clientRequestIdSchema,
  body: z.string().trim().min(1).max(4_096),
  replyToMessageId: messageUuidSchema.optional(),
});

export const outboundMediaFieldsSchema = z.object({
  type: z.enum([
    MessageType.IMAGE,
    MessageType.AUDIO,
    MessageType.VIDEO,
    MessageType.DOCUMENT,
  ]),
  clientRequestId: clientRequestIdSchema,
  body: z.string().trim().max(1_024).optional(),
  replyToMessageId: messageUuidSchema.optional(),
});
