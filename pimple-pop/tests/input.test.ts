import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardTestInput, type KeyboardActionEvent, GestureDetector, DEFAULT_GESTURES, parseGestureSettings, validateGestureSettings } from '../src/input';
import { SensorStore, type SensorBatch } from '../src/SensorStore';
import type { Side, Vector } from '../src/sensors';
const arm = (d: GestureDetector, at=0) => { d.sample(0,0,at); d.sample(0,0,at+200); };
test('noise, quiet arm, mixed normalized evidence, tie policy and strength clamp', () => {
  const d = new GestureDetector(); d.sample(3,0,0); assert.equal(d.flush(200),null);
  arm(d,300); d.sample(.1,.1,510); assert.equal(d.flush(700),null);
  d.sample(.5,.8,710); const event=d.flush(810)!;
  assert.equal(event.kind,'squeeze'); assert.equal(event.strength,.8/1.2);
  arm(d,1200); d.sample(3,3,1410); assert.equal(d.flush(1510)?.kind,'punch');
  arm(d,1900); d.sample(5,0,2110); assert.equal(d.flush(2210)?.strength,1);
});
test('bounded peak collection, sustained motion never repeats, cooldown and quiet rearm', () => {
  const d = new GestureDetector(); arm(d); d.sample(.3,0,210); d.sample(-1,0,230); d.sample(0,0,240);
  assert.equal(d.flush(300),null); assert.equal(d.flush(310)?.xPeak,1);
  for(let at=320;at<2000;at+=20) { d.sample(1,0,at); assert.equal(d.flush(at),null); }
  arm(d,2000); d.sample(0,1,2210); assert.equal(d.flush(2310)?.kind,'squeeze');
});
test('cancel discards an impact and requires new quiet evidence', () => {
  const d=new GestureDetector(); arm(d); d.sample(2,0,210); d.cancel(); assert.equal(d.flush(400),null);
  d.sample(2,0,410); assert.equal(d.flush(600),null); arm(d,700); d.sample(2,0,910); assert.ok(d.flush(1010));
});
function batch(at:number, samples: {side:Side; acceleration:Vector}[], active:Side[]=['L','R']): SensorBatch {
  const frame=(side:Side,acceleration:Vector) => ({side,acceleration,sequence:at,timeUs:at*1000,gyro:[0,0,0] as Vector});
  return { throughAt:at, overflow:false, links:(['L','R'] as Side[]).map(side=>({side,path:'test',connected:active.includes(side),message:'test',receivedAt:at,frames:at,rejected:0,frame:frame(side,[1,0,0])})), samples:samples.map(s=>({side:s.side,at,frame:frame(s.side,s.acceleration)})) };
}
const quiet=(s:SensorStore,at:number,active:Side[]=['L','R']) => s.accept(batch(at,active.map(side=>({side,acceleration:[1,0,0]})),active),at);
for(const side of ['L','R'] as Side[]) test(`${side} alone handles either gesture and preserves a spike between 20 Hz snapshots`,()=>{
  const s=new SensorStore(); const events:unknown[]=[]; s.onAction=e=>events.push(e); s.setEnabled(true,0);
  quiet(s,50,[side]); quiet(s,100,[side]); quiet(s,300,[side]);
  s.accept(batch(350,[{side,acceleration:[3,0,0]},{side,acceleration:[1,0,0]}],[side]),350);
  s.accept(batch(450,[],[side]),450); assert.equal(s.lastAction?.kind,'punch'); assert.equal(events.length,1);
  quiet(s,800,[side]); quiet(s,1000,[side]); s.accept(batch(1050,[{side,acceleration:[1,0,2]}],[side]),1050);
  s.accept(batch(1150,[],[side]),1150); assert.equal(s.lastAction?.kind,'squeeze'); assert.equal(events.length,2);
});
test('both boards aggregate once; reset, stale, reconnect, overflow and pause cancel pending input',()=>{
  for(const reason of ['reset','stale','reconnect','overflow','pause']) {
    const s=new SensorStore(); let count=0; s.onAction=()=>count++; s.setEnabled(true,0); quiet(s,50); quiet(s,100); quiet(s,300);
    s.accept(batch(350,[{side:'L',acceleration:[3,0,0]},{side:'R',acceleration:[-1,0,0]}]),350);
    if(reason==='reset') s.reset(['L'],360);
    if(reason==='stale') s.advance(1400);
    if(reason==='reconnect') { s.disconnect(360); quiet(s,400); }
    if(reason==='overflow') s.accept({...batch(400,[]),overflow:true},400);
    if(reason==='pause') { s.setEnabled(false,360); s.setEnabled(true,370); }
    s.accept(batch(450,[]),450); assert.equal(count,0,reason);
  }
  const s=new SensorStore(); let count=0; s.onAction=()=>count++; s.setEnabled(true,0); quiet(s,50); quiet(s,100); quiet(s,300);
  s.accept(batch(350,[{side:'L',acceleration:[3,0,0]},{side:'R',acceleration:[-1,0,0]}]),350); s.accept(batch(450,[]),450); s.advance(600); assert.equal(count,1);
});

