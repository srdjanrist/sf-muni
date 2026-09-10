import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
const options = vi.hoisted(() => ({
  apiKey: 'test-secret-not-for-browser',
  dataDir: `/private/tmp/muni-client-${process.pid}`,
  requestLimit: 2,
  baseUrl: 'https://api.511.org/transit/',
  operatorId: 'SF',
  timeoutMs: 1000,
  staticTimeoutMs: 2000,
}));
vi.mock('../src/server/config/index.js', () => ({ config: options }));
import { TransitApiClient } from '../src/server/upstream/client.js';
beforeEach(async () => {
  await mkdir(options.dataDir, { recursive: true });
  await writeFile(
    `${options.dataDir}/budget.json`,
    JSON.stringify({ requests: [], pausedUntil: 0 }),
  );
  vi.restoreAllMocks();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(options.dataDir, { recursive: true, force: true });
});
describe('central request budget', () => {
  it('enforces one rolling budget across feed types and process clients', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    const a = new TransitApiClient(),
      b = new TransitApiClient();
    await a.request('vehiclePositions');
    const [url, init] = fetch.mock.calls[0];
    expect(url.searchParams.has('format')).toBe(false);
    expect(init.headers.Accept).toBe('application/x-google-protobuf');
    fetch.mockResolvedValue(new Response(new Uint8Array([1])));
    await b.request('tripUpdates');
    await expect(a.request('static')).rejects.toThrow('request_budget_exhausted');
    expect(fetch).toHaveBeenCalledTimes(2);
    const budget = JSON.parse(await readFile(`${options.dataDir}/budget.json`, 'utf8'));
    expect(budget.requests).toHaveLength(2);
  });
  it('honors 429 Retry-After across all endpoints without leaking keys', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    const client = new TransitApiClient();
    await expect(client.request('vehiclePositions')).rejects.toThrow('upstream_rate_limited');
    expect(client.pausedUntil).toBeGreaterThan(Date.now() + 110000);
    await expect(client.request('tripUpdates')).rejects.toThrow('upstream_backoff');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('sanitizes transport errors containing URLs and credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new Error(`request https://api.511.org/?api_key=${options.apiKey} failed`),
        ),
    );
    await expect(new TransitApiClient().request('vehiclePositions')).rejects.toThrow(
      'upstream_timeout_or_network_error',
    );
  });
});
