import { createHash } from "node:crypto";

import { MessageStatus, MessageType } from "@/generated/prisma/enums";
import {
  parseMessageContent,
  type MessageContent,
} from "@/modules/messages/content";

import type {
  NormalizedMedia,
  NormalizedContactSyncBatchEvent,
  NormalizedContactSyncItem,
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
  NormalizedReactionEchoEvent,
  NormalizedReactionEvent,
  NormalizedStatusEvent,
  NormalizedWebhookEvent,
} from "./types";
import { isSingleEmoji } from "@/modules/reactions/emoji";

type UnknownRecord = Record<string, unknown>;

const statusMap = new Map<string, NormalizedStatusEvent["status"]>([
  ["sent", MessageStatus.SENT],
  ["delivered", MessageStatus.DELIVERED],
  ["read", MessageStatus.READ],
  ["failed", MessageStatus.FAILED],
]);

const typeMap = new Map<string, MessageType>([
  ["text", MessageType.TEXT],
  ["image", MessageType.IMAGE],
  ["audio", MessageType.AUDIO],
  ["video", MessageType.VIDEO],
  ["document", MessageType.DOCUMENT],
  ["sticker", MessageType.STICKER],
  ["location", MessageType.LOCATION],
  ["contacts", MessageType.CONTACTS],
  ["button", MessageType.INTERACTIVE],
  ["interactive", MessageType.INTERACTIVE],
  ["order", MessageType.ORDER],
  ["system", MessageType.SYSTEM],
]);

export class WebhookPayloadError extends Error {
  constructor() {
    super("Payload do webhook inválido");
    this.name = "WebhookPayloadError";
  }
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cleanString(
  value: unknown,
  maximumLength: number,
  options: { trim?: boolean } = {},
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const withoutUnsafeControls = value.replace(
    options.trim === false ? /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g,
    "",
  );
  const cleaned = options.trim === false ? withoutUnsafeControls : withoutUnsafeControls.trim();
  return cleaned ? cleaned.slice(0, maximumLength) : null;
}

function cleanFilename(value: unknown): string | null {
  const cleaned = cleanString(value, 1024);

  if (!cleaned) {
    return null;
  }

  const basename = cleaned.split(/[\\/]/).at(-1)?.trim();
  return basename ? basename.slice(0, 255) : null;
}

function strictCleanString(
  value: unknown,
  maximumLength: number,
  options: { trim?: boolean } = {},
): string | null {
  if (typeof value !== "string" || value.length > maximumLength) {
    return null;
  }

  return cleanString(value, maximumLength, options);
}

function exactIdentifier(value: unknown, maximumLength: number): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\s\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return null;
  }

  return value;
}

function replyContextId(message: UnknownRecord): string | null | undefined {
  if (!hasOwn(message, "context")) return null;
  const context = record(message.context);
  if (!context) return undefined;
  if (!hasOwn(context, "id")) return null;
  return exactIdentifier(context.id, 512) ?? undefined;
}

function businessScopedUserId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(value)
    ? value
    : null;
}

function parentBusinessScopedUserId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Z]{2}\.ENT\.[A-Za-z0-9]{1,128}$/.test(value)
    ? value
    : null;
}

function strictFilename(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1024
    ? cleanFilename(value)
    : null;
}

function parseTimestamp(value: unknown): { date: Date; raw: string } | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) {
    return null;
  }

  const milliseconds = Number(value) * 1000;
  const date = new Date(milliseconds);

  return Number.isSafeInteger(milliseconds) && !Number.isNaN(date.getTime())
    ? { date, raw: value }
    : null;
}

function whatsappUserId(value: unknown): string | null {
  const cleaned = cleanString(value, 32);
  return cleaned && /^\d{1,32}$/.test(cleaned) ? cleaned : null;
}

function canonicalWhatsappUserId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^[+()\d.\s-]+$/.test(value)
  ) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return /^\d{1,32}$/.test(digits) ? digits : null;
}

function contactsByWhatsappId(value: UnknownRecord): Map<string, string> {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const names = new Map<string, string>();

  for (const item of contacts) {
    const contact = record(item);
    const profile = record(contact?.profile);
    const whatsappId = cleanString(contact?.wa_id, 64);
    const name = cleanString(profile?.name, 256);

    if (whatsappId && name) {
      names.set(whatsappId, name);
    }
  }

  return names;
}

