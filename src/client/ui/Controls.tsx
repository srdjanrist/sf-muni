import {
  Activity,
  Layers2,
  Gauge,
  TriangleAlert,
  Radio,
  Plus,
  Minus,
  LocateFixed,
  Compass,
  X,
  RotateCcw,
} from 'lucide-react';
import { cityMap, resetCityView } from '../map/CityMap';
import { useTransit, type Mode } from '../state/store';
import { categoryLabels } from '../../shared/categories';
export function ModeBar() {
  const mode = useTransit((s) => s.mode),
    setMode = useTransit((s) => s.setMode);
  return (
    <nav className="modebar surface" aria-label="Visualization mode">
      {(
        [
          { id: 'live', label: 'Live', icon: Radio },
          { id: 'routes', label: 'Routes', icon: Layers2 },
          { id: 'delay', label: 'Delay', icon: Activity },
          { id: 'speed', label: 'Speed', icon: Gauge },
          { id: 'alerts', label: 'Alerts', icon: TriangleAlert },
        ] as const
      ).map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? 'active' : ''}
          onClick={() => setMode(m.id as Mode)}
          aria-pressed={mode === m.id}
        >
          <m.icon size={15} />
          <span>{m.label}</span>
        </button>
      ))}
    </nav>
  );
}
export function MapControls() {
  const following = useTransit((s) => s.following);
  return (
    <>
      <div className="map-controls surface">
        <button aria-label="Zoom in" onClick={() => cityMap?.zoomIn()}>
          <Plus size={18} />
        </button>
        <button aria-label="Zoom out" onClick={() => cityMap?.zoomOut()}>
          <Minus size={18} />
        </button>
        <hr />
        <button
          aria-label="Reset north"
          onClick={() => cityMap?.easeTo({ bearing: 0, duration: 600 })}
        >
          <Compass size={18} />
        </button>
        <button aria-label="Reset city view" onClick={resetCityView}>
          <LocateFixed size={18} />
        </button>
        <button
          aria-label="Toggle map tilt"
          onClick={() =>
            cityMap?.easeTo({ pitch: cityMap.getPitch() > 30 ? 0 : 60, duration: 700 })
          }
        >
          <span className="tilt-icon">3D</span>
        </button>
      </div>
      {following && (
        <button
          className="follow-banner surface"
          onClick={() => useTransit.setState({ following: null })}
        >
          <span className="connection-dot connected" />
          Following {following}
          <X size={15} />
        </button>
      )}
    </>
  );
}
export function Filters() {
  const visible = useTransit((s) => s.showFilters),
    filters = useTransit((s) => s.filters),
    set = useTransit((s) => s.setFilters),
    network = useTransit((s) => s.network);
  if (!visible) return null;
  return (
    <section className="filter-popover surface" aria-label="Network filters">
      <div className="popover-title">
        <h2>Filter the network</h2>
        <button
          className="icon-button"
          aria-label="Close filters"
          onClick={() => useTransit.setState({ showFilters: false })}
        >
          <X size={16} />
        </button>
      </div>
      <label>
        ROUTES
        <select
          aria-label="Route filter"
          value={filters.routes.length === 1 ? filters.routes[0] : ''}
          onChange={(e) => set({ routes: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">All routes</option>
          {network?.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.shortName} {r.longName}
            </option>
          ))}
        </select>
      </label>
      <div className="filter-route-chips">
        {network?.routes
          .filter((r) => r.category === 'light_rail' || r.category === 'streetcar')
          .map((r) => (
            <button
              key={r.id}
              className={filters.routes.includes(r.id) ? 'active' : ''}
              onClick={() =>
                set({
                  routes: filters.routes.includes(r.id)
                    ? filters.routes.filter((id) => id !== r.id)
                    : [...filters.routes, r.id],
                })
              }
            >
              {r.shortName}
            </button>
          ))}
      </div>
      <label>SERVICE TYPE</label>
      <div className="chip-group">
        {Object.entries(categoryLabels)
          .filter(([id]) => id !== 'unknown')
          .map(([id, label]) => (
            <button
              key={id}
              className={
                filters.categories.includes(id as keyof typeof categoryLabels) ? 'active' : ''
              }
              onClick={() =>
                set({
                  categories: filters.categories.includes(id as keyof typeof categoryLabels)
                    ? filters.categories.filter((c) => c !== id)
                    : [...filters.categories, id as keyof typeof categoryLabels],
                })
              }
            >
              {label}
            </button>
          ))}
      </div>
      <div className="filter-grid">
        <label>
          DIRECTION
          <select
            aria-label="Direction filter"
            value={filters.direction}
            onChange={(e) => set({ direction: e.target.value })}
          >
            <option value="all">Both directions</option>
            <option value="0">Direction 0</option>
            <option value="1">Direction 1</option>
          </select>
        </label>
        <label>
          STATUS
          <select
            aria-label="Status filter"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as typeof filters.status })}
          >
            <option value="all">All statuses</option>
            <option value="in_transit">In transit</option>
            <option value="incoming">Incoming</option>
            <option value="stopped">At stop</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>
      <label>
        DELAY
        <select
          aria-label="Delay filter"
          value={filters.delay}
          onChange={(e) => set({ delay: e.target.value as typeof filters.delay })}
        >
          <option value="all">Any delay</option>
          <option value="late">More than 1 min late</option>
          <option value="severe">More than 5 min late</option>
          <option value="unknown">Unknown delay</option>
        </select>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={filters.alertsOnly}
          onChange={(e) => set({ alertsOnly: e.target.checked })}
        />{' '}
        Affected by a service alert
      </label>
      <button className="secondary-button" onClick={() => useTransit.getState().resetFilters()}>
        <RotateCcw size={14} /> Reset filters
      </button>
    </section>
  );
}
export function Settings() {
  const visible = useTransit((s) => s.showSettings),
    settings = useTransit((s) => s.settings),
    set = useTransit((s) => s.setSettings);
  if (!visible) return null;
  return (
    <section className="settings-popover surface" aria-label="Display settings">
      <div className="popover-title">
        <h2>Make it your view</h2>
        <button
          className="icon-button"
          aria-label="Close settings"
          onClick={() => useTransit.setState({ showSettings: false })}
        >
          <X size={16} />
        </button>
      </div>
      {(
        [
          { id: 'buildings', label: '3D buildings' },
          { id: 'routes', label: 'Route network' },
          { id: 'stops', label: 'Stops & stations' },
          { id: 'labels', label: 'Vehicle labels' },
          { id: 'stats', label: 'Network statistics' },
          { id: 'reduced', label: 'Reduced graphics' },
        ] as const
      ).map((s) => (
        <label key={s.id} className="setting-row">
          <span>{s.label}</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings[s.id]}
            onChange={(e) => set({ [s.id]: e.target.checked })}
          />
        </label>
      ))}
      <p>Drag to pan. Right-drag to rotate and tilt. Scroll to explore.</p>
      <p className="muted">
        Buildings use mapped footprints. Missing heights use representative extrusions. Terrain and
        underground cutaways are not enabled.
      </p>
    </section>
  );
}
