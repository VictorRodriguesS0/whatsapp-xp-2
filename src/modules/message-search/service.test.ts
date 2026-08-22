import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/http";

import {
  loadMessageContext,
  searchConversationMessages,
  searchMessages,
} from "./service";
import type {
  MessageContextDto,
  MessageSearchQuery,
  MessageSearchRecord,
  MessageSearchRepository,
} from "./types";

const actorId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";

function record(overrides: Partial<MessageSearchRecord> = {}): MessageSearchRecord {
  return {
    messageId,
    conversationId,
    direction: "INBOUND",
    type: "TEXT",
    externalTimestamp: new Date("2026-08-22T12:00:00.000Z"),
    searchText: "cliente quer produto vermelho para domingo",
    contactId: "40000000-0000-4000-8000-000000000001",
    contactName: "Cliente Teste",
    contactPreferredName: null,
    contactPhone: "+55 61 99999-0000",
    ...overrides,
  };
}

function repository(options: {
  active?: boolean;
  records?: MessageSearchRecord[];
  context?: MessageContextDto | null;
} = {}): MessageSearchRepository & { queries: MessageSearchQuery[] } {
  const queries: MessageSearchQuery[] = [];
  return {
    queries,
    async findActiveUser() {
      return options.active === false ? null : { id: actorId };
    },
    async search(query) {
      queries.push(query);
      return options.records ?? [];
    },
    async loadContext() {
      return options.context ?? null;
    },
  };
}

describe("message search service", () => {
  it("normalizes a query and returns a bounded highlighted snippet", async () => {
    const repo = repository({ records: [record()] });

    const result = await searchMessages(actorId, { query: "  PRODUTO  ", take: 20 }, repo);

    expect(repo.queries[0]).toMatchObject({ query: "produto", take: 21, conversationId: null });
    expect(result).toEqual({
      items: [expect.objectContaining({
        messageId,
        conversationId,
        snippet: "cliente quer produto vermelho para domingo",
        matchedText: "produto",
      })],
      nextCursor: null,
    });
  });

  it("uses the extra row to expose a stable opaque cursor", async () => {
    const older = record({
      messageId: "30000000-0000-4000-8000-000000000002",
      externalTimestamp: new Date("2026-08-22T11:00:00.000Z"),
    });
    const repo = repository({ records: [record(), older] });

    const first = await searchMessages(actorId, { query: "produto", take: 1 }, repo);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    await searchMessages(actorId, { query: "produto", take: 1, cursor: first.nextCursor! }, repo);
    expect(repo.queries[1].cursor).toEqual({
      externalTimestamp: "2026-08-22T12:00:00.000Z",
      id: messageId,
    });
  });

  it("restricts conversation search to the requested conversation", async () => {
    const repo = repository({ records: [record()] });

    await searchConversationMessages(actorId, conversationId, { query: "domingo" }, repo);

    expect(repo.queries[0].conversationId).toBe(conversationId);
  });

  it("rejects inactive actors before querying messages", async () => {
    const repo = repository({ active: false });

    await expect(searchMessages(actorId, { query: "produto" }, repo))
      .rejects.toEqual(new HttpError(403, "Acesso negado"));
    expect(repo.queries).toHaveLength(0);
  });

  it("loads exact context without any read-state repository operation", async () => {
    const context: MessageContextDto = {
      conversationId,
      targetMessageId: messageId,
      messages: [],
    };
    const repo = repository({ context });

    await expect(loadMessageContext(actorId, conversationId, messageId, repo)).resolves.toEqual(context);
  });

  it("returns not found when the target context is unavailable", async () => {
    const repo = repository({ context: null });

    await expect(loadMessageContext(actorId, conversationId, messageId, repo))
      .rejects.toEqual(new HttpError(404, "Mensagem não encontrada"));
  });
});
