import { describe, expect, it } from "vitest";

import {
  contactInitials,
  formatContactPhone,
  resolveContactName,
} from "./contact-display";

describe("contact display helpers", () => {
  it("uses a trimmed preferred name before the Meta profile name and phone", () => {
    expect(
      resolveContactName({
        preferredName: "  Bia da Oficina  ",
        profileName: "Beatriz Meta",
        phone: "+5511999991234",
      }),
    ).toBe("Bia da Oficina");
  });

  it("falls back through a trimmed Meta profile name to a formatted phone", () => {
    expect(
      resolveContactName({
        preferredName: "   ",
        profileName: "  Beatriz Meta  ",
        phone: "+5511999991234",
      }),
    ).toBe("Beatriz Meta");

    expect(
      resolveContactName({
        preferredName: null,
        profileName: " ",
        phone: " +55 11 99999-1234 ",
      }),
    ).toBe("+55 (11) 99999-1234");
  });

  it("builds two useful uppercase initials and uses a question mark without letters or numbers", () => {
    expect(contactInitials(" João da Silva ")).toBe("JS");
    expect(contactInitials("Ana")).toBe("AN");
    expect(contactInitials("  42 assistência ")).toBe("4A");
    expect(contactInitials(" -- ")).toBe("?");
  });

  it("formats Brazilian mobile and landline numbers without changing unrecognized values", () => {
    expect(formatContactPhone("+5511999991234")).toBe("+55 (11) 99999-1234");
    expect(formatContactPhone("55 11 3333-1234")).toBe("+55 (11) 3333-1234");
    expect(formatContactPhone("  +1 202 555 0100  ")).toBe("+1 202 555 0100");
    expect(formatContactPhone("   ")).toBe("");
  });
});
