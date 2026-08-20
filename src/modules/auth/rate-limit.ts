import "server-only";

export const LOGIN_RATE_LIMIT = 5;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1_000;
export const LOGIN_RATE_LIMIT_MAX_IDENTITIES = 512;

export type LoginAttempt = {
  email: string;
  ip: string;
};

type AttemptRecord = {
  failures: number;
  firstFailureAt: number;
};

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();

  get trackedIdentityCount(): number {
    return this.attempts.size;
  }

  isAllowed(attempt: LoginAttempt, now = new Date()): boolean {
    this.prune(now);

    if (!this.hasCapacityFor(attempt)) {
      return false;
    }

    return (
      this.isKeyAllowed(this.emailKey(attempt)) &&
      this.isKeyAllowed(this.ipKey(attempt))
    );
  }

  recordFailure(attempt: LoginAttempt, now = new Date()): void {
    this.prune(now);

    if (!this.hasCapacityFor(attempt)) {
      return;
    }

    this.recordKeyFailure(this.emailKey(attempt), now);
    this.recordKeyFailure(this.ipKey(attempt), now);
  }

  reset(attempt: LoginAttempt, now = new Date()): void {
    this.prune(now);
    this.attempts.delete(this.emailKey(attempt));
    this.attempts.delete(this.ipKey(attempt));
  }

  private isKeyAllowed(key: string): boolean {
    return (this.attempts.get(key)?.failures ?? 0) < LOGIN_RATE_LIMIT;
  }

  private recordKeyFailure(key: string, now: Date): void {
    const current = this.attempts.get(key);

    if (!current) {
      this.attempts.set(key, { failures: 1, firstFailureAt: now.getTime() });
      return;
    }

    current.failures += 1;
  }

  private prune(now: Date): void {
    for (const [key, record] of this.attempts) {
      if (now.getTime() - record.firstFailureAt >= LOGIN_RATE_WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
  }

  private hasCapacityFor(attempt: LoginAttempt): boolean {
    const keys = [this.emailKey(attempt), this.ipKey(attempt)];
    const missingIdentityCount = keys.filter(
      (key) => !this.attempts.has(key),
    ).length;

    return (
      this.attempts.size + missingIdentityCount <=
      LOGIN_RATE_LIMIT_MAX_IDENTITIES
    );
  }

  private emailKey({ email }: LoginAttempt): string {
    return `email:${email.toLowerCase()}`;
  }

  private ipKey({ ip }: LoginAttempt): string {
    return `ip:${ip}`;
  }
}

export const loginRateLimiter = new LoginRateLimiter();
