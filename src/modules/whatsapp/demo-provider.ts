import "server-only";

import { randomUUID } from "node:crypto";

import type { MediaMessageType, WhatsAppProvider } from "./provider";

export class DemoWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly createUuid: () => string = randomUUID) {}

  private id(): string {
    return `demo-${this.createUuid()}`;
  }

  async sendText(_input: { to: string; body: string }) {
    return { whatsappMessageId: this.id(), status: "SENT" as const };
  }

  async uploadMedia(_input: { bytes: Uint8Array; filename: string; mimeType: string }) {
    return { mediaId: this.id() };
  }

  async sendMedia(_input: {
    to: string;
    type: MediaMessageType;
    mediaId: string;
    caption?: string;
    filename?: string;
  }) {
    return { whatsappMessageId: this.id(), status: "SENT" as const };
  }

  async getMediaMetadata(_mediaId: string): Promise<never> {
    throw new Error("Mídia remota não existe no modo demonstração");
  }

  async downloadMedia(_input: { url: string; maximumBytes: number }): Promise<never> {
    throw new Error("Mídia remota não existe no modo demonstração");
  }
}
