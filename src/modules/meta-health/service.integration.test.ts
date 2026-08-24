import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/test/database";
import { beforeEach, describe, expect, it } from "vitest";

import type { MetaHealthGraphClient } from "./graph-client";
import { acknowledgeMetaAlert, getMetaHealthSummary, listMetaHealthAlerts, syncMetaHealth } from "./service";

const config = { phoneNumberId: "phone-integration", wabaId: "waba-integration" };
const now = new Date("2026-08-23T12:00:00.000Z");

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
});
