import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { MessageContent } from "./content";

export function messageContentForPrisma(
  content: MessageContent | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return content === null ? Prisma.DbNull : (content as Prisma.InputJsonValue);
}
