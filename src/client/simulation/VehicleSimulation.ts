import {
  angleLerp,
  nearestPointOnShape,
  projectCoordinate,
  sampleShape,
  unprojectCoordinate,
} from '../../shared/geo';
import type { TransitShape, VehicleState } from '../../shared/types';
export interface VehicleRenderState {
  id: string;
  x: number;
  z: number;
  bearing: number;
  lat: number;
  lon: number;
  alpha: number;
  snapped: boolean;
  network: VehicleState;
}
interface Track {
  frozenAt?: number;
  network: VehicleState;
  render: VehicleRenderState;
  from: { x: number; z: number; bearing: number; distance?: number };
  target: { x: number; z: number; bearing: number; distance?: number };
  started: number;
  duration: number;
  shape?: TransitShape;
  speed: number;
}
export const motionConfig = {
  renderDelayMs: 3000,
  maxInterpolationMs: 120000,
  maxSnapMeters: 85,
  resetDistanceMeters: 2000,
  fullPredictionMs: 30000,
  stopPredictionMs: 90000,
};
export class VehicleSimulation {
  tracks = new Map<string, Track>();
  shapes = new Map<string, TransitShape>();
  setShape(shape: TransitShape) {
    this.shapes.set(shape.id, shape);
  }
  remove(id: string) {
    this.tracks.delete(id);
  }
  updateNetworkState(v: VehicleState, now: number) {
    const old = this.tracks.get(v.id);
    if (old && v.timestamp < old.network.timestamp) return;
    if (
      old &&
      v.timestamp === old.network.timestamp &&
      old.network.lat === v.lat &&
      old.network.lon === v.lon
    ) {
      old.network = v;
      old.render.network = v;
      return;
    }
    const shape = v.shapeId ? this.shapes.get(v.shapeId) : undefined;
    const sameTrip = old?.network.tripId === v.tripId;
    const matched = shape
      ? nearestPointOnShape(v, shape, sameTrip ? old?.target.distance : undefined)
      : undefined;
    const snapped = matched && matched.error <= motionConfig.maxSnapMeters ? matched : undefined;
    const point = snapped ? { x: snapped.x, z: snapped.z } : projectCoordinate(v.lat, v.lon);
    const elapsed = old ? Math.max(0, (v.timestamp - old.network.timestamp) / 1000) : 0;
    const moved = old ? Math.hypot(point.x - old.target.x, point.z - old.target.z) : 0;
    const inferred =
      old && moved > 2
        ? ((Math.atan2(point.x - old.target.x, old.target.z - point.z) * 180) / Math.PI + 360) % 360
        : undefined;
    const shapeBearing =
      snapped && shape ? sampleShape(shape, snapped.distance).bearing : undefined;
    // Prefer movement/shape heading when a reported bearing contradicts observed travel by over 100°.
    let bearing = v.bearing ?? inferred ?? shapeBearing ?? old?.render.bearing ?? 0;
    if (inferred !== undefined && Math.abs(((bearing - inferred + 540) % 360) - 180) > 100)
      bearing = shapeBearing ?? inferred;
    const reset =
      !old ||
      !sameTrip ||
      moved > motionConfig.resetDistanceMeters ||
      (elapsed > 0 && moved / elapsed > 50);
    const target = { ...point, bearing, distance: snapped?.distance };
    const render = reset
      ? {
          id: v.id,
          ...point,
          ...unprojectCoordinate(point.x, point.z),
          bearing,
          alpha: 1,
          snapped: Boolean(snapped),
          network: v,
        }
      : old.render;
    const from = reset
      ? target
      : {
          x: render.x,
          z: render.z,
          bearing: render.bearing,
          distance:
            old.shape?.id === shape?.id && shape
              ? nearestPointOnShape(render, shape, old.target.distance)?.distance
              : undefined,
        };
    const duration = reset
      ? 0
      : Math.max(
          motionConfig.renderDelayMs,
          Math.min(motionConfig.maxInterpolationMs, elapsed * 1000 || 8000),
        );
    this.tracks.set(v.id, {
      network: v,
      render,
      from,
      target,
      started: now,
      duration,
      shape: snapped ? shape : undefined,
      speed: Math.max(0, Math.min(30, v.speedMps ?? (elapsed > 0 ? moved / elapsed : 0))),
    });
  }
  tick(now: number, deltaSeconds: number) {
    for (const t of this.tracks.values()) {
      if (t.network.stale) t.frozenAt ??= now;
      const progress = t.duration ? Math.min(1, Math.max(0, (now - t.started) / t.duration)) : 1;
      let x = t.from.x + (t.target.x - t.from.x) * progress,
        z = t.from.z + (t.target.z - t.from.z) * progress;
      let bearing = angleLerp(t.from.bearing, t.target.bearing, progress);
      if (t.shape && t.from.distance !== undefined && t.target.distance !== undefined) {
        let d = t.from.distance + (t.target.distance - t.from.distance) * progress;
        if (progress >= 1 && t.network.status !== 'stopped') {
          const age = Math.max(0, (t.frozenAt ?? now) - t.network.timestamp),
            atTarget = Math.max(0, t.started + t.duration - t.network.timestamp);
          // Integrate the taper; multiplying distance by a declining factor would move vehicles backwards.
          const integral = (ms: number) => {
            const s = Math.max(0, Math.min(90, ms / 1000));
            return s <= 30 ? s : 30 + (s - 30) - (s - 30) ** 2 / 120;
          };
          d += t.speed * Math.max(0, integral(age) - integral(atTarget));
          const stop = t.network.nextStop;
          if (stop?.distanceMeters !== undefined)
            d = Math.min(d, t.target.distance + stop.distanceMeters);
        }
        const p = sampleShape(t.shape, d);
        x = p.x;
        z = p.z;
        bearing = p.bearing;
      }
      t.render.x = x;
      t.render.z = z;
      Object.assign(t.render, unprojectCoordinate(x, z));
      t.render.bearing = angleLerp(t.render.bearing, bearing, Math.min(1, deltaSeconds * 4));
      t.render.network = t.network;
      t.render.snapped = Boolean(t.shape);
      t.render.alpha = t.network.missingCycles >= 3 ? 0.3 : t.network.stale ? 0.45 : 1;
    }
  }
  getVehicleState(id: string) {
    return this.tracks.get(id)?.render;
  }
}
export const simulation = new VehicleSimulation();
