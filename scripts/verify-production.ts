import { chromium } from '@playwright/test';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { config } from '../src/server/config/index.js';
const origin = process.env.PRODUCTION_TEST_URL ?? 'http://127.0.0.1:3002';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const forbidden: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('api.511.org') || (config.apiKey && r.url().includes(config.apiKey)))
      forbidden.push('Browser contacted upstream or exposed key');
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  await page.goto(origin);
  await page.getByTestId('city-map').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="city-map"]')?.getAttribute('data-ready') === 'true',
    {},
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: /N Judah/i }).click();
  await page.locator('.route-vehicles button').first().click();
  await page.getByRole('button', { name: /Follow vehicle/ }).waitFor();
  await page.waitForTimeout(1800);
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/production-vehicle.png', fullPage: true });
  if (await page.locator('.map-error').count())
    errors.push(await page.locator('.map-error').innerText());
  for (const file of await readdir('dist/client/assets'))
    if (file.endsWith('.js')) {
      const content = await readFile(`dist/client/assets/${file}`, 'utf8');
      if (config.apiKey && content.includes(config.apiKey))
        forbidden.push('Client bundle contains configured key');
      if (content.includes('api.511.org'))
        forbidden.push('Client bundle contains upstream endpoint');
    }
  if (errors.length || forbidden.length)
    throw new Error(JSON.stringify({ errors, securityFailures: forbidden }));
  console.log(
    'Production map worker, vector tiles, route/vehicle selection, console, and client-secret checks passed.',
  );
} finally {
  await browser.close();
}
