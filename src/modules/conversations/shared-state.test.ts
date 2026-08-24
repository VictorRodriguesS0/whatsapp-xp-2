// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { SharedStateClient } from "./shared-state";
import {
  advanceTeamReadFromBusinessEcho,
  compareBoundary,
} from "./shared-state";

describe("shared conversation boundaries", () => {
  it("orders equal-timestamp messages by id", () => {
    const externalTimestamp = new Date("2026-08-21T12:00:00.000Z");

    expect(
      compareBoundary(
        { id: "20000000-0000-4000-8000-000000000002", externalTimestamp },
        { id: "20000000-0000-4000-8000-000000000001", externalTimestamp },
      ),
    ).toBeGreaterThan(0);
  });

  it("orders a legacy timestamp-only boundary after every pointer at the same timestamp", () => {
    const externalTimestamp = new Date("2026-08-21T12:00:00.000Z");

    expect(
      compareBoundary(
        { id: null, externalTimestamp },
        { id: "20000000-0000-4000-8000-000000000099", externalTimestamp },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareBoundary(
        { id: "20000000-0000-4000-8000-000000000099", externalTimestamp },
        { id: null, externalTimestamp },
      ),
    ).toBeLessThan(0);
  });

  it("orders a newer pointer after an older timestamp-only boundary", () => {
    expect(
      compareBoundary(
        {
          id: "20000000-0000-4000-8000-000000000001",
          externalTimestamp: new Date("2026-08-21T12:01:00.000Z"),
        },
        {
          id: null,
          externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
        },
      ),
    ).toBeGreaterThan(0);
  });
});

describe("official app reply boundary", () => {
  const inbound = {
    id: "20000000-0000-4000-8000-000000000002",
    externalTimestamp: new Date("2026-08-21T12:00:00.000Z"),
  };
  const echo = {
    id: "30000000-0000-4000-8000-000000000001",
    externalTimestamp: new Date("2026-08-21T12:01:00.000Z"),
  };

  function fakeClient(current: typeof inbound | null) {
    const update = vi.fn().mockResolvedValue(undefined);
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "conversation-1" }]),
      message: { findFirst: vi.fn().mockResolvedValue(inbound) },
      conversation: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          teamLastReadMessage: current,
          teamLastReadAt: null,
        }),
        update,
      },
    };
    return { client: client as unknown as SharedStateClient, update };
  }

  it("updates only the shared team boundary", async () => {
    const { client, update } = fakeClient(null);

    await expect(
      advanceTeamReadFromBusinessEcho(client, "conversation-1", echo),
    ).resolves.toEqual(inbound);
    expect(update).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: {
        teamLastReadMessageId: inbound.id,
        teamLastReadAt: inbound.externalTimestamp,
      },
    });
  });

  it("does not move a later shared boundary backwards", async () => {
    const later = {
      id: "40000000-0000-4000-8000-000000000001",
      externalTimestamp: new Date("2026-08-21T12:02:00.000Z"),
    };
    const { client, update } = fakeClient(later);

    await expect(
      advanceTeamReadFromBusinessEcho(client, "conversation-1", echo),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
