import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it.each([
    ["primary", "--primary", "--primary-hover", "--primary-foreground"],
    ["danger", "--destructive", "--destructive-hover", "--destructive-foreground"],
  ] as const)("uses semantic foreground and background tokens for the %s variant", (variant, background, hover, foreground) => {
    render(<Button disabled variant={variant}>{variant}</Button>);
    const button = screen.getByRole("button", { name: variant });

    expect(button).toHaveClass(
      `bg-[var(${background})]`,
      `hover:bg-[var(${hover})]`,
      `text-[var(${foreground})]`,
      "disabled:opacity-55",
      "focus-visible:ring-[var(--focus)]",
    );
    expect(button).not.toHaveClass("text-white");
    expect(button).toBeDisabled();
  });

  it("does not let busy primary-button spinners override the semantic foreground", () => {
    for (const path of [
      "src/components/auth/login-form.tsx",
      "src/components/users/user-form.tsx",
      "src/components/users/reset-password-form.tsx",
      "src/components/settings/contact-classification-screen.tsx",
    ]) {
      expect(readFileSync(resolve(process.cwd(), path), "utf8"), path).not.toContain('Spinner className="text-white"');
    }
  });
});
