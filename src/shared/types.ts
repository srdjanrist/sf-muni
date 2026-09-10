export type VehicleCategory =
  'light_rail' | 'streetcar' | 'cable_car' | 'bus' | 'trolleybus' | 'unknown';
export type VehicleStatus = 'incoming' | 'stopped' | 'in_transit' | 'unknown';
export type DataSource = 'live' | 'fixture';
export interface TransitRoute {
  id: string;
  shortName: string;
  longName: string;
  description?: string;
  type: number;
  color: string;
  textColor: string;
  category: VehicleCategory;
}
export interface TransitStop {
  id: string;
  code?: string;
  name: string;
  lat: number;
  lon: number;
  parentStationId?: string;
  locationType: number;
  routeIds: string[];
}
export interface TransitTrip {
  id: string;
  routeId: string;
  serviceId: string;
  shapeId?: string;
  headsign?: string;
  directionId?: number;
}
export interface ShapePoint {
  lat: number;
  lon: number;
  x: number;
  z: number;
  sequence: number;
  distance: number;
}
export interface TransitShape {
  id: string;
  points: ShapePoint[];
  totalDistanceMeters: number;
}
export interface StopTime {
  stopId: string;
  sequence: number;
  arrival?: number;
  departure?: number;
  pickupType?: number;
  dropOffType?: number;
}
export interface ServiceCalendar {
  id: string;
  days: boolean[];
  start: string;
  end: string;
}
export interface CalendarException {
  serviceId: string;
  date: string;
  type: number;
}
export interface Frequency {
  tripId: string;
  start: number;
  end: number;
  headway: number;
  exact: boolean;
}
export interface StaticSnapshot {
  version: string;
  updatedAt: number;
  source: string;
  timezone: string;
  routes: TransitRoute[];
  stops: TransitStop[];
  trips: TransitTrip[];
  shapes: TransitShape[];
  stopTimes: Record<string, StopTime[]>;
  calendars: ServiceCalendar[];
  exceptions: CalendarException[];
  frequencies: Frequency[];
  optional: Record<string, Record<string, string>[]>;
  bounds: [number, number, number, number];
  warnings: number;
}
export interface Freshness {
  receivedAt: number;
  sourceTimestamp?: number;
  stale: boolean;
}
export interface VehicleState extends Freshness {
  id: string;
  label?: string;
  licensePlate?: string;
  routeId?: string;
  tripId?: string;
  instanceId?: string;
  startDate?: string;
  startTime?: string;
  lat: number;
  lon: number;
  bearing?: number;
  speedMps?: number;
  speedSource?: 'reported' | 'derived';
  timestamp: number;
  directionId?: number;
  stopId?: string;
  stopSequence?: number;
  status: VehicleStatus;
  delaySeconds?: number;
  destination?: string;
  shapeId?: string;
  category: VehicleCategory;
  nextStop?: {
    id: string;
    name: string;
    predictedArrival?: number;
    scheduledArrival?: number;
    distanceMeters?: number;
  };
  missingSince?: number;
  missingCycles: number;
}
export interface RealtimeStop {
  stopId?: string;
  stopSequence?: number;
  arrival?: number;
  arrivalDelay?: number;
  departure?: number;
  departureDelay?: number;
  status: 'scheduled' | 'skipped' | 'no_data';
}
export interface RealtimeTrip extends Freshness {
  id: string;
  tripId: string;
  routeId?: string;
  vehicleId?: string;
  directionId?: number;
  startDate?: string;
  startTime?: string;
  relationship: 'scheduled' | 'canceled' | 'added' | 'unscheduled';
  delaySeconds?: number;
  stops: RealtimeStop[];
}
export interface ServiceAlert {
  id: string;
  header: string;
  description?: string;
  severity?: string;
  url?: string;
  activePeriods: { start?: number; end?: number }[];
  affectedRoutes: string[];
  affectedStops: string[];
  affectedTrips: string[];
  selectors: {
    routeId?: string;
    stopId?: string;
    tripId?: string;
    directionId?: number;
    agencyId?: string;
  }[];
  receivedAt: number;
}
export interface ArrivalPrediction {
  routeId: string;
  tripId: string;
  instanceId: string;
  stopId: string;
  stopSequence: number;
  destination?: string;
  directionId?: number;
  scheduledArrival?: number;
  predictedArrival?: number;
  scheduledDeparture?: number;
  predictedDeparture?: number;
  delaySeconds?: number;
  realtime: boolean;
  vehicleId?: string;
  status: 'scheduled' | 'skipped' | 'no_data';
  frequencyBased?: boolean;
}
export interface RouteStats {
  routeId: string;
  activeVehicles: number;
  delayedVehicles: number;
  averageDelaySeconds?: number;
  averageSpeedMps?: number;
  inboundVehicles: number;
  outboundVehicles: number;
}
export interface NetworkStats {
  timestamp: number;
  activeVehicles: number;
  activeTrips: number;
  activeRoutes: number;
  movingVehicles: number;
  stoppedVehicles: number;
  delayedVehicles: number;
  severelyDelayedVehicles: number;
  averageDelaySeconds?: number;
  medianDelaySeconds?: number;
  p95DelaySeconds?: number;
  averageSpeedMps?: number;
  delaySampleCount: number;
  speedSampleCount: number;
  activeAlerts: number;
  byVehicleType: Record<VehicleCategory, number>;
  routes: RouteStats[];
}
export type FeedName = 'vehiclePositions' | 'tripUpdates' | 'serviceAlerts';
export interface FeedHealth {
  healthy: boolean;
  lastSuccess?: number;
  sourceTimestamp?: number;
  lastAttempt?: number;
  nextAttempt?: number;
  count: number;
  error?: string;
  failures: number;
}
export interface SystemStatus {
  status: 'loading' | 'ok' | 'degraded';
  source: DataSource;
  now: number;
  playback?: 'synthetic' | 'recorded';
  gtfs: {
    loaded: boolean;
    updatedAt?: number;
    version?: string;
    source?: string;
    routes?: number;
    stops?: number;
    trips?: number;
    shapes?: number;
    error?: string;
  };
  feeds: Record<FeedName, FeedHealth>;
  budget: { used: number; limit: number; pausedUntil?: number };
  staleAfterMs: number;
}
export interface TransitSnapshot {
  version: number;
  staticVersion?: string;
  vehicles: VehicleState[];
  alerts: ServiceAlert[];
  stats: NetworkStats;
  status: SystemStatus;
}
export interface TransitDelta {
  version: number;
  staticVersion?: string;
  timestamp: number;
  vehicles: VehicleState[];
  removedVehicleIds: string[];
  tripsChanged: boolean;
  alerts?: ServiceAlert[];
  stats: NetworkStats;
  status: SystemStatus;
}
export interface NetworkPayload {
  version: string;
  routes: TransitRoute[];
  stops: TransitStop[];
  bounds: StaticSnapshot['bounds'];
  shapes: { id: string; routeId: string; coordinates: [number, number][] }[];
}
export interface SearchResult {
  type: 'route' | 'stop' | 'vehicle';
  id: string;
  title: string;
  subtitle: string;
  lon?: number;
  lat?: number;
}
export interface VehicleDetail {
  vehicle: VehicleState;
  route?: TransitRoute;
  trip?: TransitTrip;
  timeline: ArrivalPrediction[];
  alerts: ServiceAlert[];
}
