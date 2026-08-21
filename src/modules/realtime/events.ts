export type RealtimeEvent =
  | { type: "conversation.updated"; conversationId: string; revision: string }
  | {
      type: "conversation.merged";
      sourceConversationId: string;
      targetConversationId: string;
    }
  | { type: "message.created"; conversationId: string; messageId: string }
  | { type: "message.status"; conversationId: string; messageId: string }
  | { type: "read.updated"; conversationId: string; userId: string }
  | { type: "responsible.updated"; conversationId: string }
  | { type: "user.updated"; userId: string };
