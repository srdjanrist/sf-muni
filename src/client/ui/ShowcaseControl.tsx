import { useEffect, useState } from 'react';
import { Video, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../state/api';
import { backendUrl } from '../config';
import { useTransit } from '../state/store';
import type { ShowcaseStatus, SystemStatus } from '../../shared/types';

export function ShowcaseControl() {
  const snapshot = useTransit((s) => s.snapshot);
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [now, setNow] = useState(Date.now());
  const { data, refetch } = useQuery({
    queryKey: ['showcase-status'],
    queryFn: ({ signal }) => api<SystemStatus>('/system/status', signal),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  const status = open && data ? data : snapshot?.status;
  const burst = status?.showcase;
  const seconds = Math.max(0, Math.ceil(((burst?.endsAt ?? 0) - now) / 1000));
  const active = Boolean(burst?.active && seconds > 0);
  async function change(method: 'POST' | 'DELETE') {
    setPending(true);
    setError('');
    try {
      const response = await fetch(backendUrl('/api/system/showcase'), { method });
      if (!response.ok) throw new Error('Showcase is unavailable. Try again shortly.');
      const result = (await response.json()) as ShowcaseStatus;
      if (method === 'POST' && !result.active) setError(result.reason ?? 'Burst unavailable.');
      await refetch();
    } catch {
      setError('Showcase is unavailable. Try again shortly.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="showcase-control">
      <button
        className={`text-button ${burst?.active ? 'active' : ''}`}
        aria-label="Showcase mode"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Video size={17} />
        <span>Showcase</span>
      </button>
      {open && (
        <section className="showcase-popover surface" aria-label="Showcase controls">
          <div className="showcase-heading">
            <strong>Showcase mode</strong>
            <button
              className="icon-button"
              aria-label="Close showcase"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            Refresh vehicle GPS about every {(burst?.intervalMs ?? 20000) / 1000} seconds for{' '}
            {(burst?.durationMs ?? 60000) / 1000} seconds. Select a vehicle and press Follow to
            frame your video.
          </p>
          <p className="muted">
            Motion between observations is estimated. 511 may return unchanged positions. Arrival
            predictions keep their normal refresh rate.
          </p>
          <div role="status" aria-live="polite">
            {active ? (
              <strong>{seconds}s remaining · Faster GPS polling</strong>
            ) : (
              <p>
                {status?.source === 'fixture'
                  ? 'Live feeds are required. Demo playback already animates continuously.'
                  : (burst?.reason ??
                    (burst
                      ? 'Ready for a short recording.'
                      : 'Connecting to live polling controls…'))}
              </p>
            )}
            {!active && (burst?.availableAt ?? 0) > now && (
              <p>Available again in {Math.ceil((burst!.availableAt! - now) / 60000)} min.</p>
            )}
            {error && <p>{error}</p>}
          </div>
          <button
            className="showcase-start"
            disabled={pending || (!active && !burst?.available)}
            onClick={() => void change(active ? 'DELETE' : 'POST')}
          >
            {pending ? 'Updating…' : active ? 'Stop burst' : 'Start 60-second burst'}
          </button>
          <small>
            Shared by all viewers · One burst per hour · Automatically returns to normal. Uses spare
            request quota and can end early if feeds fail or the budget runs low.
          </small>
        </section>
      )}
    </div>
  );
}
