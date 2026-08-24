import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("dialog geometry contracts", () => {
  it("keeps default drawer width independent from responsive modal insets", () => {
    const dialogSource = readFileSync(join(process.cwd(), "src", "components", "ui", "dialog.tsx"), "utf8");
    const globalStyles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const mobileModalRule = globalStyles.match(/@media \(max-width: 767px\) \{\s*\.modal-dialog \{([\s\S]*?)\n  \}\n\}/)?.[1] ?? "";

    expect(dialogSource).toContain("w-full");
    expect(mobileModalRule).toContain("width: auto;");
    expect(mobileModalRule).toContain("inset:");
  });
});
