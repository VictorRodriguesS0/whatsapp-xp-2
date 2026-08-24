import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppBrand } from "./app-brand";

describe("AppBrand", () => {
  it("renders the local XP symbol and readable full wordmark", () => {
    render(<AppBrand href="/conversas" />);

    expect(screen.getByRole("link", { name: "XP Eletrônicos" })).toHaveAttribute("href", "/conversas");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/brand/xp-symbol.png");
    expect(screen.getByText("XP Eletrônicos")).toBeVisible();
  });

  it("keeps the compact mark accessible by the XP Eletrônicos name", () => {
    render(<AppBrand compact />);

    expect(screen.getByLabelText("XP Eletrônicos")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/brand/xp-symbol.png");
  });

  it("gives a compact linked mark the full 44px inline hit target", () => {
    render(<AppBrand compact href="/conversas" />);

    expect(screen.getByRole("link", { name: "XP Eletrônicos" })).toHaveClass("min-w-11");
  });
});
