import { chromium, expect } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { config } from '../src/server/config/index.js';
import type { TransitSnapshot } from '../src/shared/types.js';

const origin = process.env.LIVE_TEST_URL ?? 'http://127.0.0.1:5173';
const backend = process.env.LIVE_API_URL ?? origin;
const snapshot = async (): Promise<TransitSnapshot> => {
  const response = await fetch(`${backend}/api/realtime/snapshot`);
  if (!response.ok) throw new Error('Snapshot unavailable');
  return response.json() as Promise<TransitSnapshot>;
};
const first = await snapshot();
if (first.status.source !== 'live' || first.status.status !== 'ok')
  throw new Error('Live feeds must be healthy before verification');
// A reported prediction may already be in the past or belong to a stop whose
// last trip is ending. Select an actual upcoming board before testing its UI.
let vehicle: TransitSnapshot['vehicles'][number] | undefined;
for (const candidate of first.vehicles.filter(
  (v) =>
    !v.stale &&
    (v.nextStop?.predictedArrival ?? 0) > first.status.now + 30000 &&
    (v.nextStop?.predictedArrival ?? Infinity) < first.status.now + 3600000,
)) {
  const board = (await (
    await fetch(`${backend}/api/stops/${candidate.nextStop!.id}/arrivals`)
  ).json()) as { realtime: boolean; tripId: string }[];
  if (board.some((a) => a.realtime && a.tripId === candidate.tripId)) {
    vehicle = candidate;
    break;
  }
}
if (!vehicle) throw new Error('No vehicle with an upcoming realtime board available');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const assetUrls = new Set<string>();
  page.on('pageerror', () => errors.push('Browser page exception'));
  page.on('request', (r) => {
    if (r.url().includes('api.511.org') || (config.apiKey && r.url().includes(config.apiKey)))
      errors.push('Browser upstream request or credential exposure');
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.origin === new URL(origin).origin &&
      url.pathname.startsWith('/assets/') &&
      url.pathname.endsWith('.js')
    )
      assetUrls.add(url.href);
  });
  await page.goto(origin);
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await expect
    .poll(async () => Number(await page.locator('.network-summary strong').innerText()))
    .toBeGreaterThan(0);
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
      !m ||
      (m.renderMetrics.vehicles > 0 && m.renderMetrics.vehicles === m.getState().vehicles.size)
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
  await expect(page.locator('.arrival').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  const arrivals = (await (
    await fetch(`${backend}/api/stops/${vehicle.nextStop!.id}/arrivals`)
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
  // Fetch observed public assets independently: navigation can evict Chromium's
  // response bodies, even though those scripts loaded and ran successfully.
  if (!assetUrls.size) throw new Error('No hosted client assets observed');
  for (const url of assetUrls) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Hosted client asset unavailable');
    if (config.apiKey && (await response.text()).includes(config.apiKey))
      errors.push('Hosted client asset contains credential');
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
