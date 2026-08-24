// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "123456789";
});

import {
  MessageDirection,
  MessageStatus,
  WebhookStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  inboundLocationFixture,
  inboundMediaFixture,
  inboundTextFixture,
  phoneQualityFixture,
  statusFixture,
  templateQualityFixture,
  templateStatusFixture,
} from "@/test/fixtures/meta-webhooks";
import { resetTestDatabase } from "@/test/database";

import { normalizeWebhook } from "./normalize";
import type {
  NormalizedMessageEchoEvent,
  NormalizedMessageMutationEvent,
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
      content: unknown;
      sentByUserId: string | null;
      externalTimestamp: Date;
      mediaObjectId: string | null;
      replyToMessageId: string | null;
      replyToWhatsappMessageId: string | null;
    }
  >;
  media: Map<string, { id: string; status: string; metaMediaId: string }>;
  appContacts: Map<string, {
    phone: string;
    fullName: string | null;
    active: boolean;
    sourceTimestamp: Date;
    sourceVersionKey: string;
  }>;
  templateStatusUpdates: Array<{
    metaTemplateId: string;
    status: string;
  }>;
  templateQualityUpdates: Array<{
    metaTemplateId: string;
    qualityScore: string;
  }>;
  businessEchoReadAdvances: Array<{
    conversationId: string;
    messageId: string | null;
    externalTimestamp: Date;
  }>;
};

function cloneState(state: State): State {
  return {
    events: new Map(structuredClone([...state.events])),
    contacts: new Map(structuredClone([...state.contacts])),
    conversations: new Map(structuredClone([...state.conversations])),
    messages: new Map(structuredClone([...state.messages])),
    media: new Map(structuredClone([...state.media])),
    appContacts: new Map(structuredClone([...state.appContacts])),
    templateStatusUpdates: structuredClone(state.templateStatusUpdates),
    templateQualityUpdates: structuredClone(state.templateQualityUpdates),
    businessEchoReadAdvances: structuredClone(state.businessEchoReadAdvances),
  };
}

