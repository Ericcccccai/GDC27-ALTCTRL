import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, startGame, tick, ROUND_MS, targetFor, PIMPLE_TYPES, PIMPLE_SEQUENCE, targetsOnFace } from '../src/game';

test('round lasts exactly 45 seconds and stops accepting actions', () => {
  let state = tick(startGame(), 44_999);
  assert.equal(state.phase, 'playing');
  assert.equal(state.remainingMs, 1);
  state = tick(state, 5);
  assert.equal(state.phase, 'results');
  assert.equal(state.remainingMs, 0);
  assert.equal(act(state, 'punch', 1).outcome, 'ignored');
});
test('correct action scores and automatically selects a different target', () => {
  const before = startGame();
  const result = act(before, 'punch', 0.8);
  assert.equal(result.outcome, 'correct');
  assert.equal(result.state.score, 140);
  assert.equal(result.state.combo, 1);
  assert.equal(result.state.target.kind, 'squeeze');
  assert.notEqual(result.state.target.position, before.target.position);
});
test('weak and wrong actions preserve target but reset combo; score never goes negative', () => {
  const won = act(startGame(), 'punch', 1).state;
  const weak = act(won, 'squeeze', 0.3);
  assert.equal(weak.outcome, 'weak');
  assert.equal(weak.state.combo, 0);
  assert.deepEqual(weak.state.target, won.target);
  assert.equal(weak.state.score, won.score);
  const wrong = act(startGame(), 'squeeze', 1);
  assert.equal(wrong.outcome, 'wrong');
  assert.equal(wrong.state.score, 0);
});
test('restarting clears every round counter and timer', () => {
  const played = tick(act(startGame(), 'punch', 1).state, ROUND_MS);
  assert.equal(played.phase, 'results');
  assert.deepEqual(startGame(), { ...createGame(), phase: 'playing' });
});
test('combo bonus grows, force is bounded and invalid time does not expire the round', () => {
  let state = startGame();
  for (let i = 0; i < 3; i++) state = act(state, state.target.kind, 2).state;
  assert.equal(state.score, 475);
  assert.equal(state.bestCombo, 3);
  assert.equal(tick(state, -100).remainingMs, ROUND_MS);
  assert.equal(tick(state, Number.NaN).remainingMs, ROUND_MS);
  assert.equal(act(state, state.target.kind, Number.NaN).outcome, 'weak');
});

test('v002 progression uses all six distinct designs with stable actions and pressure', () => {
  assert.deepEqual(PIMPLE_SEQUENCE,[1,2,6,4,5,3]);
  let state=startGame();
  const seen=new Set<number>();
  for(let index=0;index<12;index++) {
    const target=state.target;
    const type=PIMPLE_TYPES[target.variant];
    seen.add(target.variant);
    assert.equal(target.kind,type.kind);
    assert.equal(target.strength,type.strength);
    assert.equal(target.variant,PIMPLE_SEQUENCE[index%6]);
    assert.equal(act(state,target.kind,target.strength-.01).outcome,'weak');
    assert.equal(act(state,target.kind==='punch'?'squeeze':'punch',1).outcome,'wrong');
    const next=act(state,target.kind,target.strength);
    assert.equal(next.outcome,'correct');
    assert.notEqual(next.state.target.position,target.position);
    state=next.state;
  }
  assert.equal(seen.size,6);
  assert.equal(targetFor(3).kind,'squeeze');
  assert.equal(targetFor(3).strength,.45);
  assert.equal(targetFor(5).kind,'punch');
  assert.equal(targetFor(5).strength,.55);
});

test('inactive spots preview their next actual variant and do not morph when selected', () => {
  for(let index=0;index<70;index++) {
    const before=targetsOnFace(index);
    const after=targetsOnFace(index+1);
    assert.equal(before.length,7);
    assert.deepEqual(before[targetFor(index).position],targetFor(index));
    for(let position=0;position<7;position++) {
      assert.equal(before[position].position,position);
      if(position!==targetFor(index).position) assert.deepEqual(before[position],after[position]);
    }
  }
});
