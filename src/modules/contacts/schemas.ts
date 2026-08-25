import { z } from "zod";

import { ContactMessagingConsentSource } from "@/generated/prisma/enums";

const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const preferredNameSchema = z.string().trim().min(1).max(80);
const displayNameSchema = z.string().trim().min(1).max(80);
const colorSchema = z.string().regex(/^#[0-9A-F]{6}$/);
const positionSchema = z.number().int().min(0).max(10_000);
const consentNoteSchema = z.string().trim().min(3).max(240);
const consentSourceSchema = z.enum([
  ContactMessagingConsentSource.WHATSAPP,
  ContactMessagingConsentSource.LOJA_FISICA,
  ContactMessagingConsentSource.TELEFONE,
  ContactMessagingConsentSource.OUTRO,
]);

export const contactIdSchema = uuidSchema;
export const contactDefinitionIdSchema = uuidSchema;

export const contactMessagingRestrictionSchema = z.strictObject({
  restricted: z.boolean(),
  reason: z.string().trim().min(3).max(240),
});

export const contactMessagingConsentSchema = z.discriminatedUnion("action", [
  z
    .strictObject({
      action: z.literal("GRANT"),
      source: consentSourceSchema,
      note: consentNoteSchema.optional(),
    })
    .superRefine((value, context) => {
      if (
        value.source === ContactMessagingConsentSource.OUTRO &&
        !value.note
      ) {
        context.addIssue({
          code: "custom",
          path: ["note"],
          message: "Informe a origem da autorização",
        });
      }
      if (
        value.source !== ContactMessagingConsentSource.OUTRO &&
        value.note !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["note"],
          message: "Observação não permitida para esta origem",
        });
      }
    }),
  z.strictObject({ action: z.literal("REVOKE") }),
]);

export const updateContactSchema = z
  .object({
    preferredName: preferredNameSchema.nullable().optional(),
    contactTypeId: uuidSchema.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Informe ao menos um campo para atualização",
  });

export const contactTagIdsSchema = z
  .array(uuidSchema)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "As etiquetas devem ser únicas",
  });

export const createContactDefinitionSchema = z.object({
  displayName: displayNameSchema,
  color: colorSchema,
  position: positionSchema,
});

export const updateContactDefinitionSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    color: colorSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Informe ao menos um campo para atualização",
  });

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactMessagingRestrictionInput = z.infer<
  typeof contactMessagingRestrictionSchema
>;
export type ContactMessagingConsentInput = z.infer<
  typeof contactMessagingConsentSchema
>;
export type CreateContactDefinitionInput = z.infer<
  typeof createContactDefinitionSchema
>;
export type UpdateContactDefinitionInput = z.infer<
  typeof updateContactDefinitionSchema
>;
