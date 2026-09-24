import { SENSOR_PATHS, type Side } from './sensors';
import './sensors.css';
import { sensors } from './SensorStore';

const SIDES: Side[] = ['L', 'R'];
const axes = [{ title: 'Squeezing', axis: 2, label: 'Z' }, { title: 'Up / down', axis: 1, label: 'Y' }, { title: 'Inward / outward', axis: 0, label: 'X' }];
const number = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(3)}`;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function mountSensorPanel(onVisibility: (visible: boolean) => void, onKeyboardTest: (enabled: boolean) => void): () => void {
  const panel = document.createElement('section');
  panel.id = 'sensor-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Sensor lab');
  panel.innerHTML = `
    <header class="sensor-header"><div><p class="eyebrow">PIMPLE POP / CONTROLLER WORKBENCH</p><h1>Sensor lab</h1><p>Move one sensor at a time. Watch the numbers become motion.</p></div><button id="back-game">Back to game</button></header>
    <div class="sensor-tools"><div><strong id="bridge-status" role="status">Connecting to local sensor reader…</strong><p id="zero-status" role="status">The first valid reading from each board becomes zero.</p></div><button id="reset-zero">Reset zero</button><label>Ignore small changes <output id="dead-value">0.06 g</output><input id="dead-zone" type="range" min="0.02" max="0.30" value="0.06" step="0.01"></label></div>
    <div class="sensor-connections">${SIDES.map(side => `<article class="sensor-device" data-side="${side}"><div class="device-title"><h2><span class="legend ${side}"></span>${side === 'L' ? 'Left' : 'Right'} sensor</h2><span data-field="status" class="status">Waiting</span></div><code>${SENSOR_PATHS[side]}</code><p data-field="message">Waiting for the board</p><div class="sensor-meta" data-field="meta">No readings yet</div><table><thead><tr><th>Axis · g</th><th>Raw</th><th>Zero</th><th>Change</th><th>Used</th></tr></thead><tbody>${['X','Y','Z'].map((axis,i) => `<tr><th>${axis}</th>${['raw','zero','delta','used'].map(field=>`<td data-value="${field}-${i}">—</td>`).join('')}</tr>`).join('')}</tbody></table><p class="gyro" data-field="gyro">Rotation · waiting</p><button data-zero="${side}">Zero this sensor</button></article>`).join('')}</div>
    <div class="sensor-graphs">${axes.map(({title,axis,label}) => `<article class="sensor-graph"><div class="graph-title"><h2>${title}</h2><span>${label} axis</span></div><p class="graph-values" id="values-${axis}">L — &nbsp; R —</p><svg viewBox="0 0 360 120" role="img" aria-label="${title} signed sensor response"><line x1="30" y1="60" x2="330" y2="60" stroke="#cfc4b8"/><line x1="180" y1="26" x2="180" y2="94" stroke="#cfc4b8" stroke-dasharray="4 4"/><text x="22" y="112">−${label}</text><text x="166" y="112">zero</text><text x="312" y="112">+${label}</text><text x="20" y="36" fill="#28827e">L</text><text x="20" y="88" fill="#be6547">R</text><circle id="dot-${axis}-L" cx="180" cy="35" r="10" fill="#28827e"/><circle id="dot-${axis}-R" cx="180" cy="85" r="10" fill="#be6547"/></svg><svg class="history" viewBox="0 0 360 170" role="img" aria-label="${title} filtered readings over the last eight seconds"><rect x="0" y="0" width="360" height="170" fill="#f8f5ef"/><rect id="band-${axis}" x="0" y="80" width="360" height="10" fill="#e8e2d8"/><path d="M0 85 H360" stroke="#b6aa9d" stroke-dasharray="4 4"/><text x="5" y="15">+1 g</text><text x="5" y="163">−1 g</text><path id="trace-${axis}-L" fill="none" stroke="#28827e" stroke-width="2"/><path id="trace-${axis}-R" fill="none" stroke="#be6547" stroke-width="2"/></svg><p class="graph-caption">Last 8 seconds · fixed ±1 g scale<br><span id="range-${axis}">Small changes settle at zero.</span></p></article>`).join('')}</div>
    <footer class="sensor-notes"><strong>Reading guide</strong><p>Raw → subtract zero → smooth over 150 ms → ignore the dead zone → Used. The diagrams show Used in g; teal is left, orange is right. The shaded band marks the dead zone. Values outside ±1 g stay visible in the numbers but clip on the graphs.</p><p>These are acceleration changes, not distance or squeeze force. Tilting also changes gravity along an axis. Confirm direction signs with your mounting; the diagrams preserve each board’s sign. Game scoring pauses in this lab. Game gestures use unsmoothed absolute X (punch) or Z (squeeze) peaks after subtracting zero and the dead zone. Highest peak / trigger threshold wins; exact ties select punch. These defaults need physical trials with your mounting.</p></footer>`;
  document.body.append(panel);
  // Keep native slider keys inside the lab.
  panel.addEventListener('keydown', event => event.stopPropagation());
  panel.addEventListener('keyup', event => event.stopPropagation());
  const get = <T extends Element = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const testing = document.createElement('div');
  testing.className = 'sensor-tools keyboard-testing';
  testing.innerHTML = `<label><input id="keyboard-test" type="checkbox">Keyboard test mode</label><div><strong>Testing only · off by default</strong><p>Hold ↑ to punch, or ← / → to squeeze. Release to act. A 1.2 second hold gives 100% power.</p><p>Sensor scoring is paused in this mode. Sensor diagnostics continue. Reloading returns to sensor play.</p></div>`;
  get('.sensor-header').after(testing);
  get('#keyboard-test').addEventListener('change', () => onKeyboardTest(get<HTMLInputElement>('#keyboard-test').checked));
  const signals = sensors.signals;
  let history: { at: number; L: number[] | null; R: number[] | null }[] = [];
  const show = () => { panel.hidden = false; onVisibility(true); get<HTMLButtonElement>('#back-game').focus(); };
  const hide = () => { panel.hidden = true; onVisibility(false); };
  const reset = (sides: Side[]) => {
    sensors.reset(sides); history = [];
    get('#zero-status').textContent = 'Zero reset requested. Hold still; the next valid reading sets the new baseline.';
  };
  get('#back-game').addEventListener('click', hide);
  get('#reset-zero').addEventListener('click', () => reset(SIDES));
  for (const side of SIDES) get(`[data-zero="${side}"]`).addEventListener('click', () => reset([side]));
  get('#dead-zone').addEventListener('input', () => {
    sensors.deadZone = Number(get<HTMLInputElement>('#dead-zone').value);
    get('#dead-value').textContent = `${sensors.deadZone.toFixed(2)} g`;
    history = []; sensors.cancel();
  });
  const tuning = document.createElement('div');
  tuning.className = 'sensor-tools gesture-tools';
  const controls = [
    { key: 'punchFull', label: 'Punch power sensitivity', help: 'Peak for 100% power (g). Higher = harder punch needed.' },
    { key: 'squeezeFull', label: 'Squeeze power sensitivity', help: 'Peak for 100% power (g). Higher = harder squeeze needed.' },
    { key: 'punchThreshold', label: 'Punch detection threshold (g)', help: 'Minimum motion to detect a punch, separate from power.' },
    { key: 'squeezeThreshold', label: 'Squeeze detection threshold (g)', help: 'Minimum motion to detect a squeeze, separate from power.' },
  ] as const;
  tuning.innerHTML = `<div><strong>Power sensitivity</strong><p>Small hits too powerful? Increase the punch value. Adjust squeeze independently. Higher values make the game less sensitive.</p><p id="last-gesture">No gameplay gesture detected yet</p><p id="tuning-status" role="status">Settings save in this browser. Return to the game to test.</p></div>${controls.map(({key,label,help}) => `<label>${label}<input data-gesture="${key}" type="number" min="0.05" max="8" step="0.05" value="${sensors.detector.settings[key]}" aria-describedby="help-${key}"><span class="tuning-help" id="help-${key}">${help}</span></label>`).join('')}`;
  get('.sensor-tools').after(tuning);
  tuning.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.gesture as keyof typeof sensors.detector.settings;
    if (!key) return;
    const result = sensors.updateSettings({ ...sensors.detector.settings, [key]: Number(input.value) });
    get('#tuning-status').textContent = result === 'invalid'
      ? 'Use 0.05 to 8 g. The 100% power value must be at least its detection threshold. Previous setting kept.'
      : result === 'saved' ? 'Saved. The next gesture uses these settings. Return to the game to test.'
      : 'Applied for this session. Browser storage is unavailable.';
    input.value = String(sensors.detector.settings[key]);
  });
  window.addEventListener('sensor-lab', show);
  const timer = window.setInterval(() => {
    const now = Date.now();
    const { links, deadZone, bridgeLive } = sensors;
    const output = { L: null, R: null } as Record<Side, number[] | null>;
    let count = 0;
    for (const side of SIDES) {
      const link = links.find(link => link.side === side);
      const live = sensors.isLive(side, now);
      const signal = signals[side];

      const ready = live && !!signal.baseline;
      if (ready) { count++; output[side] = signal.output(deadZone); }
      const card = get(`[data-side="${side}"]`);
      const field = (name: string, value: string) => { card.querySelector(`[data-field="${name}"]`)!.textContent = value; };
      field('status', ready ? 'Live' : live ? 'Setting zero' : link?.connected ? 'No fresh data' : 'Disconnected');
      card.classList.toggle('live', ready);
      field('message', link?.message ?? 'Start the local game server to read USB sensors.');
      field('meta', link?.frame ? `Frame ${link.frame.sequence} · ${link.frames} received · ${link.rejected} rejected · ${Math.max(0, now-link.receivedAt)} ms ago` : 'No valid readings yet');
      field('gyro', ready && link?.frame ? `Rotation °/s · X ${number(link.frame.gyro[0])} · Y ${number(link.frame.gyro[1])} · Z ${number(link.frame.gyro[2])}` : 'Rotation · waiting for fresh data');
      for (let i=0;i<3;i++) for (const [key,value] of Object.entries({ raw:signal.raw[i], zero:signal.baseline?.[i], delta:signal.delta[i], used:output[side]?.[i] })) {
        card.querySelector(`[data-value="${key}-${i}"]`)!.textContent = ready && value !== undefined ? number(value) : '—';
      }
    }
    get('#bridge-status').textContent = !bridgeLive ? 'Local sensor reader disconnected. Reconnecting…' : `${count} of 2 sensors live`;
    if (count === 2) get('#zero-status').textContent = 'Baselines set. Hold still and use Reset zero whenever you change the resting position.';
    history.push({ at: now, ...output });
    history = history.filter(sample => now-sample.at <= 8000);
    const action = sensors.lastAction;
    get('#last-gesture').textContent = action ? `Last gameplay gesture: ${action.kind} ${Math.round(action.strength*100)}% · X ${action.xPeak.toFixed(3)} g · Z ${action.zPeak.toFixed(3)} g` : 'No gameplay gesture detected yet';
    if (panel.hidden) return;
    for (const { axis } of axes) {
      get(`#values-${axis}`).textContent = SIDES.map(side => `${side} ${output[side] ? number(output[side]![axis])+' g' : '—'}`).join('     ');
      get(`#range-${axis}`).textContent = SIDES.some(side => Math.abs(output[side]?.[axis] ?? 0)>1) ? 'Outside graph range. Read the numbers above.' : 'Small changes settle at zero.';
      const band = get(`#band-${axis}`); band.setAttribute('y', String(85-70*deadZone)); band.setAttribute('height', String(140*deadZone));
      for (const side of SIDES) {
        const dot = get(`#dot-${axis}-${side}`);
        dot.setAttribute('cx', String(180+130*clamp(output[side]?.[axis] ?? 0)));
        dot.setAttribute('opacity', output[side] ? '1' : '0.15');
        let pen = false;
        const path = history.map(sample => {
          const values = sample[side];
          if (!values) { pen = false; return ''; }
          const command = pen ? 'L' : 'M'; pen = true;
          return `${command}${(360-(now-sample.at)/8000*360).toFixed(1)},${(85-clamp(values[axis])*70).toFixed(1)}`;
        }).join(' ');
        get(`#trace-${axis}-${side}`).setAttribute('d', path);
      }
    }
  }, 50);
  if (new URLSearchParams(location.search).has('sensors')) show();
  return () => { clearInterval(timer); window.removeEventListener('sensor-lab', show); panel.remove(); };
}
