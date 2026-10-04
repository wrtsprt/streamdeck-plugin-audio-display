// Frame-rate benchmark for driving the Stream Deck XL directly over HID.
// The Elgato Stream Deck app must be quit first: it holds the device.
//
// Usage: node bench/hid-bench.js [secondsPerScenario]

import { listStreamDecks, openStreamDeck } from '@elgato-stream-deck/node'

const SECONDS = Number(process.argv[2] ?? 5)
const KEY = 96

// Renders 8 animated bars, one per column, into an RGB buffer of the given size.
function renderBars(width, height, t) {
	const buf = Buffer.alloc(width * height * 3)
	const colWidth = width / 8
	for (let col = 0; col < 8; col++) {
		const level = 0.5 + 0.5 * Math.sin(t * (1.3 + col * 0.37) + col)
		const top = Math.round(height * (1 - level))
		const x0 = Math.round(col * colWidth + colWidth * 0.15)
		const x1 = Math.round((col + 1) * colWidth - colWidth * 0.15)
		for (let y = top; y < height; y++) {
			const frac = 1 - y / height // 0 bottom .. 1 top: green -> red
			const r = Math.round(255 * Math.min(1, frac * 2))
			const g = Math.round(255 * Math.min(1, (1 - frac) * 2))
			for (let x = x0; x < x1; x++) {
				const i = (y * width + x) * 3
				buf[i] = r
				buf[i + 1] = g
				buf[i + 2] = 40
			}
		}
	}
	return buf
}

// Cuts the panel buffer into one RGB buffer per key (row-major key order).
function sliceKeys(panel, cols, rows) {
	const width = cols * KEY
	const keys = []
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const key = Buffer.alloc(KEY * KEY * 3)
			for (let y = 0; y < KEY; y++) {
				const src = ((row * KEY + y) * width + col * KEY) * 3
				panel.copy(key, y * KEY * 3, src, src + KEY * 3)
			}
			keys.push(key)
		}
	}
	return keys
}

async function runFor(name, frameFn) {
	const end = performance.now() + SECONDS * 1000
	let frames = 0
	let keysSent = 0
	const start = performance.now()
	while (performance.now() < end) {
		keysSent += await frameFn(frames)
		frames++
	}
	const elapsed = (performance.now() - start) / 1000
	const fps = frames / elapsed
	console.log(
		`${name.padEnd(42)} ${fps.toFixed(1).padStart(6)} fps  ` +
			`${(keysSent / elapsed).toFixed(0).padStart(5)} key-writes/s  ` +
			`${((elapsed * 1000) / frames).toFixed(1).padStart(6)} ms/frame`,
	)
}

const devices = await listStreamDecks()
if (devices.length === 0) {
	console.error('No Stream Deck found. Is the Elgato app still running?')
	process.exit(1)
}
const deck = await openStreamDeck(devices[0].path)
const buttons = deck.CONTROLS.filter((c) => c.type === 'button')
const cols = Math.max(...buttons.map((b) => b.column)) + 1
const rows = Math.max(...buttons.map((b) => b.row)) + 1
console.log(`${deck.PRODUCT_NAME}: ${cols}x${rows} keys, ${SECONDS}s per scenario\n`)

const W = cols * KEY
const H = rows * KEY
const keyIndexAt = (i) => buttons.find((b) => b.row === Math.floor(i / cols) && b.column === i % cols).index

// 1. Library path: render + JPEG-encode 32 keys + write, every frame.
await runFor('fillPanelBuffer (render+encode+write)', async (f) => {
	await deck.fillPanelBuffer(renderBars(W, H, f / 30), { format: 'rgb' })
	return cols * rows
})

// 2. Same, but only write keys whose pixels changed since the last frame.
let last = []
await runFor('changed keys only (render+encode+write)', async (f) => {
	const keys = sliceKeys(renderBars(W, H, f / 30), cols, rows)
	const writes = []
	keys.forEach((k, i) => {
		if (!last[i] || !last[i].equals(k)) writes.push(deck.fillKeyBuffer(keyIndexAt(i), k, { format: 'rgb' }))
	})
	last = keys
	await Promise.all(writes)
	return writes.length
})

// 3. Pure USB transfer: pre-encode a loop of frames, then just send them.
const LOOP = 30
const prepared = []
for (let f = 0; f < LOOP; f++) {
	prepared.push(await deck.prepareFillPanelBuffer(renderBars(W, H, f / 5), { format: 'rgb' }))
}
await runFor('pre-encoded panel (write only)', async (f) => {
	await deck.sendPreparedBuffer(prepared[f % LOOP])
	return cols * rows
})

// 4. Encode cost alone, no device I/O.
await runFor('encode only (no write)', async (f) => {
	await deck.prepareFillPanelBuffer(renderBars(W, H, f / 30), { format: 'rgb' })
	return 0
})

await deck.clearPanel()
await deck.close()
