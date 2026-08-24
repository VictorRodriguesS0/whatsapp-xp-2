import { describe, expect, it } from "vitest";

import type { InboxMessage } from "@/hooks/use-inbox";

import { galleryItems } from "./media-gallery";

function message(overrides: Partial<InboxMessage>): InboxMessage {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    direction: "INBOUND",
    type: "IMAGE",
    body: null,
    content: null,
    canReply: false,
    replyTo: null,
    mediaObjectId: "50000000-0000-4000-8000-000000000001",
    mediaMimeType: "image/jpeg",
    mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
    sentBy: null,
    status: "RECEIVED",
    failureReason: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: "2026-08-23T12:00:00.000Z",
    createdAt: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("conversation media gallery", () => {
  it("derives available images, videos and PDFs in chronological order", () => {
    const items = galleryItems([
      message({
        id: "40000000-0000-4000-8000-000000000003",
        type: "DOCUMENT",
        body: "Manual da TV.pdf",
        mediaObjectId: "50000000-0000-4000-8000-000000000003",
        mediaMimeType: "application/pdf",
        externalTimestamp: "2026-08-23T12:03:00.000Z",
      }),
      message({
        id: "40000000-0000-4000-8000-000000000001",
        externalTimestamp: "2026-08-23T12:01:00.000Z",
      }),
      message({
        id: "40000000-0000-4000-8000-000000000002",
        type: "VIDEO",
        mediaObjectId: "50000000-0000-4000-8000-000000000002",
        mediaMimeType: "video/mp4",
        externalTimestamp: "2026-08-23T12:02:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["image", "video", "pdf"]);
    expect(items[0]).toMatchObject({
      filename: "Imagem",
      source: "/api/media/50000000-0000-4000-8000-000000000001?preview=1",
      downloadSource: "/api/media/50000000-0000-4000-8000-000000000001?download=1",
    });
    expect(items[2]).toMatchObject({ filename: "Manual da TV.pdf", mimeType: "application/pdf" });
  });

  it("includes a local optimistic preview with its real file name and MIME", () => {
    const items = galleryItems([message({
      id: "optimistic:request-id",
      type: "VIDEO",
      mediaObjectId: null,
      mediaMimeType: null,
      mediaState: null,
      previewUrl: "blob:preview-video",
      localFileName: "produto.mp4",
      localMimeType: "video/mp4",
      status: "PENDING",
    })]);

    expect(items).toEqual([expect.objectContaining({
      source: "blob:preview-video",
      downloadSource: "blob:preview-video",
      filename: "produto.mp4",
      mimeType: "video/mp4",
    })]);
  });

  it("excludes audio, stickers, non-PDF documents and unavailable remote media", () => {
    expect(galleryItems([
      message({ type: "AUDIO", mediaMimeType: "audio/ogg" }),
      message({ type: "STICKER", mediaMimeType: "image/webp" }),
      message({ type: "DOCUMENT", mediaMimeType: "application/zip" }),
      message({ mediaState: { status: "PENDING", nextAttemptAt: null, canRetry: false } }),
      message({ mediaState: { status: "FAILED", nextAttemptAt: null, canRetry: true } }),
    ])).toEqual([]);
  });
});