test('delayed batch respects window and buffered samples cannot cross reset or enable', () => {
  const s=new SensorStore(); const events:string[]=[]; s.onAction=e=>events.push(e.kind); s.setEnabled(true,0);
  quiet(s,50); quiet(s,100); quiet(s,300);
  const early=batch(350,[{side:'L',acceleration:[1.6,0,0]}]);
  const late=batch(550,[{side:'L',acceleration:[1,0,1.2]}]);
  s.accept({...late,samples:[...early.samples,...late.samples]},550);
  assert.deepEqual(events,['punch']);
  s.setEnabled(false,600); s.setEnabled(true,1000);
  s.accept({...batch(1000,[]), samples:[...batch(650,[{side:'L',acceleration:[1,0,0]}]).samples,...batch(850,[{side:'L',acceleration:[1,0,0]}]).samples,...batch(900,[{side:'L',acceleration:[3,0,0]}]).samples]},1000);
  assert.deepEqual(events,['punch']);
  s.reset(['L'],1100);
  s.accept({...batch(1150,[]), samples:batch(1050,[{side:'L',acceleration:[3,0,0]}]).samples},1150);
  assert.equal(s.signals.L.baseline,null);
  quiet(s,1200); assert.deepEqual(s.signals.L.baseline,[1,0,0]);
});

test('wall clock cannot close a window before the next batch delivers its captured peaks', () => {
  const s=new SensorStore(); s.setEnabled(true,0); quiet(s,50); quiet(s,100); quiet(s,300);
  s.accept({...batch(375,[]),samples:batch(350,[{side:'L',acceleration:[1.3,0,0]}]).samples},375);
  s.advance(450); assert.equal(Boolean(s.lastAction),false);
  s.accept({...batch(475,[]),samples:batch(440,[{side:'L',acceleration:[1,0,1.2]}]).samples},475);
  assert.equal(s.lastAction?.kind,'squeeze');
  assert.ok(Math.abs(s.lastAction!.strength-.95)<1e-9);
});

test('power scales independently of detection and the other gesture', () => {
  const fire = (punchFull:number,squeezeFull:number,x:number,z:number) => {
    const d=new GestureDetector(); d.settings={...DEFAULT_GESTURES,punchFull,squeezeFull}; arm(d); d.sample(x,z,210); return d.flush(310)!;
  };
  assert.equal(fire(1.2,1.2,.9,0).strength,.75);
  assert.equal(fire(3,1.2,.9,0).strength,.3);
  assert.equal(fire(6,1.2,.9,0).strength,.15);
  assert.equal(fire(6,1.2,0,.9).strength,.75);
  assert.equal(fire(6,3,0,.9).strength,.3);
  assert.equal(fire(3,1.2,100,0).strength,1);
});
test('settings reject invalid storage and bounds, save valid tuning, and cancel pending gestures',()=>{
  for(const raw of [null,'bad','{}','null','[]',JSON.stringify({...DEFAULT_GESTURES,punchFull:0}),JSON.stringify({...DEFAULT_GESTURES,squeezeFull:9}),JSON.stringify({...DEFAULT_GESTURES,punchThreshold:4})]) assert.equal(parseGestureSettings(raw),null);
  assert.equal(validateGestureSettings({...DEFAULT_GESTURES,punchFull:NaN}),null);
  assert.equal(validateGestureSettings({...DEFAULT_GESTURES,punchFull:'3'}),null);
  let saved:string|null=null;
  const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  const s=new SensorStore(); s.loadSettings(storage);
  arm(s.detector); s.detector.sample(1,0,210);
  assert.equal(s.updateSettings({...DEFAULT_GESTURES,punchFull:6},220),'saved');
  assert.equal(s.detector.flush(400),null);
  const reloaded=new SensorStore(); reloaded.loadSettings(storage); assert.equal(reloaded.detector.settings.punchFull,6); assert.equal(reloaded.detector.settings.squeezeFull,1.2);
  assert.equal(reloaded.updateSettings({...DEFAULT_GESTURES,punchFull:-1}),'invalid'); assert.equal(reloaded.detector.settings.punchFull,6);
  const unavailable=new SensorStore(); unavailable.loadSettings({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});
  assert.equal(unavailable.updateSettings({...DEFAULT_GESTURES,punchFull:4}),'session'); assert.equal(unavailable.detector.settings.punchFull,4);
});

