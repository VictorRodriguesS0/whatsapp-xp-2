// @vitest-environment node

import { describe, expect, it } from "vitest";

import { publicErrorMessage } from "./public-error";

describe("public error messages", () => {
  it("provides safe contact label load and save messages", () => {
    expect(publicErrorMessage("contact-tags")).toBe(
      "Não foi possível carregar as etiquetas.",
    );
    expect(publicErrorMessage("contact-tag-save")).toBe(
      "Não foi possível salvar as etiquetas.",
    );
    expect(publicErrorMessage("contact-tag-save", 429)).toBe(
      "Muitas solicitações. Aguarde um momento e tente novamente.",
    );
  });
});
