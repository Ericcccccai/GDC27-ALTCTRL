import { test, expect, type Page } from '@playwright/test';
const state = (page: Page) => page.evaluate(async () => {
  const url = document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
  return (await import(url)).game.registry.get('gameState');
});
test.beforeEach(async ({page}) => {
  await page.addInitScript(()=>{
    let source: {onmessage:((e:{data:string})=>void)|null}; let seq=0;
    class MockSource { onmessage=null; onerror=null; constructor(){source=this;} close(){} }
    Object.defineProperty(window,'EventSource',{value:MockSource});
    const send=(x=0,z=0)=>{
      const at=Date.now();
      const frame=(side:string,dx=0,dz=0)=>({side,sequence:++seq,timeUs:seq*5000,acceleration:[1+dx,0,dz],gyro:[0,0,0]});
      // The snapshot is quiet, but an earlier frame in the same batch contains the impact.
      source?.onmessage?.({data:JSON.stringify({throughAt:Date.now(),overflow:false,links:['L','R'].map(side=>({side,path:'mock',connected:true,message:'Mock raw stream',receivedAt:at,frames:seq,rejected:0,frame:frame(side)})),samples:[{side:'L',at,frame:frame('L',x,z)},{side:'R',at,frame:frame('R',-x,z)},{side:'L',at,frame:frame('L')},{side:'R',at,frame:frame('R')}]})});
    };
    setInterval(()=>send(),50); Object.assign(window,{gesture:send});
  });
});
test('raw sensor batches score punch and squeeze, wrong move, cancellation, arrows ignored and restart', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  await page.keyboard.press('Enter'); await expect.poll(async()=>(await state(page)).phase).toBe('playing'); await page.waitForTimeout(350);
  const gesture=(x:number,z:number)=>page.evaluate(([x,z])=>(window as unknown as {gesture:(x:number,z:number)=>void}).gesture(x,z),[x,z]);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); expect((await state(page)).attempts).toBe(0);
  await gesture(4,0); await expect.poll(async()=>(await state(page)).popped).toBe(1); expect((await state(page)).score).toBe(150);
  await page.waitForTimeout(600); await gesture(0,2); await expect.poll(async()=>(await state(page)).popped).toBe(2); expect((await state(page)).combo).toBe(2);
  await page.waitForTimeout(600); await gesture(0,2); await expect.poll(async()=>(await state(page)).attempts).toBe(3); expect((await state(page)).score).toBe(275); expect((await state(page)).combo).toBe(0);
  await page.waitForTimeout(600); await gesture(4,0); await page.evaluate(()=>window.dispatchEvent(new Event('sensor-lab'))); await page.waitForTimeout(250); expect((await state(page)).attempts).toBe(3);
  await page.getByRole('button',{name:'Back to game'}).click(); await page.waitForTimeout(600);
  await page.screenshot({path:'test-results/playing.png'});
  await expect.poll(async()=>(await state(page)).phase,{timeout:50000}).toBe('results');
  await gesture(4,0); await page.waitForTimeout(200); expect((await state(page)).phase).toBe('results');
  await page.keyboard.press('Enter'); await expect.poll(async()=>(await state(page)).phase).toBe('playing');
  expect((await state(page)).score).toBe(0); expect((await state(page)).attempts).toBe(0); expect(errors).toEqual([]);
});