class KeyboardWindow extends EventTarget {
  now = 0;
  performance = { now: () => this.now };
  document = Object.assign(new EventTarget(), { hidden: false });
  key(type: 'keydown' | 'keyup', key: string, repeat = false): void {
    const event = Object.assign(new Event(type, { cancelable: true }), { key, repeat });
    this.dispatchEvent(event);
  }
}
test('keyboard test input is opt-in, charges on hold, fires on release and suppresses repeat', () => {
  const win = new KeyboardWindow(); const events: KeyboardActionEvent[] = [];
  const keyboard = new KeyboardTestInput(win as unknown as Window, action => events.push(action));
  win.key('keydown','ArrowUp'); win.now=1500; win.key('keyup','ArrowUp'); assert.equal(events.length,0);
  keyboard.setEnabled(true); win.key('keydown','ArrowUp'); win.now=2100;
  win.key('keydown','ArrowUp',true); win.key('keydown','ArrowUp');
  assert.deepEqual(keyboard.getCharge(),{kind:'punch',strength:.5}); assert.equal(events.length,0);
  win.now=4000; win.key('keyup','ArrowUp'); win.key('keyup','ArrowUp');
  assert.deepEqual(events,[{kind:'punch',strength:1,source:'keyboard'}]);
  keyboard.destroy(); win.key('keydown','ArrowUp'); win.key('keyup','ArrowUp'); assert.equal(events.length,1);
});
test('both squeeze keys share one charge until the final squeeze key is released', () => {
  const win = new KeyboardWindow(); const events: KeyboardActionEvent[]=[];
  const keyboard=new KeyboardTestInput(win as unknown as Window,action=>events.push(action)); keyboard.setEnabled(true);
  win.key('keydown','ArrowLeft'); win.now=300; win.key('keydown','ArrowRight');
  win.now=600; win.key('keyup','ArrowLeft'); assert.equal(events.length,0);
  win.now=1200; win.key('keyup','ArrowRight');
  assert.deepEqual(events,[{kind:'squeeze',strength:1,source:'keyboard'}]); keyboard.destroy();
});
test('the first conflicting gesture wins and others never become deferred actions', () => {
  const win = new KeyboardWindow(); const events: KeyboardActionEvent[]=[];
  const keyboard=new KeyboardTestInput(win as unknown as Window,action=>events.push(action)); keyboard.setEnabled(true);
  win.key('keydown','ArrowUp'); win.key('keydown','ArrowLeft'); win.now=600; win.key('keyup','ArrowUp');
  win.key('keydown','ArrowRight'); win.key('keyup','ArrowLeft'); win.key('keyup','ArrowRight');
  assert.deepEqual(events,[{kind:'punch',strength:.5,source:'keyboard'}]);
  win.key('keydown','ArrowRight'); win.now=1800; win.key('keyup','ArrowRight'); assert.equal(events.length,2);
  assert.equal(events[1].kind,'squeeze'); keyboard.destroy();
});
test('blur, hidden, pause and mode changes cancel held input; repeats cannot resume it', () => {
  for(const reason of ['blur','hidden','disable','cancel']) {
    const win = new KeyboardWindow(); const events: KeyboardActionEvent[]=[];
    const keyboard=new KeyboardTestInput(win as unknown as Window,action=>events.push(action)); keyboard.setEnabled(true);
    win.key('keydown','ArrowUp'); win.now=1000;
    if(reason==='blur') win.dispatchEvent(new Event('blur'));
    if(reason==='hidden') { win.document.hidden=true; win.document.dispatchEvent(new Event('visibilitychange')); }
    if(reason==='disable') { keyboard.setEnabled(false); keyboard.setEnabled(true); }
    if(reason==='cancel') keyboard.cancel();
    win.key('keydown','ArrowUp',true); win.key('keyup','ArrowUp'); assert.equal(events.length,0,reason);
    assert.equal(keyboard.getCharge(),null);
    win.key('keydown','ArrowUp'); win.now=2200; win.key('keyup','ArrowUp'); assert.equal(events.length,1,reason);
    keyboard.destroy();
  }
});

