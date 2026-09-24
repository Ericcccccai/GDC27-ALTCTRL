export type ActionKind = 'punch' | 'squeeze';
export interface SensorActionEvent { kind: ActionKind; strength: number; source: 'sensor'; xPeak: number; zPeak: number }
export interface KeyboardActionEvent { kind: ActionKind; strength: number; source: 'keyboard' }
export type ActionEvent = SensorActionEvent | KeyboardActionEvent;
export interface GestureSettings { punchThreshold: number; squeezeThreshold: number; punchFull: number; squeezeFull: number }
export const DEFAULT_GESTURES: GestureSettings = { punchThreshold: 0.20, squeezeThreshold: 0.20, punchFull: 3, squeezeFull: 1.2 };

export const GESTURE_STORAGE_KEY = 'pimple-pop.gesture-settings';
export function validateGestureSettings(value: unknown): GestureSettings | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const settings = {} as GestureSettings;
  for (const key of Object.keys(DEFAULT_GESTURES) as (keyof GestureSettings)[]) {
    const number = input[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0.05 || number > 8) return null;
    settings[key] = number;
  }
  return settings.punchFull >= settings.punchThreshold && settings.squeezeFull >= settings.squeezeThreshold ? settings : null;
}
export function parseGestureSettings(serialized: string | null): GestureSettings | null {
  try { return validateGestureSettings(JSON.parse(serialized ?? 'null')); } catch { return null; }
}

/** One shared window across both boards. Equal normalized evidence selects punch. */
export class GestureDetector {
  settings = { ...DEFAULT_GESTURES };
  private armed = false;
  private quietSince: number | null = null;
  private pending: { at: number; x: number; z: number } | null = null;
  private cooldownUntil = 0;
  cancel(): void { this.armed = false; this.quietSince = null; this.pending = null; }
  sample(x: number, z: number, at: number): void {
    x = Math.abs(x); z = Math.abs(z);
    const quiet = x < this.settings.punchThreshold * 0.45 && z < this.settings.squeezeThreshold * 0.45;
    if (this.pending) { if (at - this.pending.at > 100) return; this.pending.x = Math.max(x, this.pending.x); this.pending.z = Math.max(z, this.pending.z); return; }
    if (quiet) {
      this.quietSince ??= at;
      if (at - this.quietSince >= 180 && at >= this.cooldownUntil) this.armed = true;
    } else {
      this.quietSince = null;
      if (this.armed && at >= this.cooldownUntil && (x >= this.settings.punchThreshold || z >= this.settings.squeezeThreshold)) {
        this.pending = { at, x, z }; this.armed = false;
      }
    }
  }
  flush(at: number): SensorActionEvent | null {
    if (!this.pending || at - this.pending.at < 100) return null;
    const { x, z } = this.pending;
    this.pending = null; this.quietSince = null; this.cooldownUntil = at + 300;
    const kind = x / this.settings.punchThreshold >= z / this.settings.squeezeThreshold ? 'punch' : 'squeeze';
    return { kind, source: 'sensor', xPeak: x, zPeak: z, strength: Math.min(1, (kind === 'punch' ? x / this.settings.punchFull : z / this.settings.squeezeFull)) };
  }
}


/** Explicit test input. Disabled by default; a full charge takes 1.2 seconds. */
export class KeyboardTestInput {
  private enabled = false;
  private held = new Set<string>();
  private active: { kind: ActionKind; started: number } | null = null;
  constructor(private target: Window, private onAction: (action: KeyboardActionEvent) => void) {
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.cancel);
    target.document.addEventListener('visibilitychange', this.visibility);
  }
  setEnabled(enabled: boolean): void {
    if (enabled !== this.enabled) { this.cancel(); this.enabled = enabled; }
  }
  cancel = (): void => { this.held.clear(); this.active = null; };
  getCharge(): { kind: ActionKind; strength: number } | null {
    return this.active && this.enabled ? { kind: this.active.kind,
      strength: Math.min(1, Math.max(0, (this.target.performance.now() - this.active.started) / 1200)) } : null;
  }
  destroy(): void {
    this.setEnabled(false); this.cancel();
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.cancel);
    this.target.document.removeEventListener('visibilitychange', this.visibility);
  }
  private kind(key: string): ActionKind | null {
    return key === 'ArrowUp' ? 'punch' : key === 'ArrowLeft' || key === 'ArrowRight' ? 'squeeze' : null;
  }
  private visibility = (): void => { if (this.target.document.hidden) this.cancel(); };
  private down = (event: KeyboardEvent): void => {
    const kind = this.kind(event.key);
    if (!this.enabled || !kind) return;
    event.preventDefault();
    if (event.repeat || this.held.has(event.key)) return;
    if (!this.held.size) this.active = { kind, started: this.target.performance.now() };
    this.held.add(event.key);
  };
  private up = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.kind(event.key)) return;
    event.preventDefault();
    if (!this.held.delete(event.key) || !this.active) return;
    if ([...this.held].some(key => this.kind(key) === this.active!.kind)) return;
    const charge = this.getCharge()!;
    this.active = null;
    this.onAction({ ...charge, source: 'keyboard' });
  };
}
