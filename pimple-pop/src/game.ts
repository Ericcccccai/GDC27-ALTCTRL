export type ActionKind = 'punch' | 'squeeze';
export type Phase = 'ready' | 'countdown' | 'playing' | 'results';
export const PIMPLE_TYPES = {
  1: { name: 'Small whitehead', kind: 'punch', strength: 0.35, size: 58 },
  2: { name: 'Deep bump', kind: 'squeeze', strength: 0.65, size: 76 },
  3: { name: 'Inflamed head', kind: 'punch', strength: 0.55, size: 72 },
  4: { name: 'Blackhead', kind: 'squeeze', strength: 0.45, size: 60 },
  5: { name: 'Large whitehead', kind: 'punch', strength: 0.45, size: 76 },
  6: { name: 'Whitehead', kind: 'punch', strength: 0.35, size: 62 },
} as const;
export const PIMPLE_SEQUENCE = [1, 2, 6, 4, 5, 3] as const;
export interface Target { kind: ActionKind; strength: number; position: number; variant: keyof typeof PIMPLE_TYPES }
export interface GameState { phase: Phase; remainingMs: number; score: number; combo: number; bestCombo: number; popped: number; attempts: number; target: Target }
export const ROUND_MS = 45_000;
export function targetFor(index: number): Target {
  const variant = PIMPLE_SEQUENCE[index % PIMPLE_SEQUENCE.length];
  const { kind, strength } = PIMPLE_TYPES[variant];
  return { kind, strength, position: (index * 3 + Math.floor(index / 5)) % 7, variant };
}
/** Show each spot's next target in advance, so its artwork never changes on selection. */
export function targetsOnFace(index: number): Target[] {
  const targets: Target[] = [];
  // The seven-position pattern repeats every 35 targets and visits every spot.
  for (let offset = 0; offset < 35 && targets.filter(Boolean).length < 7; offset++) {
    const target = targetFor(index + offset);
    targets[target.position] ??= target;
  }
  return targets;
}
export function createGame(): GameState {
  return { phase: 'ready', remainingMs: ROUND_MS, score: 0, combo: 0, bestCombo: 0, popped: 0, attempts: 0, target: targetFor(0) };
}
export function startGame(): GameState { return { ...createGame(), phase: 'playing' }; }
export function tick(state: GameState, deltaMs: number): GameState {
  if (state.phase !== 'playing') return state;
  const remainingMs = Math.max(0, state.remainingMs - Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
  return { ...state, remainingMs, phase: remainingMs === 0 ? 'results' : 'playing' };
}
export type Outcome = 'correct' | 'weak' | 'wrong' | 'ignored';
export function act(state: GameState, kind: ActionKind, strength: number): { state: GameState; outcome: Outcome; points: number } {
  if (state.phase !== 'playing' || state.remainingMs <= 0) return { state, outcome: 'ignored', points: 0 };
  const force = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  const outcome = kind !== state.target.kind ? 'wrong' : force < state.target.strength ? 'weak' : 'correct';
  if (outcome !== 'correct') return { state: { ...state, attempts: state.attempts + 1, combo: 0, score: Math.max(0, state.score - (outcome === 'wrong' ? 25 : 0)) }, outcome, points: outcome === 'wrong' ? -25 : 0 };
  const combo = state.combo + 1;
  const points = 100 + Math.min(5, Math.floor(combo / 3)) * 25 + Math.round(force * 50);
  return { state: { ...state, score: state.score + points, combo, bestCombo: Math.max(state.bestCombo, combo), popped: state.popped + 1, attempts: state.attempts + 1, target: targetFor(state.popped + 1) }, outcome, points };
}
