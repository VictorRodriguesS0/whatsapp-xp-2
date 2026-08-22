import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContactTypeChip } from "./contact-type-chip";

describe("ContactTypeChip", () => {
  it("renders a distinct textual type marker with a validated color", () => {
    render(<ContactTypeChip color="#176B52" name="Cliente" />);
    const marker = screen.getByText("Cliente");
    expect(marker).toHaveClass("rounded-md");
    expect(marker).toHaveStyle({ borderColor: "#176B52" });
  });

  it("uses a neutral fallback for an unsafe color and supports compact rows", () => {
    render(<ContactTypeChip color="url(javascript:bad)" compact name="Prospecto" />);
    const marker = screen.getByText("Prospecto");
    expect(marker).not.toHaveAttribute("style");
    expect(marker).toHaveClass("text-[10px]");
  });
});
