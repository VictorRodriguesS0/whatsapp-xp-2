import "server-only";

import type { MessageStatus } from "@/generated/prisma/enums";

export type SendResult = {
  whatsappMessageId: string;
  status: Extract<MessageStatus, "SENT">;
};

export type MediaMessageType = "image" | "audio" | "video" | "document";
export type ProviderReplyContext = { contextMessageId?: string };

export type MediaMetadata = {
  id: string;
  url: string;
  mimeType: string;
  sha256: string | null;
  sizeBytes: bigint;
};

export type MediaUploadSource = {
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  open(): Promise<ReadableStream<Uint8Array>>;
};

export type MediaDownload = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  sizeBytes: bigint | null;
};

export interface WhatsAppProvider {
  sendText(input: { to: string; body: string } & ProviderReplyContext): Promise<SendResult>;
  sendReaction(input: {
    to: string;
    targetWhatsappMessageId: string;
    emoji: string;
  }): Promise<SendResult>;
  uploadMedia(input: MediaUploadSource): Promise<{ mediaId: string }>;
  sendMedia(input: {
    to: string;
    type: MediaMessageType;
    mediaId: string;
    caption?: string;
    filename?: string;
  } & ProviderReplyContext): Promise<SendResult>;
  getMediaMetadata(mediaId: string): Promise<MediaMetadata>;
  downloadMedia(input: { url: string; maximumBytes: number }): Promise<MediaDownload>;
}
