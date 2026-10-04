# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Feasibility spike: can a Stream Deck XL act as a low-res display?
First target is a live spectrum-analyser bar chart of whatever audio is playing on the Mac.
No lint or tests yet.

## Commands

- `npm run build` bundles `src/plugin.js` into `com.wrtsprt.audio-display.sdPlugin/bin/plugin.js` with esbuild.
  The `createRequire` banner is required: without it the CommonJS `ws` dependency crashes the ESM bundle.
- `npx streamdeck restart com.wrtsprt.audio-display` reloads the plugin after a build.
  The plugin is symlinked into the app's Plugins folder via `npx streamdeck link`.
- Plugin logs go to `com.wrtsprt.audio-display.sdPlugin/logs/`.
  App-side errors such as crash loops and "plugin disabled" go to `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`.
- `npm run bench:hid` runs the direct-HID frame-rate benchmark. Quit the Elgato app first.
- `python3 bench/make-profile.py` writes an "Audio Display" profile with the action on all 32 keys.
  Run it only while the app is quit. It finds the XL from existing profiles; pass a device UUID if there are several.

## Hardware facts (verified on this machine)

- A Stream Deck XL is connected over USB. The Elgato Stream Deck app is installed and normally running.
- XL layout: 8 columns × 4 rows of 96×96 px keys, about 768×384 px total.
  The physical gaps between keys mean it's not one continuous surface.
- Host: macOS 27, Node 25 via Homebrew, Command Line Tools only (no full Xcode).

## The two architectural paths

The whole design hinges on which path drives the keys. Keep them separate. Don't mix their assumptions.

1. **Official plugin (`@elgato/streamdeck` SDK, `.sdPlugin` bundle).**
   The app owns the device. The plugin sends `setImage` per key over the app's WebSocket.
   Each of the 32 keys must hold an instance of the plugin's action.
   Frame rate is capped by the app's per-key image pipeline. Measure it; don't assume a number.
2. **Direct HID (`@elgato-stream-deck/node`).**
   The script writes JPEG key images straight to the device.
   That's faster and lets you paint the full panel, but the Elgato app must be quit first because it holds the device.

## Benchmark findings (2026-10-02)

- **Plugin route works.** 32 bars (4 per key) at 20 and 30 fps look smooth on the device.
  At 30 fps that's about 800 `setImage` calls per second.
- **Direct HID caps at about 1000 key writes per second.** That's 25–31 fps for full-panel redraws.
  JPEG encoding is negligible.
- **Only send keys that changed.** Fewer images means less work for the app and the USB link.
- **Use hex colours in SVG key images.** The app's renderer drew nothing for `hsl()` fills.
  Switching to hex fixed it.

## Audio source

macOS has no built-in loopback. Live system audio needs one of these:
- a Core Audio process tap (macOS 14.2+), via a small Swift helper
- ScreenCaptureKit audio capture
- a virtual device such as BlackHole (not installed here)

Spotify's Web API audio-analysis endpoint is unavailable to new apps, so it's not an option.
The FFT → band → bar rendering logic is pure and should be unit-tested independently of capture and device output.
