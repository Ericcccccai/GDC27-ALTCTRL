import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyboardInput, SerialInput, SerialLineParser, type ActionEvent } from '../src/input';

function keyboard() {
  let now = 0;
  const target = Object.assign(new EventTarget(), {
    document: Object.assign(new EventTarget(), { hidden: false }),
    performance: { now: () => now },
  });
  const actions: ActionEvent[] = [];
  const input = new KeyboardInput(target as unknown as Window, action => actions.push(action));
  const key = (type: string, key: string, repeat = false) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { key, repeat });
    target.dispatchEvent(event);
    return event;
  };
  return { target, input, actions, key, time: (value: number) => { now = value; } };
}

test('keyboard charges on hold, clamps strength, and suppresses repeats', () => {
  const k = keyboard();
  assert.equal(k.key('keydown', 'ArrowUp').defaultPrevented, true);
  k.time(600);
  k.key('keydown', 'ArrowUp', true);
  assert.deepEqual(k.input.getCharge(), { kind: 'punch', strength: 0.5 });
  k.key('keyup', 'ArrowUp');
  k.key('keyup', 'ArrowUp');
  assert.deepEqual(k.actions, [{ kind: 'punch', strength: 0.5, source: 'keyboard' }]);
  k.key('keydown', 'ArrowRight');
  k.time(10000);
  k.key('keyup', 'ArrowRight');
  assert.equal(k.actions[1]?.strength, 1);
  k.input.destroy();
});

test('left and right form one squeeze and release the final key', () => {
  const k = keyboard();
  k.key('keydown', 'ArrowLeft');
  k.time(300);
  k.key('keydown', 'ArrowRight');
  k.key('keyup', 'ArrowLeft');
  assert.equal(k.actions.length, 0);
  k.time(900);
  k.key('keyup', 'ArrowRight');
  assert.deepEqual(k.actions, [{ kind: 'squeeze', strength: 0.75, source: 'keyboard' }]);
  k.input.destroy();
});

test('first gesture wins until every tracked key is released', () => {
  for (const [first, second] of [['ArrowUp', 'ArrowLeft'], ['ArrowRight', 'ArrowUp']]) {
    const k = keyboard();
    k.key('keydown', first!);
    k.key('keydown', second!);
    k.time(1200);
    k.key('keyup', first!);
    k.key('keydown', first!);
    k.key('keyup', second!);
    k.key('keyup', first!);
    assert.equal(k.actions.length, 1);
    assert.equal(k.actions[0]?.kind, first === 'ArrowUp' ? 'punch' : 'squeeze');
    k.key('keydown', second!);
    k.key('keyup', second!);
    assert.equal(k.actions.length, 2);
    k.input.destroy();
  }
});

test('blur, hiding, reset, and destroy cancel without firing', () => {
  const k = keyboard();
  for (const cancel of [
    () => k.target.dispatchEvent(new Event('blur')),
    () => {
      k.target.document.hidden = true;
      k.target.document.dispatchEvent(new Event('visibilitychange'));
    },
    () => k.input.reset(),
    () => k.input.destroy(),
  ]) {
    k.key('keydown', 'ArrowUp');
    cancel();
    k.key('keyup', 'ArrowUp');
    assert.equal(k.input.getCharge(), null);
  }
  k.key('keydown', 'ArrowLeft');
  k.key('keyup', 'ArrowLeft');
  assert.deepEqual(k.actions, []);
});

test('parser preserves every possible chunk boundary and accepts CRLF', () => {
  const data = 'PUNCH,0.83\r\nSQUEEZE,0.71\nPUNCH,0\nSQUEEZE,1.00\n';
  const expected: ActionEvent[] = [
    { kind: 'punch', strength: 0.83, source: 'serial' },
    { kind: 'squeeze', strength: 0.71, source: 'serial' },
    { kind: 'punch', strength: 0, source: 'serial' },
    { kind: 'squeeze', strength: 1, source: 'serial' },
  ];
  for (let split = 0; split <= data.length; split++) {
    const parser = new SerialLineParser();
    assert.deepEqual([...parser.push(data.slice(0, split)), ...parser.push(data.slice(split))], expected);
  }
  const parser = new SerialLineParser();
  assert.deepEqual([...data].flatMap(char => parser.push(char)), expected);
});

