import bindings from 'gtfs-realtime-bindings';
import type { transit_realtime as RT } from 'gtfs-realtime-bindings';
import type { GtfsIndex } from '../gtfs/indexes.js';
import type { RealtimeTrip, ServiceAlert, VehicleState } from '../../shared/types.js';
import { instanceId } from '../../shared/time.js';
const { transit_realtime } = bindings;
export function decodeFeed(bytes: Uint8Array) {
  const feed = transit_realtime.FeedMessage.decode(bytes);
  if (!feed.header || !['1.0', '2.0'].includes(feed.header.gtfsRealtimeVersion))
    throw new Error('Invalid GTFS-Realtime header');
  return feed;
}
export function fieldNumber(object: object | null | undefined, field: string): number | undefined {
  if (!object || !Object.hasOwn(object, field)) return undefined;
  const raw = (object as Record<string, unknown>)[field];
  if (raw === null || raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
const epoch = (object: object | null | undefined, field: string) => {
  const n = fieldNumber(object, field);
  return n === undefined ? undefined : n * 1000;
};
export function normalizeVehicles(
  feed: RT.IFeedMessage,
  index: GtfsIndex | undefined,
  now: number,
): VehicleState[] {
  const vehicles: VehicleState[] = [];
  for (const entity of feed.entity ?? []) {
    const v = entity.vehicle,
      p = v?.position;
    if (!v || !p || entity.isDeleted) continue;
    if (
      !Number.isFinite(p.latitude) ||
      !Number.isFinite(p.longitude) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180
    )
      continue;
    const descriptor = v.trip,
      trip = descriptor?.tripId ? index?.trips.get(descriptor.tripId) : undefined;
    const routeId = descriptor?.routeId || trip?.routeId,
      route = routeId ? index?.routes.get(routeId) : undefined;
    const sourceTimestamp = epoch(v, 'timestamp') ?? epoch(feed.header, 'timestamp');
    const status = fieldNumber(v, 'currentStatus'),
      speed = fieldNumber(p, 'speed'),
      bearing = fieldNumber(p, 'bearing');
    vehicles.push({
      id: v.vehicle?.id || entity.id,
      label: v.vehicle?.label || undefined,
      licensePlate: v.vehicle?.licensePlate || undefined,
      tripId: descriptor?.tripId || undefined,
      routeId,
      instanceId: descriptor?.tripId
        ? instanceId(
            descriptor.tripId,
            descriptor.startDate || undefined,
            descriptor.startTime || undefined,
          )
        : undefined,
      startDate: descriptor?.startDate || undefined,
      startTime: descriptor?.startTime || undefined,
      lat: p.latitude,
      lon: p.longitude,
      bearing: bearing !== undefined && bearing >= 0 && bearing <= 360 ? bearing : undefined,
      speedMps: speed !== undefined && speed >= 0 ? speed : undefined,
      speedSource: speed !== undefined && speed >= 0 ? 'reported' : undefined,
      timestamp: sourceTimestamp ?? now,
      sourceTimestamp,
      receivedAt: now,
      stale: false,
      directionId: fieldNumber(descriptor, 'directionId') ?? trip?.directionId,
      stopId: v.stopId || undefined,
      stopSequence: fieldNumber(v, 'currentStopSequence'),
      status:
        status === 0
          ? 'incoming'
          : status === 1
            ? 'stopped'
            : status === 2
              ? 'in_transit'
              : 'unknown',
      destination: trip?.headsign,
      shapeId: trip?.shapeId,
      category: route?.category ?? 'unknown',
      missingCycles: 0,
    });
  }
  return vehicles;
}
export function normalizeTrips(feed: RT.IFeedMessage, now: number): RealtimeTrip[] {
  const result: RealtimeTrip[] = [];
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate,
      trip = update?.trip;
    if (!update || !trip?.tripId || entity.isDeleted) continue;
    const relationship = fieldNumber(trip, 'scheduleRelationship');
    result.push({
      id: instanceId(trip.tripId, trip.startDate || undefined, trip.startTime || undefined),
      tripId: trip.tripId,
      routeId: trip.routeId || undefined,
      startDate: trip.startDate || undefined,
      startTime: trip.startTime || undefined,
      vehicleId: update.vehicle?.id || undefined,
      directionId: fieldNumber(trip, 'directionId'),
      relationship:
        relationship === 3 || relationship === 7
          ? 'canceled'
          : relationship === 1
            ? 'added'
            : relationship === 2
              ? 'unscheduled'
              : 'scheduled',
      receivedAt: now,
      sourceTimestamp: epoch(update, 'timestamp') ?? epoch(feed.header, 'timestamp'),
      stale: false,
      delaySeconds: fieldNumber(update, 'delay'),
      stops: (update.stopTimeUpdate ?? []).map((s) => ({
        stopId: s.stopId || undefined,
        stopSequence: fieldNumber(s, 'stopSequence'),
        arrival: epoch(s.arrival, 'time'),
        arrivalDelay: fieldNumber(s.arrival, 'delay'),
        departure: epoch(s.departure, 'time'),
        departureDelay: fieldNumber(s.departure, 'delay'),
        status:
          s.scheduleRelationship === 1
            ? 'skipped'
            : s.scheduleRelationship === 2
              ? 'no_data'
              : 'scheduled',
      })),
    });
  }
  return result;
}
function translated(value?: RT.ITranslatedString | null) {
  const translations = value?.translation ?? [];
  return (
    translations.find((t) => t.language === 'en')?.text ||
    translations.find((t) => !t.language)?.text ||
    translations[0]?.text
  );
}
export function normalizeAlerts(feed: RT.IFeedMessage, now: number): ServiceAlert[] {
  return (feed.entity ?? [])
    .filter((e) => e.alert && !e.isDeleted)
    .map((e) => {
      const a = e.alert!,
        selectors = (a.informedEntity ?? []).map((s) => ({
          routeId: s.routeId || undefined,
          stopId: s.stopId || undefined,
          tripId: s.trip?.tripId || undefined,
          directionId: fieldNumber(s, 'directionId'),
          agencyId: s.agencyId || undefined,
        }));
      const url = translated(a.url);
      return {
        id: e.id,
        header: translated(a.headerText) || 'Service advisory',
        description: translated(a.descriptionText),
        url: url && /^https?:\/\//.test(url) ? url : undefined,
        severity:
          fieldNumber(a, 'severityLevel') === 4
            ? 'severe'
            : fieldNumber(a, 'severityLevel') === 3
              ? 'warning'
              : 'information',
        receivedAt: now,
        activePeriods: (a.activePeriod ?? []).map((p) => ({
          start: epoch(p, 'start'),
          end: epoch(p, 'end'),
        })),
        selectors,
        affectedRoutes: [...new Set(selectors.flatMap((s) => (s.routeId ? [s.routeId] : [])))],
        affectedStops: [...new Set(selectors.flatMap((s) => (s.stopId ? [s.stopId] : [])))],
        affectedTrips: [...new Set(selectors.flatMap((s) => (s.tripId ? [s.tripId] : [])))],
      };
    });
}
