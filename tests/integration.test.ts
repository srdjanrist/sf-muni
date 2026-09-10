import { afterAll, describe, expect, it } from 'vitest';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGtfs } from '../src/server/gtfs/parser.js';
import { GtfsIndex } from '../src/server/gtfs/indexes.js';
import {
  decodeFeed,
  normalizeAlerts,
  normalizeTrips,
  normalizeVehicles,
} from '../src/server/realtime/decode.js';
import { TransitStateManager } from '../src/server/transit/state-manager.js';
import { createApp } from '../src/server/api/app.js';
import { fixtureIndex, NOW, status, vehicle } from './support.js';
describe('complete fixture pipeline', () => {
  it('imports GTFS archives with trailing bytes after the ZIP end record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'muni-zip-'));
    try {
      const path = join(dir, 'trailing.zip');
      await writeFile(
        path,
        Buffer.concat([await readFile('fixtures/gtfs.zip'), Buffer.alloc(698)]),
      );
      expect((await parseGtfs(path, 'test')).routes).toHaveLength(68);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('imports official GTFS and merges protobuf vehicles, trip updates and alerts', async () => {
    const snapshot = await parseGtfs('fixtures/gtfs.zip', 'SFMTA DataSF fixture');
    const index = new GtfsIndex(snapshot);
    expect(index.routes.size).toBe(68);
    expect(index.stops.size).toBe(3240);
    expect(index.trips.size).toBe(34668);
    expect(index.shapes.size).toBe(287);
    expect(snapshot.warnings).toBe(0);
    const vp = decodeFeed(await readFile('fixtures/vehicle-positions.pb')),
      tu = decodeFeed(await readFile('fixtures/trip-updates.pb')),
      sa = decodeFeed(await readFile('fixtures/service-alerts.pb'));
    const now = Number(vp.header.timestamp) * 1000;
    const state = new TransitStateManager(status, 180000, 600000, () => now);
    state.setIndex(index);
    state.updateTrips(normalizeTrips(tu, now));
    state.updateVehicles(normalizeVehicles(vp, index, now));
    state.updateAlerts(normalizeAlerts(sa, now));
    expect(state.vehicles.size).toBe(vp.entity.length);
    const v = state.vehicles.values().next().value!;
    expect(v.routeId).toBe(index.trips.get(v.tripId!)?.routeId);
    expect(v.nextStop).toBeDefined();
    expect(v.nextStop?.predictedArrival).toBeDefined();
    expect(v.delaySeconds).toBeTypeOf('number');
    const update = [...state.trips.values()].find((t) => t.tripId === v.tripId)!;
    expect(update.stops.find((s) => s.stopSequence === v.stopSequence)?.stopId).toBe(
      v.nextStop?.id,
    );
    expect(
      state
        .predictions()!
        .getUpcomingArrivals(v.nextStop!.id)
        .some((a) => a.tripId === v.tripId),
    ).toBe(true);
    expect(state.alerts.size).toBe(3);
  });
});
describe('REST boundaries', async () => {
  const state = new TransitStateManager(status, 180000, 600000, () => NOW);
  state.setIndex(fixtureIndex());
  state.updateVehicles([vehicle()]);
  const app = await createApp(state);
  afterAll(() => app.close());
  it('returns normalized vehicle details and scheduled arrivals', async () => {
    const detail = await app.inject('/api/vehicles/v1');
    expect(detail.statusCode).toBe(200);
    expect(detail.json().vehicle.nextStop.id).toBe('B');
    expect(detail.json().timeline.length).toBe(3);
    const arrivals = await app.inject('/api/stops/B/arrivals');
    expect(arrivals.json()[0].realtime).toBe(false);
  });
  it('supports search, rejects invalid horizons and missing IDs', async () => {
    expect((await app.inject('/api/search?q=Judah')).json()[0].id).toBe('N');
    expect((await app.inject('/api/stops/B/arrivals?horizon=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/vehicles/missing')).statusCode).toBe(404);
  });
  it('reduces browser network payload and supports conditional caching', async () => {
    const network = await app.inject('/api/network');
    expect(network.json().stopTimes).toBeUndefined();
    expect(network.json().trips).toBeUndefined();
    const cached = await app.inject({
      url: '/api/network',
      headers: { 'if-none-match': network.headers.etag! },
    });
    expect(cached.statusCode).toBe(304);
  });
  it('health and APIs never include environment secrets or upstream URLs', async () => {
    for (const path of ['/api/health', '/api/system/status', '/api/realtime/snapshot']) {
      const response = await app.inject(path);
      expect(response.body).not.toContain('api_key');
      expect(response.body).not.toContain('511_API_KEY');
      expect(response.body).not.toContain('api.511.org');
    }
  });
});
