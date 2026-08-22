import {
  MessageStatus,
  type MessageStatus as MessageStatusValue,
} from "@/generated/prisma/enums";

export function shouldApplyMessageStatus(
  current: MessageStatusValue,
  next: MessageStatusValue,
): boolean {
  if (current === MessageStatus.RECEIVED || current === MessageStatus.READ) {
    return false;
  }

  if (next === MessageStatus.FAILED) {
    return current === MessageStatus.PENDING || current === MessageStatus.SENT;
  }

  if (current === MessageStatus.FAILED) {
    return false;
  }

  const rank: Partial<Record<MessageStatusValue, number>> = {
    [MessageStatus.PENDING]: 0,
    [MessageStatus.SENT]: 1,
    [MessageStatus.DELIVERED]: 2,
    [MessageStatus.READ]: 3,
  };

  return (rank[next] ?? -1) > (rank[current] ?? -1);
}
