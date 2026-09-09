# Input module

**Keyboard**

`KeyboardInput(window, onAction)` emits `{ kind, strength, source: 'keyboard' }` on release. Up charges `punch`; Left or Right charges `squeeze`. Strength is elapsed hold time divided by 1200 milliseconds, clamped to 0 through 1. A quick tap can have zero strength. `getCharge()` returns `{ kind, strength }` while charging, otherwise `null`.

Left and Right share one gesture: releasing the last held squeeze key fires it. The first action wins a conflict. Other action keys are ignored until all tracked keys are released; they never become a deferred action. Key repeat does not restart charging. Blur, document hiding, and `reset()` cancel without emitting. `destroy()` cancels and removes listeners. Arrow keys prevent page scrolling while this instance is attached.

**Serial protocol**

`SerialLineParser.push(chunk)` returns complete action events with `source: 'serial'`. `reset()` discards any unfinished record. Example device output:

```text
PUNCH,0.83
SQUEEZE,0.71
```

Terminate every record with LF; CRLF is also accepted. Commands are uppercase. Strength must be `0`, `1`, or a decimal with an integer part and at least one fractional digit, within 0 through 1. Spaces, signs, exponent notation, extra fields, and malformed records are rejected. A record may contain at most 64 characters before LF, including an optional CR. Oversized records are discarded through the next LF. Partial records survive chunk boundaries; incomplete data is never emitted. Stored unfinished record data is bounded to 64 characters. Returned events scale with the number of valid records in the supplied chunk.

**Browser connection**

`SerialInput(onAction)` provides `static isSupported(): boolean`, `connect(): Promise<void>`, `disconnect(): Promise<void>`, and assignable `onStatus: (status: string) => void`. Call `connect()` from a user click and handle its rejection if the chooser is cancelled or opening fails. The device opens at 115200 baud. This is an optional browser capability requiring a secure context and browser support; keyboard input works independently. `onStatus` supplies display text; callbacks should not throw.

Repeated connect calls share the pending connection. Disconnect cancels a pending read, waits for its lock to be released, then closes the port. Disconnect during the chooser waits for the user to finish that browser dialog, which the application cannot dismiss. Read errors close the connection and report a status; reconnect explicitly. Disconnect clears partial records. The implementation follows the stream cleanup order in [Chrome's official Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial).

**Physical sensor responsibility**

This module consumes classified action records. It does not read raw IMU samples or implement a dual IMU classifier. Real hardware integration must provide sensor alignment, baseline and range calibration, noise filtering, synchronization between the two sensors, gesture segmentation, punch versus squeeze classification, normalized strength, and repeat suppression in firmware or an upstream application. Validate those choices on the actual hardware before treating serial events as physical gestures. No physical hardware behavior has been verified by these software tests.
