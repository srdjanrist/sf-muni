import { QueryClient } from '@tanstack/react-query';
import type { NetworkPayload, TransitDelta, TransitSnapshot } from '../../shared/types';
import { useTransit } from './store';
import { backendUrl } from '../config';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15000, retry: 2, refetchOnWindowFocus: false } },
});
export async function api<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(backendUrl(`/api${url}`), { signal });
  if (!r.ok)
    throw new Error(
      r.status === 503
        ? 'Muni network is loading…'
        : r.status === 404
          ? 'This item is no longer available.'
          : 'Unable to connect. Retrying…',
    );
  return r.json() as Promise<T>;
}
export function connectRealtime(
  onVehicles: (vehicles: TransitSnapshot['vehicles'], removed?: string[]) => void,
) {
  const events = new EventSource(backendUrl('/api/realtime/stream'));
  let version: string | undefined;
  const reloadNetwork = (v?: string) => {
    if (!v || v === version) return;
    version = v;
    void api<NetworkPayload>('/network')
      .then((n) => useTransit.getState().setNetwork(n))
      .catch(() => {
        version = undefined;
      });
  };
  events.addEventListener('initial_snapshot', (e: MessageEvent<string>) => {
    const s = JSON.parse(e.data) as TransitSnapshot;
    const ids = new Set(s.vehicles.map((v) => v.id));
    const removed = [...useTransit.getState().vehicles.keys()].filter((id) => !ids.has(id));
    useTransit.getState().setSnapshot(s);
    onVehicles(s.vehicles, removed);
    reloadNetwork(s.staticVersion);
  });
  events.addEventListener('transit_delta', (e: MessageEvent<string>) => {
    const d = JSON.parse(e.data) as TransitDelta;
    useTransit.getState().applyDelta(d);
    onVehicles(d.vehicles, d.removedVehicleIds);
    reloadNetwork(d.staticVersion);
    if (d.tripsChanged) void queryClient.invalidateQueries({ queryKey: ['arrivals'] });
    if (d.tripsChanged || d.vehicles.length)
      void queryClient.invalidateQueries({ queryKey: ['vehicle'] });
  });
  events.onerror = () => useTransit.setState({ connected: false });
  return () => events.close();
}
