import { test, expect } from '@playwright/test';

test('live USB boards feed the diagnostic display and reset zero independently', async ({ page }) => {
  test.skip(!process.env.TEST_HARDWARE, 'Set TEST_HARDWARE=1 with both configured boards connected.');
  const errors: string[] = [];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/?sensors');
  await expect(page.getByRole('heading', { name:'Sensor lab', exact:true })).toBeVisible();
  await expect(page.locator('#bridge-status')).toHaveText('2 of 2 sensors live', {timeout:15000});
  await expect(page.locator('.sensor-graph')).toHaveCount(3);
  for (const side of ['L','R']) {
    await expect(page.locator(`[data-side="${side}"] [data-field="status"]`)).toHaveText('Live');
    await expect(page.locator(`[data-side="${side}"] [data-value="zero-0"]`)).not.toHaveText('—');
  }
  await page.getByRole('button', { name:'Reset zero', exact:true }).click();
  await expect(page.locator('#zero-status')).toContainText('Baselines set');
  await page.locator('[data-zero="L"]').click();
  await expect(page.locator('#zero-status')).toContainText('Baselines set');
  await page.locator('#dead-zone').fill('0.12');
  await expect(page.locator('#dead-value')).toHaveText('0.12 g');
  await page.waitForTimeout(500);
  await page.screenshot({ path:'test-results/sensors-live.png', fullPage:true });
  await page.locator('#sensor-panel').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path:'test-results/sensors-diagrams.png' });
  await page.getByRole('button',{name:'Back to game'}).click();
  await expect(page.locator('#sensor-panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('known sensor changes reach their own diagrams, and reset uses a fresh sample', async ({page}) => {
  await page.addInitScript(() => {
    let receiver: { onmessage: ((event: {data:string})=>void) | null };
    class TestSource {
      onmessage: ((event:{data:string})=>void) | null = null;
      onerror = null;
      constructor() { receiver = this; }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', {value:TestSource});
    Object.assign(window,{ feedSensors: (x:number) => receiver.onmessage?.({ data:JSON.stringify({throughAt:Date.now(),overflow:false, samples:['L','R'].map(side=>({side,at:Date.now(),frame:{side,sequence:1,timeUs:1,acceleration:side==='L'?[x,0,0]:[0,1,0],gyro:[0,0,0]}})), links:['L','R'].map(side=>({
      side, path:side==='L'?'/dev/cu.usbmodem21401':'/dev/cu.usbmodem21101', connected:true,
      message:'Test fixture',receivedAt:Date.now(),frames:1,rejected:0,
      frame:{side,sequence:1,timeUs:1,acceleration:side==='L'?[x,0,0]:[0,1,0],gyro:[0,0,0]},
    }))}) }) });
  });
  await page.goto('/?sensors');
  const feed = (x:number) => page.evaluate(value => (window as unknown as {feedSensors:(x:number)=>void}).feedSensors(value),x);
  await feed(1);
  await expect(page.locator('[data-side="L"] [data-value="zero-0"]')).toHaveText('+1.000');
  await page.waitForTimeout(150);
  await feed(1.5);
  await expect(page.locator('[data-side="L"] [data-value="used-0"]')).not.toHaveText('0.000');
  await expect(page.locator('[data-side="R"] [data-value="used-0"]')).toHaveText('0.000');
  await expect(page.locator('#trace-0-L')).toHaveAttribute('d', /L/);
  await page.getByRole('button',{name:'Reset zero',exact:true}).click();
  await expect(page.locator('[data-side="L"] [data-value="zero-0"]')).toHaveText('—');
  await feed(1.5);
  await expect(page.locator('[data-side="L"] [data-value="zero-0"]')).toHaveText('+1.500');
  await expect(page.locator('[data-side="L"] [data-value="used-0"]')).toHaveText('0.000');
  await expect(page.locator('[data-side="L"] [data-field="status"]')).toHaveText('No fresh data', {timeout:3000});
  await expect(page.locator('[data-side="L"] [data-value="used-0"]')).toHaveText('—');
});

test('sensor lab presents waiting state when the local reader is unavailable', async ({page}) => {
  await page.route('**/api/sensors', route=>route.abort());
  await page.goto('/?sensors');
  await expect(page.locator('#bridge-status')).toContainText('disconnected');
  await expect(page.locator('[data-side="L"] [data-value="used-0"]')).toHaveText('—');
  await page.getByRole('button',{name:'Reset zero',exact:true}).click();
  await expect(page.locator('#zero-status')).toContainText('next valid reading');
});
