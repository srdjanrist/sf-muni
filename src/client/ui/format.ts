export const routeName = (r?: { shortName: string; longName: string }) =>
  r ? `${r.shortName} ${r.longName}` : 'Unassigned route';
export const duration = (seconds?: number) =>
  seconds === undefined
    ? '—'
    : `${seconds < 0 ? '−' : '+'}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.round(Math.abs(seconds) % 60)).padStart(2, '0')}`;
export const eta = (time: number | undefined, now: number) =>
  time === undefined
    ? '—'
    : time - now < 30000
      ? 'Due'
      : `${Math.max(1, Math.ceil((time - now) / 60000))} min`;
export const clock = (epoch: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(epoch);
export const age = (epoch: number | undefined, now: number) =>
  epoch === undefined
    ? 'No update'
    : `${Math.max(0, Math.floor((now - epoch) / 1000)) < 60 ? `${Math.max(0, Math.floor((now - epoch) / 1000))}s` : `${Math.floor((now - epoch) / 60000)}m`} ago`;
