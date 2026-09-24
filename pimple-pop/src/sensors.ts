export type Side = 'L' | 'R';
export type Vector = [number, number, number];
export interface ImuFrame { side: Side; sequence: number; timeUs: number; acceleration: Vector; gyro: Vector }
export interface SensorLink {
  side: Side; path: string; connected: boolean; message: string;
  receivedAt: number; frames: number; rejected: number; frame: ImuFrame | null;
}
export const SENSOR_PATHS: Record<Side, string> = { L: '/dev/cu.usbmodem21401', R: '/dev/cu.usbmodem21101' };
export const STALE_MS = 1000;
export const DEFAULT_DEAD_ZONE = 0.06;

/** Bounded newline decoder for the firmware's ten-column CSV records. */
export class ImuParser {
  private line = '';
  private discarding = false;
  rejected = 0;
  push(chunk: string): ImuFrame[] {
    const frames: ImuFrame[] = [];
    for (const char of chunk) {
      if (char !== '\n') {
        if (!this.discarding) {
          if (this.line.length >= 256) { this.line = ''; this.discarding = true; }
          else this.line += char;
        }
        continue;
      }
      const line = this.line.replace(/\r$/, '');
      if (this.discarding) this.rejected++;
      else if (line && !line.startsWith('#')) {
        const fields = line.split(',');
        const uint = /^(0|[1-9]\d*)$/;
        const decimal = /^-?\d+(?:\.\d+)?$/;
        const values = fields.slice(4).map(Number);
        if (fields.length === 10 && fields[0] === 'IMU' && (fields[1] === 'L' || fields[1] === 'R') &&
            uint.test(fields[2]) && uint.test(fields[3]) && Number(fields[2]) <= 0xffffffff && Number(fields[3]) <= 0xffffffff &&
            fields.slice(4).every(v => decimal.test(v)) && values.every(Number.isFinite)) {
          frames.push({ side: fields[1], sequence: Number(fields[2]), timeUs: Number(fields[3]), acceleration: values.slice(0, 3) as Vector, gyro: values.slice(3) as Vector });
        } else this.rejected++;
      }
      this.line = ''; this.discarding = false;
    }
    return frames;
  }
}

export class SensorSignal {
  baseline: Vector | null = null;
  raw: Vector = [0, 0, 0];
  delta: Vector = [0, 0, 0];
  filtered: Vector = [0, 0, 0];
  private lastAt = 0;
  reset(): void {
    this.baseline = null;
    this.delta = [0, 0, 0]; this.filtered = [0, 0, 0]; this.lastAt = 0;
  }
  accept(frame: ImuFrame, at: number): void {
    this.raw = [...frame.acceleration];
    if (!this.baseline || at - this.lastAt > STALE_MS) {
      this.baseline = [...this.raw]; this.filtered = [0, 0, 0];
    }
    this.delta = this.raw.map((value, i) => value - this.baseline![i]) as Vector;
    const alpha = 1 - Math.exp(-Math.max(0, at - this.lastAt) / 150);
    this.filtered = this.filtered.map((value, i) => value + alpha * (this.delta[i] - value)) as Vector;
    this.lastAt = at;
  }
  output(deadZone = DEFAULT_DEAD_ZONE): Vector {
    return this.filtered.map(value => Math.sign(value) * Math.max(0, Math.abs(value) - deadZone)) as Vector;
  }
}
