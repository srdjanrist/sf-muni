import { chromium, expect } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { config } from '../src/server/config/index.js';
import type { TransitSnapshot } from '../src/shared/types.js';

const origin = process.env.LIVE_TEST_URL ?? 'http://127.0.0.1:5173';
const snapshot = async (): Promise<TransitSnapshot> => {
  const response = await fetch(`${origin}/api/realtime/snapshot`);
  if (!response.ok) throw new Error('Snapshot unavailable');
  return response.json() as Promise<TransitSnapshot>;
};
const first = await snapshot();
if (first.status.source !== 'live' || first.status.status !== 'ok')
  throw new Error('Live feeds must be healthy before verification');
const vehicle = first.vehicles.find((v) => v.nextStop?.predictedArrival && !v.stale);
if (!vehicle) throw new Error('No vehicle with a live next-stop prediction available');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('Browser page exception'));
  page.on('request', (r) => {
    if (r.url().includes('api.511.org') || (config.apiKey && r.url().includes(config.apiKey)))
      errors.push('Browser upstream request or credential exposure');
  });
  await page.goto(origin);
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await page.waitForFunction(() => {
    const m = (
      window as unknown as {
        __muni?: {
          renderMetrics: { vehicles: number };
          getState: () => { vehicles: Map<string, unknown> };
        };
      }
    ).__muni;
    return (
      m && m.renderMetrics.vehicles > 0 && m.renderMetrics.vehicles === m.getState().vehicles.size
    );
  });
  await expect(page.getByText('511 SF BAY · OFFICIAL FEED')).toBeVisible();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/live-overview.png' });
  await page.goto(`${origin}/?vehicle=${encodeURIComponent(vehicle.id)}`);
  await expect(page.getByRole('button', { name: /Follow vehicle/ })).toBeVisible();
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/live-vehicle.png' });
  await page.goto(`${origin}/?stop=${encodeURIComponent(vehicle.nextStop!.id)}`);
  await expect(page.getByText('UPCOMING DEPARTURES')).toBeVisible();
  await expect(page.locator('.arrival').first()).toBeVisible();
  const arrivals = (await (
    await fetch(`${origin}/api/stops/${vehicle.nextStop!.id}/arrivals`)
  ).json()) as { realtime: boolean }[];
  if (!arrivals.some((a) => a.realtime)) throw new Error('Selected board has no realtime arrivals');
  console.log(
    JSON.stringify({
      source: 'live',
      vehicles: first.vehicles.length,
      tripUpdates: first.status.feeds.tripUpdates.count,
      alerts: first.alerts.length,
      selectedVehicle: vehicle.id,
      route: vehicle.routeId,
      predictedBoardVerified: true,
    }),
  );
  await expect
    .poll(async () => (await snapshot()).status.feeds.vehiclePositions.lastSuccess, {
      timeout: 150000,
      intervals: [5000],
    })
    .not.toBe(first.status.feeds.vehiclePositions.lastSuccess);
  const second = await snapshot();
  const old = new Map(first.vehicles.map((v) => [v.id, v]));
  const stable = second.vehicles.filter((v) => old.has(v.id));
  const moved = stable.filter((v) => v.lat !== old.get(v.id)!.lat || v.lon !== old.get(v.id)!.lon);
  if (!stable.length || !moved.length) throw new Error('No stable moving IDs across live polls');
  for (const file of await readdir('dist/client/assets')) {
    if (!file.endsWith('.js')) continue;
    const text = await readFile(`dist/client/assets/${file}`, 'utf8');
    if (config.apiKey && text.includes(config.apiKey))
      errors.push('Client asset contains credential');
  }
  if (errors.length || (await page.locator('.map-error').count()))
    throw new Error(errors.join('; ') || 'Map error');
  console.log(
    JSON.stringify({
      stableIdsAcrossPolls: stable.length,
      changedPositions: moved.length,
      clientSecretCheck: 'passed',
      pageErrors: 0,
    }),
  );
} finally {
  await browser.close();
}
