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

function inboundRichFixture(
  type: string,
  content: unknown,
  id = `wamid.${type}-1`,
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
              contacts: [
                {
                  profile: { name: "Ana Cliente" },
                  wa_id: "5511999990001",
                },
              ],
              messages: [
                {
                  from: "5511999990001",
                  id,
                  timestamp: "1787133603",
                  type,
                  [type]: content,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function stickerFixture(
  overrides: Record<string, unknown> = {},
) {
  return inboundRichFixture("sticker", {
    id: "meta-sticker-1",
    mime_type: "image/webp",
    animated: true,
    ...overrides,
  });
}

export const inboundStickerFixture = stickerFixture();

export function locationFixture(
  overrides: Record<string, unknown> = {},
) {
  return inboundRichFixture("location", {
    latitude: -15.793889,
    longitude: -47.882778,
    name: "XP Eletrônicos",
    address: "Brasília - DF",
    url: "https://provider.example/field-that-must-not-survive",
    ...overrides,
  });
}

export const inboundLocationFixture = locationFixture();

export function contactsFixture(count = 2) {
  return inboundRichFixture(
    "contacts",
    Array.from({ length: count }, (_, index) => ({
      name: {
        formatted_name: index === 0 ? "Maria Silva" : `Contato ${index + 1}`,
        first_name: index === 0 ? "Maria" : "Contato",
        last_name: index === 0 ? "Silva" : `${index + 1}`,
      },
      phones: [
        {
          phone: index === 0 ? "+55 61 99999-0000" : `+55 61 99999-${String(index).padStart(4, "0")}`,
          wa_id: `556199999${String(index).padStart(4, "0")}`,
          type: "CELL",
        },
      ],
      emails: [{ email: `private-${index}@example.com`, type: "WORK" }],
      org: { company: "Provider-only field" },
    })),
  );
}

export const inboundContactsFixture = contactsFixture();

export function buttonFixture(
  overrides: Record<string, unknown> = {},
) {
  return inboundRichFixture("button", {
    payload: "buy_now",
    text: "Quero comprar",
    ...overrides,
  });
}

export const inboundButtonFixture = buttonFixture();

export const inboundListReplyFixture = inboundRichFixture("interactive", {
  type: "list_reply",
  list_reply: {
    id: "technical_support",
    title: "Assistência técnica",
    description: "Provider field that must not survive",
  },
});

export const inboundOrderFixture = inboundRichFixture("order", {
  catalog_id: "catalog-123",
  product_items: [
    {
      product_retailer_id: "sku-1",
      quantity: "1",
      item_price: "99.90",
      currency: "BRL",
    },
    {
      product_retailer_id: "sku-2",
      quantity: "2",
      item_price: "49.90",
      currency: "BRL",
    },
  ],
  text: "Provider field that must not survive",
});

export const inboundSystemFixture = inboundRichFixture("system", {
  body: "Número alterado",
  type: "user_changed_number",
  wa_id: "provider-internal-id",
});

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
                id: "wamid.reaction-1",
                timestamp: "1787133603",
                type: "reaction",
                reaction: {
                  message_id: "wamid.provider-only",
                  emoji: "👍",
                },
              },
            ],
          },
        },
      ],
    },
  ],
} as const;
