import { describe, expect, it } from "vitest";

import { buildMessageSearchText } from "./text";

describe("buildMessageSearchText", () => {
  it("normalizes body whitespace and casing without removing accents", () => {
    expect(buildMessageSearchText({
      body: "  Olá   PIX ",
      content: null,
    })).toBe("olá pix");
  });

  it("indexes captions and every textual location field", () => {
    expect(buildMessageSearchText({
      body: "Legenda",
      content: {
        kind: "location",
        name: "Loja",
        address: "Asa Norte",
        latitude: -15.7,
        longitude: -47.8,
      },
    })).toBe("legenda loja asa norte -15.7 -47.8");
  });

  it("indexes shared contact names, numbers, and phone types", () => {
    expect(buildMessageSearchText({
      body: null,
      content: {
        kind: "contacts",
        contacts: [{
          name: "Ana",
          phones: [{ phone: "+55 61 9999-0000", type: "CELL" }],
        }],
        truncated: false,
      },
    })).toBe("ana +55 61 9999-0000 cell");
  });

  it("indexes attachment filenames after the caption", () => {
    expect(buildMessageSearchText({
      body: "catálogo",
      content: null,
      originalFilename: "Lista Agosto.PDF",
    })).toBe("catálogo lista agosto.pdf");
  });

  it("ignores invalid structured content instead of indexing raw JSON", () => {
    expect(buildMessageSearchText({
      body: "Mensagem segura",
      content: { kind: "location", address: "campo solto" },
    })).toBe("mensagem segura");
  });
});
