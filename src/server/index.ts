import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config/index.js';
import { createApp } from './api/app.js';
import { TransitStateManager } from './transit/state-manager.js';
import { TransitApiClient, UpstreamError } from './upstream/client.js';
import { cachedGtfs, downloadGtfs, importGtfs } from './gtfs/loader.js';
import { Polling } from './realtime/polling.js';
import { FixturePlayback } from './realtime/fixture.js';
import { RecordedPlayback } from './realtime/recorded.js';
import { ensureMapAssets } from './gtfs/map-assets.js';
import type { FeedHealth, FeedName, SystemStatus, TransitSnapshot } from '../shared/types.js';
await mkdir(config.dataDir, { recursive: true });
await ensureMapAssets();
const client = new TransitApiClient();
await client.init();
const feeds = Object.fromEntries(
  ['vehiclePositions', 'tripUpdates', 'serviceAlerts'].map((f) => [
    f,
    { healthy: false, count: 0, failures: 0 },
  ]),
) as Record<FeedName, FeedHealth>;
let gtfsError: string | undefined,
  playback: FixturePlayback | RecordedPlayback | undefined,
  polling: Polling | undefined,
  refresh: ReturnType<typeof setTimeout> | undefined,
  closing = false;
const now = () => playback?.now() ?? Date.now();
const status = (): SystemStatus => ({
  status: !state.index
    ? 'loading'
    : Object.entries(feeds).every(
          ([name, f]) =>
            f.healthy &&
            now() - (f.sourceTimestamp ?? f.lastSuccess ?? 0) <
              Math.max(config.staleMs, config.pollMs[name as FeedName] * 2),
        )
      ? 'ok'
      : 'degraded',
  source: config.source,
  playback: config.source === 'fixture' ? config.fixtureScenario : undefined,
  now: now(),
  gtfs: {
    loaded: Boolean(state.index),
    updatedAt: state.index?.snapshot.updatedAt,
    version: state.index?.snapshot.version,
    source: state.index?.snapshot.source,
    routes: state.index?.routes.size,
    stops: state.index?.stops.size,
    trips: state.index?.trips.size,
    shapes: state.index?.shapes.size,
    error: gtfsError,
  },
  feeds,
  budget: client.budget,
  staleAfterMs: config.staleMs,
});
const state = new TransitStateManager(status, config.staleMs, config.removeMs, now);
const app = await createApp(state);
await app.listen({ port: config.port, host: config.host });
const maintenance = setInterval(() => {
  state.enrich();
  state.sweep();
  state.emit();
}, 15000);
const persist = setInterval(() => {
  if (config.source !== 'live') return;
  void (async () => {
    await writeFile(join(config.dataDir, 'realtime.json.tmp'), JSON.stringify(state.getSnapshot()));
    await rename(join(config.dataDir, 'realtime.json.tmp'), join(config.dataDir, 'realtime.json'));
  })().catch(() => app.log.warn('Could not checkpoint realtime state'));
}, 30000);
async function refreshStatic() {
  try {
    const index = await downloadGtfs(client);
    state.setIndex(index);
    gtfsError = undefined;
    app.log.info(
      {
        routes: index.routes.size,
        trips: index.trips.size,
        stops: index.stops.size,
        shapes: index.shapes.size,
        warnings: index.snapshot.warnings,
      },
      'GTFS import completed',
    );
  } catch (error) {
    gtfsError = error instanceof UpstreamError ? error.code : 'gtfs_import_failed';
    app.log.warn({ error: gtfsError }, 'GTFS refresh failed; preserving previous snapshot');
  }
  if (!closing)
    refresh = setTimeout(
      () => void refreshStatic(),
      gtfsError ? Math.max(60000, client.pausedUntil - Date.now()) : config.refreshMs,
    );
}
async function boot() {
  if (config.source === 'fixture') {
    if (config.fixtureScenario === 'recorded') {
      playback = new RecordedPlayback(state, feeds);
      await playback.start();
      app.log.info('Recorded historical feed loaded — not live');
      return;
    }
    const index = await importGtfs(
      join(config.fixtureDir, 'gtfs.zip'),
      'SFMTA DataSF / fixture static archive',
      false,
    );
    state.setIndex(index);
    playback = new FixturePlayback(index, state, feeds);
    await playback.start();
    app.log.info(
      {
        routes: index.routes.size,
        stops: index.stops.size,
        trips: index.trips.size,
        shapes: index.shapes.size,
        vehicles: state.vehicles.size,
      },
      'Fixture playback ready — synthetic vehicles on official static network',
    );
  } else {
    const cached = await cachedGtfs();
    if (cached) state.setIndex(cached);
    try {
      const checkpoint = JSON.parse(
        await readFile(join(config.dataDir, 'realtime.json'), 'utf8'),
      ) as TransitSnapshot;
      if (checkpoint.status.source === 'live') {
        state.updateVehicles(
          checkpoint.vehicles.map((v) => ({ ...v, stale: true })),
          false,
        );
        state.updateAlerts(checkpoint.alerts);
      }
    } catch {
      /* First startup. */
    }
    if (!cached || Date.now() - cached.snapshot.updatedAt > config.refreshMs) await refreshStatic();
    else
      refresh = setTimeout(
        () => void refreshStatic(),
        config.refreshMs - (Date.now() - cached.snapshot.updatedAt),
      );
    polling = new Polling(client, state, feeds, app.log);
    polling.start();
  }
}
void boot().catch(() => {
  gtfsError = 'initialization_failed';
  app.log.error(
    { source: config.source },
    'Transit initialization failed; health API remains available',
  );
});
async function shutdown() {
  closing = true;
  clearInterval(maintenance);
  clearInterval(persist);
  if (refresh) clearTimeout(refresh);
  polling?.stop();
  playback?.stop();
  state.events.removeAllListeners();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
