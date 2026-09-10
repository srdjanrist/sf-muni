import { test, expect } from '@playwright/test';
test('map renders, all reported vehicles appear, motion and selection work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await expect(
    page.getByText('Demo playback · Real Muni geography, simulated service'),
  ).toBeVisible();
  await page.waitForFunction(() => {
    const w = window as unknown as { __muni?: { renderMetrics: { vehicles: number } } };
    return (w.__muni?.renderMetrics.vehicles ?? 0) > 100;
  });
  const counts = await page.evaluate(() => {
    const m = (
      window as unknown as {
        __muni: {
          renderMetrics: { vehicles: number; fps: number };
          getState: () => { vehicles: Map<string, unknown> };
        };
      }
    ).__muni;
    return {
      rendered: m.renderMetrics.vehicles,
      network: m.getState().vehicles.size,
      fps: m.renderMetrics.fps,
    };
  });
  expect(counts.rendered).toBe(counts.network);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.getByRole('button', { name: /N Judah/i }).click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await expect(page).toHaveURL(/route=/);
  await page.locator('.route-vehicles button').first().click();
  await expect(page.getByRole('button', { name: /Follow vehicle/i })).toBeVisible();
  await expect(page).toHaveURL(/vehicle=/);
  await page.getByRole('button', { name: /Follow vehicle/i }).click();
  await expect(page.locator('.follow-banner')).toBeVisible();
  await page.locator('.follow-banner').click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/vehicle.png', fullPage: true });
  await page.locator('.stop-timeline button').nth(1).click();
  await expect(page.getByText('UPCOMING DEPARTURES')).toBeVisible();
  await expect(page).toHaveURL(/stop=/);
  await expect(page.locator('.arrival').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('UPCOMING DEPARTURES')).toBeVisible();
  expect(errors).toEqual([]);
});
test('search, filters, modes and mobile display', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('city-map')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await page.getByRole('textbox', { name: 'Search routes, stops, vehicles' }).fill('Castro');
  await expect(page.locator('.search-results button:not(.close-search)').first()).toBeVisible();
  await page.locator('.search-results button:not(.close-search)').first().click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Route filter').selectOption('N');
  await expect(page.getByLabel('Route filter')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Close filters' }).click();
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  await expect(page).toHaveURL(/mode=delay/);
  await expect(page.getByText('SCHEDULE DEVIATION', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await expect(page.getByRole('switch', { name: 'Reduced graphics' })).toBeVisible();
  await page.getByRole('switch', { name: 'Reduced graphics' }).check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('textbox', { name: 'Search routes, stops, vehicles' }).fill('N Judah');
  await page.locator('.search-results button:not(.close-search)').first().click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await expect(page.locator('.map-error')).toHaveCount(0);
});
