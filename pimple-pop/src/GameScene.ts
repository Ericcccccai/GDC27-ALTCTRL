import Phaser from 'phaser';
import { KeyboardInput, SerialInput, type ActionEvent } from './input';
import { act, createGame, startGame, tick, type GameState } from './game';

const C = { cream: 0xfff8ec, paper: 0xfffdf7, ink: 0x382b27, muted: 0x89796e, peach: 0xf3b499, coral: 0xe86445, mint: 0xc7d8bb, line: 0xe4d7c8 };
const layers = ['Face_Base', 'Cheek_L', 'Cheek_R', 'EyeWhite_L', 'EyeWhite_R', 'Pupil_L', 'Pupil_R', 'Brow_L', 'Brow_R', 'Nose', 'Mouth', 'Hair_Front'];
const spots = [[-115, 108], [95, 100], [-72, -145], [117, -118], [15, 174], [-161, 31], [158, 30]];

export default class GameScene extends Phaser.Scene {
  private state: GameState = createGame();
  private keys!: KeyboardInput;
  private serial!: SerialInput;
  private serialConnected = false;
  private serialBusy = false;
  private face!: Phaser.GameObjects.Container;
  private pimples: Phaser.GameObjects.Image[] = [];
  private ring!: Phaser.GameObjects.Arc;
  private targetArrow!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private targetHint!: Phaser.GameObjects.Text;
  private strengthText!: Phaser.GameObjects.Text;
  private chargeLabel!: Phaser.GameObjects.Text;
  private chargeFill!: Phaser.GameObjects.Rectangle;
  private threshold!: Phaser.GameObjects.Rectangle;
  private message!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private startButton!: Phaser.GameObjects.Container;
  private startLabel!: Phaser.GameObjects.Text;
  private serialLabel!: Phaser.GameObjects.Text;
  private statusLabel!: Phaser.GameObjects.Text;
  private result!: Phaser.GameObjects.Container;
  private resultScore!: Phaser.GameObjects.Text;
  private resultDetail!: Phaser.GameObjects.Text;
  private lastForce = 0;
  private forceUntil = 0;
  private enter = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.repeat) this.begin(); };

  constructor() { super('GameScene'); }
  preload(): void {
    for (const name of layers) this.load.image(name, `assets/${name}.webp`);
    for (let i = 1; i <= 4; i++) this.load.image(`Pimple_${i}`, `assets/Pimple_${i}.webp`);
  }
  private text(x: number, y: number, value: string, size = 20, color = C.ink, bold = false): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily: 'Arial, sans-serif', fontSize: `${size}px`, color: `#${color.toString(16).padStart(6, '0')}`, fontStyle: bold ? 'bold' : 'normal', lineSpacing: 6 });
  }
  private card(x: number, y: number, width: number, height: number, color = C.paper, radius = 22): Phaser.GameObjects.Graphics {
    return this.add.graphics().fillStyle(C.ink, 0.06).fillRoundedRect(x, y + 5, width, height, radius).fillStyle(color).fillRoundedRect(x, y, width, height, radius).lineStyle(1, C.line).strokeRoundedRect(x, y, width, height, radius);
  }
  private button(x: number, y: number, width: number, label: string, callback: () => void, dark = true): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, width, 46, dark ? C.ink : C.paper).setStrokeStyle(1, C.ink).setInteractive({ useHandCursor: true });
    const txt = this.text(0, 0, label, 15, dark ? C.cream : C.ink, true).setOrigin(0.5);
    const group = this.add.container(x, y, [bg, txt]);
    bg.on('pointerover', () => bg.setFillStyle(dark ? C.coral : C.mint));
    bg.on('pointerout', () => bg.setFillStyle(dark ? C.ink : C.paper));
    bg.on('pointerdown', callback);
    return group;
  }
  create(): void {
    this.cameras.main.setBackgroundColor(C.cream);
    this.text(36, 22, 'THE SATISFYINGLY GROSS ARCADE', 11, C.muted, true).setLetterSpacing(2);
    this.text(34, 43, 'Pimple Pop', 44, C.ink, true);
    this.text(312, 65, 'A little pressure. A lot of relief.', 16, C.muted);
    const serialButton = this.button(1022, 56, 174, 'CONNECT DEVICE', () => { void this.toggleSerial(); }, false);
    this.serialLabel = serialButton.list[1] as Phaser.GameObjects.Text;
    this.button(1183, 56, 118, 'FULLSCREEN', () => { if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen(); }, false);
    this.add.rectangle(640, 112, 1208, 1, C.line);
    this.statusLabel = this.text(1240, 91, SerialInput.isSupported() ? 'Keyboard ready · optional USB controller' : 'Keyboard ready · USB needs Chrome or Edge', 11, C.muted).setOrigin(1, 0);

    this.card(34, 138, 252, 146);
    this.text(54, 157, 'YOUR SCORE', 12, C.muted, true).setLetterSpacing(2);
    this.scoreText = this.text(52, 181, '0000', 57, C.ink, true);
    this.comboText = this.text(54, 252, 'A fresh face. A fresh start.', 13, C.muted);
    this.card(34, 302, 252, 119, C.mint);
    this.text(54, 321, 'TIME LEFT', 12, C.ink, true).setLetterSpacing(2);
    this.timerText = this.text(52, 344, '45', 49, C.ink, true);
    this.text(127, 368, 'seconds', 16, C.ink);
    this.text(40, 449, 'THE DAILY DECOMPRESS', 11, C.muted, true).setLetterSpacing(1);
    this.text(40, 477, 'Meet your new\nstress relief.', 29, C.ink, true);
    this.text(40, 557, 'We pick the spot.\nYou bring the pressure.\nPop as many as you can.', 16, C.muted);
    this.startButton = this.button(160, 666, 242, 'LET’S POP  ↵', () => this.begin());
    this.startLabel = this.startButton.list[1] as Phaser.GameObjects.Text;
    this.text(160, 697, 'Enter or a controller action to start', 11, C.muted).setOrigin(0.5);

    this.card(308, 138, 620, 572, C.peach, 120);
    this.text(618, 157, 'ONE FACE. 45 SECONDS. ZERO CHILL.', 11, C.ink, true).setOrigin(0.5).setLetterSpacing(1.4);
    this.add.ellipse(618, 658, 370, 34, C.ink, 0.09);
    this.face = this.add.container(618, 414);
    for (const layer of layers) this.face.add(this.add.image(0, 0, layer).setDisplaySize(486, 486));
    const maskShape = this.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff).fillRoundedRect(375, 171, 486, 486, { tl: 130, tr: 130, bl: 200, br: 200 });
    this.face.setMask(maskShape.createGeometryMask());
    for (let i = 0; i < spots.length; i++) {
      const [x, y] = spots[i];
      this.pimples.push(this.add.image(x, y, `Pimple_${i % 4 + 1}`).setDisplaySize(54, 54).setAlpha(0.65));
      this.face.add(this.pimples[i]);
    }
    this.ring = this.add.circle(0, 0, 32).setStrokeStyle(3, C.cream);
    this.face.add(this.ring);
    this.targetArrow = this.text(0, 0, '▼', 22, C.ink, true).setOrigin(0.5);
    this.face.add(this.targetArrow);
    this.tweens.add({ targets: this.ring, scale: 1.12, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.message = this.text(618, 679, 'Follow the ring. Find your rhythm.', 17, C.ink, true).setOrigin(0.5);
    this.countdownText = this.text(618, 402, '', 112, C.cream, true).setOrigin(0.5).setStroke('#382b27', 7).setDepth(10);

    this.card(950, 138, 296, 267);
    this.text(972, 158, 'AUTO TARGET', 12, C.muted, true).setLetterSpacing(2);
    this.add.circle(1209, 164, 5, C.coral);
    this.targetText = this.text(972, 190, 'Whitehead', 33, C.ink, true);
    this.targetHint = this.text(972, 239, 'PUNCH IT', 20, C.coral, true);
    this.text(972, 280, 'REQUIRED PRESSURE', 11, C.muted, true).setLetterSpacing(1);
    this.strengthText = this.text(972, 306, '35% or more', 24, C.ink, true);
    this.text(972, 352, 'The next spot is picked for you.\nNo aiming. Just popping.', 13, C.muted);
    this.card(950, 425, 296, 172);
    this.text(972, 445, 'PRESSURE METER', 12, C.muted, true).setLetterSpacing(1.5);
    this.chargeLabel = this.text(972, 477, 'Hold an arrow to charge', 16, C.ink, true);
    this.add.rectangle(1098, 525, 252, 19, C.line);
    this.chargeFill = this.add.rectangle(972, 525, 0, 19, C.coral).setOrigin(0, 0.5);
    this.threshold = this.add.rectangle(972 + 252 * 0.35, 525, 3, 29, C.ink);
    this.text(972, 552, 'Hold longer → hit harder.\nRelease when you pass the marker.', 12, C.muted);
    this.text(959, 624, 'GOOD TIMING FEELS GOOD.', 12, C.ink, true);
    this.text(959, 651, 'Right move + enough pressure = pop.\nKeep a streak for a combo bonus.', 13, C.muted);

    this.add.rectangle(640, 734, 1208, 1, C.line);
    this.text(38, 759, 'HOW TO POP', 11, C.muted, true).setLetterSpacing(1.5);
    this.text(204, 750, '↑', 31, C.coral, true);
    this.text(247, 752, 'HOLD + RELEASE', 10, C.muted, true);
    this.text(247, 768, 'Punch whiteheads', 15, C.ink, true);
    this.text(518, 750, '← / →', 25, C.coral, true);
    this.text(613, 752, 'HOLD EITHER + RELEASE', 10, C.muted, true);
    this.text(613, 768, 'Squeeze deep pimples', 15, C.ink, true);
    this.text(1244, 760, 'A tiny game for big feelings.', 13, C.muted).setOrigin(1, 0);

    const panel = this.add.graphics().fillStyle(C.cream, 0.98).fillRoundedRect(-228, -177, 456, 354, 30).lineStyle(2, C.ink).strokeRoundedRect(-228, -177, 456, 354, 30);
    const heading = this.text(0, -148, 'AHH. THAT’S BETTER.', 14, C.coral, true).setOrigin(0.5);
    this.resultScore = this.text(0, -81, '0', 73, C.ink, true).setOrigin(0.5);
    const caption = this.text(0, -22, 'POINTS OF RELIEF', 11, C.muted, true).setOrigin(0.5).setLetterSpacing(2);
    this.resultDetail = this.text(0, 29, '', 18, C.ink).setOrigin(0.5).setAlign('center');
    const again = this.button(0, 123, 290, 'ONE MORE ROUND  ↵', () => this.begin());
    this.result = this.add.container(618, 414, [panel, heading, this.resultScore, caption, this.resultDetail, again]).setDepth(20).setVisible(false);

    this.keys = new KeyboardInput(window, event => this.handleAction(event));
    this.serial = new SerialInput(event => this.handleAction(event));
    this.serial.onStatus = status => {
      this.serialConnected = status === 'Connected';
      this.serialLabel.setText(this.serialConnected ? 'DISCONNECT' : 'CONNECT DEVICE');
      this.statusLabel.setText(status.length > 84 ? status.slice(0, 81) + '…' : status);
    };
    window.addEventListener('keydown', this.enter);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keys.destroy();
      window.removeEventListener('keydown', this.enter);
      this.serial.onStatus = () => {};
      void this.serial.disconnect();
      maskShape.destroy();
    });
    this.refreshTarget();
    this.syncState();
  }

  private async toggleSerial(): Promise<void> {
    if (this.serialBusy) return;
    if (!SerialInput.isSupported()) { this.statusLabel.setText('USB controller needs Chrome or Edge. Arrow keys are ready.'); return; }
    this.serialBusy = true;
    try { if (this.serialConnected) await this.serial.disconnect(); else await this.serial.connect(); }
    catch { /* SerialInput reports the specific connection failure through onStatus. */ }
    finally { this.serialBusy = false; }
  }
  private begin(): void {
    if (this.state.phase === 'playing' || this.state.phase === 'countdown') return;
    this.keys.reset();
    this.result.setVisible(false);
    this.state = { ...createGame(), phase: 'countdown' };
    this.lastForce = 0;
    this.startLabel.setText('GET READY…');
    this.refreshTarget();
    this.syncState();
    this.message.setText('Your first target is a whitehead.');
    let number = 3;
    this.countdownText.setText(String(number));
    this.time.addEvent({ delay: 700, repeat: 2, callback: () => {
      number--;
      this.countdownText.setText(number > 0 ? String(number) : '');
      if (number === 0) {
        this.keys.reset();
        this.state = startGame();
        this.startLabel.setText('MAKE IT POP');
        this.message.setText('Hold ↑, then release to punch!');
        this.syncState();
      }
    } });
  }
  private handleAction(event: ActionEvent): void {
    if (this.state.phase === 'ready' || this.state.phase === 'results') { this.begin(); return; }
    const result = act(this.state, event.kind, event.strength);
    if (result.outcome === 'ignored') return;
    const [px, py] = spots[this.state.target.position];
    this.state = result.state;
    this.lastForce = event.strength;
    this.forceUntil = this.time.now + 400;
    const force = Math.max(0, Math.min(1, event.strength));
    this.tweens.killTweensOf(this.face);
    this.face.setScale(1).setAngle(0);
    this.tweens.add({ targets: this.face, scaleX: event.kind === 'punch' ? 1 + force * 0.07 : 1 - force * 0.10, scaleY: event.kind === 'punch' ? 1 - force * 0.06 : 1 + force * 0.07, angle: event.kind === 'punch' ? force * 2 : 0, duration: 80, yoyo: true, ease: 'Sine.easeOut' });
    if (result.outcome === 'correct') {
      this.message.setText(`POP! +${result.points}   ${this.state.combo > 1 ? `${this.state.combo} in a row!` : 'Sweet relief.'}`);
      this.burst(618 + px, 414 + py, force);
      this.refreshTarget();
    } else {
      this.message.setText(result.outcome === 'wrong' ? `Oops! This one needs a ${this.state.target.kind}. −25` : `Almost! Hold longer: reach ${Math.round(this.state.target.strength * 100)}% pressure.`);
      this.cameras.main.shake(90, 0.0015);
    }
    this.syncState();
  }
  private burst(x: number, y: number, force: number): void {
    for (let i = 0; i < 13; i++) {
      const angle = i / 13 * Math.PI * 2;
      const distance = 36 + force * 42 + Math.random() * 18;
      const dot = this.add.circle(x, y, 3 + Math.random() * 5, i % 3 === 0 ? C.coral : C.cream).setDepth(12);
      this.tweens.add({ targets: dot, x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance, alpha: 0, scale: 0.3, duration: 470, ease: 'Cubic.easeOut', onComplete: () => dot.destroy() });
    }
    const pop = this.text(x, y - 25, 'POP!', 25, C.ink, true).setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: pop, y: y - 90, alpha: 0, duration: 650, onComplete: () => pop.destroy() });
  }
  private refreshTarget(): void {
    const target = this.state.target;
    const [x, y] = spots[target.position];
    this.pimples.forEach((pimple, index) => {
      pimple.setAlpha(index === target.position ? 1 : 0.42).clearTint().setDisplaySize(index === target.position ? 68 : 43, index === target.position ? 68 : 43);
      if (index === target.position) {
        pimple.setTexture(`Pimple_${target.variant}`);
        if (target.kind === 'squeeze') pimple.setTint(0xd8757f);
      }
    });
    this.ring.setPosition(x, y).setStrokeStyle(3, target.kind === 'punch' ? C.cream : C.ink);
    this.targetArrow.setPosition(x, y - 50);
    this.targetText.setText(target.kind === 'punch' ? 'Whitehead' : 'Deep pimple');
    this.targetHint.setText(target.kind === 'punch' ? '↑  PUNCH IT' : '← / →  SQUEEZE IT');
    this.strengthText.setText(`${Math.round(target.strength * 100)}% or more`);
    this.threshold.setX(972 + 252 * target.strength);
  }
  private syncState(): void {
    this.scoreText.setText(String(this.state.score).padStart(4, '0'));
    this.comboText.setText(this.state.combo ? `${this.state.combo} COMBO  ·  ${this.state.popped} popped` : `${this.state.popped} popped  ·  build your streak`);
    this.registry.set('gameState', { ...this.state, target: { ...this.state.target } });
  }
  update(_time: number, delta: number): void {
    if (!this.keys) return;
    if (this.state.phase === 'playing') {
      this.state = tick(this.state, delta);
      this.timerText.setText(String(Math.ceil(this.state.remainingMs / 1000)).padStart(2, '0'));
      this.timerText.setColor(this.state.remainingMs < 10_000 ? '#c7462e' : '#382b27');
      this.registry.set('gameState', { ...this.state, target: { ...this.state.target } });
      if (this.state.phase === 'results') {
        this.keys.reset();
        this.resultScore.setText(String(this.state.score));
        this.resultDetail.setText(`${this.state.popped} pimples popped\nBest combo: ${this.state.bestCombo}  ·  ${this.state.attempts ? Math.round(this.state.popped / this.state.attempts * 100) : 0}% accuracy`);
        this.result.setVisible(true);
        this.startLabel.setText('PLAY AGAIN  ↵');
        this.message.setText('All done. Take a breath. Then go again.');
      }
    } else if (this.state.phase !== 'results') {
      this.timerText.setText('45').setColor('#382b27');
    }
    const charge = this.state.phase === 'playing' ? this.keys.getCharge() : null;
    const strength = charge?.strength ?? (this.time.now < this.forceUntil ? this.lastForce : 0);
    this.chargeFill.setDisplaySize(Math.max(0.01, 252 * strength), 19).setFillStyle(strength >= this.state.target.strength ? 0x719068 : C.coral);
    this.chargeLabel.setText(charge ? `${charge.kind.toUpperCase()}  ${Math.round(strength * 100)}%${strength >= this.state.target.strength ? ' · RELEASE!' : ''}` : 'Hold an arrow to charge');
  }
}
