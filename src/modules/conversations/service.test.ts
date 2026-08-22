// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";

import {
  CONVERSATION_PAGE_SIZE,
  getConversation,
  listConversations,
  markRead,
  setResponsible,
} from "./service";
import { conversationListOptionsSchema } from "./schemas";
import type {
  ConversationListRecord,
  ConversationRepository,
  ConversationUserRecord,
  MessageRecord,
} from "./types";

const victor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const marcos: SessionUser = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};
const joao: SessionUser = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "João",
  email: "joao@example.test",
  role: UserRole.ATTENDANT,
};

const users: ConversationUserRecord[] = [victor, marcos, joao].map((user) => ({
  id: user.id,
  name: user.name,
  active: true,
}));

function message(
  id: string,
  conversationId: string,
  externalTimestamp: Date,
  direction: MessageDirection = MessageDirection.INBOUND,
  body = "mensagem",
): MessageRecord {
  return {
    id,
    conversationId,
    direction,
    type: MessageType.TEXT,
    body,
    content: null,
    mediaObjectId: null,
    sentByUser: direction === MessageDirection.OUTBOUND ? users[0]! : null,
    status:
      direction === MessageDirection.INBOUND
        ? MessageStatus.RECEIVED
        : MessageStatus.SENT,
    failureReason: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp,
    createdAt: externalTimestamp,
  };
}

function conversation(
  id: string,
  name: string,
  phone: string,
  lastMessageAt: Date,
  responsibleUser: ConversationUserRecord | null = null,
  messages: MessageRecord[] = [],
  teamLastReadMessageId: string | null = null,
  contactOverrides: Record<string, unknown> = {},
): ConversationListRecord {
  const teamLastReadMessage = messages.find(
    (candidate) => candidate.id === teamLastReadMessageId,
  );

  return {
    id,
    contact: {
      id: id.replace(/.$/, "f"),
      name,
      preferredName: null,
      phone,
      contactType: null,
      tagAssignments: [],
      ...contactOverrides,
    },
    responsibleUser,
    lastMessageAt,
    createdAt: new Date(0),
    updatedAt: lastMessageAt,
    latestMessage: [...messages]
      .sort(
        (left, right) =>
          right.externalTimestamp.getTime() - left.externalTimestamp.getTime() ||
          right.id.localeCompare(left.id),
      )[0] ?? null,
    unreadCount: 0,
    teamLastReadMessageId,
    teamLastReadAt: teamLastReadMessage?.externalTimestamp ?? null,
    manualUnreadAt: null,
    awaitingResponseSince: null,
  };
}

