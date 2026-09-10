import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";
import { beforeEach, describe, expect, it } from "vitest";

import type { MetaHealthGraphClient } from "./graph-client";
import {
  acknowledgeMetaAlert,
  applyMetaOperationalEvent,
  getMetaHealthSummary,
  listMetaHealthAlerts,
  syncMetaHealth,
} from "./service";

const config = { phoneNumberId: "phone-integration", wabaId: "waba-integration" };
const now = new Date("2026-08-23T12:00:00.000Z");

function templateEvent(eventCode: string, resourceId: string) {
  return {
    wabaId: config.wabaId,
    field: "message_template_status_update" as const,
    eventCode,
    resourceId,
    occurredAt: now,
    details: { name: resourceId, language: "pt_BR" },
    deduplicationKey: `template:${resourceId}:${eventCode}`,
  };
}

function clientWithTemplates(
  templates: Array<{ id: string; name: string; language: string; status: string }>,
): MetaHealthGraphClient {
  return {
    async fetchState() {
      return {
        ...config,
        displayPhoneNumber: null,
        verifiedName: "XP Eletrônicos",
        qualityRating: "GREEN",
        accountReviewStatus: "APPROVED",
        templates,
      };
    },
  };
}

describe("Meta health Prisma reconciliation", () => {
  beforeEach(resetTestDatabase);

  it("persists, resolves, and idempotently acknowledges operational transitions", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.meta@example.test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
      },
    });
    const client = (qualityRating: "RED" | "GREEN"): MetaHealthGraphClient => ({
      async fetchState() {
        return {
          ...config,
          displayPhoneNumber: "+55 61 99999-0000",
          verifiedName: "XP Eletrônicos",
          qualityRating,
          accountReviewStatus: "APPROVED",
          templates: [],
        };
      },
    });

    await syncMetaHealth(actor, { config, client: client("RED"), now: () => now, force: true });
    await expect(getMetaHealthSummary(actor, { config, now: () => now })).resolves.toMatchObject({
      label: "CRITICAL",
      phone: { qualityRating: "RED" },
    });

    const redPage = await listMetaHealthAlerts(actor, { limit: 20 }, { config });
    const red = redPage.alerts.find((alert) => alert.eventCode === "QUALITY_RED");
    expect(red).toMatchObject({ active: true, source: "RECONCILIATION" });
    await acknowledgeMetaAlert(actor, red!.id, { now: () => now });
    await acknowledgeMetaAlert(actor, red!.id, { now: () => new Date(now.getTime() + 1_000) });

    const recovery = new Date(now.getTime() + 61_000);
    await syncMetaHealth(actor, {
      config,
      client: client("GREEN"),
      now: () => recovery,
      force: true,
    });
    const recoveredPage = await listMetaHealthAlerts(actor, { limit: 20 }, { config });
    expect(recoveredPage.alerts.find((alert) => alert.eventCode === "QUALITY_RED")).toMatchObject({
      active: false,
      acknowledgedAt: now.toISOString(),
    });
  });

  it("resolves only pending deletions absent from a complete template snapshot", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.template-delete@example.test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
      },
    });
    await applyMetaOperationalEvent(templateEvent("PENDING_DELETION", "old-1"), {
      config,
    });
    await applyMetaOperationalEvent(templateEvent("PENDING_DELETION", "keep-2"), {
      config,
    });

    await syncMetaHealth(actor, {
      config,
      force: true,
      now: () => new Date(now.getTime() + 61_000),
      client: clientWithTemplates([
        {
          id: "keep-2",
          name: "keep",
          language: "pt_BR",
          status: "PENDING_DELETION",
        },
      ]),
    });

    const page = await listMetaHealthAlerts(actor, { limit: 20 }, { config });
    expect(page.alerts.find((alert) => alert.resourceId === "old-1")).toMatchObject({
      eventCode: "TEMPLATE_PENDING_DELETION",
      active: false,
    });
    expect(page.alerts.find((alert) => alert.resourceId === "keep-2")).toMatchObject({
      eventCode: "TEMPLATE_PENDING_DELETION",
      active: true,
    });
  });
});