test('power tuning lowers percentages independently, validates inputs, and survives reload', async ({page}) => {
  await page.goto('/'); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  await page.keyboard.press('Enter'); await expect.poll(async()=>(await state(page)).phase).toBe('playing'); await page.waitForTimeout(350);
  const gesture=(x:number,z:number)=>page.evaluate(([x,z])=>(window as unknown as {gesture:(x:number,z:number)=>void}).gesture(x,z),[x,z]);
  const pressure=()=>page.evaluate(async()=> {
    const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    return (await import(url)).game.scene.getScene('GameScene').children.list.map((item:{text?:string})=>item.text).find((text?:string)=>text?.includes('% · settle'));
  });
  await gesture(1.2,0); await expect.poll(pressure).toBe('PUNCH 38% · settle');
  await expect.poll(async()=>(await state(page)).score).toBe(119);
  await page.waitForTimeout(600); await gesture(0,1.2); await expect.poll(pressure).toBe('SQUEEZE 95% · settle');
  await page.evaluate(()=>window.dispatchEvent(new Event('sensor-lab')));
  const punch=page.getByLabel('Punch power sensitivity',{exact:false});
  const squeeze=page.getByLabel('Squeeze power sensitivity',{exact:false});
  await expect(punch).toHaveValue('3'); await expect(squeeze).toHaveValue('1.2');
  await punch.fill('6'); await punch.press('Tab'); await expect(page.locator('#tuning-status')).toContainText('Saved');
  await squeeze.fill('2.4'); await squeeze.press('Tab');
  await punch.fill('0.1'); await punch.press('Tab'); await expect(page.locator('#tuning-status')).toContainText('Previous setting kept'); await expect(punch).toHaveValue('6');
  await page.screenshot({path:'test-results/power-sensitivity.png'});
  await page.getByRole('button',{name:'Back to game'}).click(); await page.waitForTimeout(600);
  await gesture(1.2,0); await expect.poll(pressure).toBe('PUNCH 19% · settle');
  await page.waitForTimeout(600); await gesture(0,1.2); await expect.poll(pressure).toBe('SQUEEZE 48% · settle');
  await page.reload(); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  await page.evaluate(()=>window.dispatchEvent(new Event('sensor-lab'))); await expect(punch).toHaveValue('6'); await expect(squeeze).toHaveValue('2.4');
});

test('all six v002 variants render their consistent artwork, action, pressure and highlight', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/'); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  await page.keyboard.press('Enter'); await expect.poll(async()=>(await state(page)).phase).toBe('playing');
  const variants = [
    {id:1,name:'Small whitehead',kind:'punch',power:35},
    {id:2,name:'Deep bump',kind:'squeeze',power:65},
    {id:6,name:'Whitehead',kind:'punch',power:35},
    {id:4,name:'Blackhead',kind:'squeeze',power:45},
    {id:5,name:'Large whitehead',kind:'punch',power:45},
    {id:3,name:'Inflamed head',kind:'punch',power:55},
  ];
  for (const [index,variant] of variants.entries()) {
    await page.waitForTimeout(650);
    const rendered=await page.evaluate(async()=>{
      const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
      const game=(await import(url)).game;
      const target=game.registry.get('gameState').target;
      const scene=game.scene.getScene('GameScene');
      const pimple=scene.pimples[target.position];
      return {variant:target.variant,kind:target.kind,name:scene.targetText.text,pressure:scene.strengthText.text,
        hint:scene.targetHint.text,texture:pimple.texture.key,tint:pimple.tintTopLeft,
        x:pimple.x,y:pimple.y,ringX:scene.ring.x,ringY:scene.ring.y,radius:scene.ring.radius,width:pimple.displayWidth};
    });
    expect(rendered.variant).toBe(variant.id);
    expect(rendered.kind).toBe(variant.kind);
    expect(rendered.name).toBe(variant.name);
    expect(rendered.pressure).toBe(`${variant.power}% or more`);
    expect(rendered.hint).toBe(variant.kind==='punch'?'SMACK THE TOP':'SQUEEZE THE BALL');
    expect(rendered.texture).toBe(`Pimple_${variant.id}`);
    expect(rendered.tint).toBe(0xffffff);
    expect(rendered.ringX).toBe(rendered.x); expect(rendered.ringY).toBe(rendered.y);
    expect(rendered.radius*2).toBeGreaterThan(rendered.width);
    await page.screenshot({path:`test-results/v002-${variant.id}.png`});
    await page.evaluate(kind=>(window as unknown as {gesture:(x:number,z:number)=>void}).gesture(kind==='punch'?4:0,kind==='squeeze'?2:0),variant.kind);
    await expect.poll(async()=>(await state(page)).popped).toBe(index+1);
  }
  expect((await state(page)).target.variant).toBe(1);
  expect((await state(page)).combo).toBe(6);
  expect(errors).toEqual([]);
});

