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
  ) {}
  start() {
    (['vehiclePositions', 'tripUpdates', 'serviceAlerts'] as FeedName[]).forEach((f, i) =>
      this.schedule(f, i * 1500),
    );
  }
  stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
  private schedule(feed: FeedName, delay: number) {
    if (this.stopped) return;
    this.health[feed].nextAttempt = Date.now() + delay;
    this.timers.set(
      feed,
      setTimeout(() => void this.poll(feed), delay),
    );
  }
  async poll(feed: FeedName) {
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
      this.log.info({ feed, count: health.count, bytes: bytes.length }, 'realtime poll completed');
    } catch (error) {
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
    this.schedule(feed, wait);
  }
}