function normalizeMedia(
  message: UnknownRecord,
  rawType: string,
): { media: NormalizedMedia; body: string | null } | null {
  const media = record(message[rawType]);
  const metaMediaId = cleanString(media?.id, 512);
  const mimeType = cleanString(media?.mime_type, 255);
  const sha256 = cleanString(media?.sha256, 256);

  if (!media || !metaMediaId || !mimeType || !sha256) {
    return null;
  }

  return {
    media: {
      metaMediaId,
      mimeType,
      sha256,
      filename: cleanFilename(media.filename),
    },
    body: cleanString(media.caption, 4096, { trim: false }),
  };
}

function normalizeEchoMedia(
  message: UnknownRecord,
  rawType: string,
): { media: NormalizedMedia; body: string | null } | null {
  const media = record(message[rawType]);

  if (!media) {
    return null;
  }

  const metaMediaId = strictCleanString(media.id, 512);
  const mimeType = strictCleanString(media.mime_type, 255);
  const sha256 = strictCleanString(media.sha256, 256);
  const filename = hasOwn(media, "filename")
    ? strictFilename(media.filename)
    : null;
  const hasCaption = hasOwn(media, "caption");
  const body = hasCaption
    ? cleanString(media.caption, 4096, { trim: false })
    : null;

  if (
    !metaMediaId ||
    !mimeType ||
    !sha256 ||
    (hasOwn(media, "filename") && !filename) ||
    (rawType === "document" && !filename) ||
    (hasCaption &&
      (typeof media.caption !== "string" || media.caption.length > 4096))
  ) {
    return null;
  }

  return {
    media: { metaMediaId, mimeType, sha256, filename },
    body,
  };
}

function optionalStrictString(
  value: unknown,
  maximumLength: number,
): { valid: boolean; value: string | null } {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }

  const cleaned = strictCleanString(value, maximumLength);
  return { valid: cleaned !== null, value: cleaned };
}

function normalizeStickerMedia(message: UnknownRecord): NormalizedMedia | null {
  const sticker = record(message.sticker);

  if (!sticker) {
    return null;
  }

  const metaMediaId = strictCleanString(sticker.id, 512);
  const mimeType = strictCleanString(sticker.mime_type, 255);
  const hasSha256 = hasOwn(sticker, "sha256");
  const sha256 = hasSha256 ? strictCleanString(sticker.sha256, 256) : null;

  if (!metaMediaId || mimeType !== "image/webp" || (hasSha256 && !sha256)) {
    return null;
  }

  return { metaMediaId, mimeType, sha256, filename: null };
}

function normalizeLocation(message: UnknownRecord): MessageContent | null {
  const location = record(message.location);

  if (!location) {
    return null;
  }

  const name = optionalStrictString(location.name, 256);
  const address = optionalStrictString(location.address, 512);

  if (!name.valid || !address.valid) {
    return null;
  }

  return parseMessageContent({
    kind: "location",
    latitude: location.latitude,
    longitude: location.longitude,
    name: name.value,
    address: address.value,
  });
}

function normalizeContacts(message: UnknownRecord): MessageContent | null {
  if (
    !Array.isArray(message.contacts) ||
    message.contacts.length === 0 ||
    message.contacts.length > 20
  ) {
    return null;
  }

  const contacts: Array<{
    name: string;
    phones: Array<{ phone: string; type: string | null }>;
  }> = [];

  for (const candidate of message.contacts) {
    const contact = record(candidate);
    const name = record(contact?.name);
    const formattedName = strictCleanString(name?.formatted_name, 256);

    if (!contact || !name || !formattedName) {
      return null;
    }

    const rawPhones = contact.phones === undefined ? [] : contact.phones;

    if (!Array.isArray(rawPhones) || rawPhones.length > 10) {
      return null;
    }

    const phones: Array<{ phone: string; type: string | null }> = [];

    for (const candidatePhone of rawPhones) {
      const providerPhone = record(candidatePhone);
      const phone = strictCleanString(providerPhone?.phone, 32);
      const phoneType = optionalStrictString(providerPhone?.type, 256);

      if (!providerPhone || !phone || !phoneType.valid) {
        return null;
      }

      phones.push({ phone, type: phoneType.value });
    }

    contacts.push({ name: formattedName, phones });
  }

  return parseMessageContent({ kind: "contacts", contacts, truncated: false });
}

