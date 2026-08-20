import "server-only";

import type { MessageStatus } from "@/generated/prisma/enums";

export type SendResult = {
  whatsappMessageId: string;
  status: Extract<MessageStatus, "SENT">;
};

export type MediaMessageType = "image" | "audio" | "video" | "document";

export type MediaMetadata = {
  id: string;
  url: string;
  mimeType: string;
  sha256: string | null;
  sizeBytes: bigint;
};

export interface WhatsAppProvider {
  sendText(input: { to: string; body: string }): Promise<SendResult>;
  uploadMedia(input: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<{ mediaId: string }>;
  sendMedia(input: { to: string; type: MediaMessageType; mediaId: string; caption?: string; filename?: string }): Promise<SendResult>;
  getMediaMetadata(mediaId: string): Promise<MediaMetadata>;
  downloadMedia(input: { url: string; maximumBytes: number }): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
