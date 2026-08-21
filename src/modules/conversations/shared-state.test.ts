// @vitest-environment node

import { describe, expect, it } from "vitest";

import { compareBoundary } from "./shared-state";

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
});
