import { test, expect, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(async () => {
  const moduleUrl = document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
  const { game } = await import(/* @vite-ignore */ moduleUrl);
  return game.registry.get('gameState');
});

test('keyboard charging, squeeze overlap, blur cancellation, complete round and restart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(async () => (await state(page))?.phase).toBe('ready');
  await page.screenshot({ path: 'test-results/ready.png' });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).phase).toBe('countdown');
  await expect.poll(async () => (await state(page)).phase, { timeout: 6000 }).toBe('playing');

  // A tap is too weak; a long hold only scores once on release.
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await state(page)).attempts).toBe(1);
  expect((await state(page)).score).toBe(0);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(650);
  await page.keyboard.down('ArrowUp');
  expect((await state(page)).attempts).toBe(1);
  await page.screenshot({ path: 'test-results/charging.png' });
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await expect.poll(async () => (await state(page)).popped).toBe(1);
  expect((await state(page)).target.kind).toBe('squeeze');
  expect((await state(page)).score).toBe(150);

  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1250);
  await page.keyboard.up('ArrowLeft');
  expect((await state(page)).popped).toBe(1);
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => (await state(page)).popped).toBe(2);
  expect((await state(page)).combo).toBe(2);

  const attempts = (await state(page)).attempts;
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
  expect((await state(page)).attempts).toBe(attempts);
  await page.screenshot({ path: 'test-results/playing.png' });

  await expect.poll(async () => (await state(page)).phase, { timeout: 50_000 }).toBe('results');
  expect((await state(page)).remainingMs).toBe(0);
  await page.screenshot({ path: 'test-results/results.png' });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).phase, { timeout: 6000 }).toBe('playing');
  const restarted = await state(page);
  expect(restarted.score).toBe(0);
  expect(restarted.combo).toBe(0);
  expect(restarted.popped).toBe(0);
  expect(restarted.remainingMs).toBeGreaterThan(43_000);
  expect(errors).toEqual([]);
});
