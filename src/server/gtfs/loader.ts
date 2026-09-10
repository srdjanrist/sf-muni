import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { StaticSnapshot } from '../../shared/types.js';
import { config } from '../config/index.js';
import { parseGtfs } from './parser.js';
import { GtfsIndex } from './indexes.js';
import type { TransitApiClient } from '../upstream/client.js';
export async function cachedGtfs() {
  try {
    const snapshot = JSON.parse(
      await readFile(join(config.dataDir, 'static.json'), 'utf8'),
    ) as StaticSnapshot;
    if (!snapshot.version || !snapshot.frequencies || !snapshot.shapes.length) return undefined;
    return new GtfsIndex(snapshot);
  } catch {
    return undefined;
  }
}
export async function importGtfs(path: string, source: string, cache = true) {
  const snapshot = await parseGtfs(path, source);
  const index = new GtfsIndex(snapshot);
  if (cache) {
    await mkdir(config.dataDir, { recursive: true });
    const temp = join(config.dataDir, 'static.json.tmp');
    await writeFile(temp, JSON.stringify(snapshot));
    await rename(temp, join(config.dataDir, 'static.json'));
  }
  return index;
}
export async function downloadGtfs(client: TransitApiClient) {
  const bytes = await client.request('static');
  await mkdir(config.dataDir, { recursive: true });
  const path = join(config.dataDir, 'gtfs-pending.zip');
  await writeFile(path, bytes);
  const index = await importGtfs(path, '511 SF / active');
  await rename(path, join(config.dataDir, 'gtfs.zip'));
  return index;
}
