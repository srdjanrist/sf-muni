import { Activity, BusFront, Route, TriangleAlert, ArrowUpRight } from 'lucide-react';
import { useTransit } from '../state/store';
import { duration } from './format';
export function StatsBar() {
  const snapshot = useTransit((s) => s.snapshot),
    show = useTransit((s) => s.settings.stats);
  if (!show) return null;
  const s = snapshot?.stats;
  return (
    <footer className="statsbar surface">
      <div className="stat-cell">
        <BusFront size={17} />
        <div>
          <strong>{s?.activeVehicles ?? '—'}</strong>
          <span>ACTIVE VEHICLES</span>
        </div>
        <small>{s?.movingVehicles ?? 0} moving</small>
      </div>
      <div className="stat-cell">
        <Route size={17} />
        <div>
          <strong>{s?.activeRoutes ?? '—'}</strong>
          <span>ACTIVE ROUTES</span>
        </div>
        <small>across the city</small>
      </div>
      <div className="stat-cell">
        <Activity size={17} />
        <div>
          <strong>{duration(s?.averageDelaySeconds)}</strong>
          <span>AVERAGE DELAY</span>
        </div>
        <small>{s?.delaySampleCount ?? 0} observations</small>
      </div>
      <button
        className="stat-cell alerts-stat"
        onClick={() => useTransit.setState((s) => ({ showAlerts: !s.showAlerts }))}
      >
        <TriangleAlert size={17} />
        <div>
          <strong>{s?.activeAlerts ?? '—'}</strong>
          <span>SERVICE ALERTS</span>
        </div>
        <ArrowUpRight size={16} />
      </button>
      <div className="stats-source">
        <span className="eyebrow">
          {snapshot?.status.source === 'fixture' ? 'PLAYBACK OBSERVATIONS' : 'NETWORK TELEMETRY'}
        </span>
        <span>
          {snapshot?.status.source === 'fixture'
            ? snapshot.status.playback === 'recorded'
              ? 'Historical 511 observation'
              : 'Official geography · synthetic motion'
            : 'Powered by 511 SF Bay'}
        </span>
      </div>
    </footer>
  );
}
