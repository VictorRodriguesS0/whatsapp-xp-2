// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase, seedReadFixture } from "@/test/database";

import { getConversation, listConversations } from "./service";
import {
  advanceSharedRead,
  advanceTeamReadFromBusinessEcho,
  markSharedUnread,
  refreshResponseState,
} from "./shared-state";

const lowerId = "20000000-0000-4000-8000-000000000001";
const higherId = "20000000-0000-4000-8000-000000000002";
const newestId = "20000000-0000-4000-8000-000000000003";
const echoId = "30000000-0000-4000-8000-000000000001";

async function seedMessages(options: { equalTimestamps?: boolean } = {}) {
  const fixture = await seedReadFixture();
  const firstTimestamp = new Date("2026-08-21T12:00:00.000Z");
  const secondTimestamp = options.equalTimestamps
    ? firstTimestamp
    : new Date("2026-08-21T12:01:00.000Z");

  await prisma.message.createMany({
    data: [
      {
        id: lowerId,
        conversationId: fixture.conversation.id,
        whatsappMessageId: "wamid.shared-lower",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "primeira",
        status: MessageStatus.RECEIVED,
        externalTimestamp: firstTimestamp,
      },
      {
        id: higherId,
        conversationId: fixture.conversation.id,
        whatsappMessageId: "wamid.shared-higher",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "segunda",
        status: MessageStatus.RECEIVED,
        externalTimestamp: secondTimestamp,
      },
    ],
  });
  await prisma.conversation.update({
    where: { id: fixture.conversation.id },
    data: { lastMessageAt: secondTimestamp },
  });

  return { ...fixture, firstTimestamp, secondTimestamp };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("shared conversation state", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("shares a read boundary and its unread result with every user", async () => {
    const { conversation, victor, marcos } = await seedMessages();

    const state = await advanceSharedRead(
      victor.id,
      conversation.id,
      higherId,
      null,
    );

    expect(state).toMatchObject({
      conversationId: conversation.id,
      unreadCount: 0,
      manuallyUnread: false,
    });
    await expect(listConversations(marcos.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 0, manuallyUnread: false }],
    });
    await expect(
      prisma.conversationRead.findUnique({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: victor.id,
          },
        },
      }),
    ).resolves.toMatchObject({ lastReadMessageId: higherId });
    await expect(prisma.conversationAuditEvent.count()).resolves.toBe(1);
  });

  it("leaves an inbound message beyond the observed boundary unread", async () => {
    const { conversation, victor, marcos, secondTimestamp } = await seedMessages();
    const newestTimestamp = new Date(secondTimestamp.getTime() + 60_000);
    await prisma.message.create({
      data: {
        id: newestId,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "chegou enquanto a conversa estava aberta",
        status: MessageStatus.RECEIVED,
        externalTimestamp: newestTimestamp,
      },
    });

    await advanceSharedRead(victor.id, conversation.id, higherId, null);

    await expect(getConversation(marcos.id, conversation.id)).resolves.toMatchObject({
      lastReadMessageId: higherId,
      unreadCount: 1,
    });
  });

  it("does not regress an equal-timestamp boundary during concurrent reads", async () => {
    const { conversation, victor, marcos } = await seedMessages({
      equalTimestamps: true,
    });

    await Promise.all([
      advanceSharedRead(victor.id, conversation.id, higherId, null),
      advanceSharedRead(marcos.id, conversation.id, lowerId, null),
    ]);

    await expect(getConversation(victor.id, conversation.id)).resolves.toMatchObject({
      lastReadMessageId: higherId,
      unreadCount: 0,
    });
    await expect(
      prisma.whatsAppReadSync.findUniqueOrThrow({
        where: { conversationId: conversation.id },
      }),
    ).resolves.toMatchObject({ targetMessageId: higherId, attemptCount: 0 });
    await expect(
      prisma.conversationRead.count({ where: { conversationId: conversation.id } }),
    ).resolves.toBe(2);
    await expect(
      prisma.conversationAuditEvent.count({ where: { conversationId: conversation.id } }),
    ).resolves.toBe(2);
  });

  it("preserves timestamp-only team and individual boundaries", async () => {
    const { conversation, victor, marcos, secondTimestamp } =
      await seedMessages();
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        teamLastReadAt: secondTimestamp,
        teamLastReadMessageId: null,
      },
    });
    await prisma.conversationRead.create({
      data: {
        conversationId: conversation.id,
        userId: victor.id,
        lastReadAt: secondTimestamp,
      },
    });

    await expect(listConversations(marcos.id, {})).resolves.toMatchObject({
      items: [{ unreadCount: 0 }],
    });
    await advanceSharedRead(victor.id, conversation.id, lowerId, null);

    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({
      teamLastReadMessageId: null,
      teamLastReadAt: secondTimestamp,
    });
    await expect(
      prisma.conversationRead.findUniqueOrThrow({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: victor.id,
          },
        },
      }),
    ).resolves.toMatchObject({
      lastReadMessageId: null,
      lastReadAt: secondTimestamp,
    });
  });

  it("shares manual unread and clears only the exact observed revision", async () => {
    const { conversation, victor, marcos } = await seedMessages();
    await advanceSharedRead(victor.id, conversation.id, higherId, null);

    const firstMark = await markSharedUnread(victor.id, conversation.id);
    await expect(getConversation(marcos.id, conversation.id)).resolves.toMatchObject({
      manuallyUnread: true,
      manualUnreadRevision: firstMark.manualUnreadRevision,
    });

    const newerMark = await markSharedUnread(victor.id, conversation.id);
    expect(newerMark.manualUnreadRevision).not.toBe(firstMark.manualUnreadRevision);
    await advanceSharedRead(
      marcos.id,
      conversation.id,
      higherId,
      firstMark.manualUnreadRevision,
    );
    await expect(getConversation(victor.id, conversation.id)).resolves.toMatchObject({
      manuallyUnread: true,
      manualUnreadRevision: newerMark.manualUnreadRevision,
    });

    await advanceSharedRead(
      marcos.id,
      conversation.id,
      lowerId,
      newerMark.manualUnreadRevision,
    );
    await expect(getConversation(victor.id, conversation.id)).resolves.toMatchObject({
      manuallyUnread: true,
      manualUnreadRevision: newerMark.manualUnreadRevision,
    });

    await advanceSharedRead(
      marcos.id,
      conversation.id,
      higherId,
      newerMark.manualUnreadRevision,
    );
    await expect(getConversation(victor.id, conversation.id)).resolves.toMatchObject({
      manuallyUnread: false,
      manualUnreadRevision: null,
    });
  });

  it("advances only the team boundary for an official app reply", async () => {
    const { conversation, victor, secondTimestamp } = await seedMessages();
    const echoTimestamp = new Date(secondTimestamp.getTime() + 60_000);
    await prisma.message.create({
      data: {
        id: echoId,
        conversationId: conversation.id,
        whatsappMessageId: "wamid.shared-official-echo",
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "resposta pelo aplicativo oficial",
        status: MessageStatus.SENT,
        externalTimestamp: echoTimestamp,
      },
    });
    const marked = await markSharedUnread(victor.id, conversation.id);
    const auditCountBefore = await prisma.conversationAuditEvent.count();

    const advanced = await prisma.$transaction((transaction) =>
      advanceTeamReadFromBusinessEcho(transaction, conversation.id, {
        id: echoId,
        externalTimestamp: echoTimestamp,
      }),
    );

    expect(advanced).toEqual({ id: higherId, externalTimestamp: secondTimestamp });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({
      teamLastReadMessageId: higherId,
      teamLastReadAt: secondTimestamp,
      manualUnreadAt: new Date(marked.manualUnreadRevision!),
      manualUnreadByUserId: victor.id,
    });
    await expect(
      prisma.conversationRead.count({ where: { conversationId: conversation.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.whatsAppReadSync.count({ where: { conversationId: conversation.id } }),
    ).resolves.toBe(0);
    await expect(prisma.conversationAuditEvent.count()).resolves.toBe(
      auditCountBefore,
    );
  });

  it("leaves messages received after the official reply unread", async () => {
    const { conversation, marcos, secondTimestamp } = await seedMessages();
    const echoTimestamp = new Date(secondTimestamp.getTime() + 60_000);
    const laterTimestamp = new Date(echoTimestamp.getTime() + 60_000);
    await prisma.message.createMany({
      data: [
        {
          id: echoId,
          conversationId: conversation.id,
          whatsappMessageId: "wamid.shared-later-official-echo",
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          body: "resposta oficial",
          status: MessageStatus.SENT,
          externalTimestamp: echoTimestamp,
        },
        {
          id: newestId,
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          body: "mensagem posterior",
          status: MessageStatus.RECEIVED,
          externalTimestamp: laterTimestamp,
        },
      ],
    });

    await prisma.$transaction((transaction) =>
      advanceTeamReadFromBusinessEcho(transaction, conversation.id, {
        id: echoId,
        externalTimestamp: echoTimestamp,
      }),
    );

    await expect(getConversation(marcos.id, conversation.id)).resolves.toMatchObject({
      lastReadMessageId: higherId,
      unreadCount: 1,
    });
  });

  it("does not regress a later shared boundary", async () => {
    const { conversation, victor, secondTimestamp } = await seedMessages();
    const newerTimestamp = new Date(secondTimestamp.getTime() + 120_000);
    await prisma.message.create({
      data: {
        id: newestId,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "limite humano posterior",
        status: MessageStatus.RECEIVED,
        externalTimestamp: newerTimestamp,
      },
    });
    await advanceSharedRead(victor.id, conversation.id, newestId, null);

    const advanced = await prisma.$transaction((transaction) =>
      advanceTeamReadFromBusinessEcho(transaction, conversation.id, {
        id: echoId,
        externalTimestamp: new Date(secondTimestamp.getTime() + 60_000),
      }),
    );

    expect(advanced).toBeNull();
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({ teamLastReadMessageId: newestId });
  });

  it("returns no boundary when an official reply precedes every inbound", async () => {
    const { conversation, firstTimestamp } = await seedMessages();

    const advanced = await prisma.$transaction((transaction) =>
      advanceTeamReadFromBusinessEcho(transaction, conversation.id, {
        id: echoId,
        externalTimestamp: new Date(firstTimestamp.getTime() - 60_000),
      }),
    );

    expect(advanced).toBeNull();
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({
      teamLastReadMessageId: null,
      teamLastReadAt: null,
    });
  });

  it("uses id ordering when the official reply shares the inbound timestamp", async () => {
    const { conversation, firstTimestamp } = await seedMessages({
      equalTimestamps: true,
    });

    const advanced = await prisma.$transaction((transaction) =>
      advanceTeamReadFromBusinessEcho(transaction, conversation.id, {
        id: newestId,
        externalTimestamp: firstTimestamp,
      }),
    );

    expect(advanced).toEqual({ id: higherId, externalTimestamp: firstTimestamp });
  });

  it("materializes the latest inbound and restores its pending pointer after a definitive failure", async () => {
    const { conversation, victor, firstTimestamp, secondTimestamp } =
      await seedMessages();

    await refreshResponseState(prisma, conversation.id);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({
      awaitingResponseSince: firstTimestamp,
      lastCustomerMessageAt: secondTimestamp,
      lastCustomerMessageId: higherId,
      pendingCustomerMessageAt: secondTimestamp,
      pendingCustomerMessageId: higherId,
      serviceWindowStateVersion: 1,
    });

    const outbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Resposta em processamento",
        sentByUserId: victor.id,
        status: MessageStatus.PENDING,
        externalTimestamp: new Date(secondTimestamp.getTime() + 1_000),
      },
    });
    await refreshResponseState(prisma, conversation.id);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({ pendingCustomerMessageId: null });

    await prisma.message.update({
      where: { id: outbound.id },
      data: { status: MessageStatus.FAILED },
    });
    await refreshResponseState(prisma, conversation.id);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).resolves.toMatchObject({
      pendingCustomerMessageAt: secondTimestamp,
      pendingCustomerMessageId: higherId,
    });
  });
});
