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
              preferredName: null,
              phone: "5511999990001",
              profilePictureUrl: null,
              contactType: null,
              tagAssignments: [],
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

  it("uses bounded nested selects, canonical phone search, exact type, and one tag predicate per requested id", async () => {
    let conversationQuery: any;
    let definitionQueryWasCalled = false;
    const tagA = "50000000-0000-4000-8000-000000000001";
    const tagB = "50000000-0000-4000-8000-000000000002";
    const typeId = "40000000-0000-4000-8000-000000000001";
    const client = {
      conversation: {
        findMany: async (query: unknown) => {
          conversationQuery = query;
          return [];
        },
      },
      message: { groupBy: async () => [] },
      conversationRead: {},
      user: {},
      contactType: {
        findMany: async () => {
          definitionQueryWasCalled = true;
          return [];
        },
      },
      contactTagDefinition: {
        findMany: async () => {
          definitionQueryWasCalled = true;
          return [];
        },
      },
    };

    await createPrismaConversationRepository(client as never).list(userId, {
      search: "+55 (11) 99999-0001",
      contactTypeId: typeId,
      tagIds: [tagA, tagB],
      take: 51,
    });

    expect(conversationQuery).toMatchObject({
      where: {
        AND: expect.arrayContaining([
          {
            contact: {
              is: {
                OR: [
                  { preferredName: { contains: "+55 (11) 99999-0001", mode: "insensitive" } },
                  { name: { contains: "+55 (11) 99999-0001", mode: "insensitive" } },
                  { phone: { contains: "5511999990001" } },
                ],
              },
            },
          },
          {
            contact: {
              is: {
                contactTypeId: typeId,
                AND: [
                  { tagAssignments: { some: { tagId: tagA } } },
                  { tagAssignments: { some: { tagId: tagB } } },
                ],
              },
            },
          },
        ]),
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 51,
      select: {
        contact: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            phone: true,
            contactType: {
              select: {
                id: true,
                displayName: true,
                color: true,
                active: true,
              },
            },
            tagAssignments: {
              orderBy: [
                { tag: { position: "asc" } },
                { tagId: "asc" },
              ],
              select: {
                tag: {
                  select: {
                    id: true,
                    displayName: true,
                    color: true,
                    active: true,
                  },
                },
              },
            },
          },
        },
        messages: { take: 1 },
      },
    });
    expect(definitionQueryWasCalled).toBe(false);
    expect(JSON.stringify(conversationQuery.select.contact)).not.toContain(
      "profilePictureUrl",
    );

    await createPrismaConversationRepository(client as never).list(userId, {
      search: "Loja 2",
      take: 51,
    });
    expect(conversationQuery.where.AND[0]).toEqual({
      contact: {
        is: {
          OR: [
            { preferredName: { contains: "Loja 2", mode: "insensitive" } },
            { name: { contains: "Loja 2", mode: "insensitive" } },
          ],
        },
      },
    });
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
