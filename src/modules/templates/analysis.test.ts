// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ProviderTemplate } from "@/modules/whatsapp/provider";

import {
  analyzeProviderTemplate,
  renderServiceResumption,
} from "./analysis";

function template(
  components: ProviderTemplate["components"],
  overrides: Partial<ProviderTemplate> = {},
): ProviderTemplate {
  return {
    metaId: "meta-template-1",
    name: " retomar_atendimento ",
    language: " pt_BR ",
    category: " utility ",
    status: " approved ",
    qualityScore: " green ",
    components,
    ...overrides,
  };
}

describe("service-resumption template analysis", () => {
  it("accepts exactly one body parameter and one optional static footer", () => {
    const analyzed = analyzeProviderTemplate(
      template([
        {
          type: " body ",
          format: " text ",
          text: " Olá, {{1}}! Podemos continuar por aqui? ",
        },
        { type: "footer", format: null, text: " XP Eletrônicos " },
      ]),
    );

    expect(analyzed).toMatchObject({
      metaId: "meta-template-1",
      name: "retomar_atendimento",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      qualityScore: "GREEN",
      bodyText: "Olá, {{1}}! Podemos continuar por aqui?",
      parameterCount: 1,
      supported: true,
      definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(analyzed.components).toEqual([
      {
        type: "BODY",
        format: "TEXT",
        text: "Olá, {{1}}! Podemos continuar por aqui?",
      },
      { type: "FOOTER", format: null, text: "XP Eletrônicos" },
    ]);
  });

  it.each([
    ["missing body", [{ type: "FOOTER", format: null, text: "XP" }]],
    [
      "two bodies",
      [
        { type: "BODY", format: null, text: "Olá, {{1}}" },
        { type: "BODY", format: null, text: "Oi, {{1}}" },
      ],
    ],
    [
      "header",
      [
        { type: "HEADER", format: "TEXT", text: "XP" },
        { type: "BODY", format: null, text: "Olá, {{1}}" },
      ],
    ],
    [
      "buttons",
      [
        { type: "BODY", format: null, text: "Olá, {{1}}" },
        { type: "BUTTONS", format: null, text: null },
      ],
    ],
    [
      "dynamic footer",
      [
        { type: "BODY", format: null, text: "Olá, {{1}}" },
        { type: "FOOTER", format: null, text: "Código {{1}}" },
      ],
    ],
    ["no parameter", [{ type: "BODY", format: null, text: "Olá" }]],
    [
      "repeated parameter",
      [{ type: "BODY", format: null, text: "Olá, {{1}} — {{1}}" }],
    ],
    [
      "noncontiguous parameter",
      [{ type: "BODY", format: null, text: "Olá, {{2}}" }],
    ],
    [
      "more than one parameter",
      [{ type: "BODY", format: null, text: "Olá, {{1}} e {{2}}" }],
    ],
    [
      "overlong body",
      [{ type: "BODY", format: null, text: `${"x".repeat(1024)}{{1}}` }],
    ],
  ] as const)("marks %s as unsupported", (_label, components) => {
    expect(
      analyzeProviderTemplate(
        template(components.map((component) => ({ ...component }))),
      ).supported,
    ).toBe(false);
  });

  it("keeps the definition hash stable after deterministic normalization", () => {
    const first = analyzeProviderTemplate(
      template([{ type: "body", format: null, text: " Olá, {{1}} " }]),
    );
    const second = analyzeProviderTemplate(
      template(
        [{ type: " BODY ", format: null, text: "Olá, {{1}}" }],
        { category: "UTILITY", status: "APPROVED" },
      ),
    );

    expect(first.definitionHash).toBe(second.definitionHash);
  });

  it("renders plain text with a bounded name or the exact neutral fallback", () => {
    expect(
      renderServiceResumption("Olá, <b>{{1}}</b>!", "  Carlos  "),
    ).toBe("Olá, <b>Carlos</b>!");
    expect(renderServiceResumption("Olá, {{1}}!", "   ")).toBe(
      "Olá, cliente!",
    );
    expect(
      renderServiceResumption("Olá, {{1}}!", "x".repeat(100)),
    ).toBe(`Olá, ${"x".repeat(80)}!`);
  });
});
