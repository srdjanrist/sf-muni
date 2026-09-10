import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
import type { FeedName } from '../../shared/types.js';
const endpoints: Record<FeedName | 'static', string> = {
  vehiclePositions: 'vehiclepositions',
  tripUpdates: 'tripupdates',
  serviceAlerts: 'servicealerts',
  static: 'datafeeds',
};
export class UpstreamError extends Error {
  constructor(
    public code: string,
    public retryAt = 0,
  ) {
    super(code);
  }
}
export class TransitApiClient {
  requests: number[] = [];
  pausedUntil = 0;
  private initialized = false;
  private serial: Promise<unknown> = Promise.resolve();
  get budget() {
    return {
      used: this.requests.filter((t) => t > Date.now() - 3600000).length,
      limit: config.requestLimit,
      pausedUntil: this.pausedUntil || undefined,
    };
  }
  async init() {
    if (this.initialized) return;
    await mkdir(config.dataDir, { recursive: true });
    try {
      const data = JSON.parse(await readFile(join(config.dataDir, 'budget.json'), 'utf8')) as {
        requests: number[];
        pausedUntil: number;
      };
      this.requests = data.requests;
      this.pausedUntil = data.pausedUntil;
    } catch {
      /* New installation has an empty budget. */
    }
    this.initialized = true;
  }
  async request(feed: FeedName | 'static'): Promise<Uint8Array> {
    const operation = this.serial.then(() => this.perform(feed));
    this.serial = operation.catch(() => undefined);
    return operation;
  }
  private async perform(feed: FeedName | 'static') {
    await this.init();
    if (!config.apiKey) throw new UpstreamError('missing_api_key');
    // A file lock also serializes maintenance commands with the running poller.
    const lockPath = join(config.dataDir, 'upstream.lock');
    let lock;
    try {
      lock = await open(lockPath, 'wx');
    } catch {
      // Fetch's abort signal bounds lock ownership. Recover a lock left behind by a killed process.
      const metadata = await stat(lockPath).catch(() => undefined);
      if (
        metadata &&
        Date.now() - metadata.mtimeMs > Math.max(config.timeoutMs, config.staticTimeoutMs) + 60000
      )
        await unlink(lockPath).catch(() => undefined);
      throw new UpstreamError('scheduler_busy', Date.now() + 5000);
    }
    try {
      try {
        const saved = JSON.parse(await readFile(join(config.dataDir, 'budget.json'), 'utf8')) as {
          requests: number[];
          pausedUntil: number;
        };
        this.requests = saved.requests;
        this.pausedUntil = saved.pausedUntil;
      } catch {
        /* First request. */
      }
      const now = Date.now();
      this.requests = this.requests.filter((t) => t > now - 3600000);
      if (now < this.pausedUntil) throw new UpstreamError('upstream_backoff', this.pausedUntil);
      if (this.requests.length >= config.requestLimit)
        throw new UpstreamError('request_budget_exhausted', this.requests[0] + 3600100);
      this.requests.push(now);
      await this.saveBudget();
      const url = new URL(endpoints[feed], config.baseUrl);
      url.searchParams.set('api_key', config.apiKey);
      url.searchParams.set(feed === 'static' ? 'operator_id' : 'agency', config.operatorId);
      if (feed === 'static') url.searchParams.set('status', 'active');
      // VehiclePositions/TripUpdates reject format=protobuf with a 200 "No Data Found".
      // Request the native protobuf representation through Accept instead.
      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(
            feed === 'static' ? config.staticTimeoutMs : config.timeoutMs,
          ),
          headers: {
            Accept: feed === 'static' ? 'application/zip' : 'application/x-google-protobuf',
          },
        });
      } catch {
        throw new UpstreamError('upstream_timeout_or_network_error');
      }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        this.pausedUntil =
          now +
          Math.max(
            60000,
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Date.parse(retry) - now || 60000
                : 60000,
          );
        await this.saveBudget();
        throw new UpstreamError('upstream_rate_limited', this.pausedUntil);
      }
      if (!response.ok) throw new UpstreamError(`upstream_http_${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new UpstreamError('upstream_empty_body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const limit = feed === 'static' ? 150_000_000 : 25_000_000;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new UpstreamError('upstream_payload_too_large');
          }
          chunks.push(value);
        }
      } catch (error) {
        throw error instanceof UpstreamError
          ? error
          : new UpstreamError('upstream_body_read_failed');
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      return buffer;
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
  private async saveBudget() {
    const path = join(config.dataDir, 'budget.json');
    await writeFile(
      `${path}.tmp`,
      JSON.stringify({ requests: this.requests, pausedUntil: this.pausedUntil }),
    );
    await rename(`${path}.tmp`, path);
  }
}
