import type { InboxMessage } from "@/hooks/use-inbox";

const MESSAGE_INTERACTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export function isMessageExpired(message: InboxMessage) {
  return Date.now() - new Date(message.externalTimestamp).getTime() > MESSAGE_INTERACTION_WINDOW_MS;
}

export function canReplyToMessage(
  message: InboxMessage,
  onReply?: (message: InboxMessage) => void,
) {
  return !message.revokedAt
    && message.canReply
    && !isMessageExpired(message)
    && Boolean(onReply);
}
