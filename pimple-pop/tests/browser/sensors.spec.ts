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

test('lab pressure meters show raw peaks, tune live values, and clear on zero or connection loss', async ({page}) => {
  await page.addInitScript(() => {
    let receiver: {onmessage:((event:{data:string})=>void)|null;onerror:(()=>void)|null};
    let current=[0,0]; let connected=true;
    class TestSource { onmessage=null; onerror=null; constructor(){receiver=this;} close(){} }
    Object.defineProperty(window,'EventSource',{value:TestSource});
    const send=(spike?:number[])=>{
      if(!connected)return;
      const at=Date.now();
      const frame=(side:string,values:number[])=>({side,sequence:at,timeUs:at,acceleration:[1+values[0],0,values[1]],gyro:[0,0,0]});
      const samples=['L','R'].flatMap(side=>[...(spike?[{side,at,frame:frame(side,spike)}]:[]),{side,at,frame:frame(side,current)}]);
      receiver?.onmessage?.({data:JSON.stringify({throughAt:at,overflow:false,samples,links:['L','R'].map(side=>({side,path:'mock',connected:true,message:'Pressure fixture',receivedAt:at,frames:1,rejected:0,frame:frame(side,current)}))})});
    };
    setInterval(()=>send(),50);
    Object.assign(window,{meterFeed:(values:number[],spike=false)=>{if(spike)send(values);else{current=values;send();}},meterDisconnect:()=>{connected=false;receiver.onerror?.();}});
  });
  await page.goto('/');
  const gameState=()=>page.evaluate(async()=>{const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;return (await import(url)).game.registry.get('gameState');});
  await expect.poll(async()=>(await gameState())?.phase).toBe('ready');
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await gameState()).phase).toBe('playing');
  await page.evaluate(()=>window.dispatchEvent(new Event('sensor-lab')));
  await expect(page.locator('#pressure-status')).toContainText('Sensors live');
  const feed=(values:number[],spike=false)=>page.evaluate(({values,spike})=>(window as unknown as {meterFeed:(values:number[],spike:boolean)=>void}).meterFeed(values,spike),{values,spike});
  const punch=page.locator('[data-pressure="punch"]'); const squeeze=page.locator('[data-pressure="squeeze"]');
  await feed([1.56,.66],true);
  await expect(punch.locator('[data-live]')).toHaveText('0%');
  await expect(punch.locator('[data-peak]')).toHaveText('50%');
  await expect(squeeze.locator('[data-peak]')).toHaveText('50%');
  await expect(punch.locator('[data-peak]')).toHaveText('0%',{timeout:2000});
  await feed([1.56,.66]);
  await expect(punch.locator('[data-live]')).toHaveText('50%');
  await expect(squeeze.locator('[data-live]')).toHaveText('50%');
  await page.getByLabel('Punch power sensitivity',{exact:false}).fill('6');
  await page.getByLabel('Punch power sensitivity',{exact:false}).press('Tab');
  await expect(punch.locator('[data-live]')).toHaveText('25%');
  await expect(squeeze.locator('[data-live]')).toHaveText('50%');
  await expect(punch.getByRole('progressbar')).toHaveAttribute('aria-valuenow','25');
  await expect(punch.locator('[data-trigger]')).toContainText('3.3%');
  expect((await gameState()).attempts).toBe(0);
  await page.locator('.sensor-pressure').screenshot({path:'test-results/lab-pressure-normal.png'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.sensor-pressure').scrollIntoViewIfNeeded();
  expect(await page.locator('#sensor-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('.sensor-pressure').screenshot({path:'test-results/lab-pressure-small.png'});
  await page.getByRole('button',{name:'Reset zero',exact:true}).click();
  await expect(punch.locator('[data-live]')).toHaveText('0%');
  await expect(punch.locator('[data-peak]')).toHaveText('0%');
  await expect(squeeze.locator('[data-peak]')).toHaveText('0%');
  await feed([3.12,1.32]);
  await expect(punch.locator('[data-live]')).toHaveText('25%');
  await page.evaluate(()=>(window as unknown as {meterDisconnect:()=>void}).meterDisconnect());
  await expect(punch.locator('[data-live]')).toHaveText('—');
  await expect(squeeze.locator('[data-peak]')).toHaveText('—');
  await expect(punch.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(page.locator('#pressure-status')).toContainText('Waiting');
  expect((await gameState()).attempts).toBe(0);
});
