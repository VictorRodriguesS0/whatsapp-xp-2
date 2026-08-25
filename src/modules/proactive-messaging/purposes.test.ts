import { describe, expect, it } from "vitest";

import {
  PROACTIVE_PURPOSES,
  parametersForPurpose,
  parseProactivePurposeInput,
  purposeAllowedForContactType,
  renderProactiveBody,
} from "./purposes";

describe("proactive WhatsApp purposes", () => {
  it("defines the three approved purposes once", () => {
    expect(PROACTIVE_PURPOSES.TEAM_CONTACT).toMatchObject({
      label: "Equipe XP",
      parameterCount: 1,
      detail: null,
    });
    expect(PROACTIVE_PURPOSES.REQUESTED_PRODUCT_UPDATE.detail).toEqual({
      label: "Produto solicitado",
      min: 2,
      max: 80,
    });
    expect(PROACTIVE_PURPOSES.AGREED_FOLLOW_UP.detail).toEqual({
      label: "Referência do retorno",
      min: 2,
      max: 120,
    });
  });

  it("normalizes only the constrained detail for detail purposes", () => {
    expect(
      parseProactivePurposeInput({
        function: "REQUESTED_PRODUCT_UPDATE",
        detail: "  controle   de PS5  ",
      }),
    ).toEqual({
      function: "REQUESTED_PRODUCT_UPDATE",
      detail: "controle de PS5",
    });
    expect(
      parseProactivePurposeInput({
        function: "AGREED_FOLLOW_UP",
        detail: "  chegada   no fim de semana ",
      }),
    ).toEqual({
      function: "AGREED_FOLLOW_UP",
      detail: "chegada no fim de semana",
    });
    expect(parseProactivePurposeInput({ function: "TEAM_CONTACT" })).toEqual({
      function: "TEAM_CONTACT",
    });
  });

  it.each([
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "a" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "x".repeat(81) },
    { function: "AGREED_FOLLOW_UP", detail: "x".repeat(121) },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "https://produto.test" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "http://produto.test" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "www.produto.test" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "produto.com" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "produto.com.br" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "produto.net" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "produto.org" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "produto.io" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "controle\u0000PS5" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "controle\u001fPS5" },
    { function: "REQUESTED_PRODUCT_UPDATE", detail: "controle\u007fPS5" },
    { function: "TEAM_CONTACT", detail: "não permitido" },
    { function: "REQUESTED_PRODUCT_UPDATE" },
    { function: "AGREED_FOLLOW_UP" },
    { function: "UNKNOWN" },
    { function: "TEAM_CONTACT", extra: true },
  ])("rejects unsafe or structurally invalid input %#", (input) => {
    expect(() => parseProactivePurposeInput(input)).toThrow();
  });

  it("uses an exact contact-type rule only for Equipe XP", () => {
    expect(purposeAllowedForContactType("TEAM_CONTACT", "equipe xp")).toBe(
      true,
    );
    expect(purposeAllowedForContactType("TEAM_CONTACT", null)).toBe(false);
    expect(purposeAllowedForContactType("TEAM_CONTACT", "Equipe XP")).toBe(
      false,
    );
    expect(purposeAllowedForContactType("TEAM_CONTACT", "équipe xp")).toBe(
      false,
    );
    expect(
      purposeAllowedForContactType("REQUESTED_PRODUCT_UPDATE", null),
    ).toBe(true);
    expect(purposeAllowedForContactType("AGREED_FOLLOW_UP", null)).toBe(true);
  });

  it("derives exact ordered text parameters using a safe contact name", () => {
    expect(
      parametersForPurpose({ function: "TEAM_CONTACT" }, "  Ana XP  "),
    ).toEqual([{ type: "text", text: "Ana XP" }]);
    expect(
      parametersForPurpose(
        {
          function: "REQUESTED_PRODUCT_UPDATE",
          detail: "controle de PS5",
        },
        "   ",
      ),
    ).toEqual([
      { type: "text", text: "cliente" },
      { type: "text", text: "controle de PS5" },
    ]);
    expect(
      parametersForPurpose(
        { function: "AGREED_FOLLOW_UP", detail: "visita no sábado" },
        "x".repeat(100),
      )[0],
    ).toEqual({ type: "text", text: "x".repeat(80) });
  });

  it("renders only the numbered placeholders for the selected purpose", () => {
    expect(
      renderProactiveBody({ function: "TEAM_CONTACT" }, "Ana"),
    ).toBe(
      "Olá, Ana. A XP Eletrônicos precisa falar com você sobre uma questão da equipe. Responda a esta mensagem quando puder.",
    );
    expect(
      renderProactiveBody(
        {
          function: "REQUESTED_PRODUCT_UPDATE",
          detail: "controle de PS5",
        },
        "Carlos",
      ),
    ).toBe(
      "Olá, Carlos. Você pediu para receber uma atualização sobre controle de PS5. A XP Eletrônicos tem uma informação para você. Responda a esta mensagem para continuarmos.",
    );
    expect(
      renderProactiveBody(
        { function: "AGREED_FOLLOW_UP", detail: "visita no sábado" },
        "Maria",
      ),
    ).toBe(
      "Olá, Maria. Este é o retorno combinado sobre visita no sábado. Responda a esta mensagem para continuarmos.",
    );
  });
});
