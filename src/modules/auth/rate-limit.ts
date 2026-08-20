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

    return (
      this.isKeyAllowed(this.emailKey(attempt)) &&
      this.isKeyAllowed(this.ipKey(attempt))
    );
  }

  recordFailure(attempt: LoginAttempt, now = new Date()): void {
    this.prune(now);
    this.recordKeyFailure(this.emailKey(attempt), now);
    this.recordKeyFailure(this.ipKey(attempt), now);
    this.enforceCapacity();
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

  private enforceCapacity(): void {
    while (this.attempts.size > LOGIN_RATE_LIMIT_MAX_IDENTITIES) {
      const oldestKey = this.attempts.keys().next().value;

      if (!oldestKey) {
        return;
      }

      this.attempts.delete(oldestKey);
    }
  }

  private emailKey({ email }: LoginAttempt): string {
    return `email:${email.toLowerCase()}`;
  }

  private ipKey({ ip }: LoginAttempt): string {
    return `ip:${ip}`;
  }
}

export const loginRateLimiter = new LoginRateLimiter();
