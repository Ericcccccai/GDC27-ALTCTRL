import { GestureDetector, pressureStrength, GESTURE_STORAGE_KEY, parseGestureSettings, validateGestureSettings, type GestureSettings, type SensorActionEvent } from './input';
import { DEFAULT_DEAD_ZONE, SensorSignal, STALE_MS, type SensorLink, type Side, type ImuFrame } from './sensors';
export interface SensorBatch { throughAt: number; links: SensorLink[]; samples: { side: Side; at: number; frame: ImuFrame }[]; overflow: boolean }
const sides: Side[] = ['L', 'R'];
export const PRESSURE_PEAK_MS = 1000;
type PressureSample = { at: number; x: number; z: number };

/** Single connection and baseline owner for the game and diagnostic view. */
export class SensorStore {
  readonly signals = { L: new SensorSignal(), R: new SensorSignal() };
  readonly detector = new GestureDetector();
  links: SensorLink[] = [];
  private deadZoneValue = DEFAULT_DEAD_ZONE;
  private pressureHistory: Record<Side, PressureSample[]> = { L: [], R: [] };
  get deadZone(): number { return this.deadZoneValue; }
  set deadZone(value: number) {
    this.deadZoneValue = value;
    this.clearPressureHistory();
  }
  bridgeLive = false;
  lastMessage = 0;
  lastAction: SensorActionEvent | null = null;
  onAction: ((event: SensorActionEvent) => void) | null = null;
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
  private enabled = false;
  private evidenceAfter = -Infinity;
  private zeroAfter = { L: -Infinity, R: -Infinity };
  private liveSides = new Set<Side>();
  private latest = { L: 0, R: 0 };
  loadSettings(storage: Pick<Storage, 'getItem' | 'setItem'>): void {
    this.storage = storage;
    try {
      const settings = parseGestureSettings(storage.getItem(GESTURE_STORAGE_KEY));
      if (settings) { this.detector.settings = settings; this.clearPressureHistory(); this.cancel(); }
    } catch { /* Storage may be unavailable; current session settings still work. */ }
  }
  updateSettings(settings: GestureSettings, at = Date.now()): 'invalid' | 'saved' | 'session' {
    const valid = validateGestureSettings(settings);
    if (!valid) return 'invalid';
    this.detector.settings = valid; this.clearPressureHistory(); this.cancel(at);
    try {
      if (!this.storage) return 'session';
      this.storage.setItem(GESTURE_STORAGE_KEY, JSON.stringify(valid));
      return 'saved';
    } catch { return 'session'; }
  }
  setEnabled(enabled: boolean, at = Date.now()): void { if (enabled !== this.enabled) { this.enabled = enabled; this.cancel(at); } }
  cancel(at = Date.now()): void { this.detector.cancel(); this.evidenceAfter = Math.max(this.evidenceAfter, at); }
  reset(selected: Side[] = sides, at = Date.now()): void { selected.forEach(side => { this.signals[side].reset(); this.pressureHistory[side] = []; this.zeroAfter[side] = at; }); this.cancel(at); }
  isLive(side: Side, now = Date.now()): boolean {
    const link = this.links.find(link => link.side === side);
    return this.bridgeLive && now - this.lastMessage < STALE_MS && !!link?.connected && now - link.receivedAt < STALE_MS;
  }
  disconnect(at = Date.now()): void { this.bridgeLive = false; this.reset(sides, at); this.liveSides.clear(); }
  accept(batch: SensorBatch, now = Date.now()): void {
    this.links = batch.links; this.bridgeLive = true; this.lastMessage = now;
    this.checkHealth(now);
    if (batch.overflow) { this.reset(sides, now); return; }
    for (const { side, at, frame } of [...batch.samples].sort((a,b) => a.at - b.at)) {
      if (!this.isLive(side, now) || now - at >= STALE_MS || at <= this.zeroAfter[side]) continue;
      if (this.latest[side] && at - this.latest[side] >= STALE_MS) { this.signals[side].reset(); this.pressureHistory[side] = []; this.cancel(at); }
      this.signals[side].accept(frame, at); this.latest[side] = at;
      // Diagnostics observe every captured sample, including when gameplay is paused.
      this.pressureHistory[side] = this.pressureHistory[side].filter(sample => now - sample.at < PRESSURE_PEAK_MS);
      if (now - at < PRESSURE_PEAK_MS) this.pressureHistory[side].push({ at, ...this.sidePressure(side) });
      if (!this.enabled || at <= this.evidenceAfter) continue;
      this.emit(at - 0.001);
      // Never let an old board reading participate in a newer sample's evidence.
      const active = sides.filter(s => this.isLive(s, now) && at - this.latest[s] < STALE_MS && this.signals[s].baseline);
      const peak = this.currentPressure(active);
      this.detector.sample(peak.x, peak.z, at);
    }
    if (this.enabled && this.liveSides.size) this.emit(batch.throughAt);
  }
  private clearPressureHistory(): void { this.pressureHistory = { L: [], R: [] }; }
  private sidePressure(side: Side): { x: number; z: number } {
    const signal = this.signals[side];
    const peak = (axis: number) => Math.max(0, Math.abs(signal.delta[axis]) - this.deadZone);
    return { x: peak(0), z: peak(2) };
  }
  private currentPressure(active: Side[]): { x: number; z: number } {
    const values = active.map(side => this.sidePressure(side));
    return { x: Math.max(0, ...values.map(value => value.x)), z: Math.max(0, ...values.map(value => value.z)) };
  }
  pressure(now = Date.now()) {
    const active = sides.filter(side => this.isLive(side, now) && now - this.latest[side] < STALE_MS && this.signals[side].baseline);
    const live = this.currentPressure(active);
    const recent = active.flatMap(side => {
      this.pressureHistory[side] = this.pressureHistory[side].filter(sample => now - sample.at < PRESSURE_PEAK_MS);
      return this.pressureHistory[side];
    });
    const channel = (axis: 'x' | 'z', full: number, threshold: number) => ({
      live: pressureStrength(live[axis], full),
      peak: pressureStrength(Math.max(live[axis], ...recent.map(sample => sample[axis])), full),
      trigger: pressureStrength(threshold, full),
    });
    const settings = this.detector.settings;
    return { ready: active.length > 0,
      punch: channel('x', settings.punchFull, settings.punchThreshold),
      squeeze: channel('z', settings.squeezeFull, settings.squeezeThreshold) };
  }
  private checkHealth(now: number): void {
    for (const side of sides) {
      const live = this.isLive(side, now);
      if (live !== this.liveSides.has(side)) {
        this.signals[side].reset(); this.pressureHistory[side] = []; this.cancel(now);
        if (live) this.liveSides.add(side); else this.liveSides.delete(side);
      }
    }
  }
  advance(now = Date.now()): void {
    this.checkHealth(now);
    // Only a completed server batch can close a peak window; wall time can
    // run ahead of frames still queued for the next transport flush.
  }
  private emit(now: number): void {
    const action = this.detector.flush(now);
    if (action) { this.lastAction = action; this.onAction?.(action); }
  }
  connect(): () => void {
    try { this.loadSettings(window.localStorage); } catch { /* Continue with session settings. */ }
    const source = new EventSource('/api/sensors');
    source.onmessage = event => this.accept(JSON.parse(event.data) as SensorBatch);
    source.onerror = () => this.disconnect();
    const timer = window.setInterval(() => this.advance(), 25);
    return () => { source.close(); clearInterval(timer); this.disconnect(); };
  }
}
export const sensors = new SensorStore();
