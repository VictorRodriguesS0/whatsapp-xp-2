import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
  it("uses the same accessible primary foreground pair as compact actions", () => {
    render(<Badge>Status</Badge>);

    expect(screen.getByText("Status")).toHaveClass(
      "bg-[var(--primary)]",
      "text-[var(--primary-foreground)]",
    );
    expect(screen.getByText("Status")).not.toHaveClass("text-white");
  });
});
