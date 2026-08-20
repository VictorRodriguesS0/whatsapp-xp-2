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
    mediaObjectId: null,
    sentByUser: direction === MessageDirection.OUTBOUND ? users[0]! : null,
    status:
      direction === MessageDirection.INBOUND
        ? MessageStatus.RECEIVED
        : MessageStatus.SENT,
    failureReason: null,
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
): ConversationListRecord {
  return {
    id,
    contact: {
      id: id.replace(/.$/, "f"),
      name,
      phone,
      profilePictureUrl: null,
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
    list: async (userId, query) => {
      const normalizedSearch = query.search?.toLocaleLowerCase("pt-BR");
      const filtered = records
        .filter(
          (record) =>
            !normalizedSearch ||
            record.contact.name.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
            record.contact.phone.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
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
        const read = reads.find(
          (candidate) =>
            candidate.userId === userId && candidate.conversationId === record.id,
        );
        const unreadCount = messages.filter(
          (candidate) =>
            candidate.conversationId === record.id &&
            candidate.direction === MessageDirection.INBOUND &&
            (!read || candidate.externalTimestamp > read.lastReadAt),
        ).length;

        return { ...record, unreadCount };
      });
    },
    findById: async (userId, id) => {
      const record = records.find((candidate) => candidate.id === id);

      if (!record) {
        return null;
      }

      const read = reads.find(
        (candidate) => candidate.userId === userId && candidate.conversationId === id,
      );
      const conversationMessages = messages.filter(
        (candidate) => candidate.conversationId === id,
      );

      return {
        ...record,
        messages: conversationMessages,
        unreadCount: conversationMessages.filter(
          (candidate) =>
            candidate.direction === MessageDirection.INBOUND &&
            (!read || candidate.externalTimestamp > read.lastReadAt),
        ).length,
        lastReadMessageId: read?.lastReadMessageId ?? null,
        lastReadAt: read?.lastReadAt ?? null,
      };
    },
    findMessage: async (messageId) =>
      messages.find((candidate) => candidate.id === messageId) ?? null,
    findRead: async (userId, conversationId) =>
      reads.find(
        (candidate) =>
          candidate.userId === userId && candidate.conversationId === conversationId,
      ) ?? null,
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
        return existing;
      }

      const created = {
        userId,
        conversationId,
        lastReadMessageId: messageId,
        lastReadAt: targetMessage.externalTimestamp,
      };
      reads.push(created);
      return created;
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

  it("searches only normalized contact name and phone", async () => {
    const firstId = "10000000-0000-4000-8000-000000000001";
    const secondId = "10000000-0000-4000-8000-000000000002";
    const records = [
      conversation(firstId, "Álvaro", "+55 11 90000-0001", new Date(2)),
      conversation(secondId, "Beatriz", "+55 21 98888-1000", new Date(1)),
    ];
    const messages = [message("20000000-0000-4000-8000-000000000001", secondId, new Date(1), MessageDirection.INBOUND, "Álvaro")];
    const repository = createRepository(records, messages);

    await expect(listConversations(victor.id, { search: "  BEATRIZ  " }, repository))
      .resolves.toMatchObject({ items: [{ id: secondId }] });
    await expect(listConversations(victor.id, { search: "90000-0001" }, repository))
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

  it("calculates unread inbound messages independently for each user", async () => {
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const first = message("20000000-0000-4000-8000-000000000001", conversationId, new Date(1));
    const outbound = message("20000000-0000-4000-8000-000000000002", conversationId, new Date(2), MessageDirection.OUTBOUND);
    const latest = message("20000000-0000-4000-8000-000000000003", conversationId, new Date(3));
    const record = conversation(conversationId, "Carlos", "5511999990001", new Date(3), null, [first, outbound, latest]);
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
      items: [{ unreadCount: 2 }],
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
});
