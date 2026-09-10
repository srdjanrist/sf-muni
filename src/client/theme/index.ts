export const theme = {
  background: '#101919',
  land: '#202b2b',
  water: '#101e23',
  park: '#263b32',
  buildings: '#384643',
  roads: '#43504c',
  text: '#f0f1e9',
  muted: '#8e9c97',
  accent: '#c4ef7a',
  routeDefault: '#79b9a5',
  selected: '#d4ff8e',
  unknown: '#84948e',
  stale: '#65726d',
  delay: {
    early: '#77bcbf',
    onTime: '#b9df82',
    minor: '#e8cc72',
    moderate: '#e9a569',
    severe: '#e97765',
    extreme: '#ce6681',
  },
};
export const delayColor = (d?: number) =>
  d === undefined
    ? theme.unknown
    : d < -60
      ? theme.delay.early
      : d <= 60
        ? theme.delay.onTime
        : d <= 180
          ? theme.delay.minor
          : d <= 300
            ? theme.delay.moderate
            : d <= 600
              ? theme.delay.severe
              : theme.delay.extreme;
export const delayLabel = (d?: number) =>
  d === undefined
    ? 'Delay unknown'
    : d < -60
      ? `${Math.ceil(-d / 60)} min early`
      : d <= 60
        ? 'Within 1 min'
        : `${Math.floor(d / 60)}m ${Math.round(d % 60)}s late`;
