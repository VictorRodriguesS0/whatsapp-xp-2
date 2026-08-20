import "server-only";

import { z } from "zod";

const metaRequiredFields = [
  "META_APP_ID",
  "META_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    NEXT_PUBLIC_APP_NAME: z.string().default("XP Atendimento"),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    WHATSAPP_PROVIDER: z.enum(["demo", "meta"]).default("demo"),
    META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
    META_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(15_000),
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    MEDIA_ROOT: z.string().default("./data/media"),
  })
  .superRefine((env, context) => {
    if (env.WHATSAPP_PROVIDER !== "meta") {
      return;
    }

    for (const field of metaRequiredFields) {
      if (!env[field]) {
        context.addIssue({
          code: "custom",
          message: `${field} é obrigatório quando WHATSAPP_PROVIDER=meta`,
          path: [field],
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return schema.parse(input);
}

let serverEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  serverEnv ??= parseServerEnv(process.env);
  return serverEnv;
}
