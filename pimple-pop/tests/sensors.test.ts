import test from 'node:test';
import assert from 'node:assert/strict';
import { ImuParser, SensorSignal, type ImuFrame } from '../src/sensors';

const frame = (acceleration: [number, number, number]): ImuFrame => ({ side: 'L', sequence: 1, timeUs: 20, acceleration, gyro: [0,0,0] });

test('IMU frames decode across every chunk boundary, with CRLF and status comments', () => {
  const line = '# imu=ready\r\nIMU,L,42,12345,0.10000,-0.20000,1.00000,0.01000,0.02000,-0.03000\r\n';
  for (let at=0;at<=line.length;at++) {
    const parser = new ImuParser();
    const frames = [...parser.push(line.slice(0,at)), ...parser.push(line.slice(at))];
    assert.equal(frames.length,1);
    assert.deepEqual(frames[0], { side:'L', sequence:42, timeUs:12345, acceleration:[0.1,-0.2,1], gyro:[0.01,0.02,-0.03] });
  }
});
test('parser rejects malformed and oversized data and recovers at the next newline', () => {
  const parser = new ImuParser();
  const bad = ['IMU,Q,1,2,0,0,1,0,0,0','IMU,L,-1,2,0,0,1,0,0,0','IMU,R,1,4294967296,0,0,1,0,0,0','IMU,L,1,2,NaN,0,1,0,0,0','IMU,L,1,2,,0,1,0,0,0','IMU,L,1,2,0,0,1,0,0,0,1'];
  assert.deepEqual(parser.push(bad.join('\n')+'\n'+'x'.repeat(10000)+'\n'),[]);
  assert.equal(parser.rejected,7);
  assert.equal(parser.push('IMU,R,0,0,0,0,1,0,0,0\n').length,1);
});
test('first reading becomes zero, including nonzero gravity and arbitrary orientation', () => {
  const signal = new SensorSignal(); signal.accept(frame([0.94,-0.23,0.19]),100);
  assert.deepEqual(signal.baseline,[0.94,-0.23,0.19]);
  assert.deepEqual(signal.output(),[0,0,0]);
  signal.accept(frame([0.95,-0.24,0.21]),150);
  assert.ok(signal.output().every(value=>value===0));
});
test('smoothing and dead zone retain signed meaningful changes without auto drifting zero', () => {
  const signal = new SensorSignal(); signal.accept(frame([1,0,0]),100);
  for(let t=120;t<1000;t+=20) signal.accept(frame([1.4,-0.4,0.01]),t);
  assert.ok(signal.output()[0]>0.33); assert.ok(signal.output()[1]<-0.33);
  assert.equal(signal.output()[2],0); assert.deepEqual(signal.baseline,[1,0,0]);
  assert.ok(Math.abs(signal.output(0.3)[0])<Math.abs(signal.output(0.06)[0]));
});
test('zero reset discards prior filter state and uses only the next fresh frame', () => {
  const signal = new SensorSignal(); signal.accept(frame([1,0,0]),100);
  signal.accept(frame([2,1,1]),500); signal.reset();
  assert.equal(signal.baseline,null); assert.deepEqual(signal.output(),[0,0,0]);
  signal.accept(frame([-1,0.4,0.3]),600);
  assert.deepEqual(signal.baseline,[-1,0.4,0.3]); assert.deepEqual(signal.output(),[0,0,0]);
});
test('recovery from a stale stream establishes a new baseline without a jump', () => {
  const signal = new SensorSignal(); signal.accept(frame([0,0,1]),100);
  signal.accept(frame([1,0,0]),2000);
  assert.deepEqual(signal.baseline,[1,0,0]); assert.deepEqual(signal.output(),[0,0,0]);
});
