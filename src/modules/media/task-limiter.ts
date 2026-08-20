import "server-only";

export class MediaTaskLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maximum = 4) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new TypeError("Invalid concurrency limit");
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active += 1;
    try {
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active -= 1;
    }
  }
}
