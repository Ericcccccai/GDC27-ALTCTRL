export type ActionKind = 'punch' | 'squeeze';

export interface ActionEvent {
  kind: ActionKind;
  strength: number;
  source: 'keyboard' | 'serial';
}

export interface ChargeState {
  kind: ActionKind;
  strength: number;
}

const FULL_CHARGE_MS = 1200;
const keyKind = (key: string): ActionKind | null =>
  key === 'ArrowUp' ? 'punch' : key === 'ArrowLeft' || key === 'ArrowRight' ? 'squeeze' : null;

export class KeyboardInput {
  private readonly held = new Set<string>();
  private active: { kind: ActionKind; started: number } | null = null;

  constructor(private readonly target: Window, private readonly onAction: (event: ActionEvent) => void) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.reset);
    target.document.addEventListener('visibilitychange', this.onVisibility);
  }

  getCharge(): ChargeState | null {
    return this.active ? {
      kind: this.active.kind,
      strength: Math.min(1, Math.max(0, (this.target.performance.now() - this.active.started) / FULL_CHARGE_MS)),
    } : null;
  }

  reset = (): void => {
    this.held.clear();
    this.active = null;
  };

  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.reset);
    this.target.document.removeEventListener('visibilitychange', this.onVisibility);
    this.reset();
  }

  private onVisibility = (): void => {
    if (this.target.document.hidden) this.reset();
  };

  private onDown = (event: KeyboardEvent): void => {
    const kind = keyKind(event.key);
    if (!kind) return;
    event.preventDefault();
    if (event.repeat || this.held.has(event.key)) return;
    if (this.held.size === 0) this.active = { kind, started: this.target.performance.now() };
    this.held.add(event.key);
  };

  private onUp = (event: KeyboardEvent): void => {
    if (!keyKind(event.key)) return;
    event.preventDefault();
    if (!this.held.delete(event.key) || !this.active) return;
    if ([...this.held].some(key => keyKind(key) === this.active?.kind)) return;
    const charge = this.getCharge()!;
    this.active = null;
    this.onAction({ ...charge, source: 'keyboard' });
  };
}

/** Discards an oversized record through its newline, never accepting its suffix. */
export class SerialLineParser {
  private line = '';
  private discarding = false;

  push(chunk: string): ActionEvent[] {
    const actions: ActionEvent[] = [];
    for (const char of chunk) {
      if (char === '\n') {
        if (!this.discarding) {
          const record = this.line.endsWith('\r') ? this.line.slice(0, -1) : this.line;
          const match = /^(PUNCH|SQUEEZE),(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(record);
          if (match) actions.push({
            kind: match[1] === 'PUNCH' ? 'punch' : 'squeeze',
            strength: Number(match[2]),
            source: 'serial',
          });
        }
        this.reset();
      } else if (!this.discarding) {
        if (this.line.length >= 64) {
          this.line = '';
          this.discarding = true;
        } else this.line += char;
      }
    }
    return actions;
  }

  reset(): void {
    this.line = '';
    this.discarding = false;
  }
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialAPI {
  requestPort(): Promise<SerialPort>;
}

interface SerialSession {
  stopped: boolean;
  connecting: Promise<void>;
  reading?: Promise<void>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
}

function serialAPI(): SerialAPI | undefined {
  return typeof navigator === 'undefined' ? undefined :
    (navigator as Navigator & { serial?: SerialAPI }).serial;
}

export class SerialInput {
  public onStatus: (status: string) => void = () => {};
  private session: SerialSession | null = null;

  constructor(private readonly onAction: (event: ActionEvent) => void) {}

  static isSupported(): boolean {
    return typeof window !== 'undefined' && !!serialAPI();
  }

  async connect(): Promise<void> {
    if (this.session) return this.session.connecting;
    const api = serialAPI();
    if (!SerialInput.isSupported() || !api) {
      this.onStatus('Web Serial is unavailable in this browser.');
      throw new Error('Web Serial is unavailable in this browser.');
    }
    const session: SerialSession = { stopped: false, connecting: Promise.resolve() };
    this.session = session;
    session.connecting = this.open(api, session);
    return session.connecting;
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    if (!session) return;
    session.stopped = true;
    await session.connecting.catch(() => {});
    if (session.reader) await session.reader.cancel().catch(() => {});
    await session.reading;
  }

  private async open(api: SerialAPI, session: SerialSession): Promise<void> {
    try {
      this.onStatus('Choose a serial device.');
      const port = await api.requestPort();
      if (session.stopped) {
        this.session = null;
        this.onStatus('Disconnected');
        return;
      }
      await port.open({ baudRate: 115200 });
      // The read task owns closing the port, including a stop during open().
      session.reading = this.read(port, session);
    } catch (error) {
      if (this.session === session) this.session = null;
      this.onStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async read(port: SerialPort, session: SerialSession): Promise<void> {
    const parser = new SerialLineParser();
    const decoder = new TextDecoder();
    let failure: unknown;
    try {
      if (!session.stopped) {
        if (!port.readable) throw new Error('Device has no readable stream.');
        session.reader = port.readable.getReader();
        this.onStatus('Connected');
        while (!session.stopped) {
          const { value, done } = await session.reader.read();
          if (done || session.stopped) break;
          if (value) for (const action of parser.push(decoder.decode(value, { stream: true }))) {
            if (session.stopped) break;
            this.onAction(action);
          }
        }
      }
    } catch (error) {
      if (!session.stopped) failure = error;
    } finally {
      session.reader?.releaseLock();
      delete session.reader;
      parser.reset();
      try { await port.close(); } catch (error) { failure ??= error; }
      if (this.session === session) this.session = null;
      this.onStatus(failure ? `Serial error: ${failure instanceof Error ? failure.message : String(failure)}` : 'Disconnected');
    }
  }
}
