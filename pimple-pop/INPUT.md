# Sensor input

## Raw USB protocol

The local Vite server opens right `/dev/cu.usbmodem21101` and left `/dev/cu.usbmodem21401` at 115200 baud. USB path determines physical side. A differing firmware label is reported on the card. Close other serial readers first. Do not run dev and preview servers together.

```text
IMU,L,42,123456,0.01000,-0.02000,1.00100,0.12000,-0.08000,0.03000
```

Fields are `IMU,side,sequence,time_us,ax,ay,az,gx,gy,gz`. Acceleration is g including gravity; gyro is degrees per second. The strict bounded parser accepts fragmented LF/CRLF records and ignores firmware comments. Malformed records are counted and rejected. Device clocks are independent; processing uses host receipt timestamps.

Every decoded frame is queued, including multiple frames in a serial chunk. `/api/sensors` emits `{ throughAt, links, samples, overflow }` every 50 ms. Each sample contains `{ side, at, frame }`. `links` contains latest connection diagnostics. A batch holds at most 512 frames; overflow cancels classification and recalibrates rather than trusting incomplete motion. Slow clients are disconnected. New subscribers receive connection state with no replayed action samples.

## Shared calibration and freshness

`SensorStore` owns one EventSource, two `SensorSignal` baselines, and one classifier per page. The game and lab share these objects. The first valid reading sets a fixed zero. Reset clears selected baselines immediately and only samples captured after reset can establish a new zero. There is no baseline drift correction during healthy streaming.

Stale data at one second, disconnects, and reconnects cancel pending gestures. A stale board is excluded, and returning boards establish a fresh baseline. Either board alone can detect either action. No live board means no input.

The diagrams show signed baseline changes smoothed over 150 ms, then a soft dead zone, default 0.06 g. The table exposes raw, zero, unfiltered change, and diagram output (Used). The game uses **unsmoothed** baseline changes: `max(0, abs(raw - zero) - deadZone)`. Diagnostic smoothing never feeds gesture detection.

## Gesture discrimination

1. Hold both active axes below 45% of their trigger thresholds for 180 ms to arm.
2. Either board crossing its X or Z trigger opens a 100 ms peak window shared by both boards. Defaults are 0.20 g after subtracting the dead zone.
3. Collect each axis’s maximum absolute evidence across both boards. Compare X peak / punch trigger against Z peak / squeeze trigger. Larger normalized evidence wins; exact ties select punch. The current game target is never consulted.
4. Normalize the winning peak by its full strength setting, default 3.00 g for punch and 1.20 g for squeeze, and clamp to 0 through 1. Correct action, sufficient strength, and existing combo rules determine scoring. Both sides of one impact produce one action.
5. Require a 300 ms cooldown and fresh quiet evidence before another gesture. Sustained movement cannot repeat actions. Delayed batches are processed in timestamp order so later peaks cannot change an earlier window’s winner. Windows close only after the server capture watermark passes their end; the browser timer cannot close a window while an in-window peak is still queued for the next packet.

Game input is enabled only during play. Opening the lab, hiding the document, losing focus, calibration changes, countdown, and results cancel pending input. Reenabling requires new quiet samples, and buffered samples from before the transition cannot rearm or score. Click or Enter starts and restarts rounds; arrows have no gameplay behavior unless Keyboard test mode is enabled.

The game displays the last detected action and strength, plus X and Z peaks. The lab displays the last **gameplay** gesture and tuning controls. Trigger settings determine when detection starts; full strength settings determine 100% pressure. Full strength must be at least its trigger. Changes cancel pending input.

## Physical limits and validation

X denotes inward/outward and Z denotes squeeze/release for the present mounting. These are acceleration changes, not measured force, displacement, or pressure. Tilt changes gravity and can produce gesture evidence. Trigger and full strength defaults are provisional until tested with real smacks and squeezes by players. Raw live streaming verification alone does not validate physical classification accuracy.

`tests/input.test.ts` exercises raw peaks between display updates, either board, simultaneous boards, sustained motion, quiet rearm, mixed axes, noise, strength clamping, calibration, stale input, reconnect, pause, delayed batches, and buffered transition samples. Browser tests feed mocked raw batches through EventSource into real scoring and test the live diagnostic view when `TEST_HARDWARE=1`.

### Adjusting power sensitivity

Open Sensor Lab and increase **Punch power sensitivity** if small smacks produce too much power. The number is the acceleration peak needed for 100% power, in g after zero and dead zone subtraction. Higher values mean less sensitivity. **Squeeze power sensitivity** works independently. Defaults are 3.00 g for punch and 1.20 g for squeeze; both detection thresholds remain 0.20 g. These are provisional tuning values, not measured physical force.

Power is `min(1, winningPeak / configured100PercentPeak)`. For example, a 0.90 g corrected punch peak now yields 30% at the 3.00 g default, compared with 75% at the previous 1.20 g scale. A 6.00 g setting reduces it to 15%. Detection thresholds decide whether motion starts a gesture; power sensitivity changes how strongly it scores. Valid values span 0.05 through 8 g, with the 100% value at least its detection threshold. Changes cancel pending gestures and apply to the next gesture after quiet rearming. Saved values remain local to this browser; zero baselines are never restored from storage.

## Keyboard test mode

Open **Sensor Lab**, enable **Keyboard test mode**, then choose **Back to game**. Click or press Enter to start. This switch is for testing and defaults off on every reload; sensor sensitivity settings still persist separately.

Hold **Up arrow** to charge a punch, or **Left / Right arrow** to charge a squeeze. Release to act. Charge rises linearly from 0% to 100% over 1.2 seconds. The meter and prompts switch to keyboard instructions, and the game displays **KEYBOARD TEST MODE**. Holding both squeeze arrows produces one action when the last is released. Auto-repeat is ignored, and the first gesture wins when conflicting keys overlap until all are released.

Sensor gameplay is disabled while testing, but live diagnostics continue. Opening the lab, switching modes, losing focus, hiding the page, countdown, results, and restart cancel held input. Returning to sensor play requires fresh quiet readings before detection can rearm. Turn the switch off or reload to return to physical play. Missing sensors never enable keyboard testing automatically.
