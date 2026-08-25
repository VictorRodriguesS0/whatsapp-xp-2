import { z } from "zod";

export type ProactiveFunction =
  | "TEAM_CONTACT"
  | "REQUESTED_PRODUCT_UPDATE"
  | "AGREED_FOLLOW_UP";

export const PROACTIVE_PURPOSES = {
  TEAM_CONTACT: {
    label: "Equipe XP",
    parameterCount: 1,
    detail: null,
    proposedBody:
      "Olá, {{1}}. A XP Eletrônicos precisa falar com você sobre uma questão da equipe. Responda a esta mensagem quando puder.",
  },
  REQUESTED_PRODUCT_UPDATE: {
    label: "Produto solicitado",
    parameterCount: 2,
    detail: { label: "Produto solicitado", min: 2, max: 80 },
    proposedBody:
      "Olá, {{1}}. Você pediu para receber uma atualização sobre {{2}}. A XP Eletrônicos tem uma informação para você. Responda a esta mensagem para continuarmos.",
  },
  AGREED_FOLLOW_UP: {
    label: "Retorno ou lembrete combinado",
    parameterCount: 2,
    detail: { label: "Referência do retorno", min: 2, max: 120 },
    proposedBody:
      "Olá, {{1}}. Este é o retorno combinado sobre {{2}}. Responda a esta mensagem para continuarmos.",
  },
} as const;

const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const urlPattern =
  /(?:https?:\/\/|www\.|\b[\p{L}\d-]+\.(?:com(?:\.br)?|net|org|io)\b)/iu;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function detailSchema(min: number, max: number) {
  return z
    .string()
    .superRefine((rawValue, context) => {
      if (controlCharacterPattern.test(rawValue)) {
        context.addIssue({
          code: "custom",
          message: "O detalhe contém caracteres inválidos",
        });
        return;
      }

      const value = normalizeWhitespace(rawValue);
      if (value.length < min || value.length > max) {
        context.addIssue({
          code: "custom",
          message: `O detalhe deve ter entre ${min} e ${max} caracteres`,
        });
      }
      if (urlPattern.test(value)) {
        context.addIssue({
          code: "custom",
          message: "Links não são permitidos neste detalhe",
        });
      }
    })
    .transform(normalizeWhitespace);
}

const proactivePurposeInputSchema = z.discriminatedUnion("function", [
  z.strictObject({ function: z.literal("TEAM_CONTACT") }),
  z.strictObject({
    function: z.literal("REQUESTED_PRODUCT_UPDATE"),
    detail: detailSchema(
      PROACTIVE_PURPOSES.REQUESTED_PRODUCT_UPDATE.detail.min,
      PROACTIVE_PURPOSES.REQUESTED_PRODUCT_UPDATE.detail.max,
    ),
  }),
  z.strictObject({
    function: z.literal("AGREED_FOLLOW_UP"),
    detail: detailSchema(
      PROACTIVE_PURPOSES.AGREED_FOLLOW_UP.detail.min,
      PROACTIVE_PURPOSES.AGREED_FOLLOW_UP.detail.max,
    ),
  }),
]);

export type ProactivePurposeInput = z.infer<
  typeof proactivePurposeInputSchema
>;

export type ProactiveTemplateTextParameter = {
  type: "text";
  text: string;
};

export function parseProactivePurposeInput(
  input: unknown,
): ProactivePurposeInput {
  return proactivePurposeInputSchema.parse(input);
}

export function purposeAllowedForContactType(
  functionName: ProactiveFunction,
  normalizedContactTypeName: string | null,
): boolean {
  return functionName !== "TEAM_CONTACT" || normalizedContactTypeName === "equipe xp";
}

function safeContactName(value: string): string {
  return value.trim().slice(0, 80) || "cliente";
}

export function parametersForPurpose(
  input: unknown,
  contactName: string,
): ProactiveTemplateTextParameter[] {
  const purpose = parseProactivePurposeInput(input);
  const parameters: ProactiveTemplateTextParameter[] = [
    { type: "text", text: safeContactName(contactName) },
  ];

  if (purpose.function !== "TEAM_CONTACT") {
    parameters.push({ type: "text", text: purpose.detail });
  }

  return parameters;
}

export function renderProactiveBody(
  input: unknown,
  contactName: string,
): string {
  const purpose = parseProactivePurposeInput(input);
  const parameters = parametersForPurpose(purpose, contactName);
  const body = PROACTIVE_PURPOSES[purpose.function].proposedBody;

  return parameters.reduce(
    (rendered, parameter, index) =>
      rendered.replaceAll(`{{${index + 1}}}`, () => parameter.text),
    body as string,
  );
}
