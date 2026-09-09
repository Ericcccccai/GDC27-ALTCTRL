import { test, expect } from '@playwright/test';

test('fullscreen and a smaller display keep the game available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(async () => {
    const url = document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    return (await import(url)).game.registry.get('gameState')?.phase === 'ready';
  });
  await page.mouse.click(1183, 56);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.waitForTimeout(200);
  const box = await page.locator('canvas').boundingBox();
  expect(box?.width).toBe(960);
  expect(box?.height).toBe(600);
  await page.screenshot({ path: 'test-results/small-display.png' });
});
