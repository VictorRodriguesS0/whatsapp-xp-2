import { describe, expect, it } from "vitest";

import { MessageDirection, MessageType } from "@/generated/prisma/enums";

import {
  quotedReplyPreview,
  whatsappMessageIdSchema,
} from "./reply-context";

const baseSource = {
  id: "20000000-0000-4000-8000-000000000001",
  direction: MessageDirection.INBOUND,
  type: MessageType.TEXT,
  body: "Produto disponível amanhã",
  content: null,
  sentBy: null,
};

describe("quoted reply public contract", () => {
  it("accepts exact official IDs and rejects altered or unsafe values", () => {
    expect(whatsappMessageIdSchema.safeParse("wamid.reply-1").success).toBe(true);
    expect(whatsappMessageIdSchema.safeParse(" wamid.reply-1").success).toBe(false);
    expect(whatsappMessageIdSchema.safeParse("wamid.reply 1").success).toBe(false);
    expect(whatsappMessageIdSchema.safeParse("wamid.\u0000reply").success).toBe(false);
    expect(whatsappMessageIdSchema.safeParse("x".repeat(513)).success).toBe(false);
  });

  it("builds a bounded text preview without interpreting markup", () => {
    expect(quotedReplyPreview(baseSource)).toEqual({
      available: true,
      messageId: baseSource.id,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      author: "Cliente",
      summary: "Produto disponível amanhã",
    });

    const markup = "<img src=x onerror=alert(1)>";
    expect(quotedReplyPreview({ ...baseSource, body: markup }).summary).toBe(markup);
    expect(quotedReplyPreview({ ...baseSource, body: "a".repeat(161) }).summary).toBe(
      `${"a".repeat(157)}…`,
    );
  });

  it.each([
    [MessageType.IMAGE, null, null, "Imagem"],
    [MessageType.VIDEO, null, null, "Vídeo"],
    [MessageType.DOCUMENT, null, null, "Documento"],
    [MessageType.AUDIO, null, null, "Áudio"],
    [MessageType.STICKER, null, null, "Figurinha"],
    [MessageType.LOCATION, null, { kind: "location", latitude: -15, longitude: -47, name: "Loja", address: null }, "Loja"],
    [MessageType.CONTACTS, null, { kind: "contacts", contacts: [{ name: "Maria", phones: [] }], truncated: false }, "Maria"],
    [MessageType.INTERACTIVE, null, { kind: "interactive", interaction: "button", id: "yes", title: "Sim" }, "Sim"],
    [MessageType.ORDER, null, { kind: "order", catalogId: null, productCount: 2 }, "Pedido"],
    [MessageType.SYSTEM, null, { kind: "system", text: "Número alterado" }, "Número alterado"],
    [MessageType.UNSUPPORTED, null, { kind: "unknown", rawType: "reaction" }, "Mensagem"],
  ])("summarizes %s safely", (type, body, content, summary) => {
    expect(quotedReplyPreview({
      ...baseSource,
      type,
      body,
      content,
    }).summary).toBe(summary);
  });

  it("uses the internal sender name and falls back to WhatsApp for app echoes", () => {
    expect(quotedReplyPreview({
      ...baseSource,
      direction: MessageDirection.OUTBOUND,
      sentBy: { name: "Victor" },
    }).author).toBe("Victor");
    expect(quotedReplyPreview({
      ...baseSource,
      direction: MessageDirection.OUTBOUND,
    }).author).toBe("WhatsApp");
  });
});
