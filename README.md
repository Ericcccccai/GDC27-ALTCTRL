# Pimple Studio

A small Phaser + TypeScript arcade prototype for a soft pimple shaped controller. The game automatically selects a target. The player reads it, charges an action, and releases to pop it.

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

## Controls

| Input | Action |
| :--- | :--- |
| Up arrow | Hold to charge a punch; release to fire |
| Left or Right arrow | Hold to charge a squeeze; release to fire |
| Enter | Start or restart |
| Fullscreen button | Toggle fullscreen |
| Connect controller | Choose a serial device in a supported browser |

The arrow keys do not move a cursor. Either side arrow performs squeeze. Holding both side arrows counts as a single gesture, completed when the last is released. Charging reaches full strength after 1.2 seconds. Repeated keydown events do not produce repeated hits. Losing focus cancels a held action.

## Prototype assumptions

A round lasts 45 seconds after a countdown. Whiteheads require punch; deep pimples require squeeze. Read the highlighted target and charge indicator before releasing. Correct actions build score and combo. Strength affects the action result and its visual feedback.

The supplied artwork in `../Sprites` is preserved. Game assets are derived copies under `public/assets`. Facial layers retain their shared canvas alignment.

The exhibition controller is a soft pimple shaped yoga ball with one IMU on each side. This prototype consumes classified actions, not raw accelerometer or gyroscope samples. Actual punch versus squeeze classification, strength normalization, calibration, noise rejection, and testing across players remain hardware work.

## Hardware interface

See [INPUT.md](INPUT.md) for the exact parser and serial lifecycle contract. At 115200 baud, send one classified action per newline:

```text
PUNCH,0.83
SQUEEZE,0.71
```

Strength is normalized from 0 to 1. Keyboard and serial input deliver the same typed action to gameplay. Connecting requires an explicit device choice in a supported browser. No physical controller was connected during software verification.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

`tests/input.test.ts` covers input and parser behavior. `tests/game.test.ts` covers the round rules. `npm run test:browser` uses an installed Google Chrome and starts the local server if needed. It checks the rendered game, real keyboard holds, score changes, a full timed round, and restart. Screenshots are written to `test-results`.

Verified on September 8, 2026: 14 unit tests, both Chrome browser tests, strict type checking, and the production build pass. Browser checks include a complete 45 second round, results, restart, repeat suppression, overlapping squeeze keys, blur cancellation, fullscreen entry and exit, and 960 × 600 scaling. Ready, charging, playing, results, and small display screenshots were inspected. The build reports the expected large Phaser bundle warning; it completes successfully. This verification covers the local desktop browser, not exhibition hardware or firmware.

## File responsibilities

| File | Purpose |
| :--- | :--- |
| `src/main.ts` | Phaser initialization and display sizing |
| `src/GameScene.ts` | Artwork, game screens, animation, and input integration |
| `src/game.ts` | Game rules independent of rendering |
| `src/input.ts` | Keyboard gestures, serial parser, and optional Web Serial connection |

## Official references

[Phaser Scale Manager](https://docs.phaser.io/phaser/concepts/scale-manager) documents aspect preserving FIT scaling and fullscreen behavior. [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial) documents device selection, stream reading, and closing a port. This is a browser prototype; it does not include a desktop wrapper or Arduino firmware.
