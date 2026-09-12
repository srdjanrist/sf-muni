import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Showcase } from '../src/server/realtime/showcase.js';
import { Polling } from '../src/server/realtime/polling.js';
import { TransitApiClient, UpstreamError } from '../src/server/upstream/client.js';
import { TransitStateManager } from '../src/server/transit/state-manager.js';
import { config } from '../src/server/config/index.js';
import { status } from './support.js';
import Fastify from 'fastify';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'muni-showcase-'));
  dirs.push(dir);
  let now = 1000000;
  const budget = { used: 56, limit: 60, pausedUntil: 0 };
  let healthy = true;
  const create = () =>
    new Showcase(
      join(dir, 'showcase.json'),
      () => budget,
      () => healthy,
      () => now,
    );
  return {
    create,
    budget,
    setTime: (t: number) => {
      now = t;
    },
    fail: () => {
      healthy = false;
    },
  };
}
describe('shared showcase budget and lifecycle', () => {
  it('deduplicates starts, expires automatically, and preserves cooldown across restart', async () => {
    const s = await setup(),
      burst = s.create();
    await burst.init();
    expect(burst.status.available).toBe(true);
    expect(await Promise.all([burst.start(), burst.start()])).toEqual([true, false]);
    expect(burst.status.active).toBe(true);
    s.setTime(1060000);
    expect(burst.status.active).toBe(false);
    const restarted = s.create();
    await restarted.init();
    expect(restarted.status.available).toBe(false);
    s.setTime(4600000);
    expect(restarted.status.available).toBe(true);
  });
  it('refuses insufficient quota and backoff; ends early on budget pressure or failure', async () => {
    const s = await setup(),
      burst = s.create();
    s.budget.used = 57;
    expect(await burst.start()).toBe(false);
    s.budget.used = 56;
    s.budget.pausedUntil = 1100000;
    expect(await burst.start()).toBe(false);
    s.budget.pausedUntil = 0;
    expect(await burst.start()).toBe(true);
    s.budget.used = 59;
    expect(burst.status.active).toBe(false);
    s.budget.used = 56;
    s.fail();
    expect(burst.status.active).toBe(false);
  });
  it('stopping preserves cooldown and cannot be undone by an in-flight start', async () => {
    const s = await setup(),
      burst = s.create();
    const starting = burst.start();
    burst.stop();
    expect(await starting).toBe(false);
    expect(burst.status.active).toBe(false);
    expect(burst.status.available).toBe(false);
  });
  it('polls at burst cadence, returns to normal, and preserves error backoff', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'muni-polling-'));
    dirs.push(dir);
    const health = structuredClone(status().feeds);
    Object.values(health).forEach((f) => {
      f.healthy = true;
      f.sourceTimestamp = undefined;
    });
    const state = new TransitStateManager(status, 180000, 600000);
    const client = new TransitApiClient();
    const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
      header: { gtfsRealtimeVersion: '2.0' },
      entity: [],
    }).finish();
    const request = vi.spyOn(client, 'request').mockResolvedValue(bytes);
    const logger = Fastify({ logger: false });
    const polling = new Polling(client, state, health, logger.log);
    // Use a separate on-disk cooldown; never touch the live cache or upstream.
    const burst = new Showcase(
      join(dir, 'showcase.json'),
      () => client.budget,
      () => true,
    );
    Object.defineProperty(polling, 'showcase', { value: burst });
    vi.useFakeTimers();
    await polling.startShowcase();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(20000);
    expect(burst.status.active).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(config.pollMs.vehiclePositions - 1);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(4);
    request.mockRejectedValue(new UpstreamError('upstream_rate_limited', Date.now() + 600000));
    await polling.poll('vehiclePositions');
    const retry = health.vehiclePositions.nextAttempt;
    polling.stopShowcase();
    expect(health.vehiclePositions.nextAttempt).toBe(retry);
    expect(retry).toBeGreaterThanOrEqual(Date.now() + 600000);
    polling.stop();
    await logger.close();
  });
});
