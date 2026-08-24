import type { InboxMessage } from "@/hooks/use-inbox";

export type MediaGalleryItem = {
  messageId: string;
  mediaId: string | null;
  kind: "image" | "video" | "pdf";
  mimeType: string;
  filename: string;
  source: string;
  downloadSource: string;
};

function mediaKind(message: InboxMessage, mimeType: string) {
  if (message.type === "IMAGE") return "image" as const;
  if (message.type === "VIDEO") return "video" as const;
  if (message.type === "DOCUMENT" && mimeType === "application/pdf") return "pdf" as const;
  return null;
}

function fallbackFilename(message: InboxMessage, kind: MediaGalleryItem["kind"]) {
  const localName = message.localFileName?.trim();
  if (localName) return localName;
  if (kind === "pdf") return message.body?.trim() || "Documento PDF";
  return kind === "image" ? "Imagem" : "Vídeo";
}

export function galleryItems(messages: InboxMessage[]): MediaGalleryItem[] {
  return [...messages]
    .sort((left, right) => (
      Date.parse(left.externalTimestamp) - Date.parse(right.externalTimestamp) ||
      left.id.localeCompare(right.id)
    ))
    .flatMap((message): MediaGalleryItem[] => {
      const mimeType = (message.localMimeType ?? message.mediaMimeType ?? "").toLowerCase();
      const kind = mediaKind(message, mimeType);
      const remoteAvailable = message.mediaObjectId !== null && message.mediaState?.status === "AVAILABLE";
      if (!kind || (!message.previewUrl && !remoteAvailable)) return [];

      const mediaId = message.mediaObjectId;
      const base = message.previewUrl ?? `/api/media/${encodeURIComponent(mediaId!)}?preview=1`;
      const downloadSource = message.previewUrl ?? `/api/media/${encodeURIComponent(mediaId!)}?download=1`;
      return [{
        messageId: message.id,
        mediaId,
        kind,
        mimeType,
        filename: fallbackFilename(message, kind),
        source: base,
        downloadSource,
      }];
    });
}
