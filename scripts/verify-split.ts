import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const frontend = process.env.SPLIT_FRONTEND_URL ?? 'http://127.0.0.1:5180';
const backend = process.env.SPLIT_BACKEND_URL ?? 'http://127.0.0.1:3101';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [],
    requests = new Set<string>();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/map-assets/')) {
      requests.add(url.pathname);
      if (url.origin !== backend) errors.push('Transit request used the frontend origin');
    }
    if (url.hostname === 'api.511.org') errors.push('Browser contacted upstream');
  });
  await page.goto(frontend);
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  // Production builds deliberately omit the development-only window.__muni hook.
  await expect
    .poll(async () => Number(await page.locator('.network-summary strong').innerText()))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: /N Judah/i }).click();
  await page.locator('.route-vehicles button').first().click();
  await expect(page.getByRole('button', { name: /Follow vehicle/ })).toBeVisible();
  await page.locator('.stop-timeline button').nth(1).click();
  await expect(page.getByText('UPCOMING DEPARTURES')).toBeVisible();
  await expect(page.locator('.arrival').first()).toBeVisible();
  await page.waitForTimeout(2000);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/split-deployment.png' });
  expect(requests.has('/api/realtime/stream')).toBe(true);
  expect(requests.has('/map-assets/sf.pmtiles')).toBe(true);
  expect([...requests].some((p) => p.startsWith('/map-assets/fonts/'))).toBe(true);
  if (await page.locator('.map-error').count())
    errors.push(await page.locator('.map-error').innerText());
  expect(errors).toEqual([]);
  console.log(
    'Separate-origin production frontend + Docker backend: map, range requests, glyphs, SSE, vehicle selection, arrivals, and browser console passed.',
  );
} finally {
  await browser.close();
}
