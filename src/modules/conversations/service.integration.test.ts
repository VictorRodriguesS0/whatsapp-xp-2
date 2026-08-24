// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";

import {
  CONVERSATION_PAGE_SIZE,
  getConversation,
  listConversations,
  setConversationPinned,
} from "./service";
import { advanceSharedRead } from "./shared-state";

const lowerId = "20000000-0000-4000-8000-000000000001";
const higherId = "20000000-0000-4000-8000-000000000002";

async function seedEqualTimestampFixture() {
  const timestamp = new Date("2026-08-19T12:00:00.000Z");
  const user = await prisma.user.create({
    data: {
      name: "Victor",
      email: "victor.conversations@example.test",
      passwordHash: "not-used-by-this-fixture",
      role: UserRole.ADMIN,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      whatsappId: "5511999990001",
      phone: "+55 11 99999-0001",
      name: "Carlos",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { contactId: contact.id, lastMessageAt: timestamp },
  });
  await prisma.message.createMany({
    data: [lowerId, higherId].map((id) => ({
      id,
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      body: id === lowerId ? "primeira" : "segunda",
      status: MessageStatus.RECEIVED,
      externalTimestamp: timestamp,
    })),
  });

  return { conversation, timestamp, user };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("conversation Prisma repository", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses the message id to delimit unread messages at an equal timestamp", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();

    await advanceSharedRead(user.id, conversation.id, lowerId, null);
    await expect(listConversations(user.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 1, latestMessage: { id: higherId } }],
    });

    const advanced = await advanceSharedRead(
      user.id,
      conversation.id,
      higherId,
      null,
    );
    expect(advanced.unreadCount).toBe(0);
    await expect(listConversations(user.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 0 }],
    });
  });

  it("paginates an unlimited shared pinned queue before unpinned conversations", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.pins@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ADMIN,
      },
    });
    const conversations = await Promise.all(
      Array.from({ length: CONVERSATION_PAGE_SIZE + 2 }, (_, index) =>
        prisma.conversation.create({
          data: {
            contact: {
              create: {
                whatsappId: `55619000${index.toString().padStart(4, "0")}`,
                phone: `55619000${index.toString().padStart(4, "0")}`,
                name: `Contato ${index}`,
              },
            },
            lastMessageAt: new Date(Date.UTC(2026, 7, 23, 10, index)),
          },
        }),
      ),
    );
    await Promise.all(
      conversations.slice(0, CONVERSATION_PAGE_SIZE).map((conversation, index) =>
        prisma.conversation.update({
          where: { id: conversation.id },
          data: { pinnedAt: new Date(Date.UTC(2026, 7, 23, 11, index)) },
        }),
      ),
    );
    const servicePinned = conversations[CONVERSATION_PAGE_SIZE]!;
    const unpinned = conversations[CONVERSATION_PAGE_SIZE + 1]!;
    const pinnedAt = new Date("2026-08-23T12:00:00.000Z");

    const firstState = await setConversationPinned(
      user.id,
      servicePinned.id,
      true,
      undefined,
      () => pinnedAt,
    );
    const repeatedState = await setConversationPinned(
      user.id,
      servicePinned.id,
      true,
      undefined,
      () => new Date("2026-08-23T13:00:00.000Z"),
    );
    const firstPage = await listConversations(user.id, {});
    const secondPage = await listConversations(user.id, {
      cursor: firstPage.nextCursor ?? undefined,
    });
    const allItems = [...firstPage.items, ...secondPage.items];

    expect(firstState.pinnedAt).toBe(pinnedAt.toISOString());
    expect(repeatedState.pinnedAt).toBe(pinnedAt.toISOString());
    expect(firstPage.items).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(secondPage.items).toHaveLength(2);
    expect(new Set(allItems.map(({ id }) => id)).size).toBe(allItems.length);
    expect(allItems.at(-2)).toMatchObject({ pinnedAt: expect.any(String) });
    expect(allItems.at(-1)).toMatchObject({ id: unpinned.id, pinnedAt: null });
  });

  it("keeps the highest equal-timestamp message during concurrent read attempts", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    await advanceSharedRead(user.id, conversation.id, lowerId, null);

    await Promise.all([
      advanceSharedRead(user.id, conversation.id, higherId, null),
      advanceSharedRead(user.id, conversation.id, lowerId, null),
    ]);

    await expect(getConversation(user.id, conversation.id)).resolves.toMatchObject({
      lastReadMessageId: higherId,
      unreadCount: 0,
    });
  });

  it("exposes only safe media recovery state in conversation DTOs", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    const nextAttemptAt = new Date("2020-01-01T00:00:00.000Z");
    const leaseUntil = new Date("2099-01-01T00:00:00.000Z");
    const media = await prisma.mediaObject.create({
      data: {
        storageProvider: "local-secret-provider",
        storageKey: "secret-storage-key",
        originalFilename: "private-provider-filename.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4n,
        sha256: "secret-hash",
        metaMediaId: "secret-provider-id",
        status: MediaStatus.PENDING,
        failureReason: "secret-internal-reason",
        downloadLeaseId: "99999999-9999-4999-8999-999999999999",
        downloadLeaseUntil: leaseUntil,
        downloadNextAttemptAt: nextAttemptAt,
        downloadAttempts: 1,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        mediaObjectId: media.id,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:01:00.000Z"),
      },
    });

    const detail = await getConversation(user.id, conversation.id);
    const dto = detail.messages.find((candidate) => candidate.id === message.id);

    expect(dto?.mediaState).toEqual({
      status: MediaStatus.PENDING,
      nextAttemptAt: leaseUntil.toISOString(),
      canRetry: false,
    });
    expect(dto?.mediaMimeType).toBe("image/jpeg");
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("secret-storage-key");
    expect(serialized).not.toContain("private-provider-filename.jpg");
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).not.toContain("secret-provider-id");
    expect(serialized).not.toContain("secret-internal-reason");
    expect(serialized).not.toContain("99999999-9999-4999-8999-999999999999");
  });

  it("selects and exposes validated message content", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    const content = {
      kind: "location",
      latitude: -15.793889,
      longitude: -47.882778,
      name: "XP Eletrônicos",
      address: "Brasília - DF",
    } as const;
    const richMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.LOCATION,
        content,
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:01:00.000Z"),
      },
    });

    const detail = await getConversation(user.id, conversation.id);

    expect(detail.messages.find(({ id }) => id === richMessage.id)?.content).toEqual(
      content,
    );
  });

  it("selects one safe quoted target and keeps unresolved official IDs private", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    const original = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.integration-original",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Tem esse produto?",
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:02:00.000Z"),
      },
    });
    const linked = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.integration-linked",
        replyToMessageId: original.id,
        replyToWhatsappMessageId: original.whatsappMessageId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Sim",
        sentByUserId: user.id,
        status: MessageStatus.SENT,
        externalTimestamp: new Date("2026-08-19T12:03:00.000Z"),
      },
    });
    const unresolved = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        whatsappMessageId: "wamid.integration-unresolved",
        replyToWhatsappMessageId: "wamid.integration-deleted",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Outra resposta",
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:04:00.000Z"),
      },
    });

    const detail = await getConversation(user.id, conversation.id);
    const linkedDto = detail.messages.find(({ id }) => id === linked.id);
    const unresolvedDto = detail.messages.find(({ id }) => id === unresolved.id);

    expect(linkedDto).toMatchObject({
      canReply: true,
      replyTo: {
        available: true,
        messageId: original.id,
        author: "Cliente",
        summary: "Tem esse produto?",
      },
    });
    expect(unresolvedDto).toMatchObject({
      canReply: true,
      replyTo: { available: false },
    });
    expect(JSON.stringify(detail)).not.toContain("wamid.");
  });

  it("reparses corrupt database JSON to a safe null DTO", async () => {
    const { conversation, user } = await seedEqualTimestampFixture();
    const corruptMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.LOCATION,
        content: { kind: "location", latitude: 999, longitude: 0 },
        status: MessageStatus.RECEIVED,
        externalTimestamp: new Date("2026-08-19T12:01:00.000Z"),
      },
    });

    const detail = await getConversation(user.id, conversation.id);

    expect(detail.messages.find(({ id }) => id === corruptMessage.id)?.content).toBeNull();
  });

  it("searches canonical contact fields and applies inactive type plus multiple tags with AND semantics", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.filters@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ADMIN,
      },
    });
    const type = await prisma.contactType.create({
      data: {
        displayName: "Cliente inativo",
        normalizedName: `cliente-inativo-${user.id}`,
        color: "#112233",
        position: 0,
        active: false,
      },
    });
    const [tagA, tagB] = await Promise.all([
      prisma.contactTagDefinition.create({
        data: {
          displayName: "Primeira",
          normalizedName: `primeira-${user.id}`,
          color: "#445566",
          position: 1,
        },
      }),
      prisma.contactTagDefinition.create({
        data: {
          displayName: "Segunda inativa",
          normalizedName: `segunda-${user.id}`,
          color: "#778899",
          position: 2,
          active: false,
        },
      }),
    ]);
    const matching = await prisma.contact.create({
      data: {
        whatsappId: "5511999991234",
        phone: "5511999991234",
        name: "Nome Meta",
        preferredName: "Bia",
        contactTypeId: type.id,
        tagAssignments: {
          create: [{ tagId: tagB.id }, { tagId: tagA.id }],
        },
      },
    });
    const missingTag = await prisma.contact.create({
      data: {
        whatsappId: "5511999991235",
        phone: "5511999991235",
        name: "Outra pessoa",
        contactTypeId: type.id,
        tagAssignments: { create: [{ tagId: tagA.id }] },
      },
    });
    await Promise.all([
      prisma.conversation.create({
        data: { contactId: matching.id, lastMessageAt: new Date(2) },
      }),
      prisma.conversation.create({
        data: { contactId: missingTag.id, lastMessageAt: new Date(1) },
      }),
    ]);

    await expect(listConversations(user.id, { search: "  BIA  " })).resolves.toMatchObject({
      items: [{ contact: { id: matching.id, profileName: "Nome Meta" } }],
    });
    await expect(
      listConversations(user.id, { search: "NOME META" }),
    ).resolves.toMatchObject({ items: [{ contact: { id: matching.id } }] });
    await expect(
      listConversations(user.id, { search: "+55 (11) 99999-1234" }),
    ).resolves.toMatchObject({ items: [{ contact: { id: matching.id } }] });
    await expect(
      listConversations(user.id, { search: "Loja 5" }),
    ).resolves.toMatchObject({ items: [] });

    const filtered = await listConversations(user.id, {
      contactTypeId: type.id,
      tagIds: [tagA.id, tagB.id],
    });

    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.contact).toMatchObject({
      id: matching.id,
      name: "Bia",
      phone: "+55 (11) 99999-1234",
      type: { id: type.id, active: false },
      tags: [
        { id: tagA.id, active: true },
        { id: tagB.id, active: false },
      ],
    });
  });
});
