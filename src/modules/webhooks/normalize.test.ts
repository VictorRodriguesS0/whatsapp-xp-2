// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  inboundMediaFixture,
  inboundTextFixture,
  statusFixture,
  unsupportedMessageFixture,
} from "@/test/fixtures/meta-webhooks";

import { normalizeWebhook, WebhookPayloadError } from "./normalize";

type EchoType = "text" | "image" | "audio" | "video" | "document" | "sticker";

function messageEchoFixture(type: EchoType = "text") {
  const media = {
    id: `echo-media-${type}`,
    mime_type:
      type === "image"
        ? "image/jpeg"
        : type === "audio"
          ? "audio/ogg"
          : type === "video"
            ? "video/mp4"
            : "application/pdf",
    sha256: `echo-${type}-sha256`,
    ...(type === "audio" ? {} : { caption: `Echo ${type}` }),
    ...(type === "document" ? { filename: "../echo-document.pdf" } : {}),
  };

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "synthetic-waba",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "business-display-number",
                phone_number_id: "synthetic-phone-number-id",
              },
              message_echoes: [
                {
                  from: "business-sender-number",
                  to: "+55 (11) 99999-0001",
                  to_user_id: "BR.Customer123",
                  id: `wamid.echo-${type}`,
                  timestamp: "1787133604",
                  type,
                  ...(type === "text"
                    ? { text: { body: "Resposta pelo aplicativo" } }
                    : type === "sticker"
                      ? { sticker: { id: "synthetic-sticker" } }
                      : { [type]: media }),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function messageEchoControlFixture(action: "edit" | "revoke") {
  const payload = messageEchoFixture();
  const echo = payload.entry[0]!.changes[0]!.value.message_echoes[0]! as Record<
    string,
    unknown
  >;
  echo.id = `wamid.echo-${action}`;
  echo.type = action;
  echo[action] = { original_message_id: "wamid.echo-original" };
  delete echo.text;
  return payload;
}

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

  it("normalizes an app text echo as outbound activity for the recipient", () => {
    expect(normalizeWebhook(messageEchoFixture())).toEqual([
      {
        kind: "messageEcho",
        whatsappMessageId: "wamid.echo-text",
        to: "5511999990001",
        toUserId: "BR.Customer123",
        toParentUserId: null,
        timestamp: new Date("2026-08-19T10:00:04.000Z"),
        timestampRaw: "1787133604",
        type: "TEXT",
        body: "Resposta pelo aplicativo",
        media: null,
        origin: "WHATSAPP_BUSINESS_APP",
      },
    ]);
  });

  it.each([
    ["image", "IMAGE", "image/jpeg"],
    ["audio", "AUDIO", "audio/ogg"],
    ["video", "VIDEO", "video/mp4"],
    ["document", "DOCUMENT", "application/pdf"],
  ] as const)("normalizes an app %s echo with safe media metadata", (kind, type, mimeType) => {
    const [event] = normalizeWebhook(messageEchoFixture(kind));

    expect(event).toMatchObject({
      kind: "messageEcho",
      to: "5511999990001",
      toUserId: "BR.Customer123",
      toParentUserId: null,
      type,
      body: kind === "audio" ? null : `Echo ${kind}`,
      media: {
        metaMediaId: `echo-media-${kind}`,
        mimeType,
        sha256: `echo-${kind}-sha256`,
      },
      origin: "WHATSAPP_BUSINESS_APP",
    });

    if (event?.kind === "messageEcho" && kind === "document") {
      expect(event.media?.filename).toBe("echo-document.pdf");
    }
  });

  it("sanitizes an empty optional app media caption to null", () => {
    const payload = messageEchoFixture("image") as Record<string, any>;
    payload.entry[0].changes[0].value.message_echoes[0].image.caption = "";

    expect(normalizeWebhook(payload)).toEqual([
      expect.objectContaining({
        kind: "messageEcho",
        body: null,
        type: "IMAGE",
      }),
    ]);
  });

  it("preserves an unknown app echo type as unsupported activity", () => {
    expect(normalizeWebhook(messageEchoFixture("sticker"))).toEqual([
      expect.objectContaining({
        kind: "messageEcho",
        whatsappMessageId: "wamid.echo-sticker",
        to: "5511999990001",
        toUserId: "BR.Customer123",
        toParentUserId: null,
        type: "UNSUPPORTED",
        body: null,
        media: null,
        origin: "WHATSAPP_BUSINESS_APP",
      }),
    ]);
  });

  it.each([
    ["edit", "EDIT"],
    ["revoke", "REVOKE"],
  ] as const)("normalizes a valid app %s control as a deduplicable no-op", (rawAction, action) => {
    expect(normalizeWebhook(messageEchoControlFixture(rawAction))).toEqual([
      {
        kind: "messageEchoControl",
        action,
        whatsappMessageId: `wamid.echo-${rawAction}`,
        originalWhatsappMessageId: "wamid.echo-original",
        to: "5511999990001",
        toUserId: "BR.Customer123",
        toParentUserId: null,
        timestamp: new Date("2026-08-19T10:00:04.000Z"),
        timestampRaw: "1787133604",
        origin: "WHATSAPP_BUSINESS_APP",
      },
    ]);
  });

  it("normalizes multiple echoes, multiple changes, and standard messages together", () => {
    const firstEcho = messageEchoFixture();
    const secondEcho = messageEchoFixture("image");
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry[0].changes.push(firstEcho.entry[0]!.changes[0]);
    payload.entry.push({
      id: "synthetic-second-entry",
      changes: [secondEcho.entry[0]!.changes[0]],
    });
    firstEcho.entry[0]!.changes[0]!.value.message_echoes.push(
      structuredClone(secondEcho.entry[0]!.changes[0]!.value.message_echoes[0]!),
    );

    const events = normalizeWebhook(payload);

    expect(events.map((event) => event.kind)).toEqual([
      "message",
      "messageEcho",
      "messageEcho",
      "messageEcho",
    ]);
    expect(events.filter((event) => event.kind === "messageEcho")).toHaveLength(3);
  });

  it("normalizes an echo without a legacy recipient phone when BSUID is present", () => {
    const payload = messageEchoFixture() as Record<string, any>;
    delete payload.entry[0].changes[0].value.message_echoes[0].to;

    expect(normalizeWebhook(payload)).toEqual([
      expect.objectContaining({
        kind: "messageEcho",
        to: null,
        toUserId: "BR.Customer123",
        toParentUserId: null,
      }),
    ]);
  });

  it("preserves the official legacy echo with phone and no BSUID", () => {
    const payload = messageEchoFixture() as Record<string, any>;
    delete payload.entry[0].changes[0].value.message_echoes[0].to_user_id;

    expect(normalizeWebhook(payload)).toEqual([
      expect.objectContaining({
        kind: "messageEcho",
        to: "5511999990001",
        toUserId: null,
        toParentUserId: null,
      }),
    ]);
  });

  it("rejects an echo without either recipient phone or BSUID", () => {
    const payload = messageEchoFixture() as Record<string, any>;
    const echo = payload.entry[0].changes[0].value.message_echoes[0];
    delete echo.to;
    delete echo.to_user_id;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it("preserves a valid parent BSUID separately from the recipient BSUID", () => {
    const payload = messageEchoFixture() as Record<string, any>;
    payload.entry[0].changes[0].value.message_echoes[0].to_parent_user_id =
      "BR.Parent456";

    expect(normalizeWebhook(payload)).toEqual([
      expect.objectContaining({
        kind: "messageEcho",
        toUserId: "BR.Customer123",
        toParentUserId: "BR.Parent456",
      }),
    ]);
  });

  it.each([
    undefined,
    "br.Customer123",
    "BRA.Customer123",
    "BR.",
    `BR.${"a".repeat(129)}`,
    "BR.Customer-123",
    " BR.Customer123",
    "BR.Customer123\u0000suffix",
  ])("rejects an invalid recipient BSUID when it is present", (toUserId) => {
    const payload = messageEchoFixture() as Record<string, any>;
    payload.entry[0].changes[0].value.message_echoes[0].to_user_id = toUserId;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([null, "br.Parent456", "BR.Parent-456", "BR.Parent456 "])(
    "rejects an invalid optional parent BSUID when it is present",
    (toParentUserId) => {
      const payload = messageEchoFixture() as Record<string, any>;
      payload.entry[0].changes[0].value.message_echoes[0].to_parent_user_id =
        toParentUserId;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each([
    ["id", undefined],
    ["id", "x".repeat(513)],
    ["id", "\u0000"],
    ["id", " wamid.echo-text"],
    ["id", "wamid.echo-text "],
    ["id", "wamid.echo\u0000text"],
    ["to", undefined],
    ["to", "not-a-recipient"],
    ["to", "1".repeat(33)],
    ["timestamp", undefined],
    ["timestamp", "not-an-epoch"],
    ["timestamp", "9".repeat(16)],
  ])("rejects an app echo with invalid required %s metadata", (field, value) => {
    const payload = messageEchoFixture() as Record<string, any>;
    payload.entry[0].changes[0].value.message_echoes[0][field] = value;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([undefined, 42, "\u0000", "x".repeat(4097)])(
    "rejects an app text echo with an invalid body",
    (body) => {
      const payload = messageEchoFixture() as Record<string, any>;
      payload.entry[0].changes[0].value.message_echoes[0].text.body = body;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each([
    ["image", "id", undefined],
    ["image", "id", "x".repeat(513)],
    ["image", "mime_type", undefined],
    ["image", "mime_type", "x".repeat(256)],
    ["image", "sha256", undefined],
    ["image", "sha256", "x".repeat(257)],
    ["document", "filename", undefined],
    ["document", "filename", "x".repeat(1025)],
  ] as const)(
    "rejects an app %s echo with invalid %s media metadata",
    (kind, field, value) => {
      const payload = messageEchoFixture(kind) as Record<string, any>;
      payload.entry[0].changes[0].value.message_echoes[0][kind][field] = value;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it.each([
    ["id", undefined],
    ["id", "x".repeat(513)],
    ["id", " wamid.echo-edit"],
    ["id", "wamid.echo-edit\u0000suffix"],
    ["original_message_id", undefined],
    ["original_message_id", "x".repeat(513)],
    ["original_message_id", " wamid.echo-original"],
    ["original_message_id", "wamid.echo-original "],
    ["original_message_id", "wamid.echo\u0000original"],
  ] as const)("rejects an app control with invalid %s", (field, value) => {
    const payload = messageEchoControlFixture("edit") as Record<string, any>;
    const echo = payload.entry[0].changes[0].value.message_echoes[0];
    if (field === "id") echo.id = value;
    else echo.edit[field] = value;

    expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
  });

  it.each([undefined, null, {}, "invalid"])(
    "rejects an invalid message_echoes collection without exposing payload markers",
    (messageEchoes) => {
      const payload = messageEchoFixture() as Record<string, any>;
      const marker = "private-echo-marker";
      payload.entry[0].changes[0].value.message_echoes = messageEchoes;
      payload.entry[0].changes[0].value.private = marker;

      try {
        normalizeWebhook(payload);
        throw new Error("expected normalizeWebhook to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookPayloadError);
        expect(String(error)).not.toContain(marker);
      }
    },
  );

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
    ["id", " wamid.text-1"],
    ["id", "wamid.text\u0000-1"],
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

  it.each([" wamid.outbound-1", "wamid.outbound\u0000-1"])(
    "rejects a status whose deduplication ID is not exact",
    (id) => {
      const payload = statusFixture("delivered") as Record<string, any>;
      payload.entry[0].changes[0].value.statuses[0].id = id;

      expect(() => normalizeWebhook(payload)).toThrow(WebhookPayloadError);
    },
  );

  it("continues to ignore an unknown status even when it has no event metadata", () => {
    const payload = statusFixture("deleted") as Record<string, any>;
    payload.entry[0].changes[0].value.statuses = [{ status: "deleted" }];

    expect(normalizeWebhook(payload)).toEqual([]);
  });
});
