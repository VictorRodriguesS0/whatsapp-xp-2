import "server-only";

import { randomUUID } from "node:crypto";

import type { MediaMessageType, MediaUploadSource, WhatsAppProvider } from "./provider";

export class DemoWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly createUuid: () => string = randomUUID) {}

  private id(): string {
    return `demo-${this.createUuid()}`;
  }

  async sendText(_input: { to: string; body: string }) {
    return { whatsappMessageId: this.id(), status: "SENT" as const };
  }

  async sendReaction(_input: { to: string; targetWhatsappMessageId: string; emoji: string }) {
    return {
      whatsappMessageId: `demo-reaction-${this.createUuid()}`,
      status: "SENT" as const,
    };
  }

  async uploadMedia(_input: MediaUploadSource) {
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
