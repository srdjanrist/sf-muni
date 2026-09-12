import Fastify, { LogController } from 'fastify';
import staticPlugin from '@fastify/static';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import type { SearchResult, ShowcaseStatus, TransitDelta } from '../../shared/types.js';
import { config } from '../config/index.js';
import type { TransitStateManager } from '../transit/state-manager.js';

export async function createApp(
  state: TransitStateManager,
  corsOrigins = config.corsOrigins,
  showcase?: {
    start: () => Promise<ShowcaseStatus> | undefined;
    stop: () => ShowcaseStatus | undefined;
  },
) {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    logController: new LogController({ disableRequestLogging: true }),
  });
  await app.register(cors, {
    origin: corsOrigins.length ? corsOrigins : false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'],
    allowedHeaders: ['Range', 'If-None-Match', 'If-Match', 'Last-Event-ID', 'Content-Type'],
    exposedHeaders: ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length'],
    maxAge: 86400,
  });
  await app.register(compress, { global: false });
  await app.register(staticPlugin, { root: config.dataDir, serve: false });
  const streams = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    streams.forEach((stream) => stream.end());
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });
  const unavailable = () => ({
    error: 'network_loading',
    message: 'Muni network is still loading. Retry shortly.',
  });
  app.get('/api/health', async (_req, reply) => {
    const s = state.status();
    return reply.code(s.status === 'loading' ? 503 : 200).send(s);
  });
  app.get('/api/system/status', async () => state.status());
  app.route({
    method: ['POST', 'DELETE'],
    url: '/api/system/showcase',
    handler: async (req, reply) => {
      const origin = req.headers.origin;
      // Reject cross-site mutations, including simple form requests; CORS alone does not do this.
      if (origin && !corsOrigins.includes(origin) && origin !== `${req.protocol}://${req.host}`)
        return reply.code(403).send({ error: 'origin_not_allowed' });
      const result = req.method === 'POST' ? await showcase?.start() : showcase?.stop();
      if (!result) return reply.code(503).send({ error: 'Showcase requires live ingestion.' });
      return reply.header('Cache-Control', 'no-store').send(result);
    },
  });
  app.get('/api/realtime/snapshot', async () => state.getSnapshot());
  app.get('/api/vehicles', async () => [...state.vehicles.values()]);
  app.get('/api/vehicles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = state.vehicles.get(id);
    if (!v) return reply.code(404).send({ error: 'vehicle_not_found' });
    return {
      vehicle: v,
      route: v.routeId ? state.index?.routes.get(v.routeId) : undefined,
      trip: v.tripId ? state.index?.trips.get(v.tripId) : undefined,
      timeline: state.predictions()?.vehicleTimeline(v) ?? [],
      alerts: state.applicableAlerts(v),
    };
  });
  app.get(
    '/api/routes',
    async (_req, reply) => state.index?.snapshot.routes ?? reply.code(503).send(unavailable()),
  );
  app.get('/api/routes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const route = state.index?.routes.get(id);
    if (!route) return reply.code(404).send({ error: 'route_not_found' });
    return {
      route,
      stats: state.getSnapshot().stats.routes.find((r) => r.routeId === id),
      stops: state.index?.snapshot.stops.filter((s) => s.routeIds.includes(id)),
      shapes: [
        ...new Set(state.index?.routeTrips.get(id)?.flatMap((t) => (t.shapeId ? [t.shapeId] : []))),
      ].map((id) => state.index!.shapes.get(id)),
      alerts: state.applicableAlerts({ routeId: id }),
    };
  });
  app.get('/api/shapes/:id', async (req, reply) => {
    const shape = state.index?.shapes.get((req.params as { id: string }).id);
    if (!shape) return reply.code(404).send({ error: 'shape_not_found' });
    return reply.header('Cache-Control', 'public,max-age=3600').send(shape);
  });
  app.get(
    '/api/stops',
    async (_req, reply) => state.index?.snapshot.stops ?? reply.code(503).send(unavailable()),
  );
  app.get('/api/stops/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const stop = state.index?.stops.get(id);
    if (!stop) return reply.code(404).send({ error: 'stop_not_found' });
    const alerts = state.applicableAlerts({ stopId: id });
    return {
      stop,
      routes: stop.routeIds.map((id) => state.index!.routes.get(id)),
      alerts: [
        ...new Map(
          [
            ...alerts,
            ...stop.routeIds.flatMap((routeId) => state.applicableAlerts({ routeId, stopId: id })),
          ].map((a) => [a.id, a]),
        ).values(),
      ],
    };
  });
  app.get('/api/stops/:id/arrivals', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!state.index?.stops.has(id)) return reply.code(404).send({ error: 'stop_not_found' });
    const parsed = z
      .object({ horizon: z.coerce.number().int().min(1).max(180).default(60) })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_horizon' });
    return state.predictions()?.getUpcomingArrivals(id, parsed.data.horizon) ?? [];
  });
  app.get('/api/alerts', async () => state.getSnapshot().alerts);
  app.get('/api/stats', async () => state.getSnapshot().stats);
  app.get('/api/network', { config: { compress: true } }, async (req, reply) => {
    const network = state.index?.network;
    if (!network) return reply.code(503).send(unavailable());
    const etag = `"${network.version}"`;
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.header('ETag', etag).header('Cache-Control', 'public,max-age=60').send(network);
  });
  app.get('/api/search', async (req) => {
    const q = z.object({ q: z.string().max(100).default('') }).safeParse(req.query);
    if (!q.success) return [];
    const term = q.data.q.toLocaleLowerCase().trim();
    if (!term) return [];
    const results: SearchResult[] = [];
    for (const r of state.index?.routes.values() ?? [])
      if (`${r.shortName} ${r.longName}`.toLowerCase().includes(term))
        results.push({
          type: 'route',
          id: r.id,
          title: `${r.shortName} ${r.longName}`,
          subtitle: 'Route',
        });
    for (const v of state.vehicles.values())
      if (`${v.id} ${v.label ?? ''}`.toLowerCase().includes(term))
        results.push({
          type: 'vehicle',
          id: v.id,
          title: v.label || v.id,
          subtitle: `Vehicle · ${v.destination ?? v.routeId ?? 'Muni'}`,
          lat: v.lat,
          lon: v.lon,
        });
    for (const s of state.index?.stops.values() ?? [])
      if (s.name.toLowerCase().includes(term) || s.id === term || s.code === term)
        results.push({
          type: 'stop',
          id: s.id,
          title: s.name,
          subtitle: `Stop ${s.code ?? s.id}`,
          lat: s.lat,
          lon: s.lon,
        });
    return results.slice(0, 30);
  });
  app.get('/api/realtime/stream', async (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    streams.add(raw);
    // hijack bypasses Fastify's normal response handling, including CORS headers.
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) raw.setHeader(name, value);
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const snapshot = state.getSnapshot();
    raw.write(
      `id: ${snapshot.version}\nevent: initial_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    );
    const listener = (delta: TransitDelta) => {
      if (raw.writableLength > 2_000_000) {
        raw.end();
        return;
      }
      raw.write(`id: ${delta.version}\nevent: transit_delta\ndata: ${JSON.stringify(delta)}\n\n`);
    };
    state.events.on('delta', listener);
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15000);
    req.raw.on('close', () => {
      streams.delete(raw);
      clearInterval(heartbeat);
      state.events.off('delta', listener);
    });
  });
  app.get('/api/map/status', async () => {
    try {
      await access(resolve(config.dataDir, 'sf.pmtiles'));
      return { ready: true };
    } catch {
      return { ready: false };
    }
  });
  app.get('/map-assets/sf.pmtiles', async (_req, reply) =>
    reply.header('Cache-Control', 'public,max-age=86400').sendFile('sf.pmtiles', config.dataDir),
  );
  app.get('/map-assets/fonts/:font/:range', async (req, reply) => {
    const { font, range } = req.params as { font: string; range: string };
    if (!/^[\w -]+$/.test(font) || !/^\d+-\d+\.pbf$/.test(range)) return reply.code(400).send();
    return reply
      .header('Cache-Control', 'public,max-age=31536000')
      .sendFile(`${font}/${range}`, resolve(config.dataDir, 'fonts'));
  });
  app.get('/*', async (req, reply) => {
    if (!config.serveFrontend) return reply.code(404).send({ error: 'not_found' });
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    const path = req.url.split('?')[0].slice(1);
    const root = resolve('dist/client');
    if (path && !path.includes('..')) {
      try {
        await access(resolve(root, path));
        return reply.sendFile(path, root);
      } catch {
        /* SPA fallback */
      }
    }
    return reply.sendFile('index.html', root);
  });
  return app;
}
