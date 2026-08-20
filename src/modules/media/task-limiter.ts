import "server-only";

export class MediaTaskLimiter {
  private active = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly queue: Array<{ key: string; resolve: () => void }> = [];

  constructor(private readonly maximum = 4, private readonly maximumPerKey = 2) {
    if (!Number.isInteger(maximum) || maximum < 1 || !Number.isInteger(maximumPerKey) || maximumPerKey < 1) {
      throw new TypeError("Invalid concurrency limit");
    }
  }

  private canStart(key: string): boolean {
    return this.active < this.maximum && (this.activeByKey.get(key) ?? 0) < this.maximumPerKey;
  }

  private reserve(key: string): void {
    this.active += 1;
    this.activeByKey.set(key, (this.activeByKey.get(key) ?? 0) + 1);
  }

  private drain(): void {
    while (this.active < this.maximum) {
      const index = this.queue.findIndex(({ key }) => this.canStart(key));
      if (index < 0) return;
      const [{ key, resolve }] = this.queue.splice(index, 1);
      this.reserve(key);
      resolve();
    }
  }

  async run<T>(work: () => Promise<T>, key = "background"): Promise<T> {
    if (this.canStart(key)) this.reserve(key);
    else await new Promise<void>((resolve) => this.queue.push({ key, resolve }));
    try {
      return await work();
    } finally {
      this.active -= 1;
      const remainingForKey = (this.activeByKey.get(key) ?? 1) - 1;
      if (remainingForKey === 0) this.activeByKey.delete(key);
      else this.activeByKey.set(key, remainingForKey);
      this.drain();
    }
  }
}
