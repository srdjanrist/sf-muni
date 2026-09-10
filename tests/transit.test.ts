import { describe, expect, it } from 'vitest';
import bindings from 'gtfs-realtime-bindings';
import {
  dateKey,
  parseGtfsTime,
  serviceActive,
  serviceDateAt,
  serviceEpoch,
} from '../src/shared/time.js';
import {
  angleLerp,
  distanceMeters,
  makeShape,
  nearestPointOnShape,
  projectCoordinate,
  sampleShape,
  unprojectCoordinate,
} from '../src/shared/geo.js';
import { decodeFeed, normalizeVehicles, normalizeTrips } from '../src/server/realtime/decode.js';
import { Predictions } from '../src/server/transit/predictions.js';
import { TransitStateManager } from '../src/server/transit/state-manager.js';
import { computeStats } from '../src/server/transit/stats.js';
import { VehicleSimulation } from '../src/client/simulation/VehicleSimulation.js';
import { fixtureIndex, NOW, status, vehicle } from './support.js';
import type { RealtimeTrip } from '../src/shared/types.js';
describe('GTFS service time', () => {
  it('parses 24+ hour times without rolling the service date', () => {
    expect(parseGtfsTime('25:14:00')).toBe(90840);
    expect(parseGtfsTime('07:60:00')).toBeUndefined();
    expect(parseGtfsTime('')).toBeUndefined();
    expect(new Date(serviceEpoch('20260908', 90840)).toISOString()).toBe(
      '2026-09-09T08:14:00.000Z',
    );
  });
  it('uses Los Angeles regardless of viewer zone', () => {
    expect(dateKey(serviceDateAt(Date.parse('2026-09-09T04:00:00Z')))).toBe('20260908');
  });
  it('handles DST using GTFS noon minus 12 elapsed hours', () => {
    expect(new Date(serviceEpoch('20260308', 0)).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(new Date(serviceEpoch('20261101', 0)).toISOString()).toBe('2026-11-01T08:00:00.000Z');
  });
  it('matches weekdays and honors added and removed service', () => {
    const calendars = [
      {
        id: 'wk',
        days: [true, true, true, true, true, false, false],
        start: '20260901',
        end: '20260930',
      },
    ];
    expect(serviceActive('wk', '20260908', calendars, [])).toBe(true);
    expect(serviceActive('wk', '20260912', calendars, [])).toBe(false);
    expect(
      serviceActive('wk', '20260908', calendars, [{ serviceId: 'wk', date: '20260908', type: 2 }]),
    ).toBe(false);
    expect(
      serviceActive('new', '20260912', [], [{ serviceId: 'new', date: '20260912', type: 1 }]),
    ).toBe(true);
  });
});
describe('projection and shapes', () => {
  it('uses locally scaled Mercator and roundtrips', () => {
    expect(projectCoordinate(37.7749, -122.4194)).toEqual({ x: 0, z: 0 });
    const p = projectCoordinate(37.8, -122.45);
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeLessThan(0);
    const q = unprojectCoordinate(p.x, p.z);
    expect(q.lat).toBeCloseTo(37.8, 8);
    expect(q.lon).toBeCloseTo(-122.45, 8);
    expect(
      distanceMeters({ lat: 37.7749, lon: -122.4194 }, { lat: 37.7749, lon: -122.4094 }),
    ).toBeGreaterThan(870);
  });
  it('orders points and computes cumulative meter distances', () => {
    const s = makeShape('s', [
      { lat: 37.78, lon: -122.4, sequence: 2 },
      { lat: 37.77, lon: -122.4, sequence: 1 },
    ]);
    expect(s.points[0].sequence).toBe(1);
    expect(s.points[1].distance).toBeCloseTo(1112, 0);
  });
  it('matches a vehicle to its shape and samples along corners', () => {
    const s = fixtureIndex().snapshot.shapes[0];
    const match = nearestPointOnShape({ lat: 37.775, lon: -122.4144 }, s)!;
    expect(match.error).toBeLessThan(15);
    expect(match.distance).toBeGreaterThan(400);
    expect(sampleShape(s, match.distance).lat).toBeCloseTo(37.7749, 4);
    const end = sampleShape(s, s.totalDistanceMeters + 100);
    expect(end.lat).toBeCloseTo(37.7799, 5);
  });
  it('interpolates heading across zero', () => {
    expect(angleLerp(350, 10, 0.5)).toBe(0);
  });
});
describe('protobuf normalization and arrivals', () => {
  const feed = (
    entity: Parameters<typeof bindings.transit_realtime.FeedMessage.encode>[0]['entity'],
  ) =>
    decodeFeed(
      bindings.transit_realtime.FeedMessage.encode({
        header: { gtfsRealtimeVersion: '2.0', timestamp: NOW / 1000 },
        entity,
      }).finish(),
    );
  const update = (overrides: Partial<RealtimeTrip> = {}): RealtimeTrip => ({
    id: 'trip|20260908|',
    tripId: 'trip',
    startDate: '20260908',
    relationship: 'scheduled',
    receivedAt: NOW,
    sourceTimestamp: NOW,
    stale: false,
    stops: [{ stopId: 'B', stopSequence: 2, arrivalDelay: 120, status: 'scheduled' }],
    ...overrides,
  });
  it('preserves missing optional values rather than protobuf prototype defaults', () => {
    const decoded = feed([
      {
        id: 'v',
        vehicle: {
          vehicle: { id: 'v1' },
          trip: { tripId: 'trip' },
          position: { latitude: 37.7749, longitude: -122.4194 },
        },
      },
    ]);
    const v = normalizeVehicles(decoded, fixtureIndex(), NOW)[0];
    expect(v.routeId).toBe('N');
    expect(v.speedMps).toBeUndefined();
    expect(v.bearing).toBeUndefined();
    expect(v.status).toBe('unknown');
    expect(v.delaySeconds).toBeUndefined();
  });
  it('handles explicit zero bearing, zero speed, and STOPPED_AT', () => {
    const decoded = feed([
      {
        id: 'v',
        vehicle: {
          position: { latitude: 37.77, longitude: -122.4, bearing: 0, speed: 0 },
          currentStatus: 1,
        },
      },
    ]);
    const v = normalizeVehicles(decoded, fixtureIndex(), NOW)[0];
    expect(v.bearing).toBe(0);
    expect(v.speedMps).toBe(0);
    expect(v.status).toBe('stopped');
  });
  it('merges trip updates, propagates known delay and sorts departures', () => {
    const p = new Predictions(fixtureIndex(), new Map([['trip|20260908|', update()]]), () => NOW);
    const a = p.getUpcomingArrivals('B');
    expect(a).toHaveLength(1);
    expect(a[0].predictedArrival).toBe(NOW + 7 * 60000);
    expect(a[0].delaySeconds).toBe(120);
    expect(a[0].realtime).toBe(true);
    expect(p.getUpcomingArrivals('C')[0].delaySeconds).toBe(120);
  });
  it('prefers absolute arrival time over contradictory delay', () => {
    const u = update({
      stops: [{ stopSequence: 2, arrival: NOW + 8 * 60000, arrivalDelay: 10, status: 'scheduled' }],
    });
    const p = new Predictions(fixtureIndex(), new Map([[u.id, u]]), () => NOW);
    expect(p.getUpcomingArrivals('B')[0].delaySeconds).toBe(180);
  });
  it('aligns 511 overnight civil dates only when absolute time and delay corroborate the prior service day', () => {
    const index = fixtureIndex();
    index.snapshot.stopTimes.trip = index.snapshot.stopTimes.trip.map((t) => ({
      ...t,
      arrival: t.arrival! + 11 * 3600,
      departure: t.departure! + 11 * 3600,
    }));
    const now = NOW + 11 * 3600000;
    const u = update({
      id: 'trip|20260909|',
      startDate: '20260909',
      receivedAt: now,
      sourceTimestamp: now,
      stops: [{ stopSequence: 2, arrival: now + 420000, arrivalDelay: 107, status: 'scheduled' }],
    });
    const p = new Predictions(index, new Map([[u.id, u]]), () => now);
    const arrivals = p.getUpcomingArrivals('B');
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({
      delaySeconds: 120,
      scheduledArrival: now + 300000,
      realtime: true,
    });
    expect(
      p.nextStop(vehicle({ startDate: '20260909', timestamp: now, sourceTimestamp: now }))
        ?.prediction.delaySeconds,
    ).toBe(120);
    expect(u.startDate).toBe('20260909');
    const noUpdate = new Predictions(index, new Map(), () => now);
    expect(
      noUpdate.nextStop(vehicle({ startDate: '20260909', timestamp: now, sourceTimestamp: now }))
        ?.prediction.scheduledArrival,
    ).toBe(now + 300000);
  });
  it('canceled trips disappear, skipped stops do not appear, no_data clears propagation', () => {
    const u = update({ relationship: 'canceled' });
    const p = new Predictions(fixtureIndex(), new Map([[u.id, u]]), () => NOW);
    expect(p.getUpcomingArrivals('B')).toEqual([]);
    u.relationship = 'scheduled';
    u.stops = [
      { stopSequence: 2, status: 'skipped', arrivalDelay: 100 },
      { stopSequence: 3, status: 'no_data' },
    ];
    expect(p.getUpcomingArrivals('B')).toEqual([]);
    expect(p.getUpcomingArrivals('C')[0].realtime).toBe(false);
  });
  it('scheduled fallback has unknown delay, stale trip updates do not look realtime', () => {
    const u = update({ sourceTimestamp: NOW - 400000 });
    const p = new Predictions(fixtureIndex(), new Map([[u.id, u]]), () => NOW);
    expect(p.getUpcomingArrivals('B')[0]).toMatchObject({
      realtime: false,
      delaySeconds: undefined,
    });
  });
  it('sorts multiple trips by predicted departure rather than static trip order', () => {
    const index = fixtureIndex(),
      trip = { ...index.snapshot.trips[0], id: 'earlier' };
    index.snapshot.trips.push(trip);
    index.trips.set(trip.id, trip);
    index.stopTrips.get('B')!.push(trip);
    index.snapshot.stopTimes.earlier = index.snapshot.stopTimes.trip.map((t) => ({
      ...t,
      arrival: (t.arrival ?? 0) - 60,
      departure: (t.departure ?? 0) - 60,
    }));
    const u = update({
      id: 'earlier|20260908|',
      tripId: 'earlier',
      stops: [{ stopSequence: 2, arrivalDelay: 600, departureDelay: 600, status: 'scheduled' }],
    });
    const arrivals = new Predictions(index, new Map([[u.id, u]]), () => NOW).getUpcomingArrivals(
      'B',
    );
    expect(arrivals.map((a) => a.tripId)).toEqual(['trip', 'earlier']);
  });
  it('expands exact frequencies but does not invent non-exact departure times', () => {
    const index = fixtureIndex();
    index.snapshot.frequencies = [
      { tripId: 'trip', start: 14 * 3600, end: 14 * 3600 + 1800, headway: 600, exact: true },
    ];
    const predictions = new Predictions(index, new Map(), () => NOW);
    expect(predictions.getUpcomingArrivals('B')).toHaveLength(3);
    index.snapshot.frequencies[0].exact = false;
    expect(predictions.getUpcomingArrivals('B')).toEqual([]);
  });
  it('finds the next stop by sequence and derives ETA', () => {
    const u = update();
    const p = new Predictions(fixtureIndex(), new Map([[u.id, u]]), () => NOW);
    expect(p.nextStop(vehicle())?.stop).toMatchObject({
      id: 'B',
      name: 'Second stop',
      predictedArrival: NOW + 420000,
    });
  });
  it('decodes trip cancellation and rejects invalid protobuf', () => {
    const f = feed([
      { id: 't', tripUpdate: { trip: { tripId: 'trip', scheduleRelationship: 3 } } },
    ]);
    expect(normalizeTrips(f, NOW)[0].relationship).toBe('canceled');
    expect(() => decodeFeed(new Uint8Array([255, 255, 255]))).toThrow();
  });
  it('retains vehicles without matching static trip', () => {
    const f = feed([
      {
        id: 'unmatched',
        vehicle: { trip: { tripId: 'unknown' }, position: { latitude: 37.78, longitude: -122.41 } },
      },
    ]);
    expect(normalizeVehicles(f, fixtureIndex(), NOW)[0].id).toBe('unmatched');
  });
});
describe('state retention and statistics', () => {
  it('retains one omitted cycle, expires after TTL and three successful omissions', () => {
    let now = NOW;
    const state = new TransitStateManager(status, 180000, 600000, () => now);
    state.updateVehicles([vehicle()]);
    state.updateVehicles([]);
    expect(state.vehicles.size).toBe(1);
    now += 610000;
    state.sweep();
    expect(state.vehicles.size).toBe(1);
    state.updateVehicles([]);
    state.updateVehicles([]);
    expect(state.vehicles.size).toBe(0);
  });
  it('marks outage data stale without deleting last known positions', () => {
    let now = NOW;
    const state = new TransitStateManager(status, 180000, 600000, () => now);
    state.updateVehicles([vehicle()]);
    now += 900000;
    state.sweep();
    expect(state.vehicles.get('v1')?.stale).toBe(true);
    expect(state.vehicles.size).toBe(1);
  });
  it('ignores older positions and excludes unknown delay from stats', () => {
    const state = new TransitStateManager(status, 180000, 600000, () => NOW);
    state.updateVehicles([vehicle()]);
    state.updateVehicles([vehicle({ timestamp: NOW - 10000, lon: -122.5 })]);
    expect(state.vehicles.get('v1')?.lon).toBe(-122.4194);
    const stats = computeStats(
      [
        vehicle(),
        vehicle({ id: 'v2', delaySeconds: 120 }),
        vehicle({ id: 'v3', delaySeconds: 240 }),
      ],
      [],
      NOW,
    );
    expect(stats.averageDelaySeconds).toBe(180);
    expect(stats.medianDelaySeconds).toBe(180);
    expect(stats.delaySampleCount).toBe(2);
  });
});
describe('vehicle simulation', () => {
  it('glides into a newly reported stop instead of teleporting', () => {
    const sim = new VehicleSimulation();
    sim.setShape(fixtureIndex().snapshot.shapes[0]);
    sim.updateNetworkState(vehicle({ speedMps: 0 }), NOW);
    sim.updateNetworkState(
      vehicle({ lon: -122.4144, timestamp: NOW + 30000, status: 'stopped', speedMps: 0 }),
      NOW + 30000,
    );
    sim.tick(NOW + 30000, 0.016);
    expect(sim.getVehicleState('v1')!.x).toBeCloseTo(0);
    sim.tick(NOW + 45000, 0.016);
    const middle = sim.getVehicleState('v1')!.x;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(400);
    sim.tick(NOW + 60000, 0.016);
    const atStop = sim.getVehicleState('v1')!.x;
    sim.tick(NOW + 90000, 0.016);
    expect(sim.getVehicleState('v1')!.x).toBe(atStop);
  });
  it('does not rewind when an extrapolated vehicle becomes stale', () => {
    const sim = new VehicleSimulation();
    sim.setShape(fixtureIndex().snapshot.shapes[0]);
    sim.updateNetworkState(vehicle({ speedMps: 5 }), NOW);
    sim.tick(NOW + 90000, 0.016);
    const predicted = sim.getVehicleState('v1')!.x;
    sim.updateNetworkState(vehicle({ speedMps: 5, stale: true }), NOW + 180000);
    sim.tick(NOW + 180000, 0.016);
    expect(sim.getVehicleState('v1')!.x).toBe(predicted);
    sim.tick(NOW + 300000, 0.016);
    expect(sim.getVehicleState('v1')!.x).toBe(predicted);
  });
  it('animates between network snapshots instead of teleporting', () => {
    const sim = new VehicleSimulation();
    sim.setShape(fixtureIndex().snapshot.shapes[0]);
    sim.updateNetworkState(vehicle({ speedMps: 0 }), NOW);
    sim.updateNetworkState(
      vehicle({
        lon: -122.4144,
        timestamp: NOW + 30000,
        sourceTimestamp: NOW + 30000,
        speedMps: 0,
      }),
      NOW + 30000,
    );
    const target = projectCoordinate(37.7749, -122.4144).x;
    sim.tick(NOW + 30000, 1 / 60);
    expect(sim.getVehicleState('v1')!.x).toBeCloseTo(0);
    sim.tick(NOW + 45000, 1 / 60);
    expect(sim.getVehicleState('v1')!.x).toBeGreaterThan(0);
    expect(sim.getVehicleState('v1')!.x).toBeLessThan(target);
    sim.tick(NOW + 60000, 1 / 60);
    expect(sim.getVehicleState('v1')!.x).toBeCloseTo(target, 0);
  });
  it('extrapolation tapers monotonically and freezes after 90 seconds', () => {
    const sim = new VehicleSimulation();
    sim.setShape(fixtureIndex().snapshot.shapes[0]);
    sim.updateNetworkState(vehicle({ speedMps: 5 }), NOW);
    const positions = [0, 30000, 60000, 90000, 180000].map((t) => {
      sim.tick(NOW + t, 0.016);
      return sim.getVehicleState('v1')!.x;
    });
    expect(positions[2]).toBeGreaterThan(positions[1]);
    expect(positions[3]).toBeGreaterThan(positions[2]);
    expect(positions[4]).toBe(positions[3]);
  });
  it('holds stopped vehicles and resets implausible jumps', () => {
    const sim = new VehicleSimulation();
    sim.setShape(fixtureIndex().snapshot.shapes[0]);
    sim.updateNetworkState(vehicle({ status: 'stopped', speedMps: 8 }), NOW);
    sim.tick(NOW + 30000, 1 / 60);
    expect(sim.getVehicleState('v1')!.x).toBeCloseTo(0);
    sim.updateNetworkState(vehicle({ lon: -122.48, timestamp: NOW + 1000 }), NOW + 1000);
    expect(sim.getVehicleState('v1')!.lon).toBeCloseTo(-122.48, 5);
  });
});
