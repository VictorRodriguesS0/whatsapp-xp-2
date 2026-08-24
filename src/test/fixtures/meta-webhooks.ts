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

type MutationAction = "edit" | "revoke";
type MutationContent = "text" | "image";

function mutationControl(
  action: MutationAction,
  content: MutationContent,
  originalMessageId: string,
) {
  if (action === "revoke") {
    return { original_message_id: originalMessageId };
  }

  return {
    original_message_id: originalMessageId,
    message: content === "text"
      ? { type: "text", text: { body: "Texto corrigido" } }
      : {
          type: "image",
          image: {
            caption: "Legenda corrigida",
            mime_type: "image/jpeg",
            sha256: "provider-field-not-persisted",
            id: "provider-media-id-not-replaced",
          },
        },
  };
}

export function inboundMutationFixture(
  action: MutationAction,
  content: MutationContent = "text",
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "synthetic-waba",
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
                  id: `wamid.inbound-${action}-${content}`,
                  timestamp: "1787133660",
                  type: action,
                  [action]: mutationControl(
                    action,
                    content,
                    `wamid.inbound-original-${content}`,
                  ),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function messageEchoMutationFixture(
  action: MutationAction,
  content: MutationContent = "text",
) {
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
                  id: `wamid.echo-${action}-${content}`,
                  timestamp: "1787133661",
                  type: action,
                  [action]: mutationControl(
                    action,
                    content,
                    `wamid.echo-original-${content}`,
                  ),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const operationalTime = 1787486400;

function operationalFixture(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", time: operationalTime, changes: [{ field, value }] }],
  };
}

export const phoneQualityFixture = (event = "FLAGGED") =>
  operationalFixture("phone_number_quality_update", {
    event,
    display_phone_number: "+5561999990000",
    current_limit: "TIER_10K",
    previous_limit: "TIER_1K",
    private_provider_field: "must-not-survive",
  });

export const accountUpdateFixture = (event = "DISABLED_UPDATE") =>
  operationalFixture("account_update", {
    event,
    phone_number: "+5561999990000",
    current_limit: "TIER_10K",
  });

export const accountReviewFixture = (decision = "PENDING") =>
  operationalFixture("account_review_update", { decision });

export const phoneNameFixture = (decision = "REJECTED") =>
  operationalFixture("phone_number_name_update", {
    decision,
    display_phone_number: "+5561999990000",
    requested_verified_name: "XP Eletrônicos",
    rejection_reason: "provider-only-copy",
  });

export const templateStatusFixture = (event = "REJECTED") =>
  operationalFixture("message_template_status_update", {
    event,
    message_template_id: "template-1",
    message_template_name: "aviso_produto",
    message_template_language: "pt_BR",
    reason: "provider-only-copy",
  });

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
