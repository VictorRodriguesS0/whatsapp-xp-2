export const inboundTextFixture = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "123456789",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550001111",
              phone_number_id: "987654321",
            },
            contacts: [
              {
                profile: { name: "Ana Cliente" },
                wa_id: "5511999990001",
              },
            ],
            messages: [
              {
                from: "5511999990001",
                id: "wamid.text-1",
                timestamp: "1787133600",
                text: { body: "Hi!" },
                type: "text",
              },
            ],
          },
        },
      ],
    },
  ],
} as const;

type MediaKind = "image" | "audio" | "video" | "document";

export function inboundMediaFixture(kind: MediaKind) {
  const media = {
    id: `meta-${kind}-1`,
    mime_type:
      kind === "image"
        ? "image/jpeg"
        : kind === "audio"
          ? "audio/ogg"
          : kind === "video"
            ? "video/mp4"
            : "application/pdf",
    sha256: `${kind}-sha256`,
    ...(kind === "audio" ? {} : { caption: `Legenda ${kind}` }),
    ...(kind === "document" ? { filename: "../../nota\u0000 fiscal.pdf" } : {}),
  };

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              contacts: [
                {
                  profile: { name: "Ana Cliente" },
                  wa_id: "5511999990001",
                },
              ],
              messages: [
                {
                  from: "5511999990001",
                  id: `wamid.${kind}-1`,
                  timestamp: "1787133601",
                  type: kind,
                  [kind]: media,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusFixture(
  status: string,
  timestamp = "1787133602",
  id = "wamid.outbound-1",
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: [
                {
                  id,
                  status,
                  timestamp,
                  recipient_id: "5511999990001",
                  ...(status === "failed"
                    ? {
                        errors: [
                          {
                            code: 131047,
                            title: "Re-engagement message",
                            message: "Customer service window elapsed\u0000",
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export const unsupportedMessageFixture = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "123456789",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            contacts: [
              { profile: { name: "Ana Cliente" }, wa_id: "5511999990001" },
            ],
            messages: [
              {
                from: "5511999990001",
                id: "wamid.sticker-1",
                timestamp: "1787133603",
                type: "sticker",
                sticker: { id: "meta-sticker-1", mime_type: "image/webp" },
              },
            ],
          },
        },
      ],
    },
  ],
} as const;
