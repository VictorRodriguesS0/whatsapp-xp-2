import { z } from "zod";

const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const preferredNameSchema = z.string().trim().min(1).max(80);
const displayNameSchema = z.string().trim().min(1).max(80);
const colorSchema = z.string().regex(/^#[0-9A-F]{6}$/);
const positionSchema = z.number().int().min(0).max(10_000);

export const contactIdSchema = uuidSchema;
export const contactDefinitionIdSchema = uuidSchema;

export const contactMessagingRestrictionSchema = z.strictObject({
  restricted: z.boolean(),
  reason: z.string().trim().min(3).max(240),
});

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
export type CreateContactDefinitionInput = z.infer<
  typeof createContactDefinitionSchema
>;
export type UpdateContactDefinitionInput = z.infer<
  typeof updateContactDefinitionSchema
>;