function normalizeInteractive(
  message: UnknownRecord,
  rawType: string,
): MessageContent | null {
  if (rawType === "button") {
    const button = record(message.button);

    if (!button) {
      return null;
    }

    return parseMessageContent({
      kind: "interactive",
      interaction: "button",
      id: strictCleanString(button.payload, 256),
      title: strictCleanString(button.text, 256),
    });
  }

  const interactive = record(message.interactive);
  const interactionType = exactBoundedProviderString(interactive?.type, 64);

  if (!interactive || !interactionType) {
    return null;
  }

  const isButton = interactionType === "button_reply";
  const isList = interactionType === "list_reply";

  if (!isButton && !isList) {
    return null;
  }

  const reply = record(interactive[isButton ? "button_reply" : "list_reply"]);

  if (!reply) {
    return null;
  }

  return parseMessageContent({
    kind: "interactive",
    interaction: isButton ? "button" : "list",
    id: strictCleanString(reply.id, 256),
    title: strictCleanString(reply.title, 256),
  });
}

function exactBoundedProviderString(
  value: unknown,
  maximumLength: number,
): string | null {
  const cleaned = strictCleanString(value, maximumLength);
  return cleaned === value ? cleaned : null;
}

function validOrderProductItem(value: unknown): boolean {
  const item = record(value);

  if (!item) {
    return false;
  }

  const productRetailerId = exactBoundedProviderString(
    item.product_retailer_id,
    256,
  );
  const hasRetailerId = hasOwn(item, "retailer_id");
  const retailerId = hasRetailerId
    ? exactBoundedProviderString(item.retailer_id, 256)
    : null;

  if (!productRetailerId || (hasRetailerId && !retailerId)) {
    return false;
  }

  if (
    typeof item.quantity !== "string" ||
    !/^[1-9]\d{0,3}$/.test(item.quantity)
  ) {
    return false;
  }

  const quantity = Number(item.quantity);

  if (!Number.isSafeInteger(quantity) || quantity > 1_000) {
    return false;
  }

  const hasItemPrice = hasOwn(item, "item_price");
  const hasCurrency = hasOwn(item, "currency");

  if (hasItemPrice !== hasCurrency) {
    return false;
  }

  if (!hasItemPrice) {
    return true;
  }

  const itemPrice = exactBoundedProviderString(item.item_price, 64);
  const currency = exactBoundedProviderString(item.currency, 3);
  const numericItemPrice = itemPrice === null ? Number.NaN : Number(itemPrice);

  return Boolean(
    itemPrice &&
      /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(itemPrice) &&
      Number.isFinite(numericItemPrice) &&
      numericItemPrice <= Number.MAX_SAFE_INTEGER &&
      currency &&
      /^[A-Z]{3}$/.test(currency),
  );
}

function normalizeOrder(message: UnknownRecord): MessageContent | null {
  const order = record(message.order);

  if (
    !order ||
    !Array.isArray(order.product_items) ||
    order.product_items.length > 1_000
  ) {
    return null;
  }

  const catalogId = optionalStrictString(order.catalog_id, 256);

  if (
    !catalogId.valid ||
    !order.product_items.every(validOrderProductItem)
  ) {
    return null;
  }

  return parseMessageContent({
    kind: "order",
    catalogId: catalogId.value,
    productCount: order.product_items.length,
  });
}

function normalizeSystem(message: UnknownRecord): MessageContent | null {
  const system = record(message.system);

  if (!system) {
    return null;
  }

  const text = optionalStrictString(system.body, 512);

  return text.valid
    ? parseMessageContent({ kind: "system", text: text.value })
    : null;
}

function normalizeStructuredContent(
  message: UnknownRecord,
  rawType: string,
): MessageContent | null {
  switch (rawType) {
    case "location":
      return normalizeLocation(message);
    case "contacts":
      return normalizeContacts(message);
    case "button":
    case "interactive":
      return normalizeInteractive(message, rawType);
    case "order":
      return normalizeOrder(message);
    case "system":
      return normalizeSystem(message);
    default:
      return null;
  }
}