describe("connection lifecycle ordering in PostgreSQL", () => {
  beforeEach(resetTestDatabase);
  const lifecycle = (eventCode: string, seconds: number) => ({
    wabaId: config.wabaId, field: "account_update" as const, eventCode,
    resourceId: config.wabaId, occurredAt: new Date(now.getTime() + seconds * 1000), details: null,
    deduplicationKey: `connection:${eventCode}:${seconds}`,
  });
  async function actor() {
    return prisma.user.create({ data: { name: "Admin", email: "connection@example.test", passwordHash: "unused", role: "ADMIN" } });
  }
  const connected: MetaHealthGraphClient = { async fetchState() { return {
    ...config, displayPhoneNumber: null, verifiedName: "Store", qualityRating: "GREEN", accountReviewStatus: "APPROVED", templates: [],
    connection: { status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true },
  }; } };

  it("keeps sends held through duplicate, old and unconfirmed reconnection events", async () => {
    const user = await actor();
    await syncMetaHealth(user, { config, client: connected, now: () => now });
    await applyMetaOperationalEvent(lifecycle("ACCOUNT_OFFBOARDED", 60), { config });
    await applyMetaOperationalEvent(lifecycle("ACCOUNT_OFFBOARDED", 60), { config });
    await applyMetaOperationalEvent(lifecycle("ACCOUNT_RECONNECTED", 30), { config });
    await expect(getMetaHealthSummary(user, { config, now: () => new Date(now.getTime() + 61_000) })).resolves.toMatchObject({ label: "CRITICAL", connection: { state: "DISCONNECTED" }, phone: { qualityRating: "GREEN" } });
    await applyMetaOperationalEvent(lifecycle("ACCOUNT_RECONNECTED", 65), { config });
    expect((await getMetaHealthSummary(user, { config })).connection.state).toBe("DISCONNECTED");
    await syncMetaHealth(user, { config, client: connected, force: true, now: () => new Date(now.getTime() + 120_000) });
    const summary = await getMetaHealthSummary(user, { config, now: () => new Date(now.getTime() + 121_000) });
    expect(summary.connection.state).toBe("CONNECTED");
    expect(summary.label).toBe("NORMAL");
  });

  it("does not overwrite a webhook that arrives while a Graph query is in flight", async () => {
    const user = await actor();
    const client: MetaHealthGraphClient = { async fetchState() {
      await applyMetaOperationalEvent(lifecycle("PARTNER_REMOVED", 0), { config });
      return connected.fetchState();
    } };
    await syncMetaHealth(user, { config, client, now: () => new Date(now.getTime() + 500) });
    expect((await getMetaHealthSummary(user, { config })).connection.state).toBe("DISCONNECTED");
  });
  it("accepts a matching phone ID before a display phone has been loaded", async () => {
    const user = await actor();
    await applyMetaOperationalEvent({ ...lifecycle("ACCOUNT_OFFBOARDED", 0), details: { phoneNumberId: config.phoneNumberId, phoneNumber: "+55 11 99999-0000" } }, { config });
    expect((await getMetaHealthSummary(user, { config })).connection.state).toBe("DISCONNECTED");
  });
  it("holds a previously connected phone when subscription verification fails", async () => {
    const user = await actor();
    await syncMetaHealth(user, { config, client: connected, now: () => now });
    const client: MetaHealthGraphClient = { async fetchState() { return { ...await connected.fetchState(), connection: { status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: false } }; } };
    await syncMetaHealth(user, { config, client, force: true, now: () => new Date(now.getTime() + 61_000) });
    expect((await getMetaHealthSummary(user, { config })).connection.state).toBe("DISCONNECTED");
  });

});
