// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  inboundMediaFixture,
  inboundTextFixture,
  statusFixture,
  unsupportedMessageFixture,
} from "@/test/fixtures/meta-webhooks";

import { normalizeWebhook, WebhookPayloadError } from "./normalize";

describe("Meta webhook normalization", () => {
  it.each([
    null,
    {},
    { object: "whatsapp_business_account", entry: {} },
  ])("rejects a payload without a valid entry array: %j", (payload) => {
    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it("rejects a null entry element", () => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry = [null];

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([undefined, null, {}])(
    "rejects a missing or non-array changes collection: %j",
    (changes) => {
      const payload = structuredClone(inboundTextFixture) as Record<string, any>;
      payload.entry[0].changes = changes;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it("rejects a null change element", () => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes = [null];

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([
    {},
    { field: 42, value: null },
    { field: "", value: null },
    { field: "   ", value: null },
  ])("rejects a change without a non-empty string field: %j", (change) => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes = [change];

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([null, [], "invalid"])(
    "rejects an invalid messages change value: %j",
    (value) => {
      const payload = structuredClone(inboundTextFixture) as Record<string, any>;
      payload.entry[0].changes[0].value = value;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it("ignores a structurally valid change for an unknown field", () => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes = [
      { field: "account_update", value: null },
      payload.entry[0].changes[0],
    ];

    expect(normalizeWebhook(payload)).toHaveLength(1);
  });

  it("normalizes the documented inbound text payload", () => {
    expect(normalizeWebhook(inboundTextFixture)[0]).toMatchObject({
      kind: "message",
      whatsappMessageId: expect.stringMatching(/^wamid\./),
      from: "5511999990001",
      contactName: "Ana Cliente",
      timestamp: new Date("2026-08-19T10:00:00.000Z"),
      type: "TEXT",
      body: "Hi!",
      media: null,
    });
  });

  it.each([
    ["image", "IMAGE", "image/jpeg"],
    ["audio", "AUDIO", "audio/ogg"],
    ["video", "VIDEO", "video/mp4"],
    ["document", "DOCUMENT", "application/pdf"],
  ] as const)("normalizes an inbound %s as pending media metadata", (kind, type, mimeType) => {
    const [event] = normalizeWebhook(inboundMediaFixture(kind));

    expect(event).toMatchObject({
      kind: "message",
      type,
      body: kind === "audio" ? null : `Legenda ${kind}`,
      media: {
        metaMediaId: `meta-${kind}-1`,
        mimeType,
        sha256: `${kind}-sha256`,
      },
    });

    if (event?.kind === "message" && kind === "document") {
      expect(event.media?.filename).toBe("nota fiscal.pdf");
      expect(event.media?.filename).not.toMatch(/[\\/\0]/);
    }
  });

  it("records an unknown inbound message type as unsupported", () => {
    expect(normalizeWebhook(unsupportedMessageFixture)).toEqual([
      expect.objectContaining({
        kind: "message",
        whatsappMessageId: "wamid.sticker-1",
        type: "UNSUPPORTED",
        body: null,
        media: null,
      }),
    ]);
  });

  it("allowlists and maps only documented status values", () => {
    const payload = structuredClone(statusFixture("sent"));
    const statuses = payload.entry[0]!.changes[0]!.value.statuses!;
    statuses.push(statusFixture("delivered").entry[0]!.changes[0]!.value.statuses![0]!);
    statuses.push(statusFixture("read").entry[0]!.changes[0]!.value.statuses![0]!);
    statuses.push(statusFixture("failed").entry[0]!.changes[0]!.value.statuses![0]!);
    statuses.push(statusFixture("deleted").entry[0]!.changes[0]!.value.statuses![0]!);

    const events = normalizeWebhook(payload);

    expect(events.map((event) => event.kind === "status" && event.status)).toEqual([
      "SENT",
      "DELIVERED",
      "READ",
      "FAILED",
    ]);
    expect(events[3]).toMatchObject({
      kind: "status",
      failureReason: "131047: Re-engagement message - Customer service window elapsed",
    });
  });

  it("rejects a non-Meta payload without echoing attacker-controlled data", () => {
    const secretMarker = "secret-marker-that-must-not-appear";

    try {
      normalizeWebhook({ object: secretMarker, entry: [] });
      throw new Error("expected normalizeWebhook to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookPayloadError);
      expect(String(error)).not.toContain(secretMarker);
    }
  });

  it("rejects a malformed inbound message instead of silently acknowledging it", () => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    delete payload.entry[0].changes[0].value.messages[0].id;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each(["messages", "statuses"] as const)(
    "rejects a declared non-array %s collection",
    (field) => {
      const payload = structuredClone(inboundTextFixture) as Record<string, any>;
      payload.entry[0].changes[0].value[field] = { attacker: "not-an-array" };

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each([
    ["id", ""],
    ["from", "not-a-whatsapp-id"],
    ["timestamp", "yesterday"],
  ] as const)("rejects an invalid required message %s", (field, value) => {
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes[0].value.messages[0][field] = value;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([undefined, 42, "\u0000"])(
    "rejects an invalid required text body: %s",
    (body) => {
      const payload = structuredClone(inboundTextFixture) as Record<string, any>;
      payload.entry[0].changes[0].value.messages[0].text.body = body;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each(["id", "mime_type", "sha256"] as const)(
    "rejects supported media without required %s metadata",
    (field) => {
      const payload = inboundMediaFixture("image") as Record<string, any>;
      delete payload.entry[0].changes[0].value.messages[0].image[field];

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each(["id", "timestamp", "recipient_id"] as const)(
    "rejects an allowlisted status without required %s",
    (field) => {
      const payload = statusFixture("delivered") as Record<string, any>;
      delete payload.entry[0].changes[0].value.statuses[0][field];

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it("continues to ignore an unknown status even when it has no event metadata", () => {
    const payload = statusFixture("deleted") as Record<string, any>;
    payload.entry[0].changes[0].value.statuses = [{ status: "deleted" }];

    expect(normalizeWebhook(payload)).toEqual([]);
  });
});
