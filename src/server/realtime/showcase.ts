import { readFile, writeFile, rename } from 'node:fs/promises';
import type { ShowcaseStatus } from '../../shared/types.js';

export const showcasePolicy = {
  durationMs: 60000,
  intervalMs: 20000,
  cooldownMs: 3600000,
  reserve: 1,
};

/** One shared, bounded burst. Restarting never clears the persisted cooldown. */
export class Showcase {
  private endsAt = 0;
  private availableAt = 0;
  private pending?: Promise<boolean>;
  private generation = 0;
  constructor(
    private path: string,
    private budget: () => { used: number; limit: number; pausedUntil?: number },
    private healthy: () => boolean,
    private now = Date.now,
  ) {}
  async init() {
    try {
      const saved: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (typeof saved !== 'number' || !Number.isFinite(saved)) throw new Error('Invalid cooldown');
      this.availableAt = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  get status(): ShowcaseStatus {
    const now = this.now(),
      budget = this.budget();
    const active =
      this.endsAt > now &&
      this.healthy() &&
      !(budget.pausedUntil && budget.pausedUntil > now) &&
      budget.limit - budget.used > showcasePolicy.reserve;
    const reason =
      !this.healthy() || (budget.pausedUntil ?? 0) > now
        ? 'Waiting for healthy live feeds.'
        : this.availableAt > now
          ? 'The shared showcase cooldown is active.'
          : budget.limit - budget.used <
              Math.ceil(showcasePolicy.durationMs / showcasePolicy.intervalMs) +
                showcasePolicy.reserve
            ? 'Not enough request budget for a burst. Try again later.'
            : undefined;
    return {
      active,
      available: !active && !reason,
      endsAt: active ? this.endsAt : undefined,
      availableAt: this.availableAt || undefined,
      reason,
      durationMs: showcasePolicy.durationMs,
      intervalMs: showcasePolicy.intervalMs,
    };
  }
  start(): Promise<boolean> {
    if (this.pending) return Promise.resolve(false);
    this.pending = this.activate().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async activate() {
    if (this.status.active || !this.status.available) return false;
    const generation = this.generation;
    const availableAt = this.now() + showcasePolicy.cooldownMs;
    await writeFile(`${this.path}.tmp`, JSON.stringify(availableAt));
    await rename(`${this.path}.tmp`, this.path);
    this.availableAt = availableAt;
    if (generation !== this.generation) return false;
    this.endsAt = this.now() + showcasePolicy.durationMs;
    return true;
  }
  stop() {
    this.generation++;
    const running = this.endsAt !== 0;
    this.endsAt = 0;
    return running;
  }
}
