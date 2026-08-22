// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  QuickReplyConflictError,
  QuickReplyNotFoundError,
  createQuickReply,
  listQuickReplies,
  normalizeQuickReplyShortcut,
  updateQuickReply,
  type QuickReplyRecord,
  type QuickReplyRepository,
} from "./service";

function record(overrides: Partial<QuickReplyRecord> = {}): QuickReplyRecord {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    shortcut: "horario",
    message: "Atendemos das 9h às 17h30.",
    position: 0,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function repository(initial: QuickReplyRecord[] = []): QuickReplyRepository {
  const items = initial.map((item) => ({ ...item }));
  return {
    list: async (activeOnly) => items
      .filter((item) => !activeOnly || item.active)
      .sort((left, right) => left.position - right.position || left.shortcut.localeCompare(right.shortcut)),
    findById: async (id) => items.find((item) => item.id === id) ?? null,
    create: async (data) => {
      if (items.some((item) => item.shortcut === data.shortcut)) throw new QuickReplyConflictError();
      const created = record({ ...data, id: crypto.randomUUID() });
      items.push(created);
      return created;
    },
    update: async (id, data) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) throw new QuickReplyNotFoundError();
      if (data.shortcut && items.some((candidate) => candidate.id !== id && candidate.shortcut === data.shortcut)) {
        throw new QuickReplyConflictError();
      }
      Object.assign(item, data, { updatedAt: new Date(1) });
      return item;
    },
  };
}

describe("quick reply service", () => {
  it("normalizes a shortcut and validates fixed text input", async () => {
    const repo = repository();
    expect(normalizeQuickReplyShortcut("  /HORARIO  ")).toBe("horario");
    await expect(createQuickReply({ shortcut: " /PIX ", message: "  Chave PIX: 123  " }, repo)).resolves.toMatchObject({
      shortcut: "pix",
      message: "Chave PIX: 123",
      active: true,
    });
    await expect(createQuickReply({ shortcut: "com espaço", message: "Texto" }, repo)).rejects.toMatchObject({ name: "QuickReplyValidationError" });
    await expect(createQuickReply({ shortcut: "endereço", message: "Texto" }, repo)).rejects.toMatchObject({ name: "QuickReplyValidationError" });
    await expect(createQuickReply({ shortcut: "vazio", message: "   " }, repo)).rejects.toMatchObject({ name: "QuickReplyValidationError" });
  });

  it("lists active records with stable ordering and public fields only", async () => {
    const items = await listQuickReplies({ activeOnly: true }, repository([
      record({ id: "10000000-0000-4000-8000-000000000003", shortcut: "pix", position: 20 }),
      record({ id: "10000000-0000-4000-8000-000000000002", shortcut: "endereco", position: 10 }),
      record({ id: "10000000-0000-4000-8000-000000000004", shortcut: "oculta", position: 0, active: false }),
    ]));
    expect(items.map((item) => item.shortcut)).toEqual(["endereco", "pix"]);
    expect(items[0]).toEqual({
      id: "10000000-0000-4000-8000-000000000002",
      shortcut: "endereco",
      message: "Atendemos das 9h às 17h30.",
      position: 10,
      active: true,
    });
  });

  it("updates fixed fields, toggles active state, and reports missing records", async () => {
    const repo = repository([record()]);
    await expect(updateQuickReply(record().id, { shortcut: "/ENDERECO", message: " Loja física ", active: false }, repo)).resolves.toEqual({
      id: record().id,
      shortcut: "endereco",
      message: "Loja física",
      position: 0,
      active: false,
    });
    await expect(updateQuickReply("20000000-0000-4000-8000-000000000001", { active: true }, repo)).rejects.toBeInstanceOf(QuickReplyNotFoundError);
  });

  it("rejects duplicate normalized shortcuts", async () => {
    const repo = repository([record()]);
    await expect(createQuickReply({ shortcut: "/HORARIO", message: "Outro texto" }, repo)).rejects.toBeInstanceOf(QuickReplyConflictError);
  });
});
