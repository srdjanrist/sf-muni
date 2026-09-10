import { makeShape } from '../src/shared/geo.js';
import { GtfsIndex } from '../src/server/gtfs/indexes.js';
import type { StaticSnapshot, SystemStatus, VehicleState } from '../src/shared/types.js';
export const NOW = Date.parse('2026-09-08T21:00:00Z');
export function fixtureIndex() {
  const shape = makeShape('shape', [
    { lat: 37.7749, lon: -122.4194, sequence: 0 },
    { lat: 37.7749, lon: -122.4094, sequence: 1 },
    { lat: 37.7799, lon: -122.4094, sequence: 2 },
  ]);
  const snapshot: StaticSnapshot = {
    version: 'test',
    updatedAt: NOW,
    source: 'test',
    timezone: 'America/Los_Angeles',
    routes: [
      {
        id: 'N',
        shortName: 'N',
        longName: 'Judah',
        type: 0,
        color: '#00549a',
        textColor: '#ffffff',
        category: 'light_rail',
      },
    ],
    stops: [
      {
        id: 'A',
        name: 'First stop',
        lat: 37.7749,
        lon: -122.4194,
        locationType: 0,
        routeIds: ['N'],
      },
      {
        id: 'B',
        name: 'Second stop',
        lat: 37.7749,
        lon: -122.4094,
        locationType: 0,
        routeIds: ['N'],
      },
      {
        id: 'C',
        name: 'Third stop',
        lat: 37.7799,
        lon: -122.4094,
        locationType: 0,
        routeIds: ['N'],
      },
    ],
    trips: [
      {
        id: 'trip',
        routeId: 'N',
        serviceId: 'daily',
        shapeId: 'shape',
        headsign: 'Ocean Beach',
        directionId: 0,
      },
    ],
    shapes: [shape],
    stopTimes: {
      trip: [
        { stopId: 'A', sequence: 1, arrival: 13 * 3600 + 55 * 60, departure: 13 * 3600 + 55 * 60 },
        {
          stopId: 'B',
          sequence: 2,
          arrival: 14 * 3600 + 5 * 60,
          departure: 14 * 3600 + 5 * 60 + 20,
        },
        { stopId: 'C', sequence: 3, arrival: 14 * 3600 + 10 * 60, departure: 14 * 3600 + 10 * 60 },
      ],
    },
    calendars: [
      {
        id: 'daily',
        days: [true, true, true, true, true, true, true],
        start: '20260101',
        end: '20261231',
      },
    ],
    exceptions: [],
    frequencies: [],
    optional: {},
    bounds: [-122.42, 37.77, -122.4, 37.78],
    warnings: 0,
  };
  return new GtfsIndex(snapshot);
}
export function vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    id: 'v1',
    tripId: 'trip',
    routeId: 'N',
    startDate: '20260908',
    lat: 37.7749,
    lon: -122.4194,
    shapeId: 'shape',
    timestamp: NOW,
    sourceTimestamp: NOW,
    receivedAt: NOW,
    stale: false,
    status: 'in_transit',
    category: 'light_rail',
    stopSequence: 2,
    missingCycles: 0,
    ...overrides,
  };
}
export function status(): SystemStatus {
  return {
    status: 'ok',
    source: 'fixture',
    now: NOW,
    gtfs: { loaded: true },
    feeds: {
      vehiclePositions: { healthy: true, count: 1, failures: 0 },
      tripUpdates: { healthy: true, count: 1, failures: 0 },
      serviceAlerts: { healthy: true, count: 0, failures: 0 },
    },
    budget: { used: 0, limit: 60 },
    staleAfterMs: 180000,
  };
}