function createHarness(options: { failCreateMessage?: boolean; now?: Date } = {}) {
  let state: State = {
    events: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    media: new Map(),
    appContacts: new Map(),
    templateStatusUpdates: [],
    templateQualityUpdates: [],
    businessEchoReadAdvances: [],
  };
  let committed = false;
  const publications: Array<{ event: unknown; afterCommit: boolean }> = [];
  const operationalApplications: unknown[] = [];

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
      syncAppContact: async (item) => {
        const existing = target.appContacts.get(item.phone);
        const incomingRank = item.action === "REMOVE" ? 1 : 0;
        const existingRank = existing?.active === false ? 1 : 0;
        const ordering = existing
          ? item.sourceTimestamp.getTime() - existing.sourceTimestamp.getTime() ||
            incomingRank - existingRank ||
            item.sourceVersionKey.localeCompare(existing.sourceVersionKey)
          : 1;
        if (existing && ordering <= 0) return false;
        if (
          item.action === "REMOVE" &&
          item.sourceTimestamp.getTime() === 0 &&
          existing &&
          existing.sourceTimestamp.getTime() > 0
        ) return false;
        target.appContacts.set(item.phone, {
          phone: item.phone,
          fullName: item.action === "ADD" ? item.fullName : null,
          active: item.action === "ADD",
          sourceTimestamp: item.sourceTimestamp,
          sourceVersionKey: item.sourceVersionKey,
        });
        return true;
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
        const replyToWhatsappMessageId = (
          message as typeof message & { replyToWhatsappMessageId?: string | null }
        ).replyToWhatsappMessageId ?? null;
        const replyTarget = [...target.messages.values()].find(
          (candidate) =>
            candidate.conversationId === message.conversationId &&
            candidate.whatsappMessageId === replyToWhatsappMessageId,
        );
        const created = {
          id: `message-${target.messages.size + 1}`,
          conversationId: message.conversationId,
          whatsappMessageId: message.whatsappMessageId,
          direction: message.direction,
          status: message.status,
          body: message.body,
          content: message.content,
          sentByUserId: message.sentByUserId,
          externalTimestamp: message.externalTimestamp,
          mediaObjectId: message.mediaObjectId,
          replyToMessageId: replyTarget?.id ?? null,
          replyToWhatsappMessageId,
        };
        target.messages.set(message.whatsappMessageId, created);
        for (const candidate of target.messages.values()) {
          if (
            candidate.conversationId === created.conversationId &&
            candidate.replyToMessageId === null &&
            candidate.replyToWhatsappMessageId === created.whatsappMessageId
          ) {
            candidate.replyToMessageId = created.id;
          }
        }
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
      advanceTeamReadFromBusinessEcho: async (
        conversationId,
        boundary,
      ) => {
        target.businessEchoReadAdvances.push({
          conversationId,
          messageId: boundary.id,
          externalTimestamp: boundary.externalTimestamp,
        });
      },
      updateMessageStatus: async (messageId, status, failureReason) => {
        const message = [...target.messages.values()].find(({ id }) => id === messageId);
        if (!message) throw new Error("missing message");
        message.status = status;
        return { ...message, failureReason };
      },
      reconcileFailedOutbound: async (messageId, conversationId) => {
        const message = [...target.messages.values()].find(
          ({ id }) => id === messageId,
        );
        if (!message || message.conversationId !== conversationId) {
          throw new Error("missing failed outbound");
        }
        const conversation = target.conversations.get(conversationId);
        if (!conversation) throw new Error("missing conversation");
        conversation.awaitingResponseSince = [...target.messages.values()]
          .filter(
            (candidate) =>
              candidate.conversationId === conversationId &&
              candidate.direction === MessageDirection.INBOUND,
          )
          .sort(
            (left, right) =>
              right.externalTimestamp.getTime() -
                left.externalTimestamp.getTime() ||
              right.id.localeCompare(left.id),
          )[0]?.externalTimestamp ?? null;
      },
      findReactionTarget: async (whatsappMessageId) => {
        const message = target.messages.get(whatsappMessageId);
        if (!message) return null;
        const conversation = target.conversations.get(message.conversationId);
        const contact = conversation
          ? [...target.contacts.values()].find((item) => item.id === conversation.contactId)
          : null;
        if (!contact) throw new Error("missing contact");
        return {
          id: message.id,
          conversationId: message.conversationId,
          status: message.status,
          contactWhatsappId: contact.whatsappId,
          contactWhatsappUserId: contact.whatsappUserId,
          contactPhone: contact.phone,
        };
      },
      applyReaction: async () => { throw new Error("unused"); },
      applyMessageMutation: async (input) => {
        const message = [...target.messages.values()].find(({ id }) => id === input.messageId);
        if (!message) return "MISSING";
        message.body = input.action === "REVOKE" ? null : input.body;
        message.content = input.action === "REVOKE" ? null : input.content;
        return "APPLIED";
      },
      updateTemplateStatus: async (event) => {
        target.templateStatusUpdates.push({
          metaTemplateId: event.metaTemplateId,
          status: event.status,
        });
        return event.metaTemplateId === "987654321";
      },
      updateTemplateQuality: async (event) => {
        target.templateQualityUpdates.push({
          metaTemplateId: event.metaTemplateId,
          qualityScore: event.qualityScore,
        });
        return event.metaTemplateId === "987654321";
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
    applyMetaOperationalEvent: async (event) => {
      operationalApplications.push(event);
    },
    now: options.now ? () => options.now! : undefined,
  };

  return {
    dependencies,
    get state() {
      return state;
    },
    publications,
    operationalApplications,
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
      replyToWhatsappMessageId: null,
      origin: "WHATSAPP_BUSINESS_APP",
    } satisfies NormalizedMessageEchoEvent;
  const mutation = {
      kind: "messageMutation",
      action: "EDIT",
      providerEventId: "wamid.echo-mutation-pending-task-2",
      originalWhatsappMessageId: "wamid.echo-original-pending-task-2",
      timestamp: new Date("2026-08-21T12:00:00.000Z"),
      timestampRaw: "1787313600",
      body: "texto corrigido",
      content: null,
      identity: { phone: "5511999990001", whatsappUserId: "BR.Customer123" },
      origin: "WHATSAPP_BUSINESS_APP",
    } satisfies NormalizedMessageMutationEvent;

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
    expect(harness.state.businessEchoReadAdvances).toEqual([
      {
        conversationId: "conversation-1",
        messageId: "message-1",
        externalTimestamp: echo.timestamp,
      },
    ]);
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

  it("persists and locally links an echo reply in the same conversation", async () => {
    const harness = createHarness();
    const original = {
      ...echo,
      whatsappMessageId: "wamid.unit-reply-original",
      body: "Mensagem original",
    };
    const reply = {
      ...echo,
      whatsappMessageId: "wamid.unit-reply-child",
      body: "Resposta citada",
      replyToWhatsappMessageId: original.whatsappMessageId,
    };

    await processWebhookEvents([original, reply], harness.dependencies);

    expect(harness.state.messages.get(reply.whatsappMessageId)).toMatchObject({
      replyToWhatsappMessageId: original.whatsappMessageId,
      replyToMessageId: harness.state.messages.get(original.whatsappMessageId)?.id,
    });
  });

  it("backfills a reply that arrives before its original", async () => {
    const harness = createHarness();
    const original = {
      ...echo,
      whatsappMessageId: "wamid.unit-original-late",
      body: "Mensagem original atrasada",
    };
    const reply = {
      ...echo,
      whatsappMessageId: "wamid.unit-reply-first",
      body: "Resposta recebida primeiro",
      replyToWhatsappMessageId: original.whatsappMessageId,
    };

    await processWebhookEvents([reply], harness.dependencies);
    expect(harness.state.messages.get(reply.whatsappMessageId)).toMatchObject({
      replyToWhatsappMessageId: original.whatsappMessageId,
      replyToMessageId: null,
    });

    await processWebhookEvents([original], harness.dependencies);

    expect(harness.state.messages.get(reply.whatsappMessageId)).toMatchObject({
      replyToWhatsappMessageId: original.whatsappMessageId,
      replyToMessageId: harness.state.messages.get(original.whatsappMessageId)?.id,
    });
  });

  it("never links a reply to an original stored in another conversation", async () => {
    const harness = createHarness();
    const original = {
      ...echo,
      whatsappMessageId: "wamid.unit-cross-original",
      to: "5511999990001",
      toUserId: null,
    };
    const reply = {
      ...echo,
      whatsappMessageId: "wamid.unit-cross-reply",
      to: "5511999990002",
      toUserId: null,
      replyToWhatsappMessageId: original.whatsappMessageId,
    };

    await processWebhookEvents([original, reply], harness.dependencies);

    expect(harness.state.messages.get(reply.whatsappMessageId)).toMatchObject({
      replyToWhatsappMessageId: original.whatsappMessageId,
      replyToMessageId: null,
    });
  });

  it("completes and deduplicates a stale mutation whose target is unavailable", async () => {
    const harness = createHarness();

    await expect(processWebhookEvents([mutation], harness.dependencies)).resolves.toEqual({
      processed: 1,
      duplicates: 0,
    });
    await expect(processWebhookEvents([mutation], harness.dependencies)).resolves.toEqual({
      processed: 0,
      duplicates: 1,
    });

    expect(
      harness.state.events.get(
        "message-mutation:wamid.echo-mutation-pending-task-2",
      ),
    ).toMatchObject({ status: WebhookStatus.PROCESSED });
    expect(harness.state.contacts).toHaveLength(0);
    expect(harness.state.conversations).toHaveLength(0);
    expect(harness.state.messages).toHaveLength(0);
    expect(harness.state.media).toHaveLength(0);
    expect(harness.publications).toEqual([]);
  });

  it("applies an official-app edit to its original and publishes only IDs", async () => {
    const harness = createHarness();
    const original = {
      ...echo,
      whatsappMessageId: mutation.originalWhatsappMessageId,
      body: "texto original",
    };

    await processWebhookEvents([original], harness.dependencies);
    await expect(processWebhookEvents([mutation], harness.dependencies)).resolves.toEqual({
      processed: 1,
      duplicates: 0,
    });

    expect(harness.state.messages.get(original.whatsappMessageId)?.body).toBe(
      "texto corrigido",
    );
    expect(harness.publications.at(-1)).toEqual({
      afterCommit: true,
      event: {
        type: "message.updated",
        conversationId: "conversation-1",
        messageId: "message-1",
      },
    });
  });

  it("keeps a recent missing mutation retryable", async () => {
    const harness = createHarness({ now: mutation.timestamp });

    await expect(
      processWebhookEvents([mutation], harness.dependencies),
    ).rejects.toBeInstanceOf(WebhookProcessingError);
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

  it("threads normalized location content into the inbound repository input", async () => {
    const harness = createHarness();
    const event = normalizeWebhook(inboundLocationFixture)[0]!;

    await processWebhookEvents([event, event], harness.dependencies);

    expect([...harness.state.messages.values()]).toEqual([
      expect.objectContaining({
        content: {
          kind: "location",
          latitude: -15.793889,
          longitude: -47.882778,
          name: "XP Eletrônicos",
          address: "Brasília - DF",
        },
      }),
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
      content: null,
      sentByUserId: null,
      externalTimestamp: now,
      mediaObjectId: null,
      replyToMessageId: null,
      replyToWhatsappMessageId: null,
    });

    await expect(processWebhookEvents(events, dependencies))
      .resolves.toEqual({ processed: 1, duplicates: 0 });
    expect(harness.state.messages.get("wamid.racing")?.status).toBe(MessageStatus.DELIVERED);
    expect(harness.state.events.get(`status:wamid.racing:DELIVERED:${timestamp}`)?.status)
      .toBe(WebhookStatus.PROCESSED);
  });

  it("persists and publishes a new operational event, then counts its duplicate", async () => {
    const harness = createHarness();
    const events = normalizeWebhook(phoneQualityFixture());

    await expect(processWebhookEvents(events, harness.dependencies)).resolves.toEqual({
      processed: 1,
      duplicates: 0,
    });
    await expect(processWebhookEvents(events, harness.dependencies)).resolves.toEqual({
      processed: 0,
      duplicates: 1,
    });
    expect(harness.operationalApplications).toHaveLength(1);
    expect(harness.publications).toContainEqual({
      event: { type: "meta-health.updated" },
      afterCommit: true,
    });
  });

  it("processes a message and an operational update from the same normalized batch", async () => {
    const harness = createHarness();
    const payload = structuredClone(inboundTextFixture) as Record<string, any>;
    payload.entry.push(phoneQualityFixture().entry[0]);

    await expect(
      processWebhookEvents(normalizeWebhook(payload), harness.dependencies),
    ).resolves.toEqual({ processed: 2, duplicates: 0 });
    expect(harness.state.messages.has("wamid.text-1")).toBe(true);
    expect(harness.operationalApplications).toHaveLength(1);
  });
});

describe("WhatsApp app contact batch processing", () => {
  it("persists valid contact items idempotently and publishes no PII", async () => {
    const harness = createHarness();
    const event = {
      kind: "contactSyncBatch" as const,
      quarantined: 1,
      items: [{
        action: "ADD" as const,
        phone: "5561992250908",
        fullName: "Cliente XP",
        sourceTimestamp: new Date("2026-08-23T12:00:00.000Z"),
        sourceTimestampRaw: "1787486400",
        sourceVersionKey: "a".repeat(64),
      }],
    };

    await expect(processWebhookEvents([event], harness.dependencies)).resolves.toEqual({
      processed: 1,
      duplicates: 0,
      quarantined: 1,
    });
    await expect(processWebhookEvents([event], harness.dependencies)).resolves.toMatchObject({
      processed: 0,
      duplicates: 1,
    });
    expect(harness.state.appContacts.get("5561992250908")).toMatchObject({
      fullName: "Cliente XP",
      active: true,
    });
    expect(JSON.stringify(harness.publications)).not.toContain("Cliente XP");
    expect(JSON.stringify(harness.publications)).not.toContain("5561992250908");
  });

  it("uses deterministic ordering and never lets a zero tombstone erase positive state", async () => {
    const harness = createHarness();
    const item = (
      action: "ADD" | "REMOVE",
      timestamp: Date,
      key: string,
      fullName: string | null,
    ) => ({
      action,
      phone: "5561992250908",
      fullName,
      sourceTimestamp: timestamp,
      sourceTimestampRaw: String(timestamp.getTime() / 1000),
      sourceVersionKey: key.repeat(64),
    });
    const batch = (items: ReturnType<typeof item>[]) => ({
      kind: "contactSyncBatch" as const,
      quarantined: 0,
      items,
    });
    const positive = new Date("2026-08-23T12:00:00.000Z");

    await processWebhookEvents([batch([item("ADD", positive, "a", "Nome A")])], harness.dependencies);
    await processWebhookEvents([batch([item("REMOVE", new Date(0), "z", null)])], harness.dependencies);
    expect(harness.state.appContacts.get("5561992250908")).toMatchObject({
      active: true,
      fullName: "Nome A",
    });

    await processWebhookEvents([batch([item("ADD", positive, "b", "Nome B")])], harness.dependencies);
    expect(harness.state.appContacts.get("5561992250908")?.fullName).toBe("Nome B");

    await processWebhookEvents([batch([item("REMOVE", positive, "c", null)])], harness.dependencies);
    expect(harness.state.appContacts.get("5561992250908")).toMatchObject({
      active: false,
      fullName: null,
    });
  });
});

describe("template webhook event processing", () => {
  it("deduplicates status, health and quality updates with only safe invalidations", async () => {
    const harness = createHarness();
    const events = [
      ...normalizeWebhook(templateStatusFixture("PAUSED")),
      ...normalizeWebhook(templateQualityFixture("YELLOW")),
    ];

    await expect(
      processWebhookEvents(events, harness.dependencies),
    ).resolves.toEqual({ processed: 3, duplicates: 0 });
    await expect(
      processWebhookEvents(events, harness.dependencies),
    ).resolves.toEqual({ processed: 0, duplicates: 3 });

    expect(harness.state.templateStatusUpdates).toEqual([
      { metaTemplateId: "987654321", status: "PAUSED" },
    ]);
    expect(harness.state.templateQualityUpdates).toEqual([
      { metaTemplateId: "987654321", qualityScore: "YELLOW" },
    ]);
    expect(harness.publications).toEqual([
      {
        afterCommit: true,
        event: { type: "meta-health.updated" },
      },
      {
        afterCommit: true,
        event: { type: "settings.updated", scope: "whatsapp-policy" },
      },
      {
        afterCommit: true,
        event: { type: "settings.updated", scope: "whatsapp-policy" },
      },
    ]);
    expect(JSON.stringify(harness.publications)).not.toContain("987654321");
  });
});

describe("webhook PostgreSQL integration", () => {
  beforeEach(resetTestDatabase);

  it("updates known template status and quality once without creating provider rows", async () => {
    await prisma.whatsAppTemplate.create({
      data: {
        metaId: "987654321",
        name: "retomar_atendimento",
        language: "pt_BR",
        category: "UTILITY",
        status: "PENDING",
        qualityScore: null,
        components: [],
        bodyText: "Olá, {{1}}",
        parameterCount: 1,
        supported: true,
        definitionHash: "a".repeat(64),
        syncedAt: new Date("2026-08-23T12:00:00.000Z"),
      },
    });
    const events = [
      ...normalizeWebhook(templateStatusFixture("APPROVED")),
      ...normalizeWebhook(templateQualityFixture("GREEN")),
    ];

    await processWebhookEvents(events);
    await processWebhookEvents(events);

    await expect(
      prisma.whatsAppTemplate.findFirstOrThrow({
        select: { status: true, qualityScore: true },
      }),
    ).resolves.toEqual({ status: "APPROVED", qualityScore: "GREEN" });
    await expect(prisma.whatsAppTemplate.count()).resolves.toBe(1);
    await expect(
      prisma.webhookEvent.count({ where: { status: WebhookStatus.PROCESSED } }),
    ).resolves.toBe(3);
    await expect(prisma.metaOperationalAlert.count()).resolves.toBe(1);
  });

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

  it("persists a normalized location exactly once", async () => {
    const event = normalizeWebhook(inboundLocationFixture)[0]!;

    await processWebhookEvents([event, event]);

    await expect(
      prisma.message.findMany({ select: { type: true, content: true } }),
    ).resolves.toEqual([
      {
        type: "LOCATION",
        content: {
          kind: "location",
          latitude: -15.793889,
          longitude: -47.882778,
          name: "XP Eletrônicos",
          address: "Brasília - DF",
        },
      },
    ]);
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
