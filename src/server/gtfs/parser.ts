import { Open } from 'unzipper';
import { parse } from 'csv-parse';
import { createHash } from 'node:crypto';
import { getVehicleCategory } from '../../shared/categories.js';
import { makeShape } from '../../shared/geo.js';
import { parseGtfsTime } from '../../shared/time.js';
import type {
  StaticSnapshot,
  TransitRoute,
  TransitStop,
  TransitTrip,
  StopTime,
} from '../../shared/types.js';

type Row = Record<string, string>;
const num = (s?: string) =>
  s === undefined || s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s);
const color = (s: string | undefined, fallback: string) =>
  s && /^[a-fA-F0-9]{6}$/.test(s) ? `#${s}` : fallback;
export async function parseGtfs(zip: string, source: string): Promise<StaticSnapshot> {
  // 511 archives can contain trailing bytes after the ZIP end record.
  // Search the full ZIP comment window rather than unzipper's 80-byte default.
  // @types/unzipper omits this supported optional argument.
  const openArchive = Open.file as (
    path: string,
    options: { tailSize: number },
  ) => ReturnType<typeof Open.file>;
  const archive = await openArchive(zip, { tailSize: 65557 });
  let warnings = 0;
  async function rows(name: string, cb: (row: Row) => void, required = false) {
    const file = archive.files.find((f) => f.path.split('/').at(-1) === name);
    if (!file) {
      if (required) throw new Error(`GTFS missing ${name}`);
      return;
    }
    if (file.uncompressedSize > 750_000_000) throw new Error(`GTFS ${name} exceeds import limit`);
    const parser = file.stream().pipe(
      parse({
        columns: true,
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 1_000_000,
      }),
    );
    for await (const row of parser) {
      try {
        cb(row as Row);
      } catch {
        warnings++;
      }
    }
  }
  let timezone = 'America/Los_Angeles';
  await rows(
    'agency.txt',
    (r) => {
      if (r.agency_timezone) timezone = r.agency_timezone;
    },
    true,
  );
  const routes: TransitRoute[] = [],
    stops: TransitStop[] = [],
    trips: TransitTrip[] = [];
  await rows(
    'routes.txt',
    (r) => {
      if (!r.route_id || num(r.route_type) === undefined) {
        warnings++;
        return;
      }
      const route = {
        id: r.route_id,
        shortName: r.route_short_name || r.route_id,
        longName: r.route_long_name || '',
        description: r.route_desc || undefined,
        type: Number(r.route_type),
        color: color(r.route_color, '#78bca4'),
        textColor: color(r.route_text_color, '#ffffff'),
      };
      routes.push({ ...route, category: getVehicleCategory(route) });
    },
    true,
  );
  await rows(
    'stops.txt',
    (r) => {
      const lat = num(r.stop_lat),
        lon = num(r.stop_lon);
      if (
        !r.stop_id ||
        lat === undefined ||
        lon === undefined ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        warnings++;
        return;
      }
      stops.push({
        id: r.stop_id,
        code: r.stop_code || undefined,
        name: r.stop_name || r.stop_id,
        lat,
        lon,
        parentStationId: r.parent_station || undefined,
        locationType: num(r.location_type) ?? 0,
        routeIds: [],
      });
    },
    true,
  );
  const routeIds = new Set(routes.map((r) => r.id)),
    stopById = new Map(stops.map((s) => [s.id, s]));
  await rows(
    'trips.txt',
    (r) => {
      if (!r.trip_id || !routeIds.has(r.route_id)) {
        warnings++;
        return;
      }
      trips.push({
        id: r.trip_id,
        routeId: r.route_id,
        serviceId: r.service_id,
        shapeId: r.shape_id || undefined,
        headsign: r.trip_headsign || undefined,
        directionId: num(r.direction_id),
      });
    },
    true,
  );
  const tripById = new Map(trips.map((t) => [t.id, t])),
    stopTimes: Record<string, StopTime[]> = Object.create(null);
  await rows(
    'stop_times.txt',
    (r) => {
      const trip = tripById.get(r.trip_id),
        stop = stopById.get(r.stop_id),
        sequence = num(r.stop_sequence);
      if (!trip || !stop || sequence === undefined) {
        warnings++;
        return;
      }
      (stopTimes[trip.id] ??= []).push({
        stopId: stop.id,
        sequence,
        arrival: parseGtfsTime(r.arrival_time ?? ''),
        departure: parseGtfsTime(r.departure_time ?? ''),
        pickupType: num(r.pickup_type),
        dropOffType: num(r.drop_off_type),
      });
      if (!stop.routeIds.includes(trip.routeId)) stop.routeIds.push(trip.routeId);
    },
    true,
  );
  for (const times of Object.values(stopTimes)) {
    times.sort((a, b) => a.sequence - b.sequence);
    for (let i = times.length - 1; i > 0; i--)
      if (times[i].sequence === times[i - 1].sequence) {
        times.splice(i, 1);
        warnings++;
      }
  }
  for (const stop of stops)
    if (stop.parentStationId) {
      const parent = stopById.get(stop.parentStationId);
      if (parent) parent.routeIds = [...new Set([...parent.routeIds, ...stop.routeIds])];
    }
  const shapeRows = new Map<string, { lat: number; lon: number; sequence: number }[]>();
  await rows(
    'shapes.txt',
    (r) => {
      const lat = num(r.shape_pt_lat),
        lon = num(r.shape_pt_lon),
        sequence = num(r.shape_pt_sequence);
      if (
        !r.shape_id ||
        lat === undefined ||
        lon === undefined ||
        sequence === undefined ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        warnings++;
        return;
      }
      const points = shapeRows.get(r.shape_id) ?? [];
      points.push({ lat, lon, sequence });
      shapeRows.set(r.shape_id, points);
    },
    true,
  );
  const shapes = [...shapeRows].filter(([, p]) => p.length >= 2).map(([id, p]) => makeShape(id, p));
  const shapeIds = new Set(shapes.map((s) => s.id));
  for (const trip of trips)
    if (trip.shapeId && !shapeIds.has(trip.shapeId)) {
      trip.shapeId = undefined;
      warnings++;
    }
  const calendars: StaticSnapshot['calendars'] = [],
    exceptions: StaticSnapshot['exceptions'] = [],
    frequencies: StaticSnapshot['frequencies'] = [];
  await rows('calendar.txt', (r) =>
    calendars.push({
      id: r.service_id,
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
        (d) => r[d] === '1',
      ),
      start: r.start_date,
      end: r.end_date,
    }),
  );
  await rows('calendar_dates.txt', (r) =>
    exceptions.push({ serviceId: r.service_id, date: r.date, type: Number(r.exception_type) }),
  );
  if (!calendars.length && !exceptions.length) throw new Error('GTFS has no service calendar');
  await rows('frequencies.txt', (r) => {
    const start = parseGtfsTime(r.start_time),
      end = parseGtfsTime(r.end_time),
      headway = num(r.headway_secs);
    if (
      start !== undefined &&
      end !== undefined &&
      headway &&
      headway > 0 &&
      tripById.has(r.trip_id)
    )
      frequencies.push({ tripId: r.trip_id, start, end, headway, exact: r.exact_times === '1' });
  });
  const optional: StaticSnapshot['optional'] = {};
  for (const file of [
    'transfers.txt',
    'pathways.txt',
    'levels.txt',
    'feed_info.txt',
    'directions.txt',
  ]) {
    optional[file] = [];
    await rows(file, (r) => optional[file].push(r));
  }
  if (!routes.length || !stops.length || !trips.length || !shapes.length)
    throw new Error('GTFS snapshot is empty or unusable');
  const bounds: StaticSnapshot['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of stops.filter((s) => s.routeIds.length)) {
    bounds[0] = Math.min(bounds[0], s.lon);
    bounds[1] = Math.min(bounds[1], s.lat);
    bounds[2] = Math.max(bounds[2], s.lon);
    bounds[3] = Math.max(bounds[3], s.lat);
  }
  const updatedAt = Date.now(),
    version = createHash('sha256')
      .update(`${updatedAt}:${routes.length}:${trips.length}:${shapes.length}`)
      .digest('hex')
      .slice(0, 16);
  return {
    version,
    updatedAt,
    source,
    timezone,
    routes,
    stops,
    trips,
    shapes,
    stopTimes,
    calendars,
    exceptions,
    frequencies,
    optional,
    bounds,
    warnings,
  };
}
