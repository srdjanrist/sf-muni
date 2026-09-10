import { access, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
export async function ensureMapAssets() {
  await mkdir(config.dataDir, { recursive: true });
  try {
    await access(join(config.dataDir, 'sf.pmtiles'));
  } catch {
    await cp(join(config.fixtureDir, 'map', 'sf.pmtiles'), join(config.dataDir, 'sf.pmtiles'));
  }
  try {
    await access(join(config.dataDir, 'fonts', 'Noto Sans Regular', '0-255.pbf'));
  } catch {
    await cp(join(config.fixtureDir, 'map', 'fonts'), join(config.dataDir, 'fonts'), {
      recursive: true,
    });
  }
}
