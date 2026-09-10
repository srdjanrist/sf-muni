import type { StaticSnapshot, TransitTrip, NetworkPayload } from '../../shared/types.js';
import { simplifyLine } from '../../shared/geo.js';
export class GtfsIndex {
  routes;
  stops;
  trips;
  shapes;
  routeTrips = new Map<string, TransitTrip[]>();
  stopTrips = new Map<string, TransitTrip[]>();
  children = new Map<string, string[]>();
  network: NetworkPayload;
  maxServiceSeconds = 86400;
  constructor(public snapshot: StaticSnapshot) {
    this.routes = new Map(snapshot.routes.map((r) => [r.id, r]));
    this.stops = new Map(snapshot.stops.map((s) => [s.id, s]));
    this.trips = new Map(snapshot.trips.map((t) => [t.id, t]));
    this.shapes = new Map(snapshot.shapes.map((s) => [s.id, s]));
    for (const stop of snapshot.stops)
      if (stop.parentStationId) {
        const children = this.children.get(stop.parentStationId) ?? [];
        children.push(stop.id);
        this.children.set(stop.parentStationId, children);
      }
    for (const trip of snapshot.trips) {
      const rt = this.routeTrips.get(trip.routeId) ?? [];
      rt.push(trip);
      this.routeTrips.set(trip.routeId, rt);
      const seen = new Set<string>();
      for (const time of snapshot.stopTimes[trip.id] ?? []) {
        this.maxServiceSeconds = Math.max(
          this.maxServiceSeconds,
          time.arrival ?? 0,
          time.departure ?? 0,
        );
        if (seen.has(time.stopId)) continue;
        seen.add(time.stopId);
        const st = this.stopTrips.get(time.stopId) ?? [];
        st.push(trip);
        this.stopTrips.set(time.stopId, st);
      }
    }
    const seenShapes = new Set<string>();
    const shapes: NetworkPayload['shapes'] = [];
    for (const t of snapshot.trips)
      if (t.shapeId && !seenShapes.has(`${t.routeId}:${t.shapeId}`)) {
        const s = this.shapes.get(t.shapeId);
        if (s) {
          seenShapes.add(`${t.routeId}:${t.shapeId}`);
          shapes.push({
            id: s.id,
            routeId: t.routeId,
            coordinates: simplifyLine(
              s.points.map((p) => [p.lon, p.lat]),
              0.000045,
            ),
          });
        }
      }
    this.network = {
      version: snapshot.version,
      routes: snapshot.routes,
      stops: snapshot.stops,
      bounds: snapshot.bounds,
      shapes,
    };
  }
}
