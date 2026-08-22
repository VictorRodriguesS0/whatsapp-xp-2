// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";

import {
  MessageDirection,
  MessageStatus,
  WebhookStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { inboundMediaFixture, inboundTextFixture, statusFixture } from "@/test/fixtures/meta-webhooks";
import { resetTestDatabase } from "@/test/database";

import { normalizeWebhook } from "./normalize";
import type {
  NormalizedMessageEchoControlEvent,
  NormalizedMessageEchoEvent,
} from "./types";
import {
  processWebhookEvents,
  WebhookProcessingError,
  type WebhookProcessDependencies,
  type WebhookRepository,
} from "./process";

type State = {
  events: Map<string, { eventType: string; status: WebhookStatus; errorSummary: string | null }>;
  contacts: Map<
    string,
    {
      id: string;
      whatsappId: string | null;
      whatsappUserId: string | null;
      phone: string | null;
      name: string;
    }
  >;
  conversations: Map<
    string,
    {
      id: string;
      contactId: string;
      lastMessageAt: Date;
      awaitingResponseSince: Date | null;
    }
  >;
  messages: Map<
    string,
    {
      id: string;
      conversationId: string;
      whatsappMessageId: string;
      direction: MessageDirection;
      status: MessageStatus;
      body: string | null;
      sentByUserId: string | null;
      externalTimestamp: Date;
      mediaObjectId: string | null;
    }
  >;
  media: Map<string, { id: string; status: string; metaMediaId: string }>;
};

function cloneState(state: State): State {
  return {
    events: new Map(structuredClone([...state.events])),
    contacts: new Map(structuredClone([...state.contacts])),
    conversations: new Map(structuredClone([...state.conversations])),
    messages: new Map(structuredClone([...state.messages])),
    media: new Map(structuredClone([...state.media])),
  };
}

function createHarness(options: { failCreateMessage?: boolean } = {}) {
  let state: State = {
    events: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    media: new Map(),
  };
  let committed = false;
  const publications: Array<{ event: unknown; afterCommit: boolean }> = [];

  function repositoryFor(target: State): WebhookRepository {
    return {
      reserveEvent: async (key, eventType) => {
        const existing = target.events.get(key);

        if (!existing) {
          target.events.set(key, {
            eventType,
            status: WebhookStatus.PROCESSING,
            errorSummary: null,
          });
          return "NEW";
        }

        if (existing.status === WebhookStatus.FAILED) {
          existing.status = WebhookStatus.PROCESSING;
          existing.errorSummary = null;
          return "RECLAIMED";
        }

        return existing.status;
      },
      completeEvent: async (key) => {
        const event = target.events.get(key);
        if (!event) throw new Error("missing reservation");
        event.status = WebhookStatus.PROCESSED;
        event.errorSummary = null;
      },
      upsertContact: async ({ whatsappId, phone, name }) => {
        const existing = target.contacts.get(whatsappId);
        if (existing) {
          existing.name = name ?? existing.name;
          return { id: existing.id };
        }
        const created = {
          id: `contact-${target.contacts.size + 1}`,
          whatsappId,
          whatsappUserId: null,
          phone,
          name: name ?? phone,
        };
        target.contacts.set(whatsappId, created);
        return { id: created.id };
      },
      resolveEchoContact: async ({ phone, whatsappUserId }) => {
        const existing = [...target.contacts.values()].find(
          (contact) =>
            (phone !== null &&
              (contact.phone === phone || contact.whatsappId === phone)) ||
            (whatsappUserId !== null &&
              contact.whatsappUserId === whatsappUserId),
        );
        if (existing) {
          existing.phone ??= phone;
          existing.whatsappId ??= phone;
          existing.whatsappUserId ??= whatsappUserId;
          return { id: existing.id, mergedConversations: [] };
        }
        const created = {
          id: `contact-${target.contacts.size + 1}`,
          whatsappId: phone,
          whatsappUserId,
          phone,
          name: phone ?? "WhatsApp",
        };
        target.contacts.set(created.id, created);
        return { id: created.id, mergedConversations: [] };
      },
      upsertConversation: async (contactId, timestamp) => {
        const existing = [...target.conversations.values()].find(
          (conversation) => conversation.contactId === contactId,
        );
        if (existing) {
          if (timestamp > existing.lastMessageAt) existing.lastMessageAt = timestamp;
          return { id: existing.id };
        }
        const created = {
          id: `conversation-${target.conversations.size + 1}`,
          contactId,
          lastMessageAt: timestamp,
          awaitingResponseSince: null,
        };
        target.conversations.set(created.id, created);
        return { id: created.id };
      },
      findMessage: async (whatsappMessageId) =>
        target.messages.get(whatsappMessageId) ?? null,
      createMedia: async (media) => {
        const created = {
          id: `media-${target.media.size + 1}`,
          status: "PENDING",
          metaMediaId: media.metaMediaId,
        };
        target.media.set(created.id, created);
        return { id: created.id };
      },
      createMessage: async (message) => {
        if (options.failCreateMessage) throw new Error("database secret-marker");
        const created = {
          id: `message-${target.messages.size + 1}`,
          conversationId: message.conversationId,
          whatsappMessageId: message.whatsappMessageId,
          direction: message.direction,
          status: message.status,
          body: message.body,
          sentByUserId: message.sentByUserId,
          externalTimestamp: message.externalTimestamp,
          mediaObjectId: message.mediaObjectId,
        };
        target.messages.set(message.whatsappMessageId, created);
        return { id: created.id, conversationId: created.conversationId };
      },
      refreshResponseState: async (conversationId) => {
        const conversation = target.conversations.get(conversationId);
        if (!conversation) throw new Error("missing conversation");
        const latest = [...target.messages.values()]
          .filter((message) => message.conversationId === conversationId)
          .sort(
            (left, right) =>
              right.externalTimestamp.getTime() -
                left.externalTimestamp.getTime() ||
              right.id.localeCompare(left.id),
          )[0];
        conversation.awaitingResponseSince =
          latest?.direction === MessageDirection.INBOUND
            ? (conversation.awaitingResponseSince ?? latest.externalTimestamp)
            : null;
      },
      updateMessageStatus: async (messageId, status, failureReason) => {
        const message = [...target.messages.values()].find(({ id }) => id === messageId);
        if (!message) throw new Error("missing message");
        message.status = status;
        return { ...message, failureReason };
      },
    };
  }

  const dependencies: WebhookProcessDependencies = {
    transaction: async (operation) => {
      committed = false;
      const staged = cloneState(state);
      const result = await operation(repositoryFor(staged));
      state = staged;
      committed = true;
      return result;
    },
    recordFailure: async (key, eventType, errorSummary) => {
      const existing = state.events.get(key);
      if (existing?.status === WebhookStatus.PROCESSED) return;
      state.events.set(key, {
        eventType,
        status: WebhookStatus.FAILED,
        errorSummary,
      });
    },
    quarantineEvent: async (key, eventType, errorSummary) => {
      state.events.set(key, {
        eventType,
        status: WebhookStatus.PROCESSED,
        errorSummary,
      });
    },
    publishRealtime: (event) => publications.push({ event, afterCommit: committed }),
  };

  return {
    dependencies,
    get state() {
      return state;
    },
    publications,
  };
}

describe("webhook event processing", () => {
  const echo = {
      kind: "messageEcho",
      whatsappMessageId: "wamid.echo-pending-task-2",
      to: "5511999990001",
      toUserId: "BR.Customer123",
      toParentUserId: null,
      timestamp: new Date("2026-08-21T12:00:00.000Z"),
      timestampRaw: "1787313600",
      type: "TEXT",
      body: "synthetic echo",
      content: null,
      media: null,
      origin: "WHATSAPP_BUSINESS_APP",
    } satisfies NormalizedMessageEchoEvent;
  const control = {
      kind: "messageEchoControl",
      action: "EDIT",
      whatsappMessageId: "wamid.echo-control-pending-task-2",
      originalWhatsappMessageId: "wamid.echo-original-pending-task-2",
      to: "5511999990001",
      toUserId: "BR.Customer123",
      toParentUserId: null,
      timestamp: new Date("2026-08-21T12:00:00.000Z"),
      timestampRaw: "1787313600",
      origin: "WHATSAPP_BUSINESS_APP",
    } satisfies NormalizedMessageEchoControlEvent;

  it("persists an echo as actorless outbound SENT and publishes only after commit", async () => {
    const harness = createHarness();
    const scheduled: string[] = [];

    await expect(
      processWebhookEvents([echo], harness.dependencies, (id) => scheduled.push(id)),
    ).resolves.toEqual({ processed: 1, duplicates: 0 });

    expect(harness.state.events.get("message-echo:wamid.echo-pending-task-2"))
      .toMatchObject({ status: WebhookStatus.PROCESSED });
    expect(harness.state.contacts).toHaveLength(1);
    expect(harness.state.conversations).toHaveLength(1);
    expect([...harness.state.messages.values()][0]).toMatchObject({
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT,
      sentByUserId: null,
      body: "synthetic echo",
    });
    expect(harness.state.media).toHaveLength(0);
    expect(scheduled).toEqual([]);
    expect(harness.publications).toEqual([
      {
        afterCommit: true,
        event: {
          type: "message.created",
          conversationId: "conversation-1",
          messageId: "message-1",
        },
      },
    ]);
  });

  it("deduplicates controls without creating domain state", async () => {
    const harness = createHarness();

    await expect(processWebhookEvents([control], harness.dependencies)).resolves.toEqual({
      processed: 1,
      duplicates: 0,
    });
    await expect(processWebhookEvents([control], harness.dependencies)).resolves.toEqual({
      processed: 0,
      duplicates: 1,
    });

    expect(
      harness.state.events.get(
        "message-echo-control:EDIT:wamid.echo-control-pending-task-2:wamid.echo-original-pending-task-2",
      ),
    ).toMatchObject({ status: WebhookStatus.PROCESSED });
    expect(harness.state.contacts).toHaveLength(0);
    expect(harness.state.conversations).toHaveLength(0);
    expect(harness.state.messages).toHaveLength(0);
    expect(harness.state.media).toHaveLength(0);
    expect(harness.publications).toEqual([]);
  });

  it("rolls back an echo and publishes or schedules nothing on transaction failure", async () => {
    const harness = createHarness({ failCreateMessage: true });
    const scheduled: string[] = [];

    await expect(
      processWebhookEvents([echo], harness.dependencies, (id) => scheduled.push(id)),
    ).rejects.toBeInstanceOf(WebhookProcessingError);

    expect(harness.state.contacts).toHaveLength(0);
    expect(harness.state.conversations).toHaveLength(0);
    expect(harness.state.messages).toHaveLength(0);
    expect(harness.state.media).toHaveLength(0);
    expect(
      harness.state.events.get("message-echo:wamid.echo-pending-task-2"),
    ).toMatchObject({
      status: WebhookStatus.FAILED,
      errorSummary: "processing_error:Error",
    });
    expect(scheduled).toEqual([]);
    expect(harness.publications).toEqual([]);
  });

  it("atomically creates contact, conversation, inbound message and pending media before publishing", async () => {
    const harness = createHarness();
    const events = normalizeWebhook(inboundMediaFixture("document"));
    const pendingMedia: string[] = [];

    await expect(processWebhookEvents(events, harness.dependencies, (id) => pendingMedia.push(id))).resolves.toEqual({
      processed: 1,
      duplicates: 0,
    });

    expect(harness.state.contacts).toHaveLength(1);
    expect(harness.state.conversations).toHaveLength(1);
    expect(harness.state.messages).toHaveLength(1);
    expect(harness.state.media).toHaveLength(1);
    expect([...harness.state.media.values()][0]).toMatchObject({
      metaMediaId: "meta-document-1",
      status: "PENDING",
    });
    expect(pendingMedia).toEqual(["media-1"]);
    expect(harness.publications).toEqual([
      {
        afterCommit: true,
        event: {
          type: "message.created",
          conversationId: "conversation-1",
          messageId: "message-1",
        },
      },
    ]);
  });

  it("does not schedule a second media download for a duplicate webhook", async () => {
    const harness = createHarness();
    const events = normalizeWebhook(inboundMediaFixture("image"));
    const pendingMedia: string[] = [];

    await processWebhookEvents(events, harness.dependencies, (id) => pendingMedia.push(id));
    await processWebhookEvents(events, harness.dependencies, (id) => pendingMedia.push(id));

    expect(pendingMedia).toEqual(["media-1"]);
  });

  it("ignores a processed message event and does not publish twice", async () => {
    const harness = createHarness();
    const events = normalizeWebhook(inboundTextFixture);

    await processWebhookEvents(events, harness.dependencies);
    const duplicate = await processWebhookEvents(events, harness.dependencies);

    expect(duplicate).toEqual({ processed: 0, duplicates: 1 });
    expect(harness.state.messages).toHaveLength(1);
    expect(harness.publications).toHaveLength(1);
    expect(harness.state.events.get("message:wamid.text-1")?.status).toBe(
      WebhookStatus.PROCESSED,
    );
  });

  it("reclaims a failed reservation on a retry", async () => {
    const harness = createHarness();
    harness.state.events.set("message:wamid.text-1", {
      eventType: "message",
      status: WebhookStatus.FAILED,
      errorSummary: "previous_error",
    });

    await expect(
      processWebhookEvents(normalizeWebhook(inboundTextFixture), harness.dependencies),
    ).resolves.toEqual({ processed: 1, duplicates: 0 });

    expect(harness.state.events.get("message:wamid.text-1")).toMatchObject({
      status: WebhookStatus.PROCESSED,
      errorSummary: null,
    });
  });

  it("rolls back domain writes and persists only a redacted failed reservation", async () => {
    const harness = createHarness({ failCreateMessage: true });

    await expect(
      processWebhookEvents(normalizeWebhook(inboundTextFixture), harness.dependencies),
    ).rejects.toBeInstanceOf(WebhookProcessingError);

    expect(harness.state.contacts).toHaveLength(0);
    expect(harness.state.conversations).toHaveLength(0);
    expect(harness.state.messages).toHaveLength(0);
    expect(harness.state.events.get("message:wamid.text-1")).toMatchObject({
      status: WebhookStatus.FAILED,
      errorSummary: "processing_error:Error",
    });
    expect(harness.state.events.get("message:wamid.text-1")?.errorSummary).not.toContain(
      "secret-marker",
    );
    expect(harness.publications).toEqual([]);
  });

  it("keeps conversation lastMessageAt monotonic for late messages", async () => {
    const harness = createHarness();
    const newer = structuredClone(inboundTextFixture) as Record<string, any>;
    newer.entry[0].changes[0].value.messages[0].id = "wamid.newer";
    newer.entry[0].changes[0].value.messages[0].timestamp = "1787133700";
    const older = structuredClone(inboundTextFixture) as Record<string, any>;
    older.entry[0].changes[0].value.messages[0].id = "wamid.older";
    older.entry[0].changes[0].value.messages[0].timestamp = "1787133500";

    await processWebhookEvents(normalizeWebhook(newer), harness.dependencies);
    await processWebhookEvents(normalizeWebhook(older), harness.dependencies);

    expect([...harness.state.conversations.values()][0]?.lastMessageAt).toEqual(
      new Date(1787133700 * 1000),
    );
  });

  it("does not downgrade READ when DELIVERED or FAILED arrives later", async () => {
    const harness = createHarness();
    await processWebhookEvents(normalizeWebhook(inboundTextFixture), harness.dependencies);
    const message = harness.state.messages.get("wamid.text-1")!;
    message.status = MessageStatus.SENT;

    await processWebhookEvents(
      normalizeWebhook(statusFixture("read", "1787133800", "wamid.text-1")),
      harness.dependencies,
    );
    await processWebhookEvents(
      normalizeWebhook(statusFixture("delivered", "1787133900", "wamid.text-1")),
      harness.dependencies,
    );
    await processWebhookEvents(
      normalizeWebhook(statusFixture("failed", "1787134000", "wamid.text-1")),
      harness.dependencies,
    );

    expect(harness.state.messages.get("wamid.text-1")?.status).toBe(MessageStatus.READ);
    expect(harness.publications.map(({ event }) => event)).toContainEqual({
      type: "message.status",
      conversationId: "conversation-1",
      messageId: "message-1",
    });
    expect(harness.state.events.has("status:wamid.text-1:READ:1787133800")).toBe(true);
  });

  it("acknowledges a historical status whose message is unknown without retrying forever", async () => {
    const harness = createHarness();

    await expect(processWebhookEvents(
      normalizeWebhook(statusFixture("delivered", "1787133602", "wamid.historical")),
      harness.dependencies,
    )).resolves.toEqual({ processed: 1, duplicates: 0 });
    expect(harness.state.events.get("status:wamid.historical:DELIVERED:1787133602"))
      .toMatchObject({ status: WebhookStatus.PROCESSED, errorSummary: null });
    expect(harness.publications).toEqual([]);
  });

  it("retries a recent missing status and applies it after the outbound message is committed", async () => {
    const harness = createHarness();
    const now = new Date("2026-08-20T12:00:00.000Z");
    const timestamp = String((now.getTime() - 30_000) / 1000);
    const dependencies = {
      ...harness.dependencies,
      now: () => now,
    } as WebhookProcessDependencies;
    const events = normalizeWebhook(statusFixture("delivered", timestamp, "wamid.racing"));

    await expect(processWebhookEvents(events, dependencies)).rejects.toMatchObject({
      retryable: true,
    });
    expect(harness.state.events.get(`status:wamid.racing:DELIVERED:${timestamp}`)?.status)
      .toBe(WebhookStatus.FAILED);

    harness.state.messages.set("wamid.racing", {
      id: "message-racing",
      conversationId: "conversation-racing",
      whatsappMessageId: "wamid.racing",
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT,
      body: "racing message",
      sentByUserId: null,
      externalTimestamp: now,
      mediaObjectId: null,
    });

    await expect(processWebhookEvents(events, dependencies))
      .resolves.toEqual({ processed: 1, duplicates: 0 });
    expect(harness.state.messages.get("wamid.racing")?.status).toBe(MessageStatus.DELIVERED);
    expect(harness.state.events.get(`status:wamid.racing:DELIVERED:${timestamp}`)?.status)
      .toBe(WebhookStatus.PROCESSED);
  });
});

describe("webhook PostgreSQL integration", () => {
  beforeEach(resetTestDatabase);

  it("commits one inbound message and one deduplication event across retries", async () => {
    const events = normalizeWebhook(inboundTextFixture);

    await processWebhookEvents(events);
    await processWebhookEvents(events);

    await expect(prisma.message.count()).resolves.toBe(1);
    await expect(prisma.contact.count()).resolves.toBe(1);
    await expect(prisma.conversation.count()).resolves.toBe(1);
    await expect(
      prisma.webhookEvent.findUnique({
        where: { deduplicationKey: "message:wamid.text-1" },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: WebhookStatus.PROCESSED });
  });

  it("serializes concurrent deliveries into one committed message", async () => {
    const events = normalizeWebhook(inboundTextFixture);

    const summaries = await Promise.all([
      processWebhookEvents(events),
      processWebhookEvents(events),
    ]);

    expect(summaries.map(({ processed }) => processed).sort()).toEqual([0, 1]);
    expect(summaries.map(({ duplicates }) => duplicates).sort()).toEqual([0, 1]);
    await expect(prisma.message.count()).resolves.toBe(1);
    await expect(prisma.webhookEvent.count()).resolves.toBe(1);
  });

  it("keeps the persisted conversation timestamp monotonic for late delivery", async () => {
    const newer = structuredClone(inboundTextFixture) as Record<string, any>;
    newer.entry[0].changes[0].value.messages[0].id = "wamid.newer-db";
    newer.entry[0].changes[0].value.messages[0].timestamp = "1787133700";
    const older = structuredClone(inboundTextFixture) as Record<string, any>;
    older.entry[0].changes[0].value.messages[0].id = "wamid.older-db";
    older.entry[0].changes[0].value.messages[0].timestamp = "1787133500";

    await processWebhookEvents(normalizeWebhook(newer));
    await processWebhookEvents(normalizeWebhook(older));

    await expect(
      prisma.conversation.findFirst({ select: { lastMessageAt: true } }),
    ).resolves.toEqual({ lastMessageAt: new Date(1787133700 * 1000) });
    await expect(
      prisma.message.findMany({
        orderBy: { externalTimestamp: "asc" },
        select: { whatsappMessageId: true },
      }),
    ).resolves.toEqual([
      { whatsappMessageId: "wamid.older-db" },
      { whatsappMessageId: "wamid.newer-db" },
    ]);
  });
});
