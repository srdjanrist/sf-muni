import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../src/server/config/index.js';
import { TransitApiClient } from '../src/server/upstream/client.js';
import { downloadGtfs, importGtfs } from '../src/server/gtfs/loader.js';
const command = process.argv[2];
const client = new TransitApiClient();
if (command === 'download' || command === 'parse') {
  const index =
    command === 'download'
      ? await downloadGtfs(client)
      : await importGtfs(
          process.argv[3] ?? join(config.dataDir, 'gtfs.zip'),
          process.argv[4] ?? 'local GTFS archive',
          !process.argv.includes('--no-cache'),
        );
  console.log(
    JSON.stringify({
      message: 'GTFS import completed',
      routes: index.routes.size,
      stops: index.stops.size,
      trips: index.trips.size,
      shapes: index.shapes.size,
      warnings: index.snapshot.warnings,
      source: index.snapshot.source,
    }),
  );
} else if (command === 'record') {
  if (!config.apiKey) throw new Error('Configure 511_API_KEY in the server .env file first');
  await mkdir(join(config.fixtureDir, 'recorded'), { recursive: true });
  for (const [feed, file] of [
    ['vehiclePositions', 'vehicle-positions'],
    ['tripUpdates', 'trip-updates'],
    ['serviceAlerts', 'service-alerts'],
  ] as const) {
    const bytes = await client.request(feed);
    await writeFile(join(config.fixtureDir, 'recorded', `${file}.pb`), bytes);
  }
  const staticData = await readFile(join(config.dataDir, 'static.json'));
  await writeFile(join(config.fixtureDir, 'recorded', 'static.json'), staticData);
  await writeFile(
    join(config.fixtureDir, 'recorded', 'manifest.json'),
    JSON.stringify(
      {
        recordedAt: Date.now(),
        source: '511 SF',
        note: 'Recorded historical observation; not live.',
      },
      null,
      2,
    ),
  );
  console.log('Recorded three feeds and matching static snapshot; no credentials included.');
} else throw new Error('Usage: transit.ts download | parse [zip] [source] [--no-cache] | record');
