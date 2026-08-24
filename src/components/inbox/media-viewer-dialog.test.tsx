import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaGalleryItem } from "./media-gallery";
import { MediaViewerDialog } from "./media-viewer-dialog";

const items: MediaGalleryItem[] = [
  {
    messageId: "image-message",
    mediaId: "image-media",
    kind: "image",
    mimeType: "image/jpeg",
    filename: "Imagem",
    source: "/api/media/image-media?preview=1",
    downloadSource: "/api/media/image-media?download=1",
  },
  {
    messageId: "video-message",
    mediaId: "video-media",
    kind: "video",
    mimeType: "video/mp4",
    filename: "Vídeo",
    source: "/api/media/video-media?preview=1",
    downloadSource: "/api/media/video-media?download=1",
  },
  {
    messageId: "pdf-message",
    mediaId: "pdf-media",
    kind: "pdf",
    mimeType: "application/pdf",
    filename: "Manual.pdf",
    source: "/api/media/pdf-media?preview=1",
    downloadSource: "/api/media/pdf-media?download=1",
  },
];

function Harness({ initial = items[0]!.messageId, onClose = vi.fn() }) {
  const [active, setActive] = useState(initial);
  return <MediaViewerDialog
    activeMessageId={active}
    items={items}
    onActiveMessageChange={setActive}
    onClose={onClose}
  />;
}

afterEach(() => vi.restoreAllMocks());

describe("MediaViewerDialog", () => {
  it("shows filename, position and safe file actions for the active item", () => {
    render(<Harness />);

    expect(screen.getByRole("dialog", { name: "Imagem" })).toBeInTheDocument();
    expect(screen.getByText("1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baixar" })).toHaveAttribute(
      "href",
      "/api/media/image-media?download=1",
    );
    expect(screen.getByRole("link", { name: "Abrir em nova aba" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("navigates with buttons and arrow keys without wrapping at the ends", () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Mídia anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Próxima mídia" }));
    expect(screen.getByRole("dialog", { name: "Vídeo" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Manual.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima mídia" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "Vídeo" })).toBeInTheDocument();
  });

  it("renders a complete PDF through the authenticated native browser viewer", () => {
    render(<Harness initial="pdf-message" />);

    expect(screen.getByTitle("Visualização de Manual.pdf")).toHaveAttribute(
      "src",
      "/api/media/pdf-media?preview=1",
    );
    expect(screen.getByText(/Se o PDF não abrir/i)).toBeInTheDocument();
  });

  it("offers bounded image zoom and reset controls", () => {
    render(<Harness />);

    const image = screen.getByRole("img", { name: "Imagem" });
    fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
    expect(image).toHaveStyle({ transform: "translate(0px, 0px) scale(1.25)" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.doubleClick(image);
    expect(image).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("pauses the active video before changing media", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
    render(<Harness initial="video-message" />);

    fireEvent.click(screen.getByRole("button", { name: "Próxima mídia" }));

    expect(pause).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigates on an intentional horizontal touch gesture", () => {
    render(<Harness />);
    const viewport = screen.getByTestId("media-viewer-viewport");

    fireEvent(viewport, new MouseEvent("pointerdown", { bubbles: true, clientX: 220, clientY: 100 }));
    fireEvent(viewport, new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 108 }));

    expect(screen.getByRole("dialog", { name: "Vídeo" })).toBeInTheDocument();
  });
});
