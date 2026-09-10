import { test, expect } from '@playwright/test';
import type { VehicleSimulation } from '../../src/client/simulation/VehicleSimulation';
import type { VehicleState } from '../../src/shared/types';
import type { Map as LibreMap } from 'maplibre-gl';
interface Debug {
  simulation: VehicleSimulation;
  renderMetrics: {
    fps: number;
    vehicles: number;
    drawCalls: number;
    triangles: number;
    frameMs: number;
  };
  getState: () => { vehicles: Map<string, VehicleState>; offset: number };
  getMap: () => LibreMap;
}
declare global {
  interface Window {
    __muni: Debug;
  }
}
test('visible motion, map picking, and SSE interruption preserve the network', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__muni?.simulation.tracks.size > 100);
  await page.waitForFunction(() =>
    [...window.__muni.simulation.tracks.values()].some((t) => t.network.speedMps && t.shape),
  );
  const sample = await page.evaluate(() => {
    const t = [...window.__muni.simulation.tracks.values()].find(
      (t) => (t.network.speedMps ?? 0) > 3 && t.shape,
    )!;
    return { id: t.network.id, x: t.render.x, z: t.render.z };
  });
  await expect
    .poll(
      () =>
        page.evaluate((s) => {
          const p = window.__muni.simulation.getVehicleState(s.id)!;
          return Math.hypot(p.x - s.x, p.z - s.z);
        }, sample),
      { timeout: 15000 },
    )
    .toBeGreaterThan(2);
  const point = await page.evaluate(() => {
    const m = window.__muni.getMap();
    for (const t of window.__muni.simulation.tracks.values()) {
      const p = m.project([t.render.lon, t.render.lat]);
      if (p.x > 400 && p.x < 1000 && p.y > 250 && p.y < 700) return { x: p.x, y: p.y };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await context.setOffline(true);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__muni.simulation.tracks.size)).toBeGreaterThan(100);
  await context.setOffline(false);
  await expect
    .poll(() => page.evaluate(() => window.__muni.renderMetrics.vehicles))
    .toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
test('measures renderer with 500 and 1000 vehicles', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__muni?.renderMetrics.vehicles > 100);
  await page.waitForTimeout(1000);
  const results = [];
  for (const count of [500, 1000]) {
    await page.evaluate((count) => {
      const m = window.__muni,
        vehicles = [...m.getState().vehicles.values()],
        now = Date.now() + m.getState().offset;
      for (let i = m.simulation.tracks.size; i < count; i++) {
        const v = vehicles[i % vehicles.length];
        m.simulation.updateNetworkState({ ...v, id: `LOAD-TEST-${i}` }, now);
      }
    }, count);
    await page.waitForTimeout(3500);
    results.push(
      await page.evaluate(() => ({
        ...window.__muni.renderMetrics,
        hardwareConcurrency: navigator.hardwareConcurrency,
        userAgent: navigator.userAgent,
      })),
    );
  }
  await testInfo.attach('performance.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  console.log('PERFORMANCE', JSON.stringify(results));
  expect(results[1].vehicles).toBeGreaterThanOrEqual(1000);
  expect(results[1].drawCalls).toBeLessThan(25);
});
