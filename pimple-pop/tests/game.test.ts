import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createGame, startGame, tick, ROUND_MS } from '../src/game';

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
