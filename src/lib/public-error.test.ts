// @vitest-environment node

import { describe, expect, it } from "vitest";

import { publicErrorMessage } from "./public-error";

describe("public error messages", () => {
  it("provides safe contact type load and save messages", () => {
    expect(publicErrorMessage("contact-types")).toBe(
      "Não foi possível carregar os tipos de contato.",
    );
    expect(publicErrorMessage("contact-type-save")).toBe(
      "Não foi possível atualizar o tipo de contato.",
    );
    expect(publicErrorMessage("contact-type-save", 429)).toBe(
      "Muitas solicitações. Aguarde um momento e tente novamente.",
    );
  });

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

  it("provides safe contact consent save copy", () => {
    expect(publicErrorMessage("contact-consent-save")).toBe(
      "Não foi possível salvar o consentimento. Confira os dados e tente novamente.",
    );
  });

  it.each([
    ["WHATSAPP_SERVICE_WINDOW_CLOSED", "A janela de 24 horas terminou. Use a retomada aprovada."],
    ["WHATSAPP_TEMPLATE_NOT_READY", "O modelo aprovado ainda não está pronto para uso."],
    ["WHATSAPP_RESUMPTION_ALREADY_STARTED", "Esta solicitação já foi respondida ou retomada."],
    ["WHATSAPP_CONTACT_OPTED_OUT", "Este contato está marcado como não contatar."],
    ["WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN", "O envio pode ter ocorrido. Confirme no WhatsApp antes de tentar novamente."],
  ] as const)("maps the safe WhatsApp domain code %s", (code, copy) => {
    expect(publicErrorMessage("resumption", 409, false, code)).toBe(copy);
  });
});
