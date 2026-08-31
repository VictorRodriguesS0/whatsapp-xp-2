import { z } from "zod";

import {
  catalogContentSchema,
  catalogProductContentSchema,
  catalogProductListContentSchema,
} from "@/modules/catalog/message-content";

const short = z.string().min(1).max(256);
const optionalShort = short.nullable();
const phone = z.object({ phone: z.string().min(1).max(32), type: optionalShort });
const sharedContact = z.object({ name: short, phones: z.array(phone).max(10) });

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("location"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    name: optionalShort,
    address: z.string().min(1).max(512).nullable(),
  }),
  z.object({
    kind: z.literal("contacts"),
    contacts: z.array(sharedContact).min(1).max(20),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("interactive"),
    interaction: z.enum(["button", "list"]),
    id: z.string().min(1).max(256),
    title: short,
  }),
  z.object({
    kind: z.literal("order"),
    catalogId: z.string().min(1).max(256).nullable(),
    productCount: z.number().int().min(0).max(1_000),
  }),
  catalogContentSchema,
  catalogProductContentSchema,
  catalogProductListContentSchema,
  z.object({
    kind: z.literal("system"),
    text: z.string().min(1).max(512).nullable(),
  }),
  z.object({
    kind: z.literal("unknown"),
    rawType: z.string().regex(/^[a-z0-9_]{1,64}$/),
  }),
]);

export type MessageContent = z.infer<typeof schema>;

export function parseMessageContent(value: unknown): MessageContent | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
