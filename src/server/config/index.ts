import 'dotenv/config';
import { z } from 'zod';
import { resolve } from 'node:path';
const integer = (fallback: number, min = 1) => z.coerce.number().int().min(min).default(fallback);
const schema = z.object({
  '511_API_KEY': z.string().default(''),
  '511_OPERATOR_ID': z.string().default('SF'),
  TRANSIT_DATA_SOURCE: z.enum(['auto', 'live', 'fixture']).default('auto'),
  FIXTURE_SCENARIO: z.enum(['synthetic', 'recorded']).default('synthetic'),
  GTFS_REFRESH_INTERVAL_MS: integer(86400000),
  VEHICLE_POLL_INTERVAL_MS: integer(120000),
  TRIP_UPDATE_POLL_INTERVAL_MS: integer(180000),
  SERVICE_ALERT_POLL_INTERVAL_MS: integer(600000),
  API_REQUESTS_PER_HOUR: integer(60),
  UPSTREAM_TIMEOUT_MS: integer(30000),
  STATIC_DOWNLOAD_TIMEOUT_MS: integer(120000),
  VEHICLE_STALE_AFTER_MS: integer(180000),
  VEHICLE_REMOVE_AFTER_MS: integer(600000),
  PORT: integer(3001),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default('data'),
  SERVE_FRONTEND: z.enum(['true', 'false']).default('true'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
          const url = new URL(origin);
          if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
            throw new Error(
              'CORS_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes',
            );
          return url.origin;
        }),
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const env = schema.parse(process.env);
export const config = {
  apiKey: env['511_API_KEY'],
  operatorId: env['511_OPERATOR_ID'],
  source:
    env.TRANSIT_DATA_SOURCE === 'auto'
      ? env['511_API_KEY']
        ? 'live'
        : 'fixture'
      : env.TRANSIT_DATA_SOURCE,
  fixtureScenario: env.FIXTURE_SCENARIO,
  dataDir: resolve(env.DATA_DIR),
  host: env.HOST,
  serveFrontend: env.SERVE_FRONTEND === 'true',
  corsOrigins: env.CORS_ORIGINS,
  fixtureDir: resolve('fixtures'),
  baseUrl: 'https://api.511.org/transit/',
  refreshMs: env.GTFS_REFRESH_INTERVAL_MS,
  requestLimit: env.API_REQUESTS_PER_HOUR,
  timeoutMs: env.UPSTREAM_TIMEOUT_MS,
  staticTimeoutMs: env.STATIC_DOWNLOAD_TIMEOUT_MS,
  staleMs: env.VEHICLE_STALE_AFTER_MS,
  removeMs: env.VEHICLE_REMOVE_AFTER_MS,
  pollMs: {
    vehiclePositions: env.VEHICLE_POLL_INTERVAL_MS,
    tripUpdates: env.TRIP_UPDATE_POLL_INTERVAL_MS,
    serviceAlerts: env.SERVICE_ALERT_POLL_INTERVAL_MS,
  },
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
} as const;
