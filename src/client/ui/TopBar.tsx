import { ShowcaseControl } from './ShowcaseControl';
import { useEffect, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Settings2,
  TrainFront,
  MapPin,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../state/api';
import { useTransit } from '../state/store';
import type { SearchResult } from '../../shared/types';
export function TopBar() {
  const source = useTransit((s) => s.snapshot?.status.source),
    connected = useTransit((s) => s.connected),
    select = useTransit((s) => s.select),
    filters = useTransit((s) => s.filters);
  const [query, setQuery] = useState(''),
    [term, setTerm] = useState(''),
    [open, setOpen] = useState(false),
    [wallNow, setNow] = useState(Date.now());
  const offset = useTransit((s) => s.offset),
    now = wallNow + offset;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === 'Escape') {
        setOpen(false);
        useTransit.setState({ showFilters: false, showSettings: false, following: null });
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const { data: results, isFetching } = useQuery({
    queryKey: ['search', term],
    queryFn: ({ signal }) => api<SearchResult[]>(`/search?q=${encodeURIComponent(term)}`, signal),
    enabled: term.trim().length > 0,
  });
  const choose = (r: SearchResult) => {
    select({ type: r.type, id: r.id });
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };
  const filterCount =
    filters.routes.length +
    filters.categories.length +
    Number(filters.direction !== 'all') +
    Number(filters.status !== 'all') +
    Number(filters.delay !== 'all') +
    Number(filters.alertsOnly);
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Muni Live home">
        <span className="brand-mark">
          <TrainFront size={23} strokeWidth={1.6} />
        </span>
        <span>
          MUNI<span className="brand-light">LIVE</span>
          <small>SAN FRANCISCO</small>
        </span>
      </a>
      <div className="search-wrap">
        <Search size={17} />
        <input
          ref={input}
          aria-label="Search routes, stops, vehicles"
          placeholder="Find a route, stop, or vehicle"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) choose(results[0]);
          }}
        />
        <kbd>⌘ K</kbd>
        {open && query && (
          <div className="search-results">
            <div className="eyebrow">
              {isFetching ? 'Searching network…' : `${results?.length ?? 0} RESULTS`}
            </div>
            {results?.map((r) => (
              <button key={`${r.type}-${r.id}`} onClick={() => choose(r)}>
                {r.type === 'stop' ? <MapPin size={16} /> : <TrainFront size={16} />}
                <span>
                  <strong>{r.title}</strong>
                  <small>{r.subtitle}</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            {!isFetching && !results?.length && <p>No matching routes, stops, or vehicles.</p>}
            <button className="close-search" onClick={() => setOpen(false)}>
              <X size={12} /> Close search
            </button>
          </div>
        )}
      </div>
      <div className="top-actions">
        <ShowcaseControl />
        <button
          className={`text-button ${filterCount ? 'active' : ''}`}
          onClick={() =>
            useTransit.setState((s) => ({ showFilters: !s.showFilters, showSettings: false }))
          }
        >
          <SlidersHorizontal size={16} /> <span>Filters</span>
          {filterCount > 0 && <b>{filterCount}</b>}
        </button>
        <button
          className="icon-button"
          aria-label="Display settings"
          onClick={() =>
            useTransit.setState((s) => ({ showSettings: !s.showSettings, showFilters: false }))
          }
        >
          <Settings2 size={18} />
        </button>
        <div className="sf-clock">
          <strong>
            {new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Los_Angeles',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }).format(now)}
          </strong>
          <span>{source === 'fixture' ? 'PLAYBACK TIME' : 'SAN FRANCISCO · PT'}</span>
        </div>
        <span
          className={`connection-dot ${connected ? 'connected' : ''}`}
          title={connected ? 'Stream connected' : 'Reconnecting'}
        />
      </div>
    </header>
  );
}
