import { describe, expect, it } from "vitest";

import { MessageStatus } from "@/generated/prisma/enums";

import { shouldApplyMessageStatus } from "./status-precedence";

describe("message status precedence", () => {
  it.each([
    MessageStatus.DELIVERED,
    MessageStatus.READ,
    MessageStatus.FAILED,
  ])("does not replace %s with a late SENT transition", (current) => {
    expect(shouldApplyMessageStatus(current, MessageStatus.SENT)).toBe(false);
  });

  it("keeps the existing monotonic webhook transitions", () => {
    expect(shouldApplyMessageStatus(MessageStatus.SENT, MessageStatus.DELIVERED))
      .toBe(true);
    expect(shouldApplyMessageStatus(MessageStatus.DELIVERED, MessageStatus.READ))
      .toBe(true);
    expect(shouldApplyMessageStatus(MessageStatus.READ, MessageStatus.FAILED))
      .toBe(false);
    expect(shouldApplyMessageStatus(MessageStatus.SENT, MessageStatus.FAILED))
      .toBe(true);
  });
});
