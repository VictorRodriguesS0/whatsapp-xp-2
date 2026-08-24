import { describe, expect, it } from "vitest";

import {
  contactInitials,
  formatContactPhone,
  resolveContactName,
} from "./contact-display";

describe("contact display helpers", () => {
  it("prefers manual, then WhatsApp app, then public profile, then phone", () => {
    expect(resolveContactName({
      preferredName: "Nome manual",
      whatsappAppName: "Nome da agenda",
      profileName: "Nome público",
      phone: "5561992250908",
    })).toBe("Nome manual");
    expect(resolveContactName({
      preferredName: null,
      whatsappAppName: "Nome da agenda",
      profileName: "Nome público",
      phone: "5561992250908",
    })).toBe("Nome da agenda");
    expect(resolveContactName({
      whatsappAppName: null,
      profileName: "Nome público",
      phone: "5561992250908",
    })).toBe("Nome público");
  });

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
    expect(formatContactPhone("abc5511999991234xyz")).toBe(
      "abc5511999991234xyz",
    );
    expect(formatContactPhone("   ")).toBe("");
  });
});
