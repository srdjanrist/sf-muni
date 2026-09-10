import bindings from 'gtfs-realtime-bindings';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GtfsIndex } from '../gtfs/indexes.js';
import type { FeedHealth, FeedName, TransitShape, TransitTrip } from '../../shared/types.js';
import type { transit_realtime as RT } from 'gtfs-realtime-bindings';
import { dateKey, serviceActive, serviceDateAt, serviceEpoch } from '../../shared/time.js';
import { nearestPointOnShape, sampleShape } from '../../shared/geo.js';
import { decodeFeed, normalizeAlerts, normalizeTrips, normalizeVehicles } from './decode.js';
import type { TransitStateManager } from '../transit/state-manager.js';
import { config } from '../config/index.js';
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
interface Run {
  trip: TransitTrip;
  shape: TransitShape;
  date: string;
  delay: number;
  stops: { id: string; seq: number; time: number; departure: number; distance: number }[];
  id: string;
}
export class FixturePlayback {
  private runs: Run[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private started = Date.now();
  private nextId = 1000;
  private refreshedAt = 0;
  readonly base = Date.parse('2026-09-08T21:00:00Z');
  now = () => this.base + (Date.now() - this.started);
  constructor(
    private index: GtfsIndex,
    private state: TransitStateManager,
    private health: Record<FeedName, FeedHealth>,
  ) {
    this.refreshRuns(this.base);
  }
  private refreshRuns(now: number) {
    const index = this.index;
    this.refreshedAt = now;
    this.runs = this.runs.filter((r) => r.stops.at(-1)!.time + r.delay * 1000 > now);
    const existing = new Set(this.runs.map((r) => r.trip.id));
    const date = dateKey(serviceDateAt(now, index.snapshot.timezone)),
      counts = new Map<string, number>();
    for (const r of this.runs) counts.set(r.trip.routeId, (counts.get(r.trip.routeId) ?? 0) + 1);
    const candidates = index.snapshot.trips
      .filter((t) =>
        serviceActive(t.serviceId, date, index.snapshot.calendars, index.snapshot.exceptions),
      )
      .sort((a, b) => hash(a.id) - hash(b.id));
    for (const trip of candidates) {
      if (existing.has(trip.id) || (counts.get(trip.routeId) ?? 0) >= 6) continue;
      const shape = trip.shapeId ? index.shapes.get(trip.shapeId) : undefined,
        times = index.snapshot.stopTimes[trip.id];
      if (!shape || !times?.length) continue;
      const start = times[0].departure ?? times[0].arrival,
        end = times.at(-1)?.arrival ?? times.at(-1)?.departure;
      if (start === undefined || end === undefined) continue;
      if (serviceEpoch(date, start) > now || serviceEpoch(date, end) < now + 60000) continue;
      let progress: number | undefined;
      const stops: Run['stops'] = [];
      for (const time of times) {
        const stop = index.stops.get(time.stopId);
        if (!stop || time.arrival === undefined) continue;
        const matched = nearestPointOnShape(stop, shape, progress);
        if (!matched) continue;
        progress = matched.distance;
        stops.push({
          id: stop.id,
          seq: time.sequence,
          time: serviceEpoch(date, time.arrival),
          departure: serviceEpoch(date, time.departure ?? time.arrival),
          distance: progress,
        });
      }
      if (stops.length < 2) continue;
      counts.set(trip.routeId, (counts.get(trip.routeId) ?? 0) + 1);
      const seed = hash(trip.id);
      this.runs.push({
        trip,
        shape,
        date,
        delay:
          seed % 7 === 0
            ? 180 + (seed % 300)
            : seed % 3 === 0
              ? 45 + (seed % 90)
              : (seed % 60) - 25,
        stops,
        id: `SIM-${this.nextId++}`,
      });
    }
  }
  async start() {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 8000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick(record = false) {
    const now = this.now(),
      stamp = Math.floor(now / 1000),
      vehicles: RT.IFeedEntity[] = [],
      updates: RT.IFeedEntity[] = [];
    if (now - this.refreshedAt >= 60000) this.refreshRuns(now);
    for (const run of this.runs) {
      const { trip, shape, stops, delay, id } = run;
      const time = now - delay * 1000;
      const i = stops.findIndex((s) => s.time >= time);
      if (i < 0) continue;
      const a = stops[Math.max(0, i - 1)],
        b = stops[i],
        fraction = Math.max(0, Math.min(1, (time - a.departure) / (b.time - a.departure || 1)));
      const distance = a.distance + (b.distance - a.distance) * fraction,
        p = sampleShape(shape, distance),
        stopped = time <= a.departure && time >= a.time;
      const speed = stopped
        ? 0
        : Math.max(
            0,
            Math.min(22, (b.distance - a.distance) / Math.max(1, (b.time - a.departure) / 1000)),
          );
      const descriptor = {
        tripId: trip.id,
        routeId: trip.routeId,
        directionId: trip.directionId,
        startDate: run.date,
      };
      vehicles.push({
        id,
        vehicle: {
          vehicle: { id, label: id },
          trip: descriptor,
          position: { latitude: p.lat, longitude: p.lon, bearing: p.bearing, speed },
          timestamp: stamp,
          currentStopSequence: stopped ? a.seq : b.seq,
          stopId: stopped ? a.id : b.id,
          currentStatus: stopped ? 1 : 2,
        },
      });
      updates.push({
        id: `TU-${id}`,
        tripUpdate: {
          trip: descriptor,
          vehicle: { id },
          timestamp: stamp,
          stopTimeUpdate: stops.map((s) => ({
            stopSequence: s.seq,
            stopId: s.id,
            arrival: { time: Math.floor((s.time + delay * 1000) / 1000) },
            departure: { time: Math.floor((s.departure + delay * 1000) / 1000) },
          })),
        },
      });
    }
    const selected = this.runs.filter((r) => r.delay > 180).slice(0, 3);
    const alerts: RT.IFeedEntity[] = selected.map((r, i) => ({
      id: `SIM-ALERT-${i}`,
      alert: {
        headerText: {
          translation: [
            {
              text: `Playback scenario: ${this.index.routes.get(r.trip.routeId)?.shortName} service delay`,
              language: 'en',
            },
          ],
        },
        descriptionText: {
          translation: [
            {
              text: 'Synthetic advisory for testing alert associations and disruption views. This is not an actual service alert.',
              language: 'en',
            },
          ],
        },
        informedEntity: [{ routeId: r.trip.routeId }],
        activePeriod: [{ start: Math.floor(this.base / 1000) }],
        severityLevel: 3,
      },
    }));
    for (const [feed, entities, file] of [
      ['tripUpdates', updates, 'trip-updates'],
      ['vehiclePositions', vehicles, 'vehicle-positions'],
      ['serviceAlerts', alerts, 'service-alerts'],
    ] as const) {
      const bytes = bindings.transit_realtime.FeedMessage.encode({
        header: { gtfsRealtimeVersion: '2.0', timestamp: stamp },
        entity: entities,
      }).finish();
      const decoded = decodeFeed(bytes);
      Object.assign(this.health[feed], {
        healthy: true,
        lastSuccess: now,
        sourceTimestamp: now,
        lastAttempt: now,
        nextAttempt: now + 8000,
        count: entities.length,
        failures: 0,
      });
      if (feed === 'vehiclePositions')
        this.state.updateVehicles(normalizeVehicles(decoded, this.index, now));
      else if (feed === 'tripUpdates') this.state.updateTrips(normalizeTrips(decoded, now));
      else this.state.updateAlerts(normalizeAlerts(decoded, now));
      if (record)
        await writeFile(join(config.fixtureDir, `${file}.pb`), bytes).catch(() => undefined);
    }
  }
}
export async function readRecordedFeed(name: string) {
  return decodeFeed(await readFile(join(config.fixtureDir, 'recorded', `${name}.pb`)));
}
