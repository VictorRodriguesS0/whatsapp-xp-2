import { z } from "zod";

export const conversationIdSchema = z.string().uuid();
export const messageIdSchema = z.string().uuid();
const canonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const tagIdsSchema = z
  .array(canonicalUuidSchema)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "As etiquetas devem ser únicas",
  });

export const conversationListOptionsSchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) =>
        value ? value.normalize("NFKC").replace(/\s+/gu, " ") : undefined,
      ),
    contactTypeId: canonicalUuidSchema.optional(),
    tagIds: tagIdsSchema.optional(),
    cursor: z.string().min(1).max(2_048).optional(),
  })
  .strict();

export const conversationCursorSchema = z.object({
  lastMessageAt: z.iso.datetime({ offset: true }),
  id: conversationIdSchema,
});

export const markReadSchema = z.object({
  messageId: messageIdSchema,
});

export const responsibleSchema = z.object({
  userId: z.string().uuid().nullable(),
});

export type MarkReadInput = z.infer<typeof markReadSchema>;
export type ResponsibleInput = z.infer<typeof responsibleSchema>;