function normalizeUnknownContent(message: UnknownRecord): MessageContent | null {
  return parseMessageContent({ kind: "unknown", rawType: message.type });
}

function normalizeMessage(
  candidate: unknown,
  contactNames: Map<string, string>,
): NormalizedMessageEvent | NormalizedReactionEvent | null {
  const message = record(candidate);
  const whatsappMessageId = exactIdentifier(message?.id, 512);
  const from = whatsappUserId(message?.from);
  const rawType = exactBoundedProviderString(message?.type, 64);
  const parsedTimestamp = parseTimestamp(message?.timestamp);

  if (!message || !whatsappMessageId || !from || !rawType || !parsedTimestamp) {
    return null;
  }

  if (rawType === "reaction") {
    const reaction = record(message.reaction);
    const targetWhatsappMessageId = exactIdentifier(reaction?.message_id, 512);
    const emoji = reaction?.emoji;
    if (
      !reaction ||
      !targetWhatsappMessageId ||
      typeof emoji !== "string" ||
      (emoji !== "" && !isSingleEmoji(emoji))
    ) {
      return null;
    }
    return {
      kind: "reaction",
      whatsappMessageId,
      targetWhatsappMessageId,
      from,
      contactName: contactNames.get(from) ?? null,
      emoji,
      timestamp: parsedTimestamp.date,
      timestampRaw: parsedTimestamp.raw,
    };
  }

  const replyToWhatsappMessageId = replyContextId(message);
  if (replyToWhatsappMessageId === undefined) return null;

  const type = typeMap.get(rawType) ?? MessageType.UNSUPPORTED;
  let body: string | null = null;
  let content: MessageContent | null = null;
  let media: NormalizedMedia | null = null;

  if (type === MessageType.TEXT) {
    const text = record(message.text);
    body = cleanString(text?.body, 4096, { trim: false });

    if (!text || !body) {
      return null;
    }
  } else if (
    type === MessageType.IMAGE ||
    type === MessageType.AUDIO ||
    type === MessageType.VIDEO ||
    type === MessageType.DOCUMENT
  ) {
    const normalizedMedia = normalizeMedia(message, rawType);

    if (!normalizedMedia) {
      return null;
    }

    body = normalizedMedia.body;
    media = normalizedMedia.media;
  } else if (type === MessageType.STICKER) {
    media = normalizeStickerMedia(message);

    if (!media) {
      return null;
    }
  } else if (type === MessageType.UNSUPPORTED) {
    content = normalizeUnknownContent(message);
  } else {
    content = normalizeStructuredContent(message, rawType);

    if (!content) {
      return null;
    }
  }

  return {
    kind: "message",
    whatsappMessageId,
    from,
    contactName: contactNames.get(from) ?? null,
    timestamp: parsedTimestamp.date,
    timestampRaw: parsedTimestamp.raw,
    type,
    body,
    content,
    media,
    replyToWhatsappMessageId,
  };
}

function normalizeContactSyncName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return null;
  }

  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned || null;
}

function normalizeContactSyncPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return null;
  }

  const digits = value.replace(/\D/gu, "");
  return /^\d{1,32}$/u.test(digits) ? digits : null;
}

