import Phaser from 'phaser';
import { KeyboardTestInput, type ActionEvent, type KeyboardActionEvent } from './input';
import { sensors } from './SensorStore';
import { act, createGame, startGame, tick, PIMPLE_TYPES, PIMPLE_SEQUENCE, targetsOnFace, type GameState } from './game';

const C = { cream: 0xfff8ec, paper: 0xfffdf7, ink: 0x382b27, muted: 0x89796e, peach: 0xf3b499, coral: 0xe86445, mint: 0xc7d8bb, line: 0xe4d7c8 };
const layers = ['Face_Base', 'Cheek_L', 'Cheek_R', 'EyeWhite_L', 'EyeWhite_R', 'Pupil_L', 'Pupil_R', 'Brow_L', 'Brow_R', 'Nose', 'Mouth', 'Hair_Front'];
const hurtLayers = ['Eye_L_hurt', 'Eye_R_hurt', 'Brow_L_hurt', 'Brow_R_hurt', 'Mouth_hurt'];
const expressionLayers = new Set(['EyeWhite_L', 'EyeWhite_R', 'Pupil_L', 'Pupil_R', 'Brow_L', 'Brow_R', 'Mouth']);
type BurstAtlasData = { meta: { frameCount: number; frameRate: number; scalePerDisplayUnit: number } };
const burstVariants = [1, 2, 3, 5, 6];
const spots = [[-115, 108], [95, 100], [-62, -150], [54, -153], [15, 174], [-161, 31], [158, 30]];

export default class GameScene extends Phaser.Scene {
  private state: GameState = createGame();
  private inputReady = false;
  private keyboardTest = false;
  private keyboard!: KeyboardTestInput;
  private keyboardLast: KeyboardActionEvent | null = null;
  private focused = true;
  private visible = () => this.syncInput();
  private modeLabel!: Phaser.GameObjects.Text;
  private pressureHelp!: Phaser.GameObjects.Text;
  private controlsTitle!: Phaser.GameObjects.Text;
  private punchKey!: Phaser.GameObjects.Text;
  private squeezeKey!: Phaser.GameObjects.Text;
  private punchInstruction!: Phaser.GameObjects.Text;
  private squeezeInstruction!: Phaser.GameObjects.Text;
  private burstEffects = new Map<number, Phaser.GameObjects.Container>();
  private normalExpression: Phaser.GameObjects.Image[] = [];
  private hurtExpression: Phaser.GameObjects.Image[] = [];
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
  private pressureLabel!: Phaser.GameObjects.Text;
  private pressureFill!: Phaser.GameObjects.Rectangle;
  private threshold!: Phaser.GameObjects.Rectangle;
  private message!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private startButton!: Phaser.GameObjects.Container;
  private startLabel!: Phaser.GameObjects.Text;
  private statusLabel!: Phaser.GameObjects.Text;
  private result!: Phaser.GameObjects.Container;
  private resultScore!: Phaser.GameObjects.Text;
  private resultDetail!: Phaser.GameObjects.Text;
  private lastForce = 0;
  private forceUntil = 0;
  private enter = (event: KeyboardEvent) => { if (this.scene.isActive() && event.key === 'Enter' && !event.repeat) this.begin(); };