test('lab pressure observes raw spikes while scoring is disabled and shares game power', () => {
  const s = new SensorStore(); let actions = 0; s.onAction = () => actions++;
  quiet(s, 100); quiet(s, 300);
  s.accept(batch(350, [
    { side: 'L', acceleration: [2.56, 0, 0] },
    { side: 'R', acceleration: [-2.06, 0, -.66] },
    { side: 'L', acceleration: [1, 0, 0] },
    { side: 'R', acceleration: [1, 0, 0] },
  ]), 350);
  const reading = s.pressure(350);
  assert.equal(reading.ready, true);
  assert.equal(reading.punch.live, 0); assert.equal(reading.squeeze.live, 0);
  assert.equal(reading.punch.peak, 1); assert.ok(Math.abs(reading.squeeze.peak - .5) < 1e-9);
  assert.equal(reading.punch.trigger, .2 / 3);
  assert.equal(actions, 0); assert.equal(s.lastAction, null);
  quiet(s, 1000); assert.equal(s.pressure(1349).punch.peak, 1);
  assert.equal(s.pressure(1350).punch.peak, 0);
  s.setEnabled(true, 1400); quiet(s, 1450); quiet(s, 1650);
  s.accept(batch(1700, [{side:'L', acceleration:[2.56,0,0]}]), 1700);
  s.accept(batch(1800, []), 1800);
  assert.equal(s.pressure(1800).punch.live, s.lastAction!.strength);
  assert.equal(actions, 1);
});

test('pressure tuning immediately rescales live channels and clears old peaks', () => {
  const s = new SensorStore(); quiet(s,100);
  s.accept(batch(200, [{side:'L',acceleration:[2.56,0,.66]}]),200);
  assert.ok(Math.abs(s.pressure(200).punch.live-.5)<1e-9);
  s.updateSettings({...s.detector.settings,punchFull:6},210);
  assert.ok(Math.abs(s.pressure(210).punch.live-.25)<1e-9);
  assert.ok(Math.abs(s.pressure(210).squeeze.live-.5)<1e-9);
  quiet(s,220); assert.equal(s.pressure(220).punch.peak,0);
  s.accept(batch(230,[{side:'L',acceleration:[2.56,0,.66]}]),230);
  s.deadZone=.16;
  assert.ok(Math.abs(s.pressure(230).punch.live-1.4/6)<1e-9);
  quiet(s,240); assert.equal(s.pressure(240).squeeze.peak,0);
});

test('pressure clears affected boards on zero, loss, stale, overflow and reconnect', () => {
  for (const reason of ['reset','loss','stale','disconnect','overflow']) {
    const s=new SensorStore(); quiet(s,100);
    s.accept(batch(200,[{side:'L',acceleration:[4.06,0,0]},{side:'R',acceleration:[1,0,.66]}]),200);
    if (reason==='reset') s.reset(['L'],210);
    if (reason==='loss') s.accept(batch(210,[],['R']),210);
    if (reason==='stale') s.advance(1500);
    if (reason==='disconnect') s.disconnect(210);
    if (reason==='overflow') s.accept({...batch(210,[]),overflow:true},210);
    const value=s.pressure(reason==='stale'?1500:210);
    assert.equal(value.punch.live,0,reason); assert.equal(value.punch.peak,0,reason);
    assert.equal(value.ready,reason==='reset'||reason==='loss',reason);
    if(value.ready) assert.ok(Math.abs(value.squeeze.peak-.5)<1e-9,reason);
    quiet(s,1600); assert.equal(s.pressure(1600).punch.peak,0,reason);
  }
});
