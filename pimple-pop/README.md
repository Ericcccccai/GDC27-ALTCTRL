# Pimple Pop

A small Phaser + TypeScript arcade prototype for a soft pimple shaped controller. The game automatically selects a target. The player smacks the top of the ball to punch or squeezes it to pop the selected target.

## Run locally

Use Node.js 22.12 or newer.

```sh
cd /Users/caizhehao/Desktop/gdc27/pimple-pop
npm install
npm run dev
```

Open the local address printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

## GitHub Pages

The repository workflow `.github/workflows/pages.yml` tests and builds this game on every push to `main`, then publishes only `pimple-pop/dist` to GitHub Pages. Generated files stay out of Git.

In repository Settings → Pages, choose **GitHub Actions** as the source. Private repositories require a GitHub plan that supports Pages. The expected game address is https://ericcccccai.github.io/GDC27-ALTCTRL/.

Vite uses a relative asset base so the production build works under the repository URL. Run `npm run build` followed by `npm run preview` to preview the production files locally. Physical gameplay and USB diagnostics require the local Vite server, which owns both USB ports. GitHub Pages can display the game but cannot supply sensor input. Sensor input remains the default. An explicit keyboard test mode is available in Sensor Lab.

## Controls

| Input | Action |
| :--- | :--- |
| Smack the top | Punch, using either board’s absolute X acceleration change |
| Squeeze the ball | Squeeze, using either board’s absolute Z acceleration change |
| Enter or start button | Start or restart |
| Fullscreen button | Toggle fullscreen |
| Sensor lab | Pause gameplay, view three axis diagrams, adjust gesture thresholds |
| Reset zero | Use each board’s next newly received reading as its baseline |

Let the ball settle between actions. Stronger peaks produce higher pressure, more points, and stronger animation. Arrow keys perform actions only when Keyboard test mode is explicitly enabled in Sensor Lab.

## Prototype assumptions

A round lasts 45 seconds after a countdown. Pale and yellow heads require punch; deep bumps and blackheads require squeeze. Each design has a fixed pressure requirement. Read the highlighted target and required pressure before moving the ball. Correct actions build score and combo. Strength affects the action result and its visual feedback.

The current game artwork comes from `../Face_Assets_v002_20260922`. Original v001 and v002 source folders are preserved. Runtime textures under `public/assets` are rebuilt from the v002 PSD, with clean aligned face layers and separate pimple sprites. The flattened reference image is never used as the face base.

The exhibition controller is a soft pimple shaped yoga ball with one IMU on each side. The sensor lab reads raw accelerometer and gyroscope samples. Gameplay classifies unsmoothed X and Z peaks independently of the target. Diagnostic charts remain smoothed for readability. These thresholds are starting values; reliable physical discrimination still needs trials with the mounted ball and different players.

## Sensor lab

Start `npm run dev` and open http://127.0.0.1:5173/?sensors, or click **Sensor lab** in the game. The game pauses while the lab is open. Close Arduino Serial Monitor before starting: each USB port can have only one owner.

The local reader opens `/dev/cu.usbmodem21101` as **right** and `/dev/cu.usbmodem21401` as **left** at 115200 baud. These explicit USB assignments take precedence over the firmware side label; a mismatch is shown on the sensor card. Connections retry every two seconds. A board stops displaying motion when readings are more than one second old.

Three diagrams show **squeezing (Z)**, **up/down (Y)**, and **inward/outward (X)**. Each shows separate left and right readings plus an eight second history. Units are g, not distance or force. Direction signs depend on board mounting; tilting also changes the gravity component.

The first valid sample is zero. **Reset zero** discards both baselines, all filter state, and chart history; the next fresh sample from each board becomes its baseline. Each card also has **Zero this sensor**. Hold the boards still while resetting. Reconnection or stale-stream recovery establishes a fresh zero.

The display applies 150 ms exponential smoothing followed by a **0.06 g dead zone**. Values inside that zone become zero; values outside have the dead-zone magnitude subtracted, so the output starts smoothly. The slider adjusts this threshold from 0.02 to 0.30 g. Raw, zero, unfiltered change, and the actual value used by the diagrams are shown together. Graphs have a fixed ±1 g range; larger readings remain visible numerically.

