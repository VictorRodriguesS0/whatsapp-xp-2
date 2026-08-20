// @vitest-environment node

import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@/generated/prisma/enums";

import {
  createPrismaConversationRepository,
  runConversationTransaction,
} from "./service";

const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "10000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000001";

describe("Prisma conversation repository", () => {
  it("loads exactly one latest message through each paginated conversation", async () => {
    const timestamp = new Date("2026-08-19T12:00:00.000Z");
    let conversationQuery: unknown;
    let globalMessageQueryWasCalled = false;
    const latestMessage = {
      id: messageId,
      conversationId,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      body: "última",
      mediaObjectId: null,
      status: MessageStatus.RECEIVED,
      failureReason: null,
      externalTimestamp: timestamp,
      createdAt: timestamp,
      sentByUser: null,
    };
    const client = {
      conversation: {
        findMany: async (query: unknown) => {
          conversationQuery = query;
          return [{
            id: conversationId,
            lastMessageAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            contact: {
              id: "30000000-0000-4000-8000-000000000001",
              name: "Carlos",
              phone: "5511999990001",
              profilePictureUrl: null,
            },
            responsibleUser: null,
            messages: [latestMessage],
          }];
        },
      },
      conversationRead: { findMany: async () => [] },
      message: {
        findMany: async () => {
          globalMessageQueryWasCalled = true;
          return [latestMessage];
        },
        groupBy: async () => [],
      },
      user: {},
    };
    const repository = createPrismaConversationRepository(client as never);

    const records = await repository.list(userId, { take: 51 });

    expect(conversationQuery).toMatchObject({
      select: {
        messages: {
          take: 1,
          orderBy: [{ externalTimestamp: "desc" }, { id: "desc" }],
        },
      },
    });
    expect(globalMessageQueryWasCalled).toBe(false);
    expect(records[0]?.latestMessage?.id).toBe(messageId);
  });

  it("retries a serializable transaction conflict by rerunning the operation", async () => {
    let attempts = 0;
    const seenTransactions: number[] = [];
    const client = {
      $transaction: async <T>(
        operation: (transaction: number) => Promise<T>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ): Promise<T> => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        attempts += 1;
        const result = await operation(attempts);

        if (attempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError("serialization failure", {
            code: "P2034",
            clientVersion: "test",
          });
        }

        return result;
      },
    };

    await expect(
      runConversationTransaction(client, async (transaction) => {
        seenTransactions.push(transaction);
        return "committed";
      }),
    ).resolves.toBe("committed");
    expect(seenTransactions).toEqual([1, 2]);
  });
});
