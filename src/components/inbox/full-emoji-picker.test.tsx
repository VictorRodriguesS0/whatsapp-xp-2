import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("keeps 44px emoji cells and responsive columns within a 320px viewport", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/inbox/full-emoji-picker.tsx"), "utf8");

    expect(source).toContain('useMediaQuery("(max-width: 389px)")');
    expect(source).toContain("columns={compact ? 6 : 7}");
    expect(source).toContain("size-11");
    expect(source).toContain("w-[min(20rem,calc(100vw-2rem))]");
    expect(source).not.toContain("columns={8}");
    expect(source).not.toContain("size-10");
  });
});
