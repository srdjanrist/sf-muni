import { EventEmitter } from 'node:events';
import type {
  ServiceAlert,
  VehicleState,
  RealtimeTrip,
  TransitSnapshot,
  SystemStatus,
  TransitDelta,
} from '../../shared/types.js';
import type { GtfsIndex } from '../gtfs/indexes.js';
import { Predictions } from './predictions.js';
import { alertActive, computeStats } from './stats.js';
import { distanceMeters } from '../../shared/geo.js';
export class TransitStateManager {
  vehicles = new Map<string, VehicleState>();
  trips = new Map<string, RealtimeTrip>();
  alerts = new Map<string, ServiceAlert>();
  index?: GtfsIndex;
  version = 0;
  events = new EventEmitter();
  private changed = new Set<string>();
  private removed = new Set<string>();
  private tripsChanged = false;
  private alertsChanged = false;
  constructor(
    public status: () => SystemStatus,
    public staleMs = 180000,
    public removeMs = 600000,
    public now: () => number = Date.now,
  ) {
    this.events.setMaxListeners(0);
  }
  setIndex(index: GtfsIndex) {
    this.index = index;
    this.enrich();
    this.emit();
  }
  updateVehicles(incoming: VehicleState[], full = true) {
    const now = this.now(),
      ids = new Set(incoming.map((v) => v.id));
    for (const v of incoming) {
      const old = this.vehicles.get(v.id);
      if (old && old.timestamp > v.timestamp) {
        old.receivedAt = now;
        old.missingSince = undefined;
        old.missingCycles = 0;
        continue;
      }
      if (
        v.speedMps === undefined &&
        old &&
        old.tripId === v.tripId &&
        v.timestamp > old.timestamp
      ) {
        const speed = distanceMeters(old, v) / ((v.timestamp - old.timestamp) / 1000);
        if (speed < 45) {
          v.speedMps = speed;
          v.speedSource = 'derived';
        }
      }
      v.stale = now - (v.sourceTimestamp ?? v.receivedAt) > this.staleMs;
      this.vehicles.set(v.id, v);
      this.changed.add(v.id);
    }
    if (full)
      for (const [id, v] of this.vehicles)
        if (!ids.has(id)) {
          v.missingSince ??= now;
          v.missingCycles++;
          this.changed.add(id);
        }
    this.enrich();
    this.sweep();
    this.emit();
  }
  deleteVehicle(id: string) {
    if (this.vehicles.delete(id)) this.removed.add(id);
  }
  updateTrips(trips: RealtimeTrip[]) {
    this.trips = new Map(trips.map((t) => [t.id, t]));
    this.tripsChanged = true;
    this.enrich();
    this.emit();
  }
  updateAlerts(alerts: ServiceAlert[]) {
    this.alerts = new Map(alerts.map((a) => [a.id, a]));
    this.alertsChanged = true;
    this.emit();
  }
  predictions() {
    return this.index ? new Predictions(this.index, this.trips, this.now) : undefined;
  }
  enrich() {
    const predictions = this.predictions();
    if (!predictions || !this.index) return;
    for (const v of this.vehicles.values()) {
      const before = JSON.stringify([v.nextStop, v.delaySeconds, v.destination, v.shapeId]);
      const trip = v.tripId ? this.index.trips.get(v.tripId) : undefined;
      v.routeId ??= trip?.routeId;
      v.destination = trip?.headsign;
      v.shapeId = trip?.shapeId;
      v.category = v.routeId
        ? (this.index.routes.get(v.routeId)?.category ?? 'unknown')
        : 'unknown';
      const next = predictions.nextStop(v);
      v.nextStop = next?.stop;
      v.delaySeconds = next?.prediction.delaySeconds;
      if (before !== JSON.stringify([v.nextStop, v.delaySeconds, v.destination, v.shapeId]))
        this.changed.add(v.id);
    }
  }
  sweep() {
    const now = this.now();
    for (const [id, v] of this.vehicles) {
      // Poll failure never starts the omission timer: stale last-known vehicles remain visible during outages.
      if (v.missingSince && now - v.missingSince >= this.removeMs && v.missingCycles >= 3) {
        this.deleteVehicle(id);
        continue;
      }
      const stale = now - (v.sourceTimestamp ?? v.receivedAt) > this.staleMs;
      if (stale !== v.stale) {
        v.stale = stale;
        this.changed.add(id);
      }
    }
  }
  applicableAlerts(target: {
    routeId?: string;
    stopId?: string;
    tripId?: string;
    directionId?: number;
  }) {
    return [...this.alerts.values()].filter(
      (a) =>
        alertActive(a, this.now()) &&
        (!a.selectors.length ||
          a.selectors.some(
            (s) =>
              (!s.routeId || s.routeId === target.routeId) &&
              (!s.stopId ||
                s.stopId === target.stopId ||
                this.index?.stops.get(target.stopId ?? '')?.parentStationId === s.stopId) &&
              (!s.tripId || s.tripId === target.tripId) &&
              (s.directionId === undefined || s.directionId === target.directionId),
          )),
    );
  }
  getSnapshot(): TransitSnapshot {
    const vehicles = [...this.vehicles.values()],
      alerts = [...this.alerts.values()].filter((a) => alertActive(a, this.now()));
    return {
      version: this.version,
      staticVersion: this.index?.snapshot.version,
      vehicles,
      alerts,
      stats: computeStats(vehicles, alerts, this.now()),
      status: this.status(),
    };
  }
  emit() {
    this.version++;
    const snapshot = this.getSnapshot();
    const delta: TransitDelta = {
      version: this.version,
      staticVersion: snapshot.staticVersion,
      timestamp: this.now(),
      vehicles: [...this.changed].flatMap((id) =>
        this.vehicles.has(id) ? [this.vehicles.get(id)!] : [],
      ),
      removedVehicleIds: [...this.removed],
      tripsChanged: this.tripsChanged,
      alerts: this.alertsChanged ? snapshot.alerts : undefined,
      stats: snapshot.stats,
      status: snapshot.status,
    };
    this.changed.clear();
    this.removed.clear();
    this.tripsChanged = false;
    this.alertsChanged = false;
    this.events.emit('delta', delta);
  }
}