test('keyboard test mode is explicit, exclusive, cancellable, and off after reload', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/'); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  const mode=()=>page.evaluate(async()=>{
    const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    return (await import(url)).game.registry.get('keyboardTestMode');
  });
  const pressure=()=>page.evaluate(async()=>{
    const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    return (await import(url)).game.scene.getScene('GameScene').pressureLabel.text;
  });
  const gesture=(x:number,z:number)=>page.evaluate(([x,z])=>(window as unknown as {gesture:(x:number,z:number)=>void}).gesture(x,z),[x,z]);
  const lab=()=>page.evaluate(()=>window.dispatchEvent(new Event('sensor-lab')));
  const checkbox=page.getByRole('checkbox',{name:'Keyboard test mode'});
  expect(await mode()).toBe(false);
  await lab(); await expect(checkbox).not.toBeChecked(); await checkbox.check();
  await page.screenshot({path:'test-results/keyboard-test-toggle.png'});
  await page.getByRole('button',{name:'Back to game'}).click();
  expect(await mode()).toBe(true);
  await expect(page.locator('#game')).toHaveAttribute('aria-label',/keyboard test mode/);
  await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state(page)).phase).toBe('countdown');
  await page.keyboard.down('ArrowUp');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect.poll(async()=>(await state(page)).phase).toBe('playing');
  await page.keyboard.down('ArrowUp'); await page.keyboard.up('ArrowUp');
  await gesture(4,0); await page.waitForTimeout(200); expect((await state(page)).attempts).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(650);
  await expect.poll(pressure).toMatch(/^PUNCH \d+% · RELEASE$/);
  await gesture(4,0); expect((await state(page)).attempts).toBe(0);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(650);
  const meter=await page.evaluate(async()=>{
    const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    const fill=(await import(url)).game.scene.getScene('GameScene').pressureFill;
    return {width:fill.displayWidth,color:fill.fillColor};
  });
  expect(meter.width).toBe(252); expect(meter.color).toBe(0x719068);
  await page.screenshot({path:'test-results/keyboard-test-charging.png'});
  await page.keyboard.up('ArrowUp'); await expect.poll(async()=>(await state(page)).popped).toBe(1);
  expect((await state(page)).score).toBe(150);
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1250);
  await page.keyboard.up('ArrowLeft'); expect((await state(page)).popped).toBe(1);
  await page.keyboard.up('ArrowRight'); await expect.poll(async()=>(await state(page)).popped).toBe(2);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(250);
  await lab(); await checkbox.uncheck(); await page.getByRole('button',{name:'Back to game'}).click();
  await page.keyboard.up('ArrowUp'); await page.keyboard.press('ArrowUp'); expect((await state(page)).attempts).toBe(2);
  await gesture(4,0); await page.waitForTimeout(250); expect((await state(page)).attempts).toBe(2);
  await page.waitForTimeout(500); await gesture(4,0); await expect.poll(async()=>(await state(page)).popped).toBe(3);
  await page.screenshot({path:'test-results/keyboard-test-return-to-sensors.png'});
  await page.waitForTimeout(600);
  // Switch while a physical gesture window is still open. Its later packets must not score.
  await page.evaluate(()=>{
    (window as unknown as {gesture:(x:number,z:number)=>void}).gesture(0,2);
    window.dispatchEvent(new Event('sensor-lab'));
  });
  await checkbox.check(); await page.getByRole('button',{name:'Back to game'}).click();
  await page.waitForTimeout(300); expect((await state(page)).attempts).toBe(3);
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(200);
  // Advance the normal scene update to expiry; the full real-time round is checked separately.
  await page.evaluate(async()=>{
    const url=document.querySelector<HTMLScriptElement>('script[src*="/src/main.ts"]')!.src;
    (await import(url)).game.scene.getScene('GameScene').update(0,45000);
  });
  await page.keyboard.up('ArrowLeft'); expect((await state(page)).phase).toBe('results'); expect((await state(page)).attempts).toBe(3);
  await page.keyboard.down('ArrowUp'); await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state(page)).phase).toBe('playing');
  await page.keyboard.down('ArrowUp'); await page.keyboard.up('ArrowUp'); expect((await state(page)).attempts).toBe(0);
  await page.reload(); await expect.poll(async()=>(await state(page))?.phase).toBe('ready');
  expect(await mode()).toBe(false); await lab(); await expect(checkbox).not.toBeChecked();
  expect(errors).toEqual([]);
});
