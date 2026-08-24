import { describe, expect, it } from "vitest";

import { realtimeEventSchema } from "./events";

describe("reaction realtime events", () => {
  it("accepts a message update without exposing prior content", () => {
    expect(realtimeEventSchema.parse({
      type: "message.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
    })).toEqual({
      type: "message.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
    });
    expect(() => realtimeEventSchema.parse({
      type: "message.updated",
      conversationId: "conversation-1",
      messageId: "message-1",
      previousBody: "must-never-leave-the-server",
    })).toThrow();
  });

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

  it("accepts only the empty Meta health invalidation event", () => {
    expect(realtimeEventSchema.parse({ type: "meta-health.updated" })).toEqual({
      type: "meta-health.updated",
    });
    expect(() =>
      realtimeEventSchema.parse({ type: "meta-health.updated", payload: "private" }),
    ).toThrow();
  });
});
