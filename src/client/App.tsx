import { useEffect, useState } from 'react';
import { Radio, Info, ArrowUpRight } from 'lucide-react';
import { CityMap } from './map/CityMap';
import { TopBar } from './ui/TopBar';
import { NetworkPanel } from './ui/NetworkPanel';
import { ModeBar, MapControls, Filters, Settings } from './ui/Controls';
import { StatsBar } from './ui/StatsBar';
import { DetailPanel } from './ui/DetailPanel';
import { useTransit } from './state/store';
import { age } from './ui/format';
import { renderMetrics } from './map/VehicleLayer';
function Debug() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <pre className="debug-panel">
      {JSON.stringify(
        {
          ...renderMetrics,
          networkVehicles: useTransit.getState().vehicles.size,
          shapes: useTransit.getState().network?.shapes.length,
        },
        null,
        2,
      )}
    </pre>
  );
}
export default function App() {
  const source = useTransit((s) => s.snapshot?.status.source),
    snapshot = useTransit((s) => s.snapshot),
    connected = useTransit((s) => s.connected),
    mode = useTransit((s) => s.mode),
    selection = useTransit((s) => s.selection),
    offset = useTransit((s) => s.offset);
  const [wallNow, setNow] = useState(Date.now());
  const now = wallNow + offset;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const feed = snapshot?.status.feeds.vehiclePositions;
  const stale =
    !connected ||
    !feed?.healthy ||
    Boolean(
      feed?.sourceTimestamp &&
      now - feed.sourceTimestamp > (snapshot?.status.staleAfterMs ?? 180000),
    );
  return (
    <main className={`app ${selection ? 'has-selection' : ''}`}>
      <CityMap />
      <TopBar />
      <div className="map-topline">
        <div className="map-location">
          <span className="eyebrow">37.7749° N · 122.4194° W</span>
          <span>San Francisco, California</span>
        </div>
        <ModeBar />
        <div className={`live-status surface ${stale ? 'stale' : ''}`}>
          <Radio size={14} />
          <strong>{source === 'fixture' ? 'PLAYBACK' : stale ? 'STALE DATA' : 'LIVE'}</strong>
          <span>{age(feed?.sourceTimestamp, now)}</span>
        </div>
      </div>
      <NetworkPanel />
      <DetailPanel />
      <MapControls />
      <Filters />
      <Settings />
      <div className="map-caption">
        <span className="eyebrow">
          {mode === 'live'
            ? 'THE NETWORK, IN MOTION'
            : mode === 'routes'
              ? 'EVERY LINE. EVERY CONNECTION.'
              : mode === 'delay'
                ? 'SCHEDULE DEVIATION'
                : mode === 'speed'
                  ? 'MOVEMENT ACROSS THE CITY'
                  : 'SERVICE DISRUPTIONS'}
        </span>
        <div className="map-legend">
          {mode === 'delay' ? (
            <>
              <i style={{ background: '#b9df82' }} />
              Within 1 min
              <i style={{ background: '#e8cc72' }} />
              1–3 min
              <i style={{ background: '#e97765' }} />
              &gt;5 min
              <i style={{ background: '#84948e' }} />
              Unknown
            </>
          ) : (
            <>
              <i className="legend-vehicle" />
              Vehicle
              <i className="legend-stop" />
              Stop
              <span className="legend-line" />
              Route
            </>
          )}
        </div>
      </div>
      {source === 'fixture' && (
        <div className="fixture-notice">
          <Info size={14} />
          <span>
            {snapshot?.status.playback === 'recorded'
              ? 'Recorded playback · Historical 511 observations'
              : 'Demo playback · Real Muni geography, simulated service'}
          </span>
          <ArrowUpRight size={13} />
        </div>
      )}
      {source === 'live' && stale && (
        <div className="fixture-notice">
          Live data unavailable · Showing last known positions and scheduled service
        </div>
      )}
      <StatsBar />
      {import.meta.env.VITE_TRANSIT_DEBUG === 'true' && <Debug />}
    </main>
  );
}
