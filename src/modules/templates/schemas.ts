import { z } from "zod";

import { WhatsAppPolicyMode } from "@/generated/prisma/enums";

export const whatsAppTemplateIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

export const whatsAppPolicyModeSchema = z.strictObject({
  mode: z.enum([
    WhatsAppPolicyMode.INACTIVE,
    WhatsAppPolicyMode.ACTIVE,
  ]),
});