  constructor() { super('GameScene'); }
  preload(): void {
    for (const name of [...layers, ...hurtLayers]) this.load.image(name, `assets/${name}.webp`);
    for (const variant of burstVariants) this.load.atlas(`Burst_${variant}`, `assets/Burst_${variant}.webp`, `assets/Burst_${variant}.json`);
    for (const i of PIMPLE_SEQUENCE) this.load.image(`Pimple_${i}`, `assets/Pimple_${i}.webp`);
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
    for (const variant of burstVariants) {
      const key = `Burst_${variant}`;
      const { frameCount, frameRate } = (this.textures.get(key).customData as BurstAtlasData).meta;
      if (!this.anims.exists(key)) this.anims.create({ key,
        frames: this.anims.generateFrameNames(key, { start: 1, end: frameCount, zeroPad: 2 }),
        frameRate, repeat: 0 });
    }
    this.cameras.main.setBackgroundColor(C.cream);
    this.text(36, 22, 'THE SATISFYINGLY GROSS ARCADE', 11, C.muted, true).setLetterSpacing(2);
    this.text(34, 43, 'Pimple Pop', 44, C.ink, true);
    this.modeLabel = this.text(312, 65, 'A little pressure. A lot of relief.', 16, C.muted);
    this.button(1022, 56, 174, 'SENSOR LAB', () => window.dispatchEvent(new Event('sensor-lab')), false);
    this.button(1183, 56, 118, 'FULLSCREEN', () => { if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen(); }, false);
    this.add.rectangle(640, 112, 1208, 1, C.line);
    this.statusLabel = this.text(1240, 91, 'USB sensor play · tune gestures in Sensor lab', 11, C.muted).setOrigin(1, 0);

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
    this.text(160, 697, 'Click or press Enter to start', 11, C.muted).setOrigin(0.5);

    this.card(308, 138, 620, 572, C.peach, 120);
    this.text(618, 157, 'ONE FACE. 45 SECONDS. ZERO CHILL.', 11, C.ink, true).setOrigin(0.5).setLetterSpacing(1.4);
    this.add.ellipse(618, 658, 370, 34, C.ink, 0.09);
    this.face = this.add.container(618, 414);
    for (const layer of layers) {
      const image = this.add.image(0, 0, layer).setDisplaySize(486, 486);
      this.face.add(image);
      if (expressionLayers.has(layer)) this.normalExpression.push(image);
    }
    for (const layer of hurtLayers) {
      const image = this.add.image(0, 0, layer).setDisplaySize(486, 486).setVisible(false);
      this.hurtExpression.push(image); this.face.add(image);
    }
    const maskShape = this.make.graphics({ x: 0, y: 0 }).fillStyle(0xffffff).fillRoundedRect(375, 171, 486, 486, { tl: 130, tr: 130, bl: 200, br: 200 });
    this.face.setMask(maskShape.createGeometryMask());
    const initialTargets = targetsOnFace(this.state.popped);
    for (let i = 0; i < spots.length; i++) {
      const [x, y] = spots[i];
      const variant = initialTargets[i].variant;
      this.pimples.push(this.add.image(x, y, `Pimple_${variant}`));
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
    this.targetText = this.text(972, 190, 'Small whitehead', 28, C.ink, true);
    this.targetHint = this.text(972, 239, 'PUNCH IT', 20, C.coral, true);
    this.text(972, 280, 'REQUIRED PRESSURE', 11, C.muted, true).setLetterSpacing(1);
    this.strengthText = this.text(972, 306, '35% or more', 24, C.ink, true);
    this.text(972, 352, 'The next spot is picked for you.\nNo aiming. Just popping.', 13, C.muted);
    this.card(950, 425, 296, 172);
    this.text(972, 445, 'PRESSURE METER', 12, C.muted, true).setLetterSpacing(1.5);
    this.pressureLabel = this.text(972, 477, 'Smack or squeeze the ball', 16, C.ink, true);
    this.add.rectangle(1098, 525, 252, 19, C.line);
    this.pressureFill = this.add.rectangle(972, 525, 1, 19, C.coral).setOrigin(0, 0.5);
    this.threshold = this.add.rectangle(972 + 252 * 0.35, 525, 3, 29, C.ink);
    this.pressureHelp = this.text(972, 552, 'Stronger motion → higher pressure.\nLet the ball settle between actions.', 12, C.muted);
    this.text(959, 624, 'GOOD TIMING FEELS GOOD.', 12, C.ink, true);
    this.text(959, 651, 'Right move + enough pressure = pop.\nKeep a streak for a combo bonus.', 13, C.muted);

    this.add.rectangle(640, 734, 1208, 1, C.line);
    this.controlsTitle = this.text(38, 759, 'HOW TO POP', 11, C.muted, true).setLetterSpacing(1.5);
    this.punchKey = this.text(204, 750, '1', 31, C.coral, true);
    this.punchInstruction = this.text(247, 752, 'SMACK THE TOP', 10, C.muted, true);
    this.text(247, 768, 'Punch pale / yellow heads', 15, C.ink, true);
    this.squeezeKey = this.text(518, 750, '2', 25, C.coral, true);
    this.squeezeInstruction = this.text(613, 752, 'SQUEEZE THE BALL', 10, C.muted, true);
    this.text(613, 768, 'Squeeze bumps / blackheads', 15, C.ink, true);
    this.text(1244, 760, 'A tiny game for big feelings.', 13, C.muted).setOrigin(1, 0);

    const panel = this.add.graphics().fillStyle(C.cream, 0.98).fillRoundedRect(-228, -177, 456, 354, 30).lineStyle(2, C.ink).strokeRoundedRect(-228, -177, 456, 354, 30);
    const heading = this.text(0, -148, 'AHH. THAT’S BETTER.', 14, C.coral, true).setOrigin(0.5);
    this.resultScore = this.text(0, -81, '0', 73, C.ink, true).setOrigin(0.5);
    const caption = this.text(0, -22, 'POINTS OF RELIEF', 11, C.muted, true).setOrigin(0.5).setLetterSpacing(2);
    this.resultDetail = this.text(0, 29, '', 18, C.ink).setOrigin(0.5).setAlign('center');
    const again = this.button(0, 123, 290, 'ONE MORE ROUND  ↵', () => this.begin());
    this.result = this.add.container(618, 414, [panel, heading, this.resultScore, caption, this.resultDetail, again]).setDepth(20).setVisible(false);

    this.keyboard = new KeyboardTestInput(window, event => this.handleAction(event));
    this.inputReady = true;
    this.focused = document.hasFocus();
    sensors.onAction = event => this.handleAction(event);
    document.addEventListener('visibilitychange', this.visible);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    this.events.on(Phaser.Scenes.Events.PAUSE, () => this.suspendInput());
    this.events.on(Phaser.Scenes.Events.RESUME, this.visible);
    window.addEventListener('keydown', this.enter);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearBursts();
      this.suspendInput(); this.keyboard.destroy(); sensors.onAction = null;
      document.removeEventListener('visibilitychange', this.visible);
      window.removeEventListener('blur', this.onBlur); window.removeEventListener('focus', this.onFocus);
      window.removeEventListener('keydown', this.enter);
      maskShape.destroy();
    });
    this.refreshTarget();
    this.syncState();
    this.updateInputCopy();
    this.syncInput();
  }

  private begin(): void {
    if (this.state.phase !== 'ready' && this.state.phase !== 'results') return;
    this.suspendInput();
    this.clearBursts();
    this.setHurt(false);
    this.result.setVisible(false);
    this.state = { ...createGame(), phase: 'countdown' };
    this.lastForce = 0;
    this.startLabel.setText('GET READY…');
    this.refreshTarget();
    this.syncState();
    this.message.setText('Start with a small whitehead: punch at 35%.');
    let number = 3;
    this.countdownText.setText(String(number));
    this.time.addEvent({ delay: 700, repeat: 2, callback: () => {
      number--;
      this.countdownText.setText(number > 0 ? String(number) : '');
      if (number === 0) {
        this.suspendInput();
        this.state = startGame();
        this.visible();
        this.startLabel.setText('MAKE IT POP');
        this.message.setText(this.keyboardTest ? 'Hold ↑, then release to punch!' : 'Smack the top of the ball to punch!');
        this.syncState();
      }
    } });
  }
  private handleAction(event: ActionEvent): void {
    if (!this.scene.isActive() || !this.focused || document.hidden || this.state.phase !== 'playing' || event.source !== (this.keyboardTest ? 'keyboard' : 'sensor')) return;
    if (event.source === 'keyboard') this.keyboardLast = event;
    const result = act(this.state, event.kind, event.strength);
    if (result.outcome === 'ignored') return;
    const poppedTarget = this.state.target;
    this.state = result.state;
    if (this.state.phase === 'recovering') { this.suspendInput(); this.setHurt(true); }
    this.lastForce = event.strength;
    this.forceUntil = this.time.now + 400;
    const force = Math.max(0, Math.min(1, event.strength));
    this.tweens.killTweensOf(this.face);
    this.face.setScale(1).setAngle(0);
    this.tweens.add({ targets: this.face, scaleX: event.kind === 'punch' ? 1 + force * 0.07 : 1 - force * 0.10, scaleY: event.kind === 'punch' ? 1 - force * 0.06 : 1 + force * 0.07, angle: event.kind === 'punch' ? force * 2 : 0, duration: 80, yoyo: true, ease: 'Sine.easeOut' });
    if (result.outcome === 'correct') {
      this.message.setText(`POP! +${result.points}   ${this.state.combo > 1 ? `${this.state.combo} in a row!` : 'Sweet relief.'}`);
      this.burst(poppedTarget.position, poppedTarget.variant, force);
      this.refreshTarget();
    } else {
      this.message.setText(result.outcome === 'wrong' ? `Oops! This one needs a ${this.state.target.kind}. −25` : `Almost! ${this.keyboardTest ? 'Hold longer' : 'Move more strongly'}: reach ${Math.round(this.state.target.strength * 100)}% pressure.`);
      this.cameras.main.shake(90, 0.0015);
    }
    this.syncState();
  }
  private burst(position: number, variant: keyof typeof PIMPLE_TYPES, force: number): void {
    const previous = this.burstEffects.get(position);
    if (previous) this.finishBurst(position, previous);
    const [x, y] = spots[position];
    const effect = this.add.container(x, y);
    this.face.add(effect);
    this.burstEffects.set(position, effect);
    this.pimples[position].setVisible(false);
    if (variant === 4) {
      // The artist deliberately excluded an unchanged blackhead sequence.
      const label = this.text(0, -18, 'POP!', 23, C.ink, true).setOrigin(0.5);
      effect.add(label);
      this.tweens.add({ targets: label, y: -60, alpha: 0, duration: 550,
        onComplete: () => this.finishBurst(position, effect) });
      return;
    }
    const key = `Burst_${variant}`;
    const sprite = this.add.sprite(0, 0, key, '01');
    const scale = PIMPLE_TYPES[variant].size * (sprite.texture.customData as BurstAtlasData).meta.scalePerDisplayUnit * (0.9 + 0.2 * force);
    sprite.setScale(scale);
    effect.add(sprite);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.finishBurst(position, effect));
    sprite.play(key);
  }
  private finishBurst(position: number, effect: Phaser.GameObjects.Container): void {
    if (this.burstEffects.get(position) !== effect) return;
    this.burstEffects.delete(position);
    this.tweens.killTweensOf(effect.list);
    effect.destroy(true);
    this.pimples[position].setVisible(true);
  }
  private clearBursts(): void {
    for (const [position, effect] of this.burstEffects) this.finishBurst(position, effect);
  }
  private refreshTarget(): void {
    const target = this.state.target;
    const [x, y] = spots[target.position];
    const upcoming = targetsOnFace(this.state.popped);
    this.pimples.forEach((pimple, index) => {
      const active = index === target.position;
      const effect = this.burstEffects.get(index);
      // A revisited spot must immediately show its new active target.
      if (active && effect) this.finishBurst(index, effect);
      pimple.setVisible(!this.burstEffects.has(index));
      const variant = upcoming[index].variant;
      pimple.setTexture(`Pimple_${variant}`);
      const type = PIMPLE_TYPES[variant];
      const size = type.size * (active ? 1 : 0.72);
      pimple.setAlpha(active ? 1 : 0.48).setDisplaySize(size, size);
    });
    const type = PIMPLE_TYPES[target.variant];
    this.ring.setPosition(x, y).setRadius(type.size / 2 + 7).setStrokeStyle(3, target.kind === 'punch' ? C.cream : C.ink);
    this.targetArrow.setPosition(x, y - type.size / 2 - 24);
    this.targetText.setText(type.name);
    this.targetHint.setText(this.keyboardTest ? (target.kind === 'punch' ? '↑  PUNCH' : '← / →  SQUEEZE') : (target.kind === 'punch' ? 'SMACK THE TOP' : 'SQUEEZE THE BALL'));
    this.strengthText.setText(`${Math.round(target.strength * 100)}% or more`);
    this.threshold.setX(972 + 252 * target.strength);
  }
  private syncState(): void {
    this.scoreText.setText(String(this.state.score).padStart(4, '0'));
    this.comboText.setText(this.state.combo ? `${this.state.combo} COMBO  ·  ${this.state.popped} popped` : `${this.state.popped} popped  ·  build your streak`);
    this.registry.set('gameState', { ...this.state, target: { ...this.state.target } });
  }
  update(_time: number, delta: number): void {
    if (!this.inputReady) return;
    if (this.state.phase === 'playing' || this.state.phase === 'recovering') {
      const wasRecovering = this.state.phase === 'recovering';
      this.state = tick(this.state, delta);
      if (wasRecovering && this.state.phase !== 'recovering') {
        this.setHurt(false); this.syncInput(); this.refreshTarget(); this.updateInputCopy();
        this.message.setText(this.keyboardTest ? 'Recovered. Use a fresh key press.' : 'Recovered. Let the ball settle, then try again.');
      }
      this.timerText.setText(String(Math.ceil(this.state.remainingMs / 1000)).padStart(2, '0'));
      this.timerText.setColor(this.state.remainingMs < 10_000 ? '#c7462e' : '#382b27');
      this.registry.set('gameState', { ...this.state, target: { ...this.state.target } });
      if (this.state.phase === 'results') {
        this.suspendInput();
        this.clearBursts(); this.setHurt(false);
        this.resultScore.setText(String(this.state.score));
        this.resultDetail.setText(`${this.state.popped} pimples popped\nBest combo: ${this.state.bestCombo}  ·  ${this.state.attempts ? Math.round(this.state.popped / this.state.attempts * 100) : 0}% accuracy`);
        this.result.setVisible(true);
        this.startLabel.setText('PLAY AGAIN  ↵');
        this.message.setText('All done. Take a breath. Then go again.');
      }
    } else if (this.state.phase !== 'results') {
      this.timerText.setText('45').setColor('#382b27');
    }
    const count = (['L','R'] as const).filter(side => sensors.isLive(side)).length;
    if (this.state.phase === 'recovering' && this.state.recovery) {
      const { remainingMs, durationMs, severe } = this.state.recovery;
      this.statusLabel.setText(`${this.keyboardTest ? 'KEYBOARD TEST MODE' : `${count}/2 sensors live`} · recovering · inputs paused`);
      this.pressureLabel.setText(`RECOVERING · ${(remainingMs / 1000).toFixed(1)}s`);
      this.pressureFill.setDisplaySize(Math.max(0.01, 252 * (1 - remainingMs / durationMs)), 19).setFillStyle(0x719068);
      this.targetHint.setText('OUCH! TAKE A BREAK');
      this.strengthText.setText('Actions paused');
      this.pressureHelp.setText('Let the face recover.\nThen start a fresh action.');
      this.message.setText(severe ? 'Ouch! Wrong move + too much pressure. Rest a moment.' : 'Ouch! Give the face a moment to recover.');
      return;
    }
    const charge = this.keyboardTest && this.state.phase === 'playing' ? this.keyboard.getCharge() : null;
    const strength = charge?.strength ?? (this.time.now < this.forceUntil ? this.lastForce : 0);
    this.pressureFill.setDisplaySize(Math.max(0.01, 252 * strength), 19).setFillStyle(strength >= this.state.target.strength ? 0x719068 : C.coral);
    const last = sensors.lastAction;
    this.pressureLabel.setText(this.keyboardTest
      ? charge ? `${charge.kind.toUpperCase()} ${Math.round(charge.strength*100)}% · RELEASE`
        : this.keyboardLast ? `${this.keyboardLast.kind.toUpperCase()} ${Math.round(this.keyboardLast.strength*100)}% · test` : 'Hold an arrow, then release'
      : last ? `${last.kind.toUpperCase()} ${Math.round(last.strength*100)}% · settle` : 'Smack or squeeze the ball');
    this.statusLabel.setText(this.keyboardTest ? 'KEYBOARD TEST MODE · sensor scoring off · Sensor lab to exit' : `${count}/2 sensors live · ${last ? `X ${last.xPeak.toFixed(2)} g · Z ${last.zPeak.toFixed(2)} g` : 'Hold still to arm'} · Sensor lab to tune`);
  }
  private setHurt(hurt: boolean): void {
    if (hurt) this.clearBursts();
    this.normalExpression.forEach(image => image.setVisible(!hurt));
    this.hurtExpression.forEach(image => image.setVisible(hurt));
    this.ring.setVisible(!hurt); this.targetArrow.setVisible(!hurt);
    this.threshold.setVisible(!hurt);
  }
  setKeyboardTest(enabled: boolean): void {
    if (enabled === this.keyboardTest) return;
    this.keyboardTest = enabled;
    if (!this.inputReady) return;
    this.syncInput();
    this.keyboardLast = null; this.lastForce = 0; this.forceUntil = 0;
    this.updateInputCopy(); this.refreshTarget();
    this.message.setText(enabled ? 'Keyboard test: hold an arrow, then release.' : 'Sensor play: let the ball settle, then act.');
  }
  private suspendInput(): void {
    sensors.setEnabled(false); sensors.cancel();
    this.keyboard?.setEnabled(false); this.keyboard?.cancel();
  }
  private syncInput(): void {
    this.suspendInput();
    const playing = this.inputReady && this.focused && !document.hidden && this.scene.isActive() && this.state.phase === 'playing';
    sensors.setEnabled(playing && !this.keyboardTest);
    this.keyboard?.setEnabled(playing && this.keyboardTest);
  }
  private updateInputCopy(): void {
    this.registry.set('keyboardTestMode', this.keyboardTest);
    this.modeLabel.setText(this.keyboardTest ? 'KEYBOARD TEST MODE · sensors do not score' : 'A little pressure. A lot of relief.').setColor(this.keyboardTest ? '#c7462e' : '#89796e');
    this.pressureHelp.setText(this.keyboardTest ? 'Hold for up to 1.2 seconds.\nRelease when you pass the marker.' : 'Stronger motion → higher pressure.\nLet the ball settle between actions.');
    this.controlsTitle.setText(this.keyboardTest ? 'TEST CONTROLS' : 'HOW TO POP');
    this.punchKey.setText(this.keyboardTest ? '↑' : '1');
    this.squeezeKey.setText(this.keyboardTest ? '← / →' : '2');
    this.punchInstruction.setText(this.keyboardTest ? 'HOLD + RELEASE' : 'SMACK THE TOP');
    this.squeezeInstruction.setText(this.keyboardTest ? 'HOLD EITHER + RELEASE' : 'SQUEEZE THE BALL');
    document.getElementById('game')?.setAttribute('aria-label', this.keyboardTest
      ? 'Pimple Pop keyboard test mode. Hold Up to punch or Left or Right to squeeze. Release to act. Enter starts the round.'
      : 'Pimple Pop sensor game. Smack the top to punch, squeeze the ball to squeeze. Click or press Enter to start.');
  }
  private onBlur = (): void => { this.focused = false; this.suspendInput(); };
  private onFocus = (): void => { this.focused = true; this.syncInput(); };
}