function contactSyncVersionKey(input: {
  action: "ADD" | "REMOVE";
  phone: string;
  fullName: string | null;
  timestamp: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function normalizeContactSyncItem(candidate: unknown): NormalizedContactSyncItem | null {
  const item = record(candidate);
  const contact = record(item?.contact);
  const metadata = record(item?.metadata);

  if (!item || item.type !== "contact" || !contact || !metadata) {
    return null;
  }

  const action = item.action === "add"
    ? "ADD"
    : item.action === "remove"
      ? "REMOVE"
      : null;
  const phone = normalizeContactSyncPhone(contact.phone_number);
  const parsedTimestamp = parseTimestamp(metadata.timestamp);
  const fullName = action === "ADD"
    ? normalizeContactSyncName(contact.full_name)
    : null;

  if (!action || !phone || !parsedTimestamp || (action === "ADD" && !fullName)) {
    return null;
  }

  return {
    action,
    phone,
    fullName,
    sourceTimestamp: parsedTimestamp.date,
    sourceTimestampRaw: parsedTimestamp.raw,
    sourceVersionKey: contactSyncVersionKey({
      action,
      phone,
      fullName,
      timestamp: parsedTimestamp.raw,
    }),
  };
}

function normalizeContactSyncBatch(value: UnknownRecord): NormalizedContactSyncBatchEvent {
  if (!Array.isArray(value.state_sync) || value.state_sync.length > 5_000) {
    throw new WebhookPayloadError();
  }

  const items: NormalizedContactSyncItem[] = [];
  let quarantined = 0;

  for (const candidate of value.state_sync) {
    const item = normalizeContactSyncItem(candidate);
    if (item) items.push(item);
    else quarantined += 1;
  }

  return { kind: "contactSyncBatch", items, quarantined };
}

function normalizeMessageEcho(
  candidate: unknown,
): NormalizedMessageEchoEvent | NormalizedMessageEchoControlEvent | NormalizedReactionEchoEvent | null {
  const message = record(candidate);
  const whatsappMessageId = exactIdentifier(message?.id, 512);
  const hasLegacyRecipient = message ? hasOwn(message, "to") : false;
  const to = hasLegacyRecipient ? canonicalWhatsappUserId(message?.to) : null;
  const hasUserId = message ? hasOwn(message, "to_user_id") : false;
  const toUserId = hasUserId ? businessScopedUserId(message?.to_user_id) : null;
  const hasParentUserId = message ? hasOwn(message, "to_parent_user_id") : false;
  const toParentUserId = hasParentUserId
    ? parentBusinessScopedUserId(message?.to_parent_user_id)
    : null;
  const rawType = exactBoundedProviderString(message?.type, 64);
  const parsedTimestamp = parseTimestamp(message?.timestamp);

  if (
    !message ||
    !whatsappMessageId ||
    (hasLegacyRecipient && !to) ||
    (hasUserId && !toUserId) ||
    (!to && !toUserId) ||
    (hasParentUserId && !toParentUserId) ||
    !rawType ||
    !parsedTimestamp
  ) {
    return null;
  }

  if (rawType === "edit" || rawType === "revoke") {
    const control = record(message[rawType]);
    const originalWhatsappMessageId = exactIdentifier(
      control?.original_message_id,
      512,
    );

    if (!control || !originalWhatsappMessageId) {
      return null;
    }

    return {
      kind: "messageEchoControl",
      action: rawType === "edit" ? "EDIT" : "REVOKE",
      whatsappMessageId,
      originalWhatsappMessageId,
      to,
      toUserId,
      toParentUserId,
      timestamp: parsedTimestamp.date,
      timestampRaw: parsedTimestamp.raw,
      origin: "WHATSAPP_BUSINESS_APP",
    };
  }

  if (rawType === "reaction") {
    const reaction = record(message.reaction);
    const targetWhatsappMessageId = exactIdentifier(reaction?.message_id, 512);
    const emoji = reaction?.emoji;
    if (
      !reaction ||
      !targetWhatsappMessageId ||
      typeof emoji !== "string" ||
      (emoji !== "" && !isSingleEmoji(emoji))
    ) {
      return null;
    }
    return {
      kind: "reactionEcho",
      whatsappMessageId,
      targetWhatsappMessageId,
      to,
      toUserId,
      toParentUserId,
      emoji,
      timestamp: parsedTimestamp.date,
      timestampRaw: parsedTimestamp.raw,
      origin: "WHATSAPP_BUSINESS_APP",
    };
  }

  const replyToWhatsappMessageId = replyContextId(message);
  if (replyToWhatsappMessageId === undefined) return null;

  const type = typeMap.get(rawType) ?? MessageType.UNSUPPORTED;
  let body: string | null = null;
  let content: MessageContent | null = null;
  let media: NormalizedMedia | null = null;

  if (type === MessageType.TEXT) {
    const text = record(message.text);
    body = strictCleanString(text?.body, 4096, { trim: false });

    if (!text || !body) {
      return null;
    }
  } else if (
    type === MessageType.IMAGE ||
    type === MessageType.AUDIO ||
    type === MessageType.VIDEO ||
    type === MessageType.DOCUMENT
  ) {
    const normalizedMedia = normalizeEchoMedia(message, rawType);

    if (!normalizedMedia) {
      return null;
    }

    body = normalizedMedia.body;
    media = normalizedMedia.media;
  } else if (type === MessageType.STICKER) {
    media = normalizeStickerMedia(message);

    if (!media) {
      return null;
    }
  } else if (type === MessageType.UNSUPPORTED) {
    content = normalizeUnknownContent(message);
  } else {
    content = normalizeStructuredContent(message, rawType);

    if (!content) {
      return null;
    }
  }

  return {
    kind: "messageEcho",
    whatsappMessageId,
    to,
    toUserId,
    toParentUserId,
    timestamp: parsedTimestamp.date,
    timestampRaw: parsedTimestamp.raw,
    type,
    body,
    content,
    media,
    replyToWhatsappMessageId,
    origin: "WHATSAPP_BUSINESS_APP",
  };
}

function failureReason(status: UnknownRecord): string | null {
  const firstError = Array.isArray(status.errors) ? record(status.errors[0]) : null;

  if (!firstError) {
    return null;
  }

  const code =
    typeof firstError.code === "number" || typeof firstError.code === "string"
      ? String(firstError.code).slice(0, 32)
      : null;
  const title = cleanString(firstError.title, 160);
  const message = cleanString(firstError.message, 320);
  const description = [title, message].filter(Boolean).join(" - ");

  return [code, description].filter(Boolean).join(": ").slice(0, 500) || null;
}

function normalizeStatus(candidate: unknown): NormalizedStatusEvent | null {
  const status = record(candidate);
  const rawStatus = cleanString(status?.status, 32);

  if (!status || !rawStatus) {
    throw new WebhookPayloadError();
  }

  const normalizedStatus = statusMap.get(rawStatus);

  if (!normalizedStatus) {
    return null;
  }

  const whatsappMessageId = exactIdentifier(status.id, 512);
  const parsedTimestamp = parseTimestamp(status.timestamp);
  const recipientId = whatsappUserId(status.recipient_id);

  if (!whatsappMessageId || !parsedTimestamp || !recipientId) {
    throw new WebhookPayloadError();
  }

  return {
    kind: "status",
    whatsappMessageId,
    status: normalizedStatus,
    timestamp: parsedTimestamp.date,
    timestampRaw: parsedTimestamp.raw,
    failureReason:
      normalizedStatus === MessageStatus.FAILED ? failureReason(status) : null,
  };
}

export function normalizeWebhook(payload: unknown): NormalizedWebhookEvent[] {
  const root = record(payload);

  if (root?.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) {
    throw new WebhookPayloadError();
  }

  const events: NormalizedWebhookEvent[] = [];

  for (const entryCandidate of root.entry) {
    const entry = record(entryCandidate);

    if (!entry || !Array.isArray(entry.changes)) {
      throw new WebhookPayloadError();
    }

    const changes = entry.changes;

    for (const changeCandidate of changes) {
      const change = record(changeCandidate);

      if (!change) {
        throw new WebhookPayloadError();
      }

      const field = cleanString(change.field, 128);

      if (!field) {
        throw new WebhookPayloadError();
      }

      if (
        field !== "messages" &&
        field !== "smb_message_echoes" &&
        field !== "smb_app_state_sync"
      ) {
        continue;
      }

      const value = record(change.value);

      if (!value) {
        throw new WebhookPayloadError();
      }

      if (field === "smb_app_state_sync") {
        events.push(normalizeContactSyncBatch(value));
        continue;
      }

      if (field === "smb_message_echoes") {
        if (!Array.isArray(value.message_echoes)) {
          throw new WebhookPayloadError();
        }

        for (const messageEcho of value.message_echoes) {
          const normalized = normalizeMessageEcho(messageEcho);

          if (!normalized) {
            throw new WebhookPayloadError();
          }

          events.push(normalized);
        }

        continue;
      }

      const contactNames = contactsByWhatsappId(value);

      if (hasOwn(value, "messages") && !Array.isArray(value.messages)) {
        throw new WebhookPayloadError();
      }

      if (hasOwn(value, "statuses") && !Array.isArray(value.statuses)) {
        throw new WebhookPayloadError();
      }

      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      for (const message of messages) {
        const normalized = normalizeMessage(message, contactNames);
        if (!normalized) {
          throw new WebhookPayloadError();
        }
        events.push(normalized);
      }

      for (const status of statuses) {
        const normalized = normalizeStatus(status);
        if (normalized) events.push(normalized);
      }
    }
  }

  return events;
}
