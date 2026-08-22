import { describe, expect, it } from "vitest";

import { realtimeEventSchema } from "./events";

describe("reaction realtime events", () => {
  it("accepts only the bounded conversation and message identifiers", () => {
    expect(realtimeEventSchema.parse({
      type: "reaction.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
    })).toEqual({
      type: "reaction.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
    });
    expect(() => realtimeEventSchema.parse({
      type: "reaction.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
      emoji: "secret-extra-field",
    })).toThrow();
  });
});
