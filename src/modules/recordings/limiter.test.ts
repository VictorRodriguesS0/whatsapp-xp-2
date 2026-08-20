// @vitest-environment node

import { describe, expect, it } from "vitest";

import { RecordingAdmissionLimiter } from "./limiter";

describe("recording admission limiter", () => {
  it("allows one active conversion per user and two globally", () => {
    const limiter = new RecordingAdmissionLimiter();
    const first = limiter.tryAcquire("u1");
    expect(first).not.toBe("BUSY");
    expect(limiter.tryAcquire("u1")).toBe("BUSY");
    const second = limiter.tryAcquire("u2");
    expect(second).not.toBe("BUSY");
    expect(limiter.tryAcquire("u3")).toBe("BUSY");
    if (typeof first !== "string") first.release();
    if (typeof second !== "string") second.release();
  });

  it("allows ten admissions in ten minutes and rate-limits the eleventh", () => {
    const limiter = new RecordingAdmissionLimiter();
    const now = new Date("2026-08-20T12:00:00.000Z");
    for (let index = 0; index < 10; index += 1) {
      const admission = limiter.tryAcquire("u1", now);
      expect(admission).not.toBe("RATE_LIMITED");
      if (typeof admission !== "string") admission.release();
    }
    expect(limiter.tryAcquire("u1", now)).toBe("RATE_LIMITED");
  });

  it("expires an admission exactly at the window boundary", () => {
    const limiter = new RecordingAdmissionLimiter();
    const start = new Date("2026-08-20T12:00:00.000Z");
    for (let index = 0; index < 10; index += 1) {
      const admission = limiter.tryAcquire("u1", start);
      if (typeof admission !== "string") admission.release();
    }
    expect(limiter.tryAcquire("u1", new Date(start.getTime() + 600_000 - 1))).toBe("RATE_LIMITED");
    expect(limiter.tryAcquire("u1", new Date(start.getTime() + 600_000))).not.toBe("RATE_LIMITED");
  });

  it("has an idempotent release with exact ownership", () => {
    const limiter = new RecordingAdmissionLimiter();
    const first = limiter.tryAcquire("u1");
    if (typeof first === "string") throw new Error("unexpected limiter result");
    first.release(); first.release();
    expect(limiter.tryAcquire("u1")).not.toBe("BUSY");
  });

  it("does not charge rate budget to an attempt rejected only by global concurrency", () => {
    const limiter = new RecordingAdmissionLimiter();
    const now = new Date("2026-08-20T12:00:00.000Z");
    const first = limiter.tryAcquire("a", now);
    const second = limiter.tryAcquire("b", now);
    expect(limiter.tryAcquire("c", now)).toBe("BUSY");
    if (typeof first !== "string") first.release();
    if (typeof second !== "string") second.release();
    for (let index = 0; index < 10; index += 1) {
      const admission = limiter.tryAcquire("c", now);
      expect(admission).not.toBe("RATE_LIMITED");
      if (typeof admission !== "string") admission.release();
    }
  });

  it("prunes expired attempt histories for inactive users", () => {
    const limiter = new RecordingAdmissionLimiter();
    const start = new Date("2026-08-20T12:00:00.000Z");
    const first = limiter.tryAcquire("expired-user", start);
    if (typeof first !== "string") first.release();
    const current = limiter.tryAcquire("current-user", new Date(start.getTime() + 600_000));
    if (typeof current !== "string") current.release();

    const attempts = Reflect.get(limiter, "attempts") as Map<string, number[]>;
    expect([...attempts.keys()]).toEqual(["current-user"]);
  });
});
