import { describe, expect, it } from "vitest";

import {
  LOGIN_RATE_LIMIT_MAX_IDENTITIES,
  LoginRateLimiter,
} from "./rate-limit";

describe("login rate limiter", () => {
  it("blocks the sixth failed attempt for the same email and IP", () => {
    const limiter = new LoginRateLimiter();
    const attempt = { email: "marcos@example.test", ip: "127.0.0.1" };

    for (let count = 0; count < 5; count += 1) {
      expect(limiter.isAllowed(attempt)).toBe(true);
      limiter.recordFailure(attempt);
    }

    expect(limiter.isAllowed(attempt)).toBe(false);
  });

  it("blocks an email after five failures even if its client IP changes", () => {
    const limiter = new LoginRateLimiter();
    const email = "marcos@example.test";

    for (let count = 0; count < 5; count += 1) {
      limiter.recordFailure({ email, ip: `127.0.0.${count + 1}` });
    }

    expect(limiter.isAllowed({ email, ip: "203.0.113.10" })).toBe(false);
  });

  it("resets failures after a successful login", () => {
    const limiter = new LoginRateLimiter();
    const attempt = { email: "marcos@example.test", ip: "127.0.0.1" };

    limiter.recordFailure(attempt);
    limiter.recordFailure(attempt);
    limiter.reset(attempt);

    expect(limiter.isAllowed(attempt)).toBe(true);
  });

  it("forgets failures after fifteen minutes", () => {
    const limiter = new LoginRateLimiter();
    const attempt = { email: "marcos@example.test", ip: "127.0.0.1" };
    const now = new Date("2026-08-19T12:00:00.000Z");

    for (let count = 0; count < 5; count += 1) {
      limiter.recordFailure(attempt, now);
    }

    expect(limiter.isAllowed(attempt, new Date("2026-08-19T12:15:00.001Z"))).toBe(
      true,
    );
  });

  it("prunes every expired identity during a later limiter operation", () => {
    const limiter = new LoginRateLimiter();
    const beforeExpiry = new Date("2026-08-19T12:00:00.000Z");

    limiter.recordFailure(
      { email: "expired@example.test", ip: "192.0.2.1" },
      beforeExpiry,
    );
    limiter.recordFailure(
      { email: "fresh@example.test", ip: "192.0.2.2" },
      new Date("2026-08-19T12:15:00.001Z"),
    );

    expect(
      (limiter as unknown as { trackedIdentityCount: number })
        .trackedIdentityCount,
    ).toBe(2);
  });

  it("keeps a five-failure lockout while newer identities fill capacity", () => {
    const limiter = new LoginRateLimiter();
    const now = new Date("2026-08-19T12:00:00.000Z");
    const locked = { email: "locked@example.test", ip: "192.0.2.250" };

    for (let count = 0; count < 5; count += 1) {
      limiter.recordFailure(locked, now);
    }

    for (let count = 0; count < LOGIN_RATE_LIMIT_MAX_IDENTITIES; count += 1) {
      limiter.recordFailure(
        {
          email: `user-${count}@example.test`,
          ip: `198.51.100.${count}`,
        },
        now,
      );
    }

    expect(limiter.trackedIdentityCount).toBe(LOGIN_RATE_LIMIT_MAX_IDENTITIES);
    expect(limiter.isAllowed(locked, now)).toBe(false);
  });

  it("denies an untracked identity when capacity is full without evicting one", () => {
    const limiter = new LoginRateLimiter();
    const now = new Date("2026-08-19T12:00:00.000Z");

    for (let count = 0; count < LOGIN_RATE_LIMIT_MAX_IDENTITIES; count += 1) {
      limiter.recordFailure(
        {
          email: `user-${count}@example.test`,
          ip: `198.51.100.${count}`,
        },
        now,
      );
    }

    const untracked = { email: "untracked@example.test", ip: "203.0.113.1" };
    expect(limiter.isAllowed(untracked, now)).toBe(false);

    limiter.recordFailure(untracked, now);
    expect(limiter.trackedIdentityCount).toBe(LOGIN_RATE_LIMIT_MAX_IDENTITIES);
  });

  it("accepts a new identity after expiry pruning frees capacity", () => {
    const limiter = new LoginRateLimiter();
    const now = new Date("2026-08-19T12:00:00.000Z");

    for (let count = 0; count < LOGIN_RATE_LIMIT_MAX_IDENTITIES; count += 1) {
      limiter.recordFailure(
        {
          email: `user-${count}@example.test`,
          ip: `198.51.100.${count}`,
        },
        now,
      );
    }

    const later = new Date("2026-08-19T12:15:00.001Z");
    const untracked = { email: "untracked@example.test", ip: "203.0.113.1" };

    expect(limiter.isAllowed(untracked, later)).toBe(true);
    limiter.recordFailure(untracked, later);
    expect(limiter.trackedIdentityCount).toBe(2);
  });
});
