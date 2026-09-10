import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  ArrowUpRight,
  Navigation,
  MapPin,
  TrainFront,
  TriangleAlert,
  Radio,
  Clock3,
} from 'lucide-react';
import { api } from '../state/api';
import { transitNow, useTransit } from '../state/store';
import { age, clock, duration, eta } from './format';
import { categoryLabels } from '../../shared/categories';
import { delayLabel } from '../theme';
import type {
  ArrivalPrediction,
  ServiceAlert,
  TransitRoute,
  TransitStop,
  VehicleDetail,
  RouteStats,
} from '../../shared/types';
export function AlertCards({ alerts }: { alerts: ServiceAlert[] }) {
  return (
    <div className="alert-cards">
      {alerts.map((a) => (
        <article key={a.id}>
          <div>
            <TriangleAlert size={15} />
            <strong>{a.header}</strong>
          </div>
          {a.description && <p>{a.description}</p>}
          {a.activePeriods[0]?.start && (
            <small>
              Since {clock(a.activePeriods[0].start)} PT
              {a.activePeriods[0].end ? ` · Until ${clock(a.activePeriods[0].end)} PT` : ''}
            </small>
          )}
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer">
              Service information <ArrowUpRight size={12} />
            </a>
          )}
        </article>
      ))}
    </div>
  );
}
function Timeline({ arrivals, sequence }: { arrivals: ArrivalPrediction[]; sequence?: number }) {
  const network = useTransit((s) => s.network);
  const index =
    sequence === undefined
      ? 0
      : Math.max(0, arrivals.findIndex((a) => a.stopSequence >= sequence) - 1);
  return (
    <ol className="stop-timeline">
      {arrivals.slice(index, index + 9).map((a, i) => (
        <li
          key={`${a.stopId}-${a.stopSequence}`}
          className={`${a.stopSequence === sequence ? 'next' : ''} ${a.status === 'skipped' ? 'skipped' : ''}`}
        >
          <i />
          <div>
            <button onClick={() => useTransit.getState().select({ type: 'stop', id: a.stopId })}>
              {network?.stops.find((s) => s.id === a.stopId)?.name ?? a.stopId}
            </button>
            <small>
              {a.status === 'skipped'
                ? 'Skipped stop'
                : a.stopSequence === sequence
                  ? 'Next stop'
                  : i === 0 && index > 0
                    ? 'Previous stop'
                    : a.realtime
                      ? 'Realtime prediction'
                      : 'Scheduled'}
            </small>
          </div>
          <span>
            {a.status === 'skipped'
              ? '—'
              : eta(a.predictedArrival ?? a.scheduledArrival, transitNow())}
          </span>
        </li>
      ))}
    </ol>
  );
}
function VehicleContents({ id }: { id: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: ({ signal }) => api<VehicleDetail>(`/vehicles/${encodeURIComponent(id)}`, signal),
    refetchInterval: 10000,
  });
  if (isLoading) return <p className="panel-message">Finding this vehicle…</p>;
  if (error || !data)
    return <p className="panel-message">{error?.message ?? 'Vehicle unavailable'}</p>;
  const { vehicle: v, route: r } = data,
    now = transitNow();
  return (
    <>
      <div className="detail-route">
        <button
          className="route-badge large"
          style={{ background: r?.color, color: r?.textColor }}
          onClick={() =>
            v.routeId && useTransit.getState().select({ type: 'route', id: v.routeId })
          }
        >
          {r?.shortName ?? '?'}
        </button>
        <div>
          <span className="eyebrow">{categoryLabels[v.category]}</span>
          <h2>{r?.longName || 'Muni vehicle'}</h2>
        </div>
      </div>
      <div className="vehicle-id">
        <TrainFront size={14} />
        Vehicle {v.label || v.id}
        <span className={`status-pill ${v.stale ? 'stale' : ''}`}>
          {v.stale ? 'STALE' : v.status.replaceAll('_', ' ').toUpperCase()}
        </span>
      </div>
      <div className="destination">
        <span className="eyebrow">HEADING TO</span>
        <h3>{v.destination ?? 'Destination unavailable'}</h3>
        <ArrowUpRight size={24} />
      </div>
      <div className="next-stop-card">
        <div className="eyebrow">
          <MapPin size={12} /> {v.status === 'stopped' ? 'AT STOP' : 'NEXT STOP'}
        </div>
        <strong>{v.nextStop?.name ?? 'Not reported'}</strong>
        <div>
          <b>{eta(v.nextStop?.predictedArrival ?? v.nextStop?.scheduledArrival, now)}</b>
          <span>
            {v.nextStop?.predictedArrival
              ? 'Realtime prediction'
              : v.nextStop?.scheduledArrival
                ? 'Scheduled arrival'
                : 'ETA unavailable'}
          </span>
        </div>
      </div>
      <div className="detail-metrics">
        <div>
          <span>SCHEDULE DEVIATION</span>
          <strong className={(v.delaySeconds ?? 0) > 60 ? 'late' : ''}>
            {duration(v.delaySeconds)}
          </strong>
          <small>{delayLabel(v.delaySeconds)}</small>
        </div>
        <div>
          <span>CURRENT SPEED</span>
          <strong>
            {v.speedMps === undefined ? '—' : Math.round(v.speedMps * 3.6)}
            <small> km/h</small>
          </strong>
          <small>
            {v.speedSource === 'derived' ? 'Derived from positions' : 'Reported by feed'}
          </small>
        </div>
      </div>
      <button className="primary-button" onClick={() => useTransit.setState({ following: v.id })}>
        <Navigation size={15} />
        Follow vehicle
        <ArrowUpRight size={15} />
      </button>
      <div className="section-heading">
        <span>TRIP PROGRESS</span>
        <span>{data.timeline.length} STOPS</span>
      </div>
      <Timeline arrivals={data.timeline} sequence={v.stopSequence} />
      <AlertCards alerts={data.alerts} />
      <details className="technical-details">
        <summary>Vehicle telemetry</summary>
        <dl>
          <dt>Vehicle ID</dt>
          <dd>{v.id}</dd>
          <dt>Trip ID</dt>
          <dd>{v.tripId ?? 'Not reported'}</dd>
          <dt>Position</dt>
          <dd>
            {v.lat.toFixed(5)}, {v.lon.toFixed(5)}
          </dd>
          <dt>Bearing</dt>
          <dd>{v.bearing === undefined ? 'Not reported' : `${Math.round(v.bearing)}°`}</dd>
          <dt>Direction</dt>
          <dd>{v.directionId ?? 'Unknown'}</dd>
          <dt>Updated</dt>
          <dd>{age(v.sourceTimestamp, now)}</dd>
          <dt>Timestamp</dt>
          <dd>{v.sourceTimestamp ? new Date(v.sourceTimestamp).toISOString() : 'Not reported'}</dd>
        </dl>
      </details>
    </>
  );
}
function StopContents({ id }: { id: string }) {
  const { data, error } = useQuery({
    queryKey: ['stop', id],
    queryFn: ({ signal }) =>
      api<{ stop: TransitStop; routes: TransitRoute[]; alerts: ServiceAlert[] }>(
        `/stops/${encodeURIComponent(id)}`,
        signal,
      ),
  });
  const arrivals = useQuery({
    queryKey: ['arrivals', id],
    queryFn: ({ signal }) =>
      api<ArrivalPrediction[]>(`/stops/${encodeURIComponent(id)}/arrivals`, signal),
    refetchInterval: 15000,
  });
  if (error) return <p className="panel-message">{error.message}</p>;
  if (!data) return <p className="panel-message">Loading stop…</p>;
  return (
    <>
      <div className="eyebrow">
        <MapPin size={14} /> {data.stop.locationType === 1 ? 'STATION' : 'MUNI STOP'} ·{' '}
        {data.stop.code ?? id}
      </div>
      <h2 className="stop-title">{data.stop.name}</h2>
      <div className="stop-routes">
        {data.routes.filter(Boolean).map((r) => (
          <button
            key={r.id}
            className="route-badge"
            style={{ background: r.color, color: r.textColor }}
            onClick={() => useTransit.getState().select({ type: 'route', id: r.id })}
          >
            {r.shortName}
          </button>
        ))}
      </div>
      <div className="section-heading">
        <span>UPCOMING DEPARTURES</span>
        <span>NEXT 60 MIN</span>
      </div>
      <div className="arrival-list">
        {arrivals.isLoading && <p className="muted">Loading departures…</p>}
        {arrivals.error && <p>{arrivals.error.message}</p>}
        {arrivals.data?.length === 0 && (
          <p className="panel-message">No departures in the next hour.</p>
        )}
        {arrivals.data?.slice(0, 18).map((a) => {
          const r = data.routes.find((r) => r?.id === a.routeId),
            time =
              a.predictedDeparture ??
              a.predictedArrival ??
              a.scheduledDeparture ??
              a.scheduledArrival;
          return (
            <div className="arrival" key={`${a.instanceId}-${a.stopSequence}`}>
              <button
                className="route-badge"
                style={{ background: r?.color, color: r?.textColor }}
                onClick={() => useTransit.getState().select({ type: 'route', id: a.routeId })}
              >
                {r?.shortName ?? a.routeId}
              </button>
              <div>
                <strong>{a.destination ?? r?.longName ?? 'Destination unavailable'}</strong>
                <small>
                  {a.realtime ? <Radio size={10} /> : <Clock3 size={10} />}{' '}
                  {a.realtime ? 'Realtime' : 'Scheduled'}
                  {a.delaySeconds !== undefined ? ` · ${duration(a.delaySeconds)}` : ''}
                </small>
              </div>
              <b>
                {eta(time, transitNow())}
                <small>{time ? clock(time) : '—'}</small>
              </b>
            </div>
          );
        })}
      </div>
      <AlertCards alerts={data.alerts} />
    </>
  );
}
function RouteContents({ id }: { id: string }) {
  const { data, error } = useQuery({
    queryKey: ['route', id],
    queryFn: ({ signal }) =>
      api<{
        route: TransitRoute;
        stats?: RouteStats;
        stops: TransitStop[];
        alerts: ServiceAlert[];
      }>(`/routes/${encodeURIComponent(id)}`, signal),
    refetchInterval: 15000,
  });
  const allVehicles = useTransit((s) => s.snapshot?.vehicles);
  const vehicles = allVehicles?.filter((v) => v.routeId === id) ?? [];
  if (error) return <p>{error.message}</p>;
  if (!data) return <p className="panel-message">Loading route…</p>;
  const r = data.route;
  return (
    <>
      <div className="detail-route">
        <span className="route-badge large" style={{ background: r.color, color: r.textColor }}>
          {r.shortName}
        </span>
        <div>
          <span className="eyebrow">ROUTE FOCUS · {categoryLabels[r.category]}</span>
          <h2>{r.longName || r.shortName}</h2>
        </div>
      </div>
      <p className="panel-intro">Following the line across San Francisco.</p>
      <div className="route-kpis">
        <div>
          <strong>{data.stats?.activeVehicles ?? 0}</strong>
          <span>ACTIVE VEHICLES</span>
        </div>
        <div>
          <strong>{data.stats?.delayedVehicles ?? 0}</strong>
          <span>DELAYED</span>
        </div>
        <div>
          <strong>{duration(data.stats?.averageDelaySeconds)}</strong>
          <span>AVERAGE DELAY</span>
        </div>
        <div>
          <strong>
            {data.stats?.averageSpeedMps === undefined
              ? '—'
              : Math.round(data.stats.averageSpeedMps * 3.6)}
          </strong>
          <span>AVG SPEED · KM/H</span>
        </div>
      </div>
      <div className="direction-counts">
        <span>
          Direction 0 <b>{data.stats?.inboundVehicles ?? 0}</b>
        </span>
        <span>
          Direction 1 <b>{data.stats?.outboundVehicles ?? 0}</b>
        </span>
      </div>
      <div className="section-heading">
        <span>VEHICLES ON THIS ROUTE</span>
        <span>{vehicles.length}</span>
      </div>
      <div className="route-vehicles">
        {vehicles.map((v) => (
          <button
            key={v.id}
            onClick={() => useTransit.getState().select({ type: 'vehicle', id: v.id })}
          >
            <TrainFront size={16} />
            <span>
              <strong>{v.label || v.id}</strong>
              <small>{v.destination ?? 'Destination unavailable'}</small>
            </span>
            <b>{v.stale ? 'Stale' : duration(v.delaySeconds)}</b>
            <ArrowUpRight size={14} />
          </button>
        ))}
        {!vehicles.length && <p>No vehicles currently reported on this route.</p>}
      </div>
      <AlertCards alerts={data.alerts} />
      <details className="technical-details">
        <summary>Stops on this route ({data.stops.length})</summary>
        {data.stops.map((s) => (
          <button
            className="stop-link"
            key={s.id}
            onClick={() => useTransit.getState().select({ type: 'stop', id: s.id })}
          >
            <MapPin size={12} />
            {s.name}
          </button>
        ))}
      </details>
    </>
  );
}
export function DetailPanel() {
  const selection = useTransit((s) => s.selection),
    showAlerts = useTransit((s) => s.showAlerts),
    alerts = useTransit((s) => s.snapshot?.alerts);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!selection && !showAlerts) return null;
  return (
    <aside
      className="detail-panel surface"
      aria-label={showAlerts ? 'Service alerts' : `${selection!.type} details`}
      data-testid="detail-panel"
    >
      <div className="detail-top">
        <span className="eyebrow">
          {showAlerts ? 'NETWORK ADVISORIES' : `${selection!.type.toUpperCase()} DETAILS`}
        </span>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={() => {
            useTransit.getState().select(null);
            useTransit.setState({ showAlerts: false });
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="detail-scroll">
        {showAlerts ? (
          <>
            <h2 className="stop-title">Service alerts</h2>
            <p className="panel-intro">Advisories affecting the network.</p>
            <AlertCards alerts={alerts ?? []} />
            {!alerts?.length && <p className="panel-message">No active advisories reported.</p>}
          </>
        ) : selection?.type === 'vehicle' ? (
          <VehicleContents id={selection.id} />
        ) : selection?.type === 'stop' ? (
          <StopContents id={selection.id} />
        ) : selection?.type === 'route' ? (
          <RouteContents id={selection.id} />
        ) : null}
      </div>
      <div className="detail-footer">
        <span className="connection-dot connected" />{' '}
        {useTransit.getState().snapshot?.status.source === 'fixture'
          ? 'PLAYBACK · NOT LIVE'
          : '511 SF BAY · TRANSIT TELEMETRY'}
      </div>
    </aside>
  );
}
