import type { TransitRoute, VehicleCategory } from './types.js';
const metadata: Record<string, VehicleCategory> = {
  J: 'light_rail',
  K: 'light_rail',
  L: 'light_rail',
  M: 'light_rail',
  N: 'light_rail',
  T: 'light_rail',
  F: 'streetcar',
  E: 'streetcar',
};
export function getVehicleCategory(
  route: Pick<TransitRoute, 'type' | 'shortName'>,
): VehicleCategory {
  if (route.type === 5) return 'cable_car';
  if (route.type === 11 || route.type === 800) return 'trolleybus';
  if (route.type === 0 || route.type === 900) return metadata[route.shortName] ?? 'light_rail';
  if (route.type === 3 || (route.type >= 700 && route.type <= 716)) return 'bus';
  return 'unknown';
}
export const categoryLabels: Record<VehicleCategory, string> = {
  light_rail: 'Metro',
  streetcar: 'Streetcar',
  cable_car: 'Cable car',
  bus: 'Bus',
  trolleybus: 'Trolleybus',
  unknown: 'Unknown',
};
