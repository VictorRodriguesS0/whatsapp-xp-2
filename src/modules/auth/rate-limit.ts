import "server-only";

export const LOGIN_RATE_LIMIT = 5;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1_000;

export type LoginAttempt = {
  email: string;
  ip: string;
};

type AttemptRecord = {
  failures: number;
  firstFailureAt: number;
};

export class LoginRateLimiter {
  private readonly emailAttempts = new Map<string, AttemptRecord>();
  private readonly ipAttempts = new Map<string, AttemptRecord>();

  isAllowed(attempt: LoginAttempt, now = new Date()): boolean {
    return (
      this.isKeyAllowed(this.emailAttempts, this.emailKey(attempt), now) &&
      this.isKeyAllowed(this.ipAttempts, this.ipKey(attempt), now)
    );
  }

  recordFailure(attempt: LoginAttempt, now = new Date()): void {
    this.recordKeyFailure(this.emailAttempts, this.emailKey(attempt), now);
    this.recordKeyFailure(this.ipAttempts, this.ipKey(attempt), now);
  }

  reset(attempt: LoginAttempt): void {
    this.emailAttempts.delete(this.emailKey(attempt));
    this.ipAttempts.delete(this.ipKey(attempt));
  }

  private isKeyAllowed(
    attempts: Map<string, AttemptRecord>,
    key: string,
    now: Date,
  ): boolean {
    const record = attempts.get(key);

    if (!record) {
      return true;
    }

    if (now.getTime() - record.firstFailureAt >= LOGIN_RATE_WINDOW_MS) {
      attempts.delete(key);
      return true;
    }

    return record.failures < LOGIN_RATE_LIMIT;
  }

  private recordKeyFailure(
    attempts: Map<string, AttemptRecord>,
    key: string,
    now: Date,
  ): void {
    const current = attempts.get(key);

    if (!current || now.getTime() - current.firstFailureAt >= LOGIN_RATE_WINDOW_MS) {
      attempts.set(key, { failures: 1, firstFailureAt: now.getTime() });
      return;
    }

    current.failures += 1;
  }

  private emailKey({ email }: LoginAttempt): string {
    return email.toLowerCase();
  }

  private ipKey({ ip }: LoginAttempt): string {
    return ip;
  }
}

export const loginRateLimiter = new LoginRateLimiter();
