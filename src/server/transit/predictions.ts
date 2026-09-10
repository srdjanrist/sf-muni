import {
  dateKey,
  instanceId,
  parseGtfsTime,
  plainDate,
  serviceActive,
  serviceDateAt,
  serviceEpoch,
} from '../../shared/time.js';
import type {
  ArrivalPrediction,
  RealtimeTrip,
  StopTime,
  TransitTrip,
  VehicleState,
} from '../../shared/types.js';
import type { GtfsIndex } from '../gtfs/indexes.js';
import { distanceMeters } from '../../shared/geo.js';
// 511's interpolated intermediate stop times can differ slightly from static GTFS.
const SERVICE_DAY_MATCH_TOLERANCE_MS = 120000;
export class Predictions {
  private serviceDates = new Map<string, string | undefined>();
  constructor(
    public index: GtfsIndex,
    public updates: Map<string, RealtimeTrip>,
    public now: () => number = Date.now,
  ) {
    for (const u of updates.values()) {
      let date = u.startDate;
      // 511 may label overnight 24+ hour trips with the civil date. Correct only
      // when its absolute time AND reported delay agree with the prior service day.
      if (date) {
        const trip = index.trips.get(u.tripId);
        for (const s of u.stops) {
          const time = index.snapshot.stopTimes[u.tripId]?.find((t) =>
            s.stopSequence !== undefined ? t.sequence === s.stopSequence : t.stopId === s.stopId,
          );
          const seconds = s.arrival !== undefined ? time?.arrival : time?.departure;
          const absolute = s.arrival ?? s.departure;
          const delay = s.arrival !== undefined ? s.arrivalDelay : s.departureDelay;
          if (
            !trip ||
            seconds === undefined ||
            seconds < 86400 ||
            absolute === undefined ||
            delay === undefined
          )
            continue;
          const candidate = dateKey(plainDate(date).subtract({ days: 1 }));
          if (
            serviceActive(
              trip.serviceId,
              candidate,
              index.snapshot.calendars,
              index.snapshot.exceptions,
            ) &&
            Math.abs(
              serviceEpoch(candidate, seconds, index.snapshot.timezone) - (absolute - delay * 1000),
            ) <= SERVICE_DAY_MATCH_TOLERANCE_MS
          )
            date = candidate;
          break;
        }
      }
      this.serviceDates.set(u.id, date);
    }
  }
  updateFor(tripId: string, date: string, start?: string) {
    return [...this.updates.values()].find(
      (t) =>
        t.tripId === tripId &&
        (!t.startDate || this.serviceDates.get(t.id) === date) &&
        (!start || !t.startTime || start === t.startTime),
    );
  }
  timeline(trip: TransitTrip, date: string, start?: string, offset = 0): ArrivalPrediction[] {
    const update = this.updateFor(trip.id, date, start);
    const fresh = update && this.now() - (update.sourceTimestamp ?? update.receivedAt) <= 360000;
    if (fresh && update.relationship === 'canceled') return [];
    let delay = fresh ? update.delaySeconds : undefined;
    const stopTimes = this.index.snapshot.stopTimes[trip.id] ?? [];
    return stopTimes.map((time): ArrivalPrediction => {
      const u = fresh
        ? update.stops.find((s) =>
            s.stopSequence !== undefined
              ? s.stopSequence === time.sequence
              : s.stopId === time.stopId,
          )
        : undefined;
      const scheduledArrival =
        time.arrival === undefined
          ? undefined
          : serviceEpoch(date, time.arrival + offset, this.index.snapshot.timezone);
      const scheduledDeparture =
        time.departure === undefined
          ? undefined
          : serviceEpoch(date, time.departure + offset, this.index.snapshot.timezone);
      if (u?.status === 'no_data') delay = undefined;
      const arrivalDelay =
        u?.arrival !== undefined && scheduledArrival !== undefined
          ? (u.arrival - scheduledArrival) / 1000
          : u?.arrivalDelay;
      const departureDelay =
        u?.departure !== undefined && scheduledDeparture !== undefined
          ? (u.departure - scheduledDeparture) / 1000
          : u?.departureDelay;
      if (arrivalDelay !== undefined && u?.status !== 'skipped') delay = arrivalDelay;
      const arrivalApplied = delay;
      const predictedArrival =
        u?.status === 'no_data' || u?.status === 'skipped'
          ? undefined
          : (u?.arrival ??
            (scheduledArrival !== undefined && arrivalApplied !== undefined
              ? scheduledArrival + arrivalApplied * 1000
              : undefined));
      if (departureDelay !== undefined && u?.status !== 'skipped') delay = departureDelay;
      const predictedDeparture =
        u?.status === 'no_data' || u?.status === 'skipped'
          ? undefined
          : (u?.departure ??
            (scheduledDeparture !== undefined && delay !== undefined
              ? scheduledDeparture + delay * 1000
              : undefined));
      return {
        routeId: trip.routeId,
        tripId: trip.id,
        instanceId: instanceId(trip.id, date, start),
        stopId: time.stopId,
        stopSequence: time.sequence,
        destination: trip.headsign,
        directionId: trip.directionId,
        scheduledArrival,
        scheduledDeparture,
        predictedArrival,
        predictedDeparture,
        delaySeconds:
          predictedArrival !== undefined
            ? arrivalApplied
            : predictedDeparture !== undefined
              ? delay
              : undefined,
        realtime: predictedArrival !== undefined || predictedDeparture !== undefined,
        vehicleId: fresh ? update.vehicleId : undefined,
        status: u?.status ?? 'scheduled',
      };
    });
  }
  getUpcomingArrivals(stopId: string, horizonMinutes = 60): ArrivalPrediction[] {
    const now = this.now(),
      until = now + Math.max(1, Math.min(horizonMinutes, 180)) * 60000;
    const stopIds = new Set([stopId, ...(this.index.children.get(stopId) ?? [])]);
    const trips = new Map<string, TransitTrip>();
    for (const id of stopIds)
      for (const trip of this.index.stopTrips.get(id) ?? []) trips.set(trip.id, trip);
    const results: ArrivalPrediction[] = [],
      today = serviceDateAt(now, this.index.snapshot.timezone);
    const active = new Map<string, boolean>();
    for (
      let day = -Math.ceil(this.index.maxServiceSeconds / 86400);
      day <= Math.ceil(horizonMinutes / 1440);
      day++
    ) {
      const date = dateKey(today.add({ days: day }));
      for (const trip of trips.values()) {
        const key = `${trip.serviceId}:${date}`;
        if (!active.has(key))
          active.set(
            key,
            serviceActive(
              trip.serviceId,
              date,
              this.index.snapshot.calendars,
              this.index.snapshot.exceptions,
            ),
          );
        if (!active.get(key)) continue;
        const frequencies = this.index.snapshot.frequencies.filter((f) => f.tripId === trip.id);
        const runs: { start?: string; offset: number; frequencyBased?: boolean }[] = [];
        if (frequencies.length) {
          const first = this.index.snapshot.stopTimes[trip.id]?.[0];
          const base = first?.departure ?? first?.arrival ?? 0;
          for (const f of frequencies) {
            // Non-exact headways cannot produce authoritative departure instants. Only expose actual realtime instances.
            if (!f.exact) {
              for (const u of this.updates.values())
                if (u.tripId === trip.id && this.serviceDates.get(u.id) === date && u.startTime)
                  runs.push({
                    start: u.startTime,
                    offset: (parseGtfsTime(u.startTime) ?? base) - base,
                    frequencyBased: true,
                  });
              continue;
            }
            for (let seconds = f.start; seconds < f.end; seconds += f.headway) {
              const start = `${Math.floor(seconds / 3600)
                .toString()
                .padStart(2, '0')}:${Math.floor((seconds % 3600) / 60)
                .toString()
                .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
              runs.push({ start, offset: seconds - base });
            }
          }
        } else runs.push({ offset: 0 });
        for (const run of runs)
          for (const arrival of this.timeline(trip, date, run.start, run.offset)) {
            if (!stopIds.has(arrival.stopId) || arrival.status === 'skipped') continue;
            const staticTime = this.index.snapshot.stopTimes[trip.id]?.find(
              (t) => t.sequence === arrival.stopSequence,
            );
            if (staticTime?.pickupType === 1) continue;
            const time =
              arrival.predictedDeparture ??
              arrival.predictedArrival ??
              arrival.scheduledDeparture ??
              arrival.scheduledArrival;
            if (time !== undefined && time >= now - 15000 && time <= until)
              results.push({ ...arrival, frequencyBased: run.frequencyBased });
          }
      }
    }
    // Realtime added/unscheduled trips may have no static trip at all.
    for (const u of this.updates.values())
      if (
        !this.index.trips.has(u.tripId) &&
        u.relationship !== 'canceled' &&
        now - (u.sourceTimestamp ?? u.receivedAt) <= 360000
      )
        for (const s of u.stops) {
          const time = s.departure ?? s.arrival;
          if (
            s.stopId &&
            stopIds.has(s.stopId) &&
            s.status !== 'skipped' &&
            time !== undefined &&
            time >= now - 15000 &&
            time <= until
          )
            results.push({
              routeId: u.routeId ?? '',
              tripId: u.tripId,
              instanceId: u.id,
              stopId: s.stopId,
              stopSequence: s.stopSequence ?? 0,
              predictedArrival: s.arrival,
              predictedDeparture: s.departure,
              realtime: true,
              status: s.status,
              vehicleId: u.vehicleId,
            });
        }
    return results
      .sort(
        (a, b) =>
          (a.predictedDeparture ??
            a.predictedArrival ??
            a.scheduledDeparture ??
            a.scheduledArrival ??
            Infinity) -
          (b.predictedDeparture ??
            b.predictedArrival ??
            b.scheduledDeparture ??
            b.scheduledArrival ??
            Infinity),
      )
      .slice(0, 100);
  }
  vehicleTimeline(vehicle: VehicleState) {
    const trip = vehicle.tripId ? this.index.trips.get(vehicle.tripId) : undefined;
    if (!trip) return [];
    let date = vehicle.startDate;
    const update = [...this.updates.values()].find(
      (u) =>
        u.tripId === trip.id &&
        (!date || u.startDate === date) &&
        (!vehicle.startTime || !u.startTime || vehicle.startTime === u.startTime),
    );
    if (update) date = this.serviceDates.get(update.id) ?? date;
    const relevant = (this.index.snapshot.stopTimes[trip.id] ?? []).find(
      (t) => t.sequence === vehicle.stopSequence,
    );
    // A vehicle observation can also disambiguate a 24+ hour schedule without a TU.
    if (!update && date && (relevant?.arrival ?? 0) >= 86400) {
      const candidate = dateKey(plainDate(date).subtract({ days: 1 }));
      const observed = vehicle.sourceTimestamp ?? vehicle.timestamp;
      if (
        serviceEpoch(date, relevant!.arrival!, this.index.snapshot.timezone) - observed >
          18 * 3600000 &&
        Math.abs(
          serviceEpoch(candidate, relevant!.arrival!, this.index.snapshot.timezone) - observed,
        ) <
          6 * 3600000 &&
        serviceActive(
          trip.serviceId,
          candidate,
          this.index.snapshot.calendars,
          this.index.snapshot.exceptions,
        )
      )
        date = candidate;
    }
    if (!date) {
      const today = serviceDateAt(this.now(), this.index.snapshot.timezone);
      const times = this.index.snapshot.stopTimes[trip.id] ?? [];
      const relevant = times.find((t) => t.sequence === vehicle.stopSequence) ?? times[0];
      let best = Infinity;
      for (let d = -Math.ceil(this.index.maxServiceSeconds / 86400); d <= 0; d++) {
        const candidate = dateKey(today.add({ days: d }));
        if (
          !serviceActive(
            trip.serviceId,
            candidate,
            this.index.snapshot.calendars,
            this.index.snapshot.exceptions,
          )
        )
          continue;
        const diff = Math.abs(
          serviceEpoch(candidate, relevant?.arrival ?? 0, this.index.snapshot.timezone) -
            this.now(),
        );
        if (diff < best) {
          best = diff;
          date = candidate;
        }
      }
    }
    if (!date) return [];
    const first = this.index.snapshot.stopTimes[trip.id]?.[0],
      start = vehicle.startTime ? parseGtfsTime(vehicle.startTime) : undefined;
    const offset =
      this.index.snapshot.frequencies.some((f) => f.tripId === trip.id) && start !== undefined
        ? start - (first?.departure ?? first?.arrival ?? 0)
        : 0;
    return this.timeline(trip, date, vehicle.startTime, offset);
  }
  nextStop(vehicle: VehicleState) {
    const timeline = this.vehicleTimeline(vehicle);
    const next =
      vehicle.stopSequence !== undefined
        ? timeline.find((t) => t.stopSequence >= vehicle.stopSequence! && t.status !== 'skipped')
        : vehicle.stopId
          ? timeline.find((t) => t.stopId === vehicle.stopId && t.status !== 'skipped')
          : timeline.find(
              (t) =>
                (t.predictedArrival ?? t.scheduledArrival ?? 0) >= this.now() &&
                t.status !== 'skipped',
            );
    const stop = next ? this.index.stops.get(next.stopId) : undefined;
    if (!next || !stop) return undefined;
    return {
      prediction: next,
      stop: {
        id: stop.id,
        name: stop.name,
        predictedArrival: next.predictedArrival,
        scheduledArrival: next.scheduledArrival,
        distanceMeters: distanceMeters(vehicle, stop),
      },
    };
  }
}
export function nextStopTime(times: StopTime[], sequence: number) {
  return times.find((t) => t.sequence >= sequence);
}
