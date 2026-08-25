import { z } from "zod";

export const resumeConversationSchema = z.strictObject({
  clientRequestId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
});
