import { describe, expect, it } from "vitest";

import { LoginRateLimiter } from "./rate-limit";

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
});
