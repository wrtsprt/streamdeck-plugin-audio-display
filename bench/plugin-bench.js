// Frame-rate benchmark through the official Stream Deck SDK.
// Every key on the deck holds one "Display Pixel" action; the plugin draws one
// tile of an animated 8-bar chart on each. The benchmark starts once all keys
// have appeared, and again on any key press.
//
// setImage() resolves when the image is handed to the app, not when the device
// shows it, so the logged rate is an upper bound. The on-device frame counter
// (top-left key) shows what actually gets displayed.

import streamDeck, { SingletonAction } from '@elgato/streamdeck'

const COLS = 8
const ROWS = 4
const KEY = 144 // SDK images are 144x144 for @2x devices; the app scales them.
const SECONDS = 10
const TARGETS = [20, 30]

// Hex, not hsl(): the app's SVG renderer ignores hsl() fills.
const ROW_COLORS = ['#ff3030', '#ff9900', '#ffe000', '#30e040'] // top to bottom

const log = streamDeck.logger

const BARS_PER_KEY = 4
const SLOT = KEY / BARS_PER_KEY
const GAP = 6

// One SVG tile for the key at (col, row), showing its slice of BARS_PER_KEY bars.
function tileSvg(col, row, t, frame, targetFps) {
	const panelH = ROWS * KEY
	let bars = ''
	for (let i = 0; i < BARS_PER_KEY; i++) {
		const bar = col * BARS_PER_KEY + i
		const level = 0.5 + 0.5 * Math.sin(t * (1.1 + bar * 0.13) + bar * 0.7)
		const barTop = panelH * (1 - level) - row * KEY // in tile coordinates
		const y = Math.max(0, Math.min(KEY, barTop))
		const h = KEY - y
		if (h > 0) {
			bars += `<rect x="${i * SLOT + GAP / 2}" y="${y}" width="${SLOT - GAP}" height="${h}" fill="${ROW_COLORS[row]}"/>`
		}
	}
	const label =
		col === 0 && row === 0
			? `<text x="8" y="40" font-size="36" fill="#fff" font-family="Menlo">${targetFps}</text>` +
				`<text x="8" y="80" font-size="24" fill="#aaa" font-family="Menlo">${frame}</text>`
			: ''
	return (
		'data:image/svg+xml;charset=utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${KEY}" height="${KEY}">` +
				`<rect width="${KEY}" height="${KEY}" fill="#000"/>` +
				bars +
				label +
				'</svg>',
		)
	)
}

class DisplayPixel extends SingletonAction {
	manifestId = 'com.wrtsprt.audio-display.pixel'
	running = false
	startTimer = undefined

	onWillAppear() {
		const keys = this.keys()
		if (keys.length === COLS * ROWS && !this.running) {
			clearTimeout(this.startTimer)
			this.startTimer = setTimeout(() => this.runAll(), 5000)
		}
	}

	onKeyDown() {
		if (!this.running) this.runAll()
	}

	keys() {
		return [...this.actions].filter((a) => a.isKey() && a.coordinates)
	}

	async runAll() {
		this.running = true
		const keys = this.keys()
		log.info(`benchmark: ${keys.length} keys`)
		for (const target of TARGETS) {
			await this.run(keys, target)
		}
		for (const k of keys) await k.setImage()
		this.running = false
	}

	async run(keys, targetFps) {
		const interval = 1000 / targetFps
		const start = performance.now()
		const end = start + SECONDS * 1000
		let frames = 0
		let sendMs = 0
		let prev = new Map()
		let writes = 0
		while (performance.now() < end) {
			const frameStart = performance.now()
			const t = (frameStart - start) / 1000 // time-based, so motion speed is rate-independent
			// Only send tiles whose image changed, like a real renderer would.
			const sends = []
			for (const k of keys) {
				const { column, row } = k.coordinates
				const img = tileSvg(column, row, t * 3, frames, targetFps)
				if (prev.get(k.id) !== img) {
					prev.set(k.id, img)
					sends.push(k.setImage(img))
				}
			}
			await Promise.all(sends)
			writes += sends.length
			sendMs += performance.now() - frameStart
			frames++
			const wait = frameStart + interval - performance.now()
			await new Promise((r) => setTimeout(r, Math.max(0, wait)))
		}
		const elapsed = (performance.now() - start) / 1000
		log.info(
			`target ${targetFps || 'max'} fps: sent ${(frames / elapsed).toFixed(1)} fps, ` +
				`${(writes / elapsed).toFixed(0)} setImage/s, ${(sendMs / frames).toFixed(1)} ms send/frame`,
		)
	}
}

streamDeck.actions.registerAction(new DisplayPixel())
streamDeck.connect()