test('parser rejects invalid records, out of range values, and oversized records', () => {
  const parser = new SerialLineParser();
  const invalid = ['punch,0.5', 'PUNCH, 0.5', ' PUNCH,0.5', 'PUNCH,0.5 ', 'PUNCH,+0.5',
    'PUNCH,-0.5', 'PUNCH,1.01', 'PUNCH,2', 'PUNCH,NaN', 'PUNCH,Infinity', 'PUNCH,1e-1',
    'PUNCH,.5', 'PUNCH,00.5', 'PUNCH,0.', 'PUNCH,0.5,extra', 'PUNCH,0.5\r\r', '', 'SQUEEZE'];
  assert.deepEqual(parser.push(invalid.join('\n') + '\n'), []);
  assert.deepEqual(parser.push('x'.repeat(1_000_000)), []);
  assert.deepEqual(parser.push('PUNCH,1\n'), []);
  assert.deepEqual(parser.push('PUNCH,1\n'), [{ kind: 'punch', strength: 1, source: 'serial' }]);
  assert.deepEqual(parser.push('PUNCH,0.' + '0'.repeat(100) + '\n'), []);
  parser.push('PUNCH,0.');
  parser.reset();
  assert.deepEqual(parser.push('5\n'), []);
});

test('serial disconnect cancels reading, releases lock, and closes exactly once', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let cancelled = 0;
  let closed = 0;
  let requested = 0;
  const actions: ActionEvent[] = [];
  const statuses: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('PUNCH,0.5\n')); },
    cancel() { cancelled++; },
  });
  const port = {
    readable: stream,
    async open(options: { baudRate: number }) { assert.equal(options.baudRate, 115200); },
    async close() { assert.equal(stream.locked, false); closed++; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { serial: { async requestPort() { requested++; return port; } } },
  });
  try {
    assert.equal(SerialInput.isSupported(), true);
    const input = new SerialInput(action => actions.push(action));
    input.onStatus = status => statuses.push(status);
    await Promise.all([input.connect(), input.connect()]);
    await input.disconnect();
    await input.disconnect();
    assert.equal(requested, 1);
    assert.equal(cancelled, 1);
    assert.equal(closed, 1);
    assert.deepEqual(actions, [{ kind: 'punch', strength: 0.5, source: 'serial' }]);
    assert.equal(statuses.at(-1), 'Disconnected');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

async function withSerialPort(port: unknown, run: () => Promise<void>) {
  const originals = ['window', 'navigator'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { serial: { async requestPort() { return port; } } },
  });
  try { await run(); } finally {
    ['window', 'navigator'].forEach((key, i) => {
      if (originals[i]) Object.defineProperty(globalThis, key, originals[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

test('disconnect while opening closes the port without delivering buffered actions', async () => {
  let finishOpen!: () => void;
  let signalOpening!: () => void;
  const opening = new Promise<void>(resolve => { signalOpening = resolve; });
  const opened = new Promise<void>(resolve => { finishOpen = resolve; });
  let closes = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('PUNCH,1\n')); },
  });
  await withSerialPort({
    readable: stream,
    async open() { signalOpening(); await opened; },
    async close() { assert.equal(stream.locked, false); closes++; },
  }, async () => {
    const actions: ActionEvent[] = [];
    const input = new SerialInput(action => actions.push(action));
    const connect = input.connect();
    await opening;
    const disconnect = input.disconnect();
    finishOpen();
    await Promise.all([connect, disconnect]);
    assert.deepEqual(actions, []);
    assert.equal(closes, 1);
  });
});

test('serial read failures release the stream and report a status', async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(new Error('Device removed')); },
  });
  let closes = 0;
  await withSerialPort({
    readable: stream,
    async open() {},
    async close() { assert.equal(stream.locked, false); closes++; },
  }, async () => {
    let report!: (status: string) => void;
    const failed = new Promise<string>(resolve => { report = resolve; });
    const input = new SerialInput(() => assert.fail('No action expected'));
    input.onStatus = status => { if (status.startsWith('Serial error:')) report(status); };
    await input.connect();
    assert.match(await failed, /Device removed/);
    await input.disconnect();
    assert.equal(closes, 1);
  });
});
