import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FullEmojiPicker } from "./full-emoji-picker";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

describe("FullEmojiPicker", () => {
  it("renders Portuguese search and bounded loading copy", () => {
    render(<FullEmojiPicker onSelect={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "Buscar emoji" })).toBeVisible();
    expect(screen.getByText("Carregando emojis…")).toBeInTheDocument();
  });
});
