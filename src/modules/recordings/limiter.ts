import "server-only";

import { randomUUID } from "node:crypto";

export type RecordingAdmission = { release(): void };

const MAX_ACTIVE_GLOBAL = 2;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

export class RecordingAdmissionLimiter {
  private readonly activeUsers = new Map<string, string>();
  private readonly attempts = new Map<string, number[]>();
  private readonly activeIds = new Set<string>();

  tryAcquire(userId: string, now = new Date()): RecordingAdmission | "BUSY" | "RATE_LIMITED" {
    const instant = now.getTime();
    this.pruneAttempts(instant);
    if (this.activeUsers.has(userId) || this.activeIds.size >= MAX_ACTIVE_GLOBAL) return "BUSY";
    const recent = this.attempts.get(userId) ?? [];
    if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) return "RATE_LIMITED";
    const id = randomUUID();
    recent.push(instant);
    this.attempts.set(userId, recent);
    this.activeUsers.set(userId, id);
    this.activeIds.add(id);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (this.activeUsers.get(userId) !== id || !this.activeIds.delete(id)) return;
        this.activeUsers.delete(userId);
      },
    };
  }

  private pruneAttempts(instant: number): void {
    for (const [userId, attempts] of this.attempts) {
      const recent = attempts.filter((attempt) => attempt > instant - WINDOW_MS);
      if (recent.length === 0) this.attempts.delete(userId);
      else this.attempts.set(userId, recent);
    }
  }
}
