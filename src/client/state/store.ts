import { create } from 'zustand';
import type {
  NetworkPayload,
  TransitSnapshot,
  VehicleCategory,
  VehicleState,
  VehicleStatus,
  TransitDelta,
} from '../../shared/types';
export type Mode = 'live' | 'routes' | 'delay' | 'speed' | 'alerts';
export type Selection = { type: 'vehicle' | 'route' | 'stop'; id: string } | null;
export interface Filters {
  routes: string[];
  categories: VehicleCategory[];
  direction: string;
  status: VehicleStatus | 'all';
  delay: 'all' | 'late' | 'severe' | 'unknown';
  alertsOnly: boolean;
}
export interface Settings {
  buildings: boolean;
  routes: boolean;
  stops: boolean;
  labels: boolean;
  stats: boolean;
  reduced: boolean;
}
const initialFilters: Filters = {
  routes: [],
  categories: [],
  direction: 'all',
  status: 'all',
  delay: 'all',
  alertsOnly: false,
};
const initialSettings: Settings = {
  buildings: true,
  routes: true,
  stops: true,
  labels: true,
  stats: true,
  reduced: navigator.hardwareConcurrency <= 4 || matchMedia('(max-width:600px)').matches,
};
function initialUrl() {
  const p = new URLSearchParams(location.search);
  const type = (['vehicle', 'stop', 'route'] as const).find((t) => p.has(t));
  return {
    selection: type ? { type, id: p.get(type)! } : null,
    mode: (['live', 'routes', 'delay', 'speed', 'alerts'].includes(p.get('mode') ?? '')
      ? p.get('mode')
      : 'live') as Mode,
  };
}
function settings() {
  try {
    return { ...initialSettings, ...JSON.parse(localStorage.getItem('muni.settings') ?? '{}') };
  } catch {
    return initialSettings;
  }
}
export const useTransit = create<{
  network?: NetworkPayload;
  snapshot?: TransitSnapshot;
  vehicles: Map<string, VehicleState>;
  connected: boolean;
  offset: number;
  selection: Selection;
  mode: Mode;
  filters: Filters;
  settings: Settings;
  following: string | null;
  showFilters: boolean;
  showSettings: boolean;
  showAlerts: boolean;
  setNetwork: (n: NetworkPayload) => void;
  setSnapshot: (s: TransitSnapshot) => void;
  applyDelta: (d: TransitDelta) => void;
  select: (s: Selection) => void;
  setMode: (m: Mode) => void;
  setFilters: (f: Partial<Filters>) => void;
  setSettings: (s: Partial<Settings>) => void;
  resetFilters: () => void;
}>((set, get) => ({
  ...initialUrl(),
  network: undefined,
  snapshot: undefined,
  vehicles: new Map(),
  connected: false,
  offset: 0,
  filters: initialFilters,
  settings: settings(),
  following: null,
  showFilters: false,
  showSettings: false,
  showAlerts: false,
  setNetwork: (network) => set({ network }),
  setSnapshot: (snapshot) =>
    set({
      snapshot,
      vehicles: new Map(snapshot.vehicles.map((v) => [v.id, v])),
      offset: snapshot.status.now - Date.now(),
      connected: true,
    }),
  applyDelta: (d) => {
    const old = get().snapshot;
    if (!old || d.version <= old.version) return;
    const vehicles = new Map(get().vehicles);
    d.removedVehicleIds.forEach((id) => vehicles.delete(id));
    d.vehicles.forEach((v) => vehicles.set(v.id, v));
    set({
      vehicles,
      snapshot: {
        ...old,
        version: d.version,
        staticVersion: d.staticVersion,
        vehicles: [...vehicles.values()],
        alerts: d.alerts ?? old.alerts,
        stats: d.stats,
        status: d.status,
      },
      offset: d.status.now - Date.now(),
      connected: true,
    });
  },
  select: (selection) => {
    set({ selection, following: null, showAlerts: false });
    const url = new URL(location.href);
    ['route', 'vehicle', 'stop'].forEach((k) => url.searchParams.delete(k));
    if (selection) url.searchParams.set(selection.type, selection.id);
    history.replaceState(null, '', url);
  },
  setMode: (mode) => {
    set({ mode });
    const url = new URL(location.href);
    if (mode === 'live') url.searchParams.delete('mode');
    else url.searchParams.set('mode', mode);
    history.replaceState(null, '', url);
  },
  setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
  resetFilters: () => set({ filters: { ...initialFilters } }),
  setSettings: (s) => {
    const next = { ...get().settings, ...s };
    localStorage.setItem('muni.settings', JSON.stringify(next));
    set({ settings: next });
  },
}));
window.addEventListener('popstate', () => useTransit.setState(initialUrl()));
export function matchesVehicle(v: VehicleState, f: Filters, alertRoutes: Set<string>) {
  return (
    (!f.routes.length || Boolean(v.routeId && f.routes.includes(v.routeId))) &&
    (!f.categories.length || f.categories.includes(v.category)) &&
    (f.direction === 'all' || String(v.directionId) === f.direction) &&
    (f.status === 'all' || v.status === f.status) &&
    (f.delay === 'all' ||
      (f.delay === 'unknown' && v.delaySeconds === undefined) ||
      (f.delay === 'late' && (v.delaySeconds ?? 0) > 60) ||
      (f.delay === 'severe' && (v.delaySeconds ?? 0) > 300)) &&
    (!f.alertsOnly || Boolean(v.routeId && alertRoutes.has(v.routeId)))
  );
}
export const transitNow = () => Date.now() + useTransit.getState().offset;
