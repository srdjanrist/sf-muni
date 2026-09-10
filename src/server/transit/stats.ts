import type { NetworkStats, RouteStats, ServiceAlert, VehicleState } from '../../shared/types.js';
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
export function alertActive(alert: ServiceAlert, now: number) {
  return (
    !alert.activePeriods.length ||
    alert.activePeriods.some(
      (p) => (p.start === undefined || now >= p.start) && (p.end === undefined || now < p.end),
    )
  );
}
export function computeStats(
  vehicles: VehicleState[],
  alerts: ServiceAlert[],
  now: number,
): NetworkStats {
  const active = vehicles.filter((v) => !v.stale && !v.missingSince);
  const delays = active
    .flatMap((v) => (v.delaySeconds === undefined ? [] : [v.delaySeconds]))
    .sort((a, b) => a - b);
  const speeds = active.flatMap((v) => (v.speedMps === undefined ? [] : [v.speedMps]));
  const byVehicleType: NetworkStats['byVehicleType'] = {
    light_rail: 0,
    streetcar: 0,
    cable_car: 0,
    bus: 0,
    trolleybus: 0,
    unknown: 0,
  };
  for (const v of active) byVehicleType[v.category]++;
  const routeIds = [...new Set(active.flatMap((v) => (v.routeId ? [v.routeId] : [])))];
  const routes = routeIds.map((routeId): RouteStats => {
    const vs = active.filter((v) => v.routeId === routeId);
    return {
      routeId,
      activeVehicles: vs.length,
      delayedVehicles: vs.filter((v) => (v.delaySeconds ?? -Infinity) > 60).length,
      averageDelaySeconds: mean(
        vs.flatMap((v) => (v.delaySeconds === undefined ? [] : [v.delaySeconds])),
      ),
      averageSpeedMps: mean(vs.flatMap((v) => (v.speedMps === undefined ? [] : [v.speedMps]))),
      inboundVehicles: vs.filter((v) => v.directionId === 0).length,
      outboundVehicles: vs.filter((v) => v.directionId === 1).length,
    };
  });
  return {
    timestamp: now,
    activeVehicles: active.length,
    activeTrips: new Set(
      active.flatMap((v) => (v.instanceId ? [v.instanceId] : v.tripId ? [v.tripId] : [])),
    ).size,
    activeRoutes: routeIds.length,
    movingVehicles: active.filter((v) => v.speedMps !== undefined && v.speedMps > 0.5).length,
    stoppedVehicles: active.filter((v) => v.status === 'stopped').length,
    delayedVehicles: delays.filter((d) => d > 60).length,
    severelyDelayedVehicles: delays.filter((d) => d > 300).length,
    averageDelaySeconds: mean(delays),
    medianDelaySeconds: delays.length
      ? (delays[Math.floor((delays.length - 1) / 2)] + delays[Math.ceil((delays.length - 1) / 2)]) /
        2
      : undefined,
    p95DelaySeconds: delays.length
      ? delays[Math.max(0, Math.ceil(delays.length * 0.95) - 1)]
      : undefined,
    averageSpeedMps: mean(speeds),
    delaySampleCount: delays.length,
    speedSampleCount: speeds.length,
    activeAlerts: alerts.filter((a) => alertActive(a, now)).length,
    byVehicleType,
    routes,
  };
}
