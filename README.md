# Stream Deck XL Audio Display

A proof of concept that turns a Stream Deck XL into a low-res display.
It draws a live spectrum analyser of whatever your Mac is playing across all 32 keys.

- 32 bars, four per key column, at 30 fps.
- System audio comes from a Core Audio process tap. No virtual audio device needed.
- Built as an official Stream Deck plugin, so the Elgato app keeps running.

> **Status: proof of concept.** It works end to end on a real XL with live system audio.
> The system-audio permission step is the fiddly part. See [Troubleshooting](#troubleshooting).

## How it works

```
system audio ──► bin/audio-tap (Swift) ──► stdout: mono float32 PCM
                                              │
                                              ▼
                bin/plugin.js (Node, Stream Deck SDK)
                FFT ─► 32 log-spaced bands ─► dB scale ─► peak smoothing
                                              │
                                              ▼
                     one SVG tile per key ─► setImage ─► Stream Deck app
```

- [`capture/audio-tap.swift`](capture/audio-tap.swift) creates a global process tap (macOS 14.2+).
  It reads the tap through a private aggregate device and writes mono samples to stdout.
- [`src/spectrum.js`](src/spectrum.js) holds the pure audio-to-bar logic: Hann-windowed FFT, log bands from 40 Hz to 16 kHz, a −60 dB floor, and peak-meter decay.
- [`src/plugin.js`](src/plugin.js) is the plugin.
  Every key holds one "Display Pixel" action.
  Once all 32 have appeared, it starts the tap and redraws at 30 fps.
  It only sends keys whose image changed.

## Requirements

- macOS 14.2 or later (Core Audio process taps)
- A Stream Deck XL (8 × 4 keys)
- [Elgato Stream Deck app](https://www.elgato.com/downloads) 7.1 or later
- Node.js 24 or later
- Xcode Command Line Tools for `swiftc`: `xcode-select --install`

## Installation

1. Clone and install dependencies.

   ```sh
   git clone <this repo>
   cd streamdeck-plugin-audio-display
   npm install
   ```

2. Build the plugin and the audio helper.

   ```sh
   npm run build       # bundles src/plugin.js into the .sdPlugin
   npm run build:tap   # compiles and ad-hoc signs bin/audio-tap
   ```

3. Link the plugin into the Stream Deck app.

   ```sh
   npx streamdeck link com.wrtsprt.audio-display.sdPlugin
   npx streamdeck restart com.wrtsprt.audio-display
   ```

4. Put the **Display Pixel** action on all 32 keys.
   You can drag it from the "Audio Display" category in the app onto each key.
   Or let the script build a profile for you:

   ```sh
   # Quit the Stream Deck app first. It only reads profiles at startup.
   python3 bench/make-profile.py
   ```

   Then reopen the app and switch the XL to the "Audio Display" profile.

5. Grant system-audio permission.
   macOS asks the first time the tap runs.
   If it doesn't, open System Settings → Privacy & Security → Screen & System Audio Recording.
   Under "System Audio Recording Only", enable **Elgato Stream Deck**.
   Restart the Stream Deck app afterwards.

6. Play some music. The bars should move.

### Check capture on its own

Run the helper directly to see whether it hears anything:

```sh
com.wrtsprt.audio-display.sdPlugin/bin/audio-tap --meter > /dev/null
```

It prints `rate=48000`, then an `rms=` level every second.
With music playing, rms should be above zero.
When you run it from a terminal, macOS attributes the permission to the terminal app, so grant it there.

## Troubleshooting

- **Bars stay flat.** The tap delivers silence, not an error, when permission is missing.
  The plugin logs `5 s of silence` when that happens.
  Check the permission in step 5, then restart the Stream Deck app.
- **Nothing draws at all.** The plugin waits until all 32 keys hold the action.
  Switching page or profile stops it until they're all back.
- **Logs.** Plugin logs go to `com.wrtsprt.audio-display.sdPlugin/logs/`.
  App-side errors go to `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`.

## Development

```sh
npm test                                          # unit tests for src/spectrum.js
npm run build && npx streamdeck restart com.wrtsprt.audio-display
```

### Benchmarks

The [`bench/`](bench) folder holds the frame-rate experiments behind the design.

- `bench/plugin-bench.js` drives animated bars through the SDK.
  At 30 fps that's about 800 `setImage` calls per second, and it looks smooth.
- `npm run bench:hid` writes JPEGs straight to the device over HID, bypassing the app.
  It tops out around 1000 key writes per second, or 25–31 fps for full-panel redraws.
  Quit the Stream Deck app first, since it holds the device.

One gotcha: use hex colours in SVG key images. The app's renderer draws nothing for `hsl()` fills.

## License

[MIT](LICENSE)