Gesture tuning exposes **Punch power sensitivity**, **Squeeze power sensitivity**, and separate detection thresholds, in g after zero and dead zone subtraction. Trigger defaults are 0.20 g; 100% power defaults are 3.00 g for punch and 1.20 g for squeeze. Full strength must be at least the corresponding trigger. Valid settings are saved in this browser and restored on reload. Invalid stored settings are ignored; if browser storage is unavailable, tuning still works for the session. The lab shows separate **Hit / Punch pressure** and **Squeeze pressure** meters with current percentages and the highest captured reading from the last second. They use the same unsmoothed, zero-adjusted, dead-zone-subtracted maximum across fresh boards and the same power normalization as gameplay. Short impacts remain visible even when the latest snapshot is quiet. A separate marker shows the detection threshold; it is not the target pressure needed to pop. Live pressure updates immediately after sensitivity changes; previous peak history clears on tuning, dead-zone changes, zero reset, overflow, and loss of the affected board. Waiting or stale channels show no percentage. These diagnostics continue while lab/recovery/keyboard mode pauses sensor scoring, without emitting gameplay actions. The last gameplay gesture and its axis peaks remain available separately.

See [INPUT.md](INPUT.md) for the firmware protocol and processing details. The local reader also runs under `npm run preview`; do not run dev and preview at the same time because they would compete for the USB ports.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

`tests/input.test.ts` covers the classifier, batched impacts, shared sensor state, cancellation, stale recovery, and rearming. `tests/sensors.test.ts` covers raw IMU parsing, baseline reset, filtering, and stale recovery. `tests/game.test.ts` covers the round rules. `npm run test:browser` uses an installed Google Chrome and starts the local server if needed. It checks the rendered game, mocked raw sensor batches, punch and squeeze scores, wrong actions, ignored arrows, lab cancellation, a full timed round, and restart. Screenshots are written to `test-results`.

To include the real two-board diagnostic check, run `TEST_HARDWARE=1 npm run test:browser`. Without that flag, the hardware test is skipped. The remaining browser tests work without boards. Live test screenshots are saved under `test-results`.

## File responsibilities

| File | Purpose |
| :--- | :--- |
| `src/main.ts` | Phaser initialization and display sizing |
| `src/GameScene.ts` | Artwork, game screens, animation, and input integration |
| `src/game.ts` | Game rules independent of rendering |
| `src/input.ts` | Pure bounded gesture classifier |
| `src/SensorStore.ts` | Shared connection, calibration, freshness, and gesture delivery |
| `src/sensors.ts` | Strict IMU parser and baseline/filter calculations |
| `src/SensorPanel.ts` | Connection cards, zero controls, and axis diagrams |
| `server/sensors.ts` | Local USB port ownership and streamed raw frame batches |

## Official references

