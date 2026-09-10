import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/api/app.js';
import { TransitStateManager } from '../src/server/transit/state-manager.js';
import { ensureMapAssets } from '../src/server/gtfs/map-assets.js';
import { fixtureIndex, NOW, status, vehicle } from './support.js';

const allowed = 'https://muni-example.vercel.app';
const state = new TransitStateManager(status, 180000, 600000, () => NOW);
state.setIndex(fixtureIndex());
state.updateVehicles([vehicle()]);
const app = await createApp(state, [allowed]);
afterAll(() => app.close());

describe('Vercel frontend and VPS backend boundary', () => {
  it('allows exact configured origins and rejects lookalikes and unrelated Vercel projects', async () => {
    const response = await app.inject({ url: '/api/network', headers: { origin: allowed } });
    expect(response.headers['access-control-allow-origin']).toBe(allowed);
    expect(response.headers.vary).toContain('Origin');
    expect(response.headers['access-control-expose-headers']).toContain('ETag');
    for (const origin of ['https://another.vercel.app', `${allowed}.evil.example`, 'null']) {
      const denied = await app.inject({ url: '/api/network', headers: { origin } });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('supports preflight and cross-origin PMTiles range requests', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/map-assets/sf.pmtiles',
      headers: {
        origin: allowed,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'range,if-match',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('Range');
    await ensureMapAssets();
    const range = await app.inject({
      url: '/map-assets/sf.pmtiles',
      headers: { origin: allowed, range: 'bytes=0-126' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(127);
    expect(range.headers['access-control-allow-origin']).toBe(allowed);
    expect(range.headers['access-control-expose-headers']).toContain('Content-Range');
  });
  it('preserves CORS on the hijacked SSE response and sends the initial snapshot', async () => {
    const streamState = new TransitStateManager(status, 180000, 600000, () => NOW);
    streamState.setIndex(fixtureIndex());
    const streamApp = await createApp(streamState, [allowed]);
    let closed: Promise<void> | undefined;
    streamState.events.once('newListener', () => {
      // The handler registers its delta listener after writing the initial snapshot.
      queueMicrotask(() => {
        closed = streamApp.close();
      });
    });
    const response = await streamApp.inject({
      url: '/api/realtime/stream',
      headers: { origin: allowed },
    });
    await closed;
    expect(response.headers['access-control-allow-origin']).toBe(allowed);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');
    expect(response.body).toContain('event: initial_snapshot');
  });
});
