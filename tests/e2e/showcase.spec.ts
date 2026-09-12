import { test, expect } from '@playwright/test';

test('showcase starts, counts down, stops, and explains cooldown on desktop and mobile', async ({
  page,
}) => {
  let active = false,
    used = false;
  const burst = () => ({
    active,
    available: !used,
    durationMs: 60000,
    intervalMs: 20000,
    endsAt: active ? Date.now() + 60000 : undefined,
    availableAt: used ? Date.now() + 3600000 : undefined,
    reason: used ? 'The shared showcase cooldown is active.' : undefined,
  });
  await page.route('**/api/system/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), source: 'live', showcase: burst() },
    });
  });
  await page.route('**/api/system/showcase', async (route) => {
    active = route.request().method() === 'POST';
    used = true;
    await route.fulfill({ json: burst() });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Showcase mode' }).click();
  await expect(page.getByRole('button', { name: 'Start 60-second burst' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start 60-second burst' }).click();
  await expect(page.getByText(/remaining · Faster GPS polling/)).toBeVisible();
  await expect(page.getByText(/Motion between observations is estimated/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop burst' }).click();
  await expect(page.getByRole('button', { name: 'Start 60-second burst' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Showcase controls' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/showcase-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Showcase controls' })).not.toBeVisible();
});
