import { z } from "zod";

export const metaAlertIdSchema = z.string().uuid();

const activeSchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const metaAlertListQuerySchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    active: activeSchema.optional(),
    cursorOccurredAt: z.string().datetime({ offset: true }).optional(),
    cursorId: metaAlertIdSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.cursorOccurredAt) !== Boolean(value.cursorId)) {
      context.addIssue({ code: "custom", message: "Cursor incompleto" });
    }
  })
  .transform(({ cursorOccurredAt, cursorId, ...value }) => ({
    ...value,
    ...(cursorOccurredAt && cursorId
      ? { cursor: { occurredAt: new Date(cursorOccurredAt), id: cursorId } }
      : {}),
  }));

export const emptyMetaSyncBodySchema = z.strictObject({});
