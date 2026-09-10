import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// The checked-in SF extract keeps the normal local setup independent of another credential or binary.
export async function prepareMap() {
  await mkdir(resolve('data'), { recursive: true });
  try {
    await access(resolve('data/sf.pmtiles'));
  } catch {
    await cp(resolve('fixtures/map/sf.pmtiles'), resolve('data/sf.pmtiles'));
  }
  await cp(resolve('fixtures/map/fonts'), resolve('data/fonts'), { recursive: true });
  await writeFile(
    resolve('data/map-source.json'),
    JSON.stringify({
      source: 'Protomaps / OpenStreetMap',
      build: '20260908',
      bounds: [-122.535, 37.69, -122.345, 37.84],
      maxZoom: 15,
    }),
  );
}
await prepareMap();
console.log('San Francisco basemap and fonts ready.');
