import { readFileSync } from 'node:fs';
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

test('correct actions and insufficient power never hurt, even with worst-case random', () => {
  const noRandom=()=>{throw Error('Random must not be used');};
  for(let index=0;index<6;index++) {
    const state={...startGame(),target:targetFor(index)};
    assert.equal(act(state,state.target.kind,1,noRandom).state.recovery,null);
    assert.equal(act(state,state.target.kind,state.target.strength-.01,noRandom).state.recovery,null);
  }
});
test('wrong-action hurt chance is exactly 20%; severe threshold is inclusive for every variant', () => {
  for(let index=0;index<6;index++) {
    const state={...startGame(),target:targetFor(index)};
    const wrong=state.target.kind==='punch'?'squeeze':'punch';
    const threshold=(Math.round(state.target.strength*100)+20)/100;
    assert.equal(act(state,wrong,threshold-.0001,()=>.2).state.phase,'playing');
    assert.equal(act(state,wrong,threshold-.0001,()=>.199999).state.phase,'recovering');
    const severe=act(state,wrong,threshold,()=>{throw Error('Severe must not roll random');}).state;
    assert.equal(severe.phase,'recovering'); assert.equal(severe.recovery?.severe,true);
    assert.equal(act(state,wrong,1,()=>1).state.recovery?.durationMs,5000);
  }
});
test('recovery lasts 3 to 5 seconds proportional to excess force and blocks all actions', () => {
  const base={...startGame(),score:100,combo:3};
  const mild=act(base,'squeeze',.2,()=>0).state;
  assert.equal(mild.recovery?.durationMs,3000);
  const medium=act(base,'squeeze',.675,()=>1).state;
  assert.equal(medium.recovery?.durationMs,4000);
  const strong=act(base,'squeeze',1,()=>1).state;
  assert.equal(strong.recovery?.durationMs,5000);
  assert.equal(strong.score,75); assert.equal(strong.combo,0); assert.equal(strong.attempts,1);
  assert.deepEqual(strong.target,base.target);
  for(const kind of ['punch','squeeze'] as const) {
    const result=act(strong,kind,1,()=>0); assert.equal(result.outcome,'ignored'); assert.equal(result.state,strong);
  }
  const almost=tick(strong,4999); assert.equal(almost.phase,'recovering'); assert.equal(almost.recovery?.remainingMs,1);
  assert.equal(almost.remainingMs,ROUND_MS-4999);
  const recovered=tick(almost,1); assert.equal(recovered.phase,'playing'); assert.equal(recovered.recovery,null);
  assert.equal(recovered.remainingMs,ROUND_MS-5000); assert.equal(act(recovered,'punch',1).outcome,'correct');
  assert.deepEqual(tick(strong,-10),strong); assert.deepEqual(tick(strong,NaN),strong);
});
test('round expiry clears recovery and restart clears every hurt field', () => {
  const hurt=act({...startGame(),remainingMs:800},'squeeze',1,()=>1).state;
  const end=tick(hurt,800); assert.equal(end.phase,'results'); assert.equal(end.remainingMs,0); assert.equal(end.recovery,null);
  assert.equal(act(end,'punch',1).outcome,'ignored'); assert.equal(startGame().recovery,null);
});

test('authored burst atlases preserve all nine frames, fixed origins and source canvas dimensions', () => {
  const source=JSON.parse(readFileSync(new URL('../../Pimple_Burst_Animations_v001_20260923/Import_Info.json',import.meta.url),'utf8'));
  assert.deepEqual(source.groups.map((group:{pimple_id:string})=>group.pimple_id),['Pimple_01','Pimple_02','Pimple_03','Pimple_05','Pimple_06']);
  for(const group of source.groups) {
    const id=Number(group.pimple_id.split('_')[1]);
    const atlas=JSON.parse(readFileSync(new URL(`../public/assets/Burst_${id}.json`,import.meta.url),'utf8'));
    assert.deepEqual(Object.keys(atlas.frames).sort(),['01','02','03','04','05','06','07','08','09']);
    assert.equal(atlas.meta.frameCount,9); assert.equal(atlas.meta.frameRate,12);
    const [width,height]=group.canvas_size_px;
    const pivot=atlas.frames['01'].pivot;
    assert.ok(pivot.x>=0 && pivot.x<=1 && pivot.y>=0 && pivot.y<=1);
    for(let index=1;index<=9;index++) {
      const frame=atlas.frames[String(index).padStart(2,'0')];
      assert.deepEqual(frame.frame,{x:(index-1)*width,y:0,w:width,h:height});
      assert.deepEqual(frame.pivot,pivot); assert.equal(frame.trimmed,false);
    }
    assert.ok(atlas.meta.scalePerDisplayUnit>0 && atlas.meta.scalePerDisplayUnit<1);
  }
});
