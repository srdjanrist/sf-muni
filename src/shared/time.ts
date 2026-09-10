import { Temporal } from '@js-temporal/polyfill';
import type { CalendarException, ServiceCalendar } from './types.js';
export const AGENCY_TIMEZONE = 'America/Los_Angeles';
export function parseGtfsTime(value: string): number | undefined {
  if (!/^\d{1,3}:\d{2}:\d{2}$/.test(value)) return undefined;
  const [h, m, s] = value.split(':').map(Number);
  if (m > 59 || s > 59) return undefined;
  return h * 3600 + m * 60 + s;
}
export function dateKey(date: Temporal.PlainDate) {
  return date.toString().replaceAll('-', '');
}
export function plainDate(key: string) {
  return Temporal.PlainDate.from(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`);
}
export function serviceDateAt(epochMs: number, zone = AGENCY_TIMEZONE) {
  return Temporal.Instant.fromEpochMilliseconds(Math.floor(epochMs))
    .toZonedDateTimeISO(zone)
    .toPlainDate();
}
// GTFS uses noon minus twelve elapsed hours, which is deliberately different from midnight on DST transition days.
export function serviceEpoch(date: string, seconds: number, zone = AGENCY_TIMEZONE) {
  return (
    plainDate(date).toZonedDateTime({ timeZone: zone, plainTime: '12:00' }).epochMilliseconds -
    12 * 3600000 +
    seconds * 1000
  );
}
export function serviceActive(
  id: string,
  date: string,
  calendars: ServiceCalendar[],
  exceptions: CalendarException[],
) {
  const exception = exceptions.find((e) => e.serviceId === id && e.date === date);
  if (exception) return exception.type === 1;
  const c = calendars.find((c) => c.id === id);
  return Boolean(c && date >= c.start && date <= c.end && c.days[plainDate(date).dayOfWeek - 1]);
}
export const instanceId = (tripId: string, date?: string, start?: string) =>
  [tripId, date ?? '', start ?? ''].join('|');
