export type MessageBoundary = {
  id: string | null;
  externalTimestamp: Date;
};

export function compareBoundary(
  left: MessageBoundary,
  right: MessageBoundary,
): number {
  const timestampOrder =
    left.externalTimestamp.getTime() - right.externalTimestamp.getTime();
  if (timestampOrder !== 0 || left.id === right.id) {
    return timestampOrder;
  }
  if (left.id === null) {
    return 1;
  }
  if (right.id === null) {
    return -1;
  }
  return left.id.localeCompare(right.id);
}
