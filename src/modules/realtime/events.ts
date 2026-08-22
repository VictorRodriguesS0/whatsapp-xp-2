import { z } from "zod";

const id = z.string();

export const realtimeEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("conversation.updated"),
    conversationId: id,
    revision: id,
  }),
  z.strictObject({
    type: z.literal("conversation.merged"),
    sourceConversationId: id,
    targetConversationId: id,
  }),
  z.strictObject({
    type: z.literal("message.created"),
    conversationId: id,
    messageId: id,
  }),
  z.strictObject({
    type: z.literal("message.status"),
    conversationId: id,
    messageId: id,
  }),
  z.strictObject({
    type: z.literal("media.updated"),
    conversationId: id,
    messageId: id,
    mediaId: id,
  }),
  z.strictObject({
    type: z.literal("reaction.updated"),
    conversationId: id,
    messageId: id,
  }),
  z.strictObject({
    type: z.literal("read.updated"),
    conversationId: id,
    userId: id,
  }),
  z.strictObject({
    type: z.literal("responsible.updated"),
    conversationId: id,
  }),
  z.strictObject({ type: z.literal("user.updated"), userId: id }),
  z.strictObject({ type: z.literal("contact.updated"), contactId: id }),
  z.strictObject({
    type: z.literal("settings.updated"),
    scope: z.enum(["contact-types", "contact-tags"]),
  }),
]);

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
