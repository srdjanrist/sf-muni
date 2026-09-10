import type { ShapePoint, TransitShape } from './types.js';
export const ORIGIN = { lat: 37.7749, lon: -122.4194 };
const R = 6378137;
const RAD = Math.PI / 180;
const SCALE = Math.cos(ORIGIN.lat * RAD);
const mercatorY = (lat: number) =>
  R * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2));
export function projectCoordinate(lat: number, lon: number) {
  return {
    x: R * (lon - ORIGIN.lon) * RAD * SCALE,
    z: (mercatorY(ORIGIN.lat) - mercatorY(lat)) * SCALE,
  };
}
export function unprojectCoordinate(x: number, z: number) {
  return {
    lon: ORIGIN.lon + x / (R * SCALE * RAD),
    lat: (2 * Math.atan(Math.exp((mercatorY(ORIGIN.lat) - z / SCALE) / R)) - Math.PI / 2) / RAD,
  };
}
export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = (b.lat - a.lat) * RAD,
    dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function makeShape(
  id: string,
  coords: { lat: number; lon: number; sequence: number }[],
): TransitShape {
  coords.sort((a, b) => a.sequence - b.sequence);
  let distance = 0;
  const points = coords.map((p, i): ShapePoint => {
    if (i) distance += distanceMeters(coords[i - 1], p);
    return { ...p, ...projectCoordinate(p.lat, p.lon), distance };
  });
  return { id, points, totalDistanceMeters: distance };
}
export function sampleShape(shape: TransitShape, distance: number) {
  const points = shape.points;
  if (points.length < 2) return { ...points[0], bearing: 0 };
  const d = Math.max(0, Math.min(distance, shape.totalDistanceMeters));
  let low = 0,
    high = points.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >>> 1;
    if (points[mid].distance <= d) low = mid;
    else high = mid;
  }
  const a = points[low],
    b = points[high],
    t = (d - a.distance) / (b.distance - a.distance || 1);
  const x = a.x + (b.x - a.x) * t,
    z = a.z + (b.z - a.z) * t;
  return {
    x,
    z,
    ...unprojectCoordinate(x, z),
    bearing: (Math.atan2(b.x - a.x, a.z - b.z) / RAD + 360) % 360,
  };
}
export function nearestPointOnShape(
  position: { lat: number; lon: number },
  shape: TransitShape,
  previousDistance?: number,
) {
  const p = projectCoordinate(position.lat, position.lon);
  let best:
    | { distance: number; error: number; segment: number; x: number; z: number; score: number }
    | undefined;
  for (let i = 0; i < shape.points.length - 1; i++) {
    const a = shape.points[i],
      b = shape.points[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
    );
    const x = a.x + t * dx,
      z = a.z + t * dz,
      error = Math.hypot(p.x - x, p.z - z),
      distance = a.distance + t * (b.distance - a.distance);
    // A small progress penalty disambiguates loops without dragging off-route GPS onto a distant segment.
    const score =
      error +
      (previousDistance === undefined
        ? 0
        : Math.min(Math.abs(distance - previousDistance) * 0.025, 60));
    if (!best || score < best.score) best = { x, z, error, distance, segment: i, score };
  }
  return best;
}
export function angleLerp(a: number, b: number, t: number) {
  return (a + (((b - a + 540) % 360) - 180) * t + 360) % 360;
}
export function simplifyLine(points: [number, number][], tolerance = 0.00003): [number, number][] {
  if (points.length <= 2) return points;
  const keep = new Set([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start],
      b = points[end],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    let max = tolerance ** 2,
      index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      );
      const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep.add(index);
      stack.push([start, index], [index, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
