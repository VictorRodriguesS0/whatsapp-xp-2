import { MessageStatus, MessageType } from "@/generated/prisma/enums";

import type {
  NormalizedMedia,
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
  NormalizedMessageEvent,
  NormalizedStatusEvent,
  NormalizedWebhookEvent,
} from "./types";

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

function normalizeMessage(
  candidate: unknown,
  contactNames: Map<string, string>,
): NormalizedMessageEvent | null {
  const message = record(candidate);
  const whatsappMessageId = cleanString(message?.id, 512);
  const from = whatsappUserId(message?.from);
  const rawType = cleanString(message?.type, 64);
  const parsedTimestamp = parseTimestamp(message?.timestamp);

  if (!message || !whatsappMessageId || !from || !rawType || !parsedTimestamp) {
    return null;
  }

  const type = typeMap.get(rawType) ?? MessageType.UNSUPPORTED;
  let body: string | null = null;
  let media: NormalizedMedia | null = null;

  if (type === MessageType.TEXT) {
    const text = record(message.text);
    body = cleanString(text?.body, 4096, { trim: false });

    if (!text || !body) {
      return null;
    }
  } else if (type !== MessageType.UNSUPPORTED) {
    const normalizedMedia = normalizeMedia(message, rawType);

    if (!normalizedMedia) {
      return null;
    }

    body = normalizedMedia.body;
    media = normalizedMedia.media;
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
    media,
  };
}

function normalizeMessageEcho(
  candidate: unknown,
): NormalizedMessageEchoEvent | NormalizedMessageEchoControlEvent | null {
  const message = record(candidate);
  const whatsappMessageId = strictCleanString(message?.id, 512);
  const to = canonicalWhatsappUserId(message?.to);
  const rawType = strictCleanString(message?.type, 64);
  const parsedTimestamp = parseTimestamp(message?.timestamp);

  if (!message || !whatsappMessageId || !to || !rawType || !parsedTimestamp) {
    return null;
  }

  if (rawType === "edit" || rawType === "revoke") {
    const control = record(message[rawType]);
    const originalWhatsappMessageId = strictCleanString(
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
      timestamp: parsedTimestamp.date,
      timestampRaw: parsedTimestamp.raw,
      origin: "WHATSAPP_BUSINESS_APP",
    };
  }

  const type = typeMap.get(rawType) ?? MessageType.UNSUPPORTED;
  let body: string | null = null;
  let media: NormalizedMedia | null = null;

  if (type === MessageType.TEXT) {
    const text = record(message.text);
    body = strictCleanString(text?.body, 4096, { trim: false });

    if (!text || !body) {
      return null;
    }
  } else if (type !== MessageType.UNSUPPORTED) {
    const normalizedMedia = normalizeEchoMedia(message, rawType);

    if (!normalizedMedia) {
      return null;
    }

    body = normalizedMedia.body;
    media = normalizedMedia.media;
  }

  return {
    kind: "messageEcho",
    whatsappMessageId,
    to,
    timestamp: parsedTimestamp.date,
    timestampRaw: parsedTimestamp.raw,
    type,
    body,
    media,
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

  const whatsappMessageId = cleanString(status.id, 512);
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

      if (field !== "messages" && field !== "smb_message_echoes") {
        continue;
      }

      const value = record(change.value);

      if (!value) {
        throw new WebhookPayloadError();
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