function createRepository(
  initialConversations: ConversationListRecord[],
  initialMessages: MessageRecord[],
  initialReads: Array<{
    userId: string;
    conversationId: string;
    lastReadMessageId: string;
    lastReadAt: Date;
  }> = [],
): ConversationRepository & {
  reads: typeof initialReads;
  upsertCalls: Array<[string, string, string]>;
  responsibleUpdates: Array<[string, string | null]>;
} {
  const records = initialConversations.map((record) => ({ ...record }));
  const messages = initialMessages.map((record) => ({ ...record }));
  const reads = initialReads.map((record) => ({ ...record }));
  const upsertCalls: Array<[string, string, string]> = [];
  const responsibleUpdates: Array<[string, string | null]> = [];

  const repository: ConversationRepository & {
    reads: typeof reads;
    upsertCalls: typeof upsertCalls;
    responsibleUpdates: typeof responsibleUpdates;
  } = {
    reads,
    upsertCalls,
    responsibleUpdates,
    list: async (_userId, query) => {
      const normalizedSearch = query.search?.toLocaleLowerCase("pt-BR");
      const canonicalPhoneSearch = query.search?.replace(/\D/gu, "");
      const filtered = records
        .filter(
          (record) =>
            !normalizedSearch ||
            record.contact.preferredName
              ?.toLocaleLowerCase("pt-BR")
              .includes(normalizedSearch) ||
            record.contact.name.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
            record.contact.phone
              ?.toLocaleLowerCase("pt-BR")
              .includes(normalizedSearch) ||
            Boolean(canonicalPhoneSearch) &&
              record.contact.phone?.replace(/\D/gu, "").includes(canonicalPhoneSearch!),
        )
        .filter(
          (record) =>
            !query.contactTypeId ||
            record.contact.contactType?.id === query.contactTypeId,
        )
        .filter(
          (record) =>
            !query.tagIds ||
            query.tagIds.every((tagId) =>
              record.contact.tagAssignments.some(({ tag }) => tag.id === tagId),
            ),
        )
        .filter(
          (record) =>
            !query.cursor ||
            record.lastMessageAt < query.cursor.lastMessageAt ||
            (record.lastMessageAt.getTime() === query.cursor.lastMessageAt.getTime() &&
              record.id < query.cursor.id),
        )
        .sort(
          (left, right) =>
            right.lastMessageAt.getTime() - left.lastMessageAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, query.take);

      return filtered.map((record) => {
        const readMessage = messages.find(
          (candidate) => candidate.id === record.teamLastReadMessageId,
        );
        const unreadCount = messages.filter((candidate) => {
          if (
            candidate.conversationId !== record.id ||
            candidate.direction !== MessageDirection.INBOUND
          ) {
            return false;
          }

          if (!readMessage) {
            return true;
          }

          return (
            candidate.externalTimestamp > readMessage.externalTimestamp ||
            (candidate.externalTimestamp.getTime() ===
              readMessage.externalTimestamp.getTime() &&
              candidate.id > readMessage.id)
          );
        }).length;

        return { ...record, unreadCount };
      });
    },
    findById: async (_userId, id) => {
      const record = records.find((candidate) => candidate.id === id);

      if (!record) {
        return null;
      }

      const conversationMessages = messages.filter(
        (candidate) => candidate.conversationId === id,
      );
      const readMessage = messages.find(
        (candidate) => candidate.id === record.teamLastReadMessageId,
      );

      return {
        ...record,
        messages: conversationMessages,
        unreadCount: conversationMessages.filter((candidate) => {
          if (candidate.direction !== MessageDirection.INBOUND) {
            return false;
          }

          if (!readMessage) {
            return true;
          }

          return (
            candidate.externalTimestamp > readMessage.externalTimestamp ||
            (candidate.externalTimestamp.getTime() ===
              readMessage.externalTimestamp.getTime() && candidate.id > readMessage.id)
          );
        }).length,
        lastReadMessageId: record.teamLastReadMessageId,
        lastReadAt: record.teamLastReadAt,
      };
    },
    findMessage: async (messageId) =>
      messages.find((candidate) => candidate.id === messageId) ?? null,
    findRead: async (userId, conversationId) =>
      (() => {
        const read = reads.find(
          (candidate) =>
            candidate.userId === userId && candidate.conversationId === conversationId,
        );
        return read
          ? {
              ...read,
              lastReadMessage:
                messages.find((candidate) => candidate.id === read.lastReadMessageId) ??
                null,
            }
          : null;
      })(),
    upsertRead: async (userId, conversationId, messageId) => {
      upsertCalls.push([userId, conversationId, messageId]);
      const targetMessage = messages.find((candidate) => candidate.id === messageId)!;
      const existing = reads.find(
        (candidate) =>
          candidate.userId === userId && candidate.conversationId === conversationId,
      );

      if (existing) {
        existing.lastReadMessageId = messageId;
        existing.lastReadAt = targetMessage.externalTimestamp;
        return { ...existing, lastReadMessage: targetMessage };
      }

      const created = {
        userId,
        conversationId,
        lastReadMessageId: messageId,
        lastReadAt: targetMessage.externalTimestamp,
      };
      reads.push(created);
      return { ...created, lastReadMessage: targetMessage };
    },
    findActiveUser: async (userId) =>
      users.find((candidate) => candidate.id === userId && candidate.active) ?? null,
    updateResponsible: async (id, userId) => {
      responsibleUpdates.push([id, userId]);
      const record = records.find((candidate) => candidate.id === id);

      if (!record) {
        return;
      }

      record.responsibleUser =
        users.find((candidate) => candidate.id === userId) ?? null;
    },
    transaction: async (operation) => operation(repository),
  };

  return repository;
}

