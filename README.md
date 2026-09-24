# Pimple Studio

Pimple Pop is a Phaser and TypeScript arcade game for a soft ball with two USB IMU sensors. Smack its top to punch a whitehead, or squeeze it to pop a deep pimple. Acceleration peaks determine action strength, scoring, and animation. Pointer or Enter starts a round; keyboard controls are available only through the explicit Keyboard test mode in Sensor Lab.

Start the local game from `pimple-pop` with `npm install` and `npm run dev`. Open the address printed by Vite. The local server owns both USB ports and sends every sampled frame to the browser. The game and sensor lab share calibration and connection state.

See [game setup and verification](pimple-pop/README.md), [sensor processing and gesture rules](pimple-pop/INPUT.md), and [Arduino firmware](yoga_ball_controller_TEST_VER/yoga_ball_controller_TEST_VER.ino). The lab retains three diagrams, per sensor and combined zero reset, raw and processed values, dead zone adjustment, and gesture tuning. Classification thresholds are starting values that still need physical player trials.
