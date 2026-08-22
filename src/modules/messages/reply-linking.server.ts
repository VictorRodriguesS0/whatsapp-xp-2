import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { whatsappMessageIdSchema } from "./reply-context";

export type ReplyLinkClient = Pick<Prisma.TransactionClient, "message">;

export async function resolveReplyTarget(
  client: ReplyLinkClient,
  conversationId: string,
  replyToMessageId: string,
): Promise<{ id: string; whatsappMessageId: string } | null> {
  const target = await client.message.findFirst({
    where: { id: replyToMessageId, conversationId },
    select: { id: true, whatsappMessageId: true },
  });
  const parsed = whatsappMessageIdSchema.safeParse(target?.whatsappMessageId);

  return target && parsed.success
    ? { id: target.id, whatsappMessageId: parsed.data }
    : null;
}

export async function reconcileReplyLinks(
  client: ReplyLinkClient,
  input: {
    conversationId: string;
    messageId: string;
    whatsappMessageId: string;
  },
): Promise<number> {
  const parsedWhatsappMessageId = whatsappMessageIdSchema.safeParse(
    input.whatsappMessageId,
  );
  if (!parsedWhatsappMessageId.success) return 0;

  const result = await client.message.updateMany({
    where: {
      conversationId: input.conversationId,
      replyToMessageId: null,
      replyToWhatsappMessageId: parsedWhatsappMessageId.data,
    },
    data: { replyToMessageId: input.messageId },
  });
  return result.count;
}

export async function reconcileConversationReplyLinks(
  client: ReplyLinkClient,
  conversationId: string,
): Promise<number> {
  const unresolved = await client.message.findMany({
    where: {
      conversationId,
      replyToMessageId: null,
      replyToWhatsappMessageId: { not: null },
    },
    select: { replyToWhatsappMessageId: true },
  });
  const externalIds = [
    ...new Set(
      unresolved.flatMap(({ replyToWhatsappMessageId }) => {
        const parsed = whatsappMessageIdSchema.safeParse(
          replyToWhatsappMessageId,
        );
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  ];
  if (externalIds.length === 0) return 0;

  const originals = await client.message.findMany({
    where: {
      conversationId,
      whatsappMessageId: { in: externalIds },
    },
    select: { id: true, whatsappMessageId: true },
  });
  let count = 0;
  for (const original of originals) {
    if (!original.whatsappMessageId) continue;
    count += await reconcileReplyLinks(client, {
      conversationId,
      messageId: original.id,
      whatsappMessageId: original.whatsappMessageId,
    });
  }
  return count;
}