describe("conversation service", () => {
  it("resolves the safe contact DTO with immutable profile name, formatted phone, and ordered assigned classifications", async () => {
    const typeId = "40000000-0000-4000-8000-000000000001";
    const firstTagId = "50000000-0000-4000-8000-000000000001";
    const secondTagId = "50000000-0000-4000-8000-000000000002";
    const record = conversation(
      "10000000-0000-4000-8000-000000000001",
      "Nome Meta",
      "5511999991234",
      new Date(1),
      null,
      [],
      null,
      {
        preferredName: "  Bia  ",
        profilePictureUrl: "https://provider.example/private-profile.jpg",
        whatsappId: "raw-provider-identity",
        contactType: {
          id: typeId,
          displayName: "Cliente",
          color: "#112233",
          position: 0,
          active: false,
        },
        tagAssignments: [
          {
            tag: {
              id: secondTagId,
              displayName: "Segundo",
              color: "#445566",
              position: 2,
              active: false,
            },
          },
          {
            tag: {
              id: firstTagId,
              displayName: "Primeiro",
              color: "#778899",
              position: 1,
              active: true,
            },
          },
        ],
      },
    );

    const result = await listConversations(
      victor.id,
      {},
      createRepository([record], []),
    );

    expect(result.items[0]?.contact).toEqual({
      id: record.contact.id,
      profileName: "Nome Meta",
      preferredName: "  Bia  ",
      name: "Bia",
      phone: "+55 (11) 99999-1234",
      type: { id: typeId, name: "Cliente", color: "#112233", active: false },
      tags: [
        { id: firstTagId, name: "Primeiro", color: "#778899", active: true },
        { id: secondTagId, name: "Segundo", color: "#445566", active: false },
      ],
    });
    expect(JSON.stringify(result.items[0]?.contact)).not.toContain(
      "raw-provider-identity",
    );
    expect(result.items[0]?.contact).not.toHaveProperty("profilePictureUrl");
    expect(JSON.stringify(result.items[0]?.contact)).not.toContain(
      "provider.example",
    );
  });

  it("uses the exact display fallback when preferred and profile names are blank", async () => {
    const record = conversation(
      "10000000-0000-4000-8000-000000000001",
      "   ",
      "551133331234",
      new Date(1),
      null,
      [],
      null,
      { preferredName: null },
    );

    await expect(
      listConversations(victor.id, {}, createRepository([record], [])),
    ).resolves.toMatchObject({
      items: [{ contact: { name: "+55 (11) 3333-1234" } }],
    });
  });

  it("canonicalizes classification filters and rejects semantic tag duplicates", () => {
    const typeId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const tagId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";

    expect(
      conversationListOptionsSchema.parse({
        contactTypeId: typeId,
        tagIds: [tagId],
      }),
    ).toEqual({
      contactTypeId: typeId.toLowerCase(),
      tagIds: [tagId.toLowerCase()],
    });
    expect(() =>
      conversationListOptionsSchema.parse({
        tagIds: [tagId, tagId.toLowerCase()],
      }),
    ).toThrow();
    expect(() =>
      conversationListOptionsSchema.parse({ tagIds: Array(21).fill(tagId) }),
    ).toThrow();
  });

  it("forwards exact type and tag filters with AND semantics", async () => {
    const typeId = "40000000-0000-4000-8000-000000000001";
    const tagA = "50000000-0000-4000-8000-000000000001";
    const tagB = "50000000-0000-4000-8000-000000000002";
    const matching = conversation(
      "10000000-0000-4000-8000-000000000001",
      "Carlos",
      "5511999990001",
      new Date(2),
      null,
      [],
      null,
      {
        contactType: { id: typeId },
        tagAssignments: [{ tag: { id: tagA } }, { tag: { id: tagB } }],
      },
    );
    const missingTag = conversation(
      "10000000-0000-4000-8000-000000000002",
      "Carla",
      "5511999990002",
      new Date(1),
      null,
      [],
      null,
      {
        contactType: { id: typeId },
        tagAssignments: [{ tag: { id: tagA } }],
      },
    );

    const result = await listConversations(
      victor.id,
      { contactTypeId: typeId, tagIds: [tagA, tagB] },
      createRepository([matching, missingTag], []),
    );

    expect(result.items.map(({ id }) => id)).toEqual([matching.id]);
  });

  it("returns conversations assigned to another employee", async () => {
    const assigned = conversation(
      "10000000-0000-4000-8000-000000000001",
      "Carlos",
      "+55 11 99999-0001",
      new Date(3),
      users[1],
    );
    const repository = createRepository([assigned], []);

    const result = await listConversations(joao.id, {}, repository);

    expect(result.items.map((item) => item.id)).toContain(assigned.id);
    expect(result.items[0]?.responsible).toEqual({ id: marcos.id, name: marcos.name });
  });

  it("searches preferred/profile names and canonical phone through masked input only", async () => {
    const firstId = "10000000-0000-4000-8000-000000000001";
    const secondId = "10000000-0000-4000-8000-000000000002";
    const records = [
      conversation(firstId, "Álvaro", "5511900000001", new Date(2)),
      conversation(
        secondId,
        "Beatriz Meta",
        "5521988881000",
        new Date(1),
        null,
        [],
        null,
        { preferredName: "Bia" },
      ),
    ];
    const messages = [message("20000000-0000-4000-8000-000000000001", secondId, new Date(1), MessageDirection.INBOUND, "Álvaro")];
    const repository = createRepository(records, messages);

    await expect(listConversations(victor.id, { search: "  BIA  " }, repository))
      .resolves.toMatchObject({ items: [{ id: secondId }] });
    await expect(listConversations(victor.id, { search: "+55 (11) 90000-0001" }, repository))
      .resolves.toMatchObject({ items: [{ id: firstId }] });
    await expect(listConversations(victor.id, { search: "mensagem inexistente" }, repository))
      .resolves.toMatchObject({ items: [] });
  });

  it("orders by last message and uses id as a stable cursor tie-breaker", async () => {
    const sameTimestamp = new Date("2026-08-19T12:00:00.000Z");
    const records = Array.from({ length: CONVERSATION_PAGE_SIZE + 1 }, (_, index) => {
      const suffix = (index + 1).toString(16).padStart(12, "0");
      return conversation(
        `10000000-0000-4000-8000-${suffix}`,
        `Contato ${index}`,
        `${index}`,
        sameTimestamp,
      );
    });
    const repository = createRepository(records, []);

    const firstPage = await listConversations(victor.id, {}, repository);
    const secondPage = await listConversations(
      victor.id,
      { cursor: firstPage.nextCursor ?? undefined },
      repository,
    );

    expect(firstPage.items).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items.at(-1)?.id);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("returns the same shared unread count to every user", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const first = message("20000000-0000-4000-8000-000000000001", conversationId, new Date(1));
    const outbound = message("20000000-0000-4000-8000-000000000002", conversationId, new Date(2), MessageDirection.OUTBOUND);
    const latest = message("20000000-0000-4000-8000-000000000003", conversationId, new Date(3));
    const record = conversation(
      conversationId,
      "Carlos",
      "5511999990001",
      new Date(3),
      null,
      [first, outbound, latest],
      first.id,
    );
    const repository = createRepository([record], [first, outbound, latest], [
      {
        userId: victor.id,
        conversationId,
        lastReadMessageId: first.id,
        lastReadAt: first.externalTimestamp,
      },
    ]);

    await expect(listConversations(victor.id, {}, repository)).resolves.toMatchObject({
      items: [{ unreadCount: 1 }],
    });
    await expect(listConversations(marcos.id, {}, repository)).resolves.toMatchObject({
      items: [{ unreadCount: 1 }],
    });
  });

  it("returns conversation history in chronological order without internal fields", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const latest = message("20000000-0000-4000-8000-000000000002", conversationId, new Date(2));
    const first = message("20000000-0000-4000-8000-000000000001", conversationId, new Date(1));
    const record = conversation(conversationId, "Carlos", "5511999990001", new Date(2), null, [latest, first]);
    const repository = createRepository([record], [latest, first]);

    const result = await getConversation(victor.id, conversationId, repository);

    expect(result.messages.map((item) => item.id)).toEqual([first.id, latest.id]);
    expect(result).not.toHaveProperty("contactId");
    expect(result.messages[0]).not.toHaveProperty("whatsappMessageId");
  });

  it("replaces corrupt stored content with a safe null DTO", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const stored = message(
      "20000000-0000-4000-8000-000000000001",
      conversationId,
      new Date(1),
    );
    stored.content = { kind: "location", latitude: 999, longitude: 0 };
    const record = conversation(
      conversationId,
      "Carlos",
      "5511999990001",
      new Date(1),
      null,
      [stored],
    );
    const repository = createRepository([record], [stored]);

    const detail = await getConversation(victor.id, conversationId, repository);

    expect(detail.messages[0]?.content).toBeNull();
  });

  it("marks only the actor read state", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const latest = message("20000000-0000-4000-8000-000000000001", conversationId, new Date(1));
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "5511999990001", new Date(1), null, [latest])],
      [latest],
    );

    await markRead(victor.id, conversationId, latest.id, repository);

    expect(repository.upsertCalls).toEqual([[victor.id, conversationId, latest.id]]);
    expect(repository.reads).toEqual([
      expect.objectContaining({ userId: victor.id, conversationId }),
    ]);
    expect(repository.reads.some((read) => read.userId === marcos.id)).toBe(false);
  });

  it("rejects a read message from another conversation", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const otherConversationId = "10000000-0000-4000-8000-000000000002";
    const foreign = message("20000000-0000-4000-8000-000000000001", otherConversationId, new Date(1));
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", new Date(1))],
      [foreign],
    );

    await expect(
      markRead(victor.id, conversationId, foreign.id, repository),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.upsertCalls).toEqual([]);
  });

  it("keeps read state monotonic when an older message arrives later", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const older = message("20000000-0000-4000-8000-000000000001", conversationId, new Date(1));
    const latest = message("20000000-0000-4000-8000-000000000002", conversationId, new Date(2));
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", new Date(2), null, [older, latest])],
      [older, latest],
      [{
        userId: victor.id,
        conversationId,
        lastReadMessageId: latest.id,
        lastReadAt: latest.externalTimestamp,
      }],
    );

    const result = await markRead(victor.id, conversationId, older.id, repository);

    expect(repository.upsertCalls).toEqual([]);
    expect(result.lastReadMessageId).toBe(latest.id);
  });

  it("counts a higher id at the same timestamp as unread", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const timestamp = new Date("2026-08-19T12:00:00.000Z");
    const lower = message(
      "20000000-0000-4000-8000-000000000001",
      conversationId,
      timestamp,
    );
    const higher = message(
      "20000000-0000-4000-8000-000000000002",
      conversationId,
      timestamp,
    );
    const repository = createRepository(
      [
        conversation(
          conversationId,
          "Carlos",
          "1",
          timestamp,
          null,
          [lower, higher],
          lower.id,
        ),
      ],
      [lower, higher],
      [{
        userId: victor.id,
        conversationId,
        lastReadMessageId: lower.id,
        lastReadAt: timestamp,
      }],
    );

    await expect(listConversations(victor.id, {}, repository)).resolves.toMatchObject({
      items: [{ unreadCount: 1 }],
    });
  });

  it("advances a read to a higher id at the same timestamp", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const timestamp = new Date("2026-08-19T12:00:00.000Z");
    const lower = message(
      "20000000-0000-4000-8000-000000000001",
      conversationId,
      timestamp,
    );
    const higher = message(
      "20000000-0000-4000-8000-000000000002",
      conversationId,
      timestamp,
    );
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", timestamp, null, [lower, higher])],
      [lower, higher],
      [{
        userId: victor.id,
        conversationId,
        lastReadMessageId: lower.id,
        lastReadAt: timestamp,
      }],
    );

    const result = await markRead(victor.id, conversationId, higher.id, repository);

    expect(result.lastReadMessageId).toBe(higher.id);
    expect(repository.upsertCalls).toEqual([[victor.id, conversationId, higher.id]]);
  });

  it("does not regress equal-timestamp reads during concurrent attempts", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const timestamp = new Date("2026-08-19T12:00:00.000Z");
    const lower = message(
      "20000000-0000-4000-8000-000000000001",
      conversationId,
      timestamp,
    );
    const higher = message(
      "20000000-0000-4000-8000-000000000002",
      conversationId,
      timestamp,
    );
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", timestamp, null, [lower, higher])],
      [lower, higher],
      [{
        userId: victor.id,
        conversationId,
        lastReadMessageId: lower.id,
        lastReadAt: timestamp,
      }],
    );

    await Promise.all([
      markRead(victor.id, conversationId, higher.id, repository),
      markRead(victor.id, conversationId, lower.id, repository),
    ]);

    expect(repository.reads[0]?.lastReadMessageId).toBe(higher.id);
  });

  it("assigns an active employee and returns the committed conversation", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", new Date(1))],
      [],
    );

    const result = await setResponsible(victor, conversationId, marcos.id, repository);

    expect(repository.responsibleUpdates).toEqual([[conversationId, marcos.id]]);
    expect(result.responsible).toEqual({ id: marcos.id, name: marcos.name });
  });

  it("rejects an inactive responsible target", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", new Date(1))],
      [],
    );
    users[1]!.active = false;

    try {
      await expect(
        setResponsible(victor, conversationId, marcos.id, repository),
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.responsibleUpdates).toEqual([]);
    } finally {
      users[1]!.active = true;
    }
  });

  it("removes the responsible employee", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", new Date(1), users[1])],
      [],
    );

    const result = await setResponsible(victor, conversationId, null, repository);

    expect(repository.responsibleUpdates).toEqual([[conversationId, null]]);
    expect(result.responsible).toBeNull();
  });

  it("maps current reactions and revocation into message DTOs", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const timestamp = new Date("2026-08-22T12:00:00.000Z");
    const target = message(
      "20000000-0000-4000-8000-000000000001",
      conversationId,
      timestamp,
    ) as MessageRecord & {
      revokedAt: Date | null;
      reactions: Array<{
        id: string;
        reactor: "CONTACT" | "BUSINESS";
        emoji: string;
        status: "SENT";
        sentByUser: ConversationUserRecord | null;
      }>;
    };
    target.revokedAt = new Date("2026-08-22T12:05:00.000Z");
    target.reactions = [
      {
        id: "30000000-0000-4000-8000-000000000002",
        reactor: "BUSINESS",
        emoji: "❤️",
        status: "SENT",
        sentByUser: users[0]!,
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        reactor: "CONTACT",
        emoji: "👍",
        status: "SENT",
        sentByUser: null,
      },
    ];
    const repository = createRepository(
      [conversation(conversationId, "Carlos", "1", timestamp, null, [target])],
      [target],
    );

    const result = await getConversation(victor.id, conversationId, repository);

    expect(result.messages[0]).toMatchObject({
      revokedAt: "2026-08-22T12:05:00.000Z",
      reactions: [
        { reactor: "CONTACT", emoji: "👍", status: "SENT", sentBy: null },
        { reactor: "BUSINESS", emoji: "❤️", status: "SENT", sentBy: { id: victor.id, name: victor.name } },
      ],
    });
  });
});
