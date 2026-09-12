import { join } from 'node:path';
import { Showcase, showcasePolicy } from './showcase.js';
import type { FastifyBaseLogger } from 'fastify';
import type { FeedHealth, FeedName } from '../../shared/types.js';
import { config } from '../config/index.js';
import {
  decodeFeed,
  fieldNumber,
  normalizeAlerts,
  normalizeTrips,
  normalizeVehicles,
} from './decode.js';
import { TransitApiClient, UpstreamError } from '../upstream/client.js';
import type { TransitStateManager } from '../transit/state-manager.js';
import type { transit_realtime as RT } from 'gtfs-realtime-bindings';
export class Polling {
  timers = new Map<FeedName, ReturnType<typeof setTimeout>>();
  stopped = false;
  readonly showcase: Showcase;
  private inFlight = new Set<FeedName>();
  private showcaseTimer?: ReturnType<typeof setTimeout>;
  private entities: Record<FeedName, Map<string, RT.IFeedEntity>> = {
    vehiclePositions: new Map(),
    tripUpdates: new Map(),
    serviceAlerts: new Map(),
  };
  constructor(
    private client: TransitApiClient,
    private state: TransitStateManager,
    private health: Record<FeedName, FeedHealth>,
    private log: FastifyBaseLogger,
  ) {
    this.showcase = new Showcase(
      join(config.dataDir, 'showcase.json'),
      () => client.budget,
      () => !this.stopped && Object.values(health).every((f) => f.healthy),
    );
  }
  async startShowcase() {
    if (await this.showcase.start()) {
      if (!this.inFlight.has('vehiclePositions')) this.schedule('vehiclePositions', 0, true);
      this.showcaseTimer = setTimeout(() => this.stopShowcase(), showcasePolicy.durationMs);
      this.log.info('Showcase vehicle polling started');
      this.state.emit();
    }
    return this.showcase.status;
  }
  stopShowcase() {
    if (!this.showcase.stop()) return this.showcase.status;
    clearTimeout(this.showcaseTimer);
    // Preserve an existing failure backoff. Otherwise restore the usual cadence.
    if (!this.inFlight.has('vehiclePositions') && this.health.vehiclePositions.healthy)
      this.schedule('vehiclePositions', config.pollMs.vehiclePositions);
    this.state.emit();
    return this.showcase.status;
  }
  start() {
    (['vehiclePositions', 'tripUpdates', 'serviceAlerts'] as FeedName[]).forEach((f, i) =>
      this.schedule(f, i * 1500),
    );
  }
  stop() {
    this.stopped = true;
    this.showcase.stop();
    clearTimeout(this.showcaseTimer);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
  private schedule(feed: FeedName, delay: number, expedited = false) {
    if (this.stopped) return;
    clearTimeout(this.timers.get(feed));
    this.health[feed].nextAttempt = Date.now() + delay;
    this.timers.set(
      feed,
      setTimeout(() => {
        if (expedited && !this.showcase.status.active) {
          this.schedule(feed, config.pollMs[feed]);
          return;
        }
        void this.poll(feed);
      }, delay),
    );
  }
  async poll(feed: FeedName) {
    if (this.stopped || this.inFlight.has(feed)) return;
    this.inFlight.add(feed);
    const health = this.health[feed];
    health.lastAttempt = Date.now();
    let wait = config.pollMs[feed];
    this.log.debug({ feed }, 'realtime poll started');
    try {
      const bytes = await this.client.request(feed);
      let message: RT.IFeedMessage;
      try {
        message = decodeFeed(bytes);
      } catch {
        throw new UpstreamError('protobuf_decode_failure');
      }
      const now = Date.now(),
        source = fieldNumber(message.header, 'timestamp');
      if (source && health.sourceTimestamp && source * 1000 < health.sourceTimestamp)
        throw new UpstreamError('out_of_order_feed');
      const full = message.header.incrementality !== 1;
      if (full) this.entities[feed].clear();
      for (const entity of message.entity ?? []) {
        if (entity.isDeleted) this.entities[feed].delete(entity.id);
        else this.entities[feed].set(entity.id, entity);
      }
      const merged = { header: message.header, entity: [...this.entities[feed].values()] };
      health.healthy = true;
      health.lastSuccess = now;
      health.sourceTimestamp = source === undefined ? undefined : source * 1000;
      health.error = undefined;
      health.failures = 0;
      health.count = merged.entity.length;
      if (feed === 'vehiclePositions') {
        const vehicles = normalizeVehicles(merged, this.state.index, now);
        health.count = vehicles.length;
        this.state.updateVehicles(vehicles);
      }
      if (feed === 'tripUpdates') this.state.updateTrips(normalizeTrips(merged, now));
      if (feed === 'serviceAlerts') this.state.updateAlerts(normalizeAlerts(merged, now));
      if (feed === 'vehiclePositions' && this.showcase.status.active)
        wait = showcasePolicy.intervalMs;
      this.log.info({ feed, count: health.count, bytes: bytes.length }, 'realtime poll completed');
    } catch (error) {
      this.showcase.stop();
      health.healthy = false;
      health.failures++;
      health.error = error instanceof UpstreamError ? error.code : 'poll_failed';
      wait = Math.max(
        Math.min(config.pollMs[feed] * 2 ** Math.min(health.failures, 5), 900000) *
          (0.9 + Math.random() * 0.2),
        error instanceof UpstreamError ? error.retryAt - Date.now() : 0,
      );
      this.log.warn(
        { feed, error: health.error, retryInMs: Math.round(wait) },
        'realtime poll failed; retaining last known state',
      );
      this.state.emit();
    }
    this.inFlight.delete(feed);
    this.schedule(
      feed,
      wait,
      feed === 'vehiclePositions' &&
        wait === showcasePolicy.intervalMs &&
        this.showcase.status.active,
    );
  }
}
