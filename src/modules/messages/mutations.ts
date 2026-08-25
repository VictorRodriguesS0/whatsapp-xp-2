import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { MessageRevisionAction } from "@/generated/prisma/enums";
import type { MessageContent } from "@/modules/messages/content";
import { messageContentForPrisma } from "@/modules/messages/content.server";
import { buildMessageSearchText } from "@/modules/message-search/text";

export type ApplyMessageMutationInput = {
  messageId: string;
  providerEventId: string;
  action: "EDIT" | "REVOKE";
  providerTimestamp: Date;
  body: string | null;
  content: MessageContent | null;
};

export async function applyMessageMutation(
  client: Prisma.TransactionClient,
  input: ApplyMessageMutationInput,
): Promise<"APPLIED" | "IGNORED" | "MISSING"> {
  const locked = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM messages
    WHERE id = ${input.messageId}::uuid
    FOR UPDATE
  `);
  if (locked.length === 0) return "MISSING";

  const current = await client.message.findUnique({
    where: { id: input.messageId },
    select: {
      body: true,
      content: true,
      revokedAt: true,
      lastMutationAt: true,
      mediaObject: { select: { originalFilename: true } },
    },
  });
  if (!current) return "MISSING";

  const duplicate = await client.messageRevision.findUnique({
    where: { providerEventId: input.providerEventId },
    select: { id: true },
  });
  if (duplicate || current.revokedAt) return "IGNORED";

  const latestRevision = current.lastMutationAt
    ? await client.messageRevision.findFirst({
        where: {
          messageId: input.messageId,
          providerTimestamp: current.lastMutationAt,
        },
        orderBy: { providerEventId: "desc" },
        select: { providerEventId: true },
      })
    : null;
  if (current.lastMutationAt) {
    const timestampOrder =
      input.providerTimestamp.getTime() - current.lastMutationAt.getTime();
    if (
      timestampOrder < 0 ||
      (timestampOrder === 0 &&
        input.providerEventId <= (latestRevision?.providerEventId ?? ""))
    ) {
      return "IGNORED";
    }
  }

  await client.messageRevision.create({
    data: {
      messageId: input.messageId,
      providerEventId: input.providerEventId,
      action:
        input.action === "EDIT"
          ? MessageRevisionAction.EDIT
          : MessageRevisionAction.REVOKE,
      providerTimestamp: input.providerTimestamp,
      previousBody: input.action === "EDIT" ? current.body : null,
      previousContent:
        input.action === "EDIT"
          ? current.content === null
            ? Prisma.DbNull
            : (current.content as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });

  if (input.action === "REVOKE") {
    await client.message.update({
      where: { id: input.messageId },
      data: {
        body: null,
        content: Prisma.DbNull,
        searchText: "mensagem apagada",
        revokedAt: input.providerTimestamp,
        lastMutationAt: input.providerTimestamp,
      },
    });
    return "APPLIED";
  }

  await client.message.update({
    where: { id: input.messageId },
    data: {
      body: input.body,
      content: messageContentForPrisma(input.content),
      searchText: buildMessageSearchText({
        body: input.body,
        content: input.content,
        originalFilename: current.mediaObject?.originalFilename ?? null,
      }),
      editedAt: input.providerTimestamp,
      lastMutationAt: input.providerTimestamp,
    },
  });
  return "APPLIED";
}
