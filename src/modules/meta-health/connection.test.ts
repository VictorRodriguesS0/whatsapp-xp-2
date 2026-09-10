import { describe, expect, it } from "vitest";
import { connectionFromGraph, connectionFromEvent, mergeConnectionEvidence } from "./connection";

const before = new Date("2026-09-10T12:00:00Z");
const after = new Date("2026-09-10T12:00:02Z");

describe("connection evidence", () => {
  it("requires all coexistence indicators for a connected result", () => {
    expect(connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true }, after).connectionState).toBe("CONNECTED");
    expect(connectionFromGraph({ status: "DISCONNECTED", platformType: "ON_PREMISE", isOnBizApp: true, subscribed: true }, after).connectionState).toBe("DISCONNECTED");
    expect(connectionFromGraph({ status: null, platformType: null, isOnBizApp: null }, after).connectionState).toBe("UNKNOWN");
  });

  it("keeps a newer disconnection when an older query finishes", () => {
    const offboarded = connectionFromEvent("ACCOUNT_OFFBOARDED", after)!;
    const olderRead = connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true }, before);
    expect(mergeConnectionEvidence(offboarded, olderRead)).toBeNull();
  });

  it("does not unlock sends from a reconnection notification or missing Graph fields", () => {
    const offboarded = connectionFromEvent("PARTNER_REMOVED", before)!;
    expect(mergeConnectionEvidence(offboarded, connectionFromEvent("ACCOUNT_RECONNECTED", after)!)?.connectionState).toBe("DISCONNECTED");
    expect(mergeConnectionEvidence(offboarded, connectionFromGraph({ status: null, platformType: null, isOnBizApp: null }, after))?.connectionState).toBe("DISCONNECTED");
    expect(connectionFromEvent("VERIFIED_ACCOUNT", after)).toBeNull();
    expect(connectionFromEvent("131060", after)).toBeNull();
  });

  it("resolves a confirmed disconnection only with a newer positive Graph read", () => {
    const offboarded = connectionFromEvent("ACCOUNT_OFFBOARDED", before)!;
    const read = connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true }, after);
    expect(mergeConnectionEvidence(offboarded, read)?.connectionState).toBe("CONNECTED");
    expect(mergeConnectionEvidence(read, offboarded)).toBeNull();
  });

  it("gives disconnection precedence for conflicting same-second webhook evidence", () => {
    const read = connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true }, after);
    const offboarded = connectionFromEvent("ACCOUNT_OFFBOARDED", after)!;
    expect(mergeConnectionEvidence(read, offboarded)?.connectionState).toBe("DISCONNECTED");
    expect(mergeConnectionEvidence(offboarded, read)).toBeNull();
  });
});

it("does not confirm a Cloud API phone with missing webhook subscriptions", () => {
  expect(connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: false }, after).connectionState).toBe("DISCONNECTED");
  expect(connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true }, after).connectionState).toBe("UNKNOWN");
});
it("gives a second-resolution offboard precedence over a Graph read started within that second", () => {
  const read = connectionFromGraph({ status: "CONNECTED", platformType: "CLOUD_API", isOnBizApp: true, subscribed: true }, new Date(before.getTime() + 500));
  const offboard = connectionFromEvent("ACCOUNT_OFFBOARDED", before)!;
  expect(mergeConnectionEvidence(read, offboard)?.connectionState).toBe("DISCONNECTED");
  expect(mergeConnectionEvidence(offboard, read)).toBeNull();
});
