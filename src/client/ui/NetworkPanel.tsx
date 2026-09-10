import { useState } from 'react';
import { ArrowUpRight, ChevronDown, TrainFront, BusFront, CableCar, Radio, X } from 'lucide-react';
import { useTransit } from '../state/store';
import { categoryLabels } from '../../shared/categories';
import type { VehicleCategory } from '../../shared/types';
export function NetworkPanel() {
  const network = useTransit((s) => s.network),
    snapshot = useTransit((s) => s.snapshot),
    selection = useTransit((s) => s.selection),
    filters = useTransit((s) => s.filters),
    select = useTransit((s) => s.select),
    setFilters = useTransit((s) => s.setFilters);
  const [expanded, setExpanded] = useState(false);
  const stats = snapshot?.stats;
  const routes = [...(network?.routes ?? [])].sort((a, b) => {
    const priority = (c: string) =>
      c === 'light_rail' ? 0 : c === 'streetcar' ? 1 : c === 'cable_car' ? 2 : 3;
    return (
      priority(a.category) - priority(b.category) ||
      a.shortName.localeCompare(b.shortName, undefined, { numeric: true })
    );
  });
  return (
    <aside className="network-panel surface" aria-label="Network overview">
      <div className="eyebrow">
        <span className="tiny-square" /> SYSTEM OVERVIEW <span className="small-number">01</span>
      </div>
      <h1>
        San Francisco<span>in motion.</span>
      </h1>
      <p className="panel-intro">One city. An entire network.</p>
      <div className="source-note">
        <Radio size={14} />
        <span>
          {snapshot?.status.source === 'fixture'
            ? 'FIXTURE PLAYBACK'
            : '511 SF BAY · OFFICIAL FEED'}
        </span>
      </div>
      <div className="network-summary">
        <div>
          <strong>{stats?.activeVehicles ?? '—'}</strong>
          <span>active vehicles</span>
        </div>
        <div className="activity-bars" aria-hidden="true">
          {[30, 48, 24, 55, 38, 65, 48, 75, 54, 65, 42, 60, 36].map((h, i) => (
            <i key={i} style={{ height: h + '%', animationDelay: `${i * 0.14}s` }} />
          ))}
        </div>
      </div>
      <div className="section-heading">
        <span>SERVICE TYPES</span>
        {filters.categories.length > 0 && (
          <button onClick={() => setFilters({ categories: [] })}>Reset</button>
        )}
      </div>
      <div className="type-list">
        {(
          [
            'light_rail',
            'streetcar',
            'cable_car',
            'bus',
            'trolleybus',
            ...(stats?.byVehicleType.unknown ? ['unknown'] : []),
          ] as VehicleCategory[]
        ).map((c) => {
          const Icon =
            c === 'bus' || c === 'trolleybus'
              ? BusFront
              : c === 'cable_car'
                ? CableCar
                : TrainFront;
          return (
            <button
              key={c}
              className={filters.categories.includes(c) ? 'selected' : ''}
              onClick={() =>
                setFilters({
                  categories: filters.categories.includes(c)
                    ? filters.categories.filter((t) => t !== c)
                    : [...filters.categories, c],
                })
              }
            >
              <Icon size={15} />
              <span>{categoryLabels[c]}</span>
              <b>{stats?.byVehicleType[c] ?? 0}</b>
              <i className="type-check" />
            </button>
          );
        })}
      </div>
      <div className="section-heading routes-heading">
        <span>EXPLORE ROUTES</span>
        <span>{network?.routes.length ?? '—'}</span>
      </div>
      <div className={`route-list ${expanded ? 'expanded' : ''}`}>
        {routes.slice(0, expanded ? undefined : 9).map((r) => {
          const n = stats?.routes.find((s) => s.routeId === r.id)?.activeVehicles ?? 0;
          return (
            <button
              className={`route-row ${selection?.type === 'route' && selection.id === r.id ? 'selected' : ''}`}
              key={r.id}
              onClick={() => select({ type: 'route', id: r.id })}
            >
              <span className="route-badge" style={{ background: r.color, color: r.textColor }}>
                {r.shortName}
              </span>
              <span className="route-row-name">{r.longName || r.shortName}</span>
              <small>{n}</small>
              <ArrowUpRight size={13} />
            </button>
          );
        })}
      </div>
      <button className="all-routes" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show key routes' : 'Explore all routes'}
        <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
      </button>
      {selection?.type === 'route' && (
        <button className="clear-focus" onClick={() => select(null)}>
          <X size={13} /> Exit route focus
        </button>
      )}
    </aside>
  );
}