[Phaser Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager) documents aspect preserving FIT scaling and fullscreen behavior. [SerialPort documentation](https://serialport.io/docs/api-stream/) documents the local USB reader; [Vite plugin documentation](https://vite.dev/guide/api-plugin.html) documents its dev and preview integration. Firmware is in `../yoga_ball_controller_TEST_VER`.

### Adjusting power sensitivity

Open Sensor Lab and increase **Punch power sensitivity** if small smacks produce too much power. The number is the acceleration peak needed for 100% power, in g after zero and dead zone subtraction. Higher values mean less sensitivity. **Squeeze power sensitivity** works independently. Defaults are 3.00 g for punch and 1.20 g for squeeze; both detection thresholds remain 0.20 g. These are provisional tuning values, not measured physical force.

Power is `min(1, winningPeak / configured100PercentPeak)`. For example, a 0.90 g corrected punch peak now yields 30% at the 3.00 g default, compared with 75% at the previous 1.20 g scale. A 6.00 g setting reduces it to 15%. Detection thresholds decide whether motion starts a gesture; power sensitivity changes how strongly it scores. Valid values span 0.05 through 8 g, with the 100% value at least its detection threshold. Changes cancel pending gestures and apply to the next gesture after quiet rearming. Saved values remain local to this browser; zero baselines are never restored from storage.

## v002 artwork and progression

Each design keeps a consistent action and pressure requirement. The opening sequence teaches a small whitehead, a deep bump, and a regular whitehead, then introduces the other three designs before repeating. Inactive spots show their next actual target, so a pimple does not change type when the ring moves onto it. Popping a spot replaces that spot with its next design.

| Source design | In game | Action | Required power |
| :--- | :--- | :--- | :--- |
| Pimple 1, extracted from PSD | Small whitehead | Punch | 35% |
| Pimple 2 | Deep bump | Squeeze | 65% |
| Pimple 6 | Whitehead | Punch | 35% |
| Pimple 4 | Blackhead | Squeeze | 45% |
| Pimple 5 | Large whitehead | Punch | 45% |
| Pimple 3 | Inflamed head | Punch | 55% |

The ring, target name, action instruction, and required percentage remain explicit. Art retains its source colors without a squeeze tint. Variants use different display sizes and transparent square padding that preserves each source shape’s aspect ratio.

To reproduce the runtime textures, install Python 3 with Pillow and psd-tools, then run `python3 scripts/export_assets.py` from this folder. This script reads the v002 PSD and writes only the game’s derived WebP textures. All face layers retain their common 2048 pixel coordinates before resizing together to 1024 pixels. It excludes the background and baked pimple layers, extracts the missing Pimple 1 directly from its source layer, honors pimple layer opacity, removes only edge-connected white matte on Pimple 5, feathers cutout edges, and pads each proportional sprite to 160 pixels. Transparent RGB is preserved in lossless WebP. Existing runtime filenames are replaced by v002 exports; no v001 loading path remains.

## Keyboard test mode

Open **Sensor Lab**, enable **Keyboard test mode**, then choose **Back to game**. Click or press Enter to start. This switch is for testing and defaults off on every reload; sensor sensitivity settings still persist separately.

Hold **Up arrow** to charge a punch, or **Left / Right arrow** to charge a squeeze. Release to act. Charge rises linearly from 0% to 100% over 1.2 seconds. The meter and prompts switch to keyboard instructions, and the game displays **KEYBOARD TEST MODE**. Holding both squeeze arrows produces one action when the last is released. Auto-repeat is ignored, and the first gesture wins when conflicting keys overlap until all are released.

Sensor gameplay is disabled while testing, but live diagnostics continue. Opening the lab, switching modes, losing focus, hiding the page, countdown, results, and restart cancel held input. Returning to sensor play requires fresh quiet readings before detection can rearm. Turn the switch off or reload to return to physical play. Missing sensors never enable keyboard testing automatically.

## Mistakes and recovery

A wrong action still costs 25 points and breaks the combo. If its power is at least **20 percentage points above the target requirement**, hurt is guaranteed. For example, a 35% whitehead squeezed at 55% or more is severe; a 65% deep bump punched at 85% or more is severe. Other wrong actions have a **20%** chance to hurt. Correct actions and correct actions with insufficient power never trigger hurt.

Recovery lasts **3 to 5 seconds**, proportional to how much the wrong action exceeded the required power. The exact severity is `clamp((power - requiredPower) / (1 - requiredPower), 0, 1)` and duration is `round(3000 + 2000 * severity)` milliseconds. The same target remains. The round clock continues during recovery, making lost time the additional penalty. Opening Sensor Lab pauses the game and recovery together.

The hurt expression replaces both eye whites and pupils, both brows, and the mouth with the five supplied `face hurt` features. A recovery countdown and progress bar replace action feedback. Neither keyboard nor sensor actions score or count as attempts during recovery. Enter, mode changes and zero resets cannot skip it. Both input paths are cancelled on entry and exit; use a fresh key press or let the sensors settle before the next action. Normal facial parts return on recovery completion, round end and restart.

The existing asset exporter also processes `../face hurt/*.png`. These files use a 2732 by 2048 canvas and screen-side names. It crops only transparent margins, preserves the native feature proportions, and aligns each cutout to the corresponding v002 normal feature’s alpha center on the shared 2048 pixel canvas before resizing to 1024. It does not squeeze the wider source canvas into a square. The original sources remain untouched.

## Authored burst animations

Successful pops use the hand-drawn sequences in `../Pimple_Burst_Animations_v001_20260923`. Pimple IDs 1, 2, 3, 5 and 6 each use their matching nine frames in numerical order at the supplied 12 fps, once per pop (0.75 seconds). The source deliberately omits Pimple 4 because its content did not change across frames; blackheads disappear briefly with a simple POP label, without borrowing another design’s animation. The previous generic confetti effect has been removed.

The existing exporter writes one lossless WebP atlas and Phaser frame metadata per sequence. It preserves each group’s rectangular frame size, transparency and common frame alignment. A fixed pivot at the first frame’s emission point keeps the spray attached to the treated spot as it grows. The animation scales uniformly from the matching pimple’s original pixel scale, with a small strength adjustment, and is parented to the face so it follows the hit reaction.

Each simultaneous pop owns its own effect. The popped spot stays hidden while its burst plays, then shows its next scheduled design. A newly active target is never hidden by an older effect at the same position. Failed, weak and hurt actions never create a success burst. Animation completion removes the effect; hurt, round end, restart and scene shutdown clear any remaining effects. The original animation images and import information are preserved.
