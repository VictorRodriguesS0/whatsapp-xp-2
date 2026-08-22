import { parseMessageContent } from "@/modules/messages/content";

export type MessageSearchTextInput = {
  body: string | null;
  content: unknown;
  originalFilename?: string | null;
};

type SearchPart = string | number | null | undefined;

export function normalizeSearchText(parts: SearchPart[]): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildMessageSearchText(input: MessageSearchTextInput): string {
  const content = parseMessageContent(input.content);
  const parts: SearchPart[] = [input.body, input.originalFilename];

  if (content?.kind === "location") {
    parts.push(content.name, content.address, content.latitude, content.longitude);
  }

  if (content?.kind === "contacts") {
    for (const contact of content.contacts) {
      parts.push(contact.name);
      for (const phone of contact.phones) parts.push(phone.phone, phone.type);
    }
  }

  if (content?.kind === "interactive") parts.push(content.title, content.id);
  if (content?.kind === "system") parts.push(content.text);

  return normalizeSearchText(parts);
}
