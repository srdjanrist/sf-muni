import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
import { GtfsIndex } from '../gtfs/indexes.js';
import { decodeFeed, normalizeAlerts, normalizeTrips, normalizeVehicles } from './decode.js';
import type { FeedHealth, FeedName, StaticSnapshot } from '../../shared/types.js';
import type { TransitStateManager } from '../transit/state-manager.js';
export class RecordedPlayback {
  private recordedAt = Date.now();
  private started = Date.now();
  now = () => this.recordedAt + (Date.now() - this.started);
  constructor(
    private state: TransitStateManager,
    private health: Record<FeedName, FeedHealth>,
  ) {}
  async start() {
    const root = join(config.fixtureDir, 'recorded');
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as {
      recordedAt: number;
    };
    this.recordedAt = manifest.recordedAt;
    this.started = Date.now();
    const snapshot = JSON.parse(
      await readFile(join(root, 'static.json'), 'utf8'),
    ) as StaticSnapshot;
    const index = new GtfsIndex(snapshot);
    this.state.setIndex(index);
    for (const [feed, name] of [
      ['tripUpdates', 'trip-updates'],
      ['vehiclePositions', 'vehicle-positions'],
      ['serviceAlerts', 'service-alerts'],
    ] as const) {
      const decoded = decodeFeed(await readFile(join(root, `${name}.pb`)));
      const sourceTimestamp = Number(decoded.header.timestamp) * 1000 || this.now();
      Object.assign(this.health[feed], {
        healthy: true,
        lastSuccess: this.now(),
        sourceTimestamp,
        count: decoded.entity.length,
      });
      if (feed === 'vehiclePositions')
        this.state.updateVehicles(normalizeVehicles(decoded, index, this.now()));
      else if (feed === 'tripUpdates') this.state.updateTrips(normalizeTrips(decoded, this.now()));
      else this.state.updateAlerts(normalizeAlerts(decoded, this.now()));
    }
  }
  stop() {
    /* A single captured frame has no polling loop. Motion stops at the normal prediction limit. */
  }
}
