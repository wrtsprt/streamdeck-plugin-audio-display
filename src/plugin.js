// Live spectrum analyser across all 32 keys of a Stream Deck XL.
// Every key holds one "Display Pixel" action. Once all of them have appeared,
// the plugin starts bin/audio-tap (system audio, mono float32 on stdout) and
// redraws 32 bars, four per key column, at FPS.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import streamDeck, { SingletonAction } from '@elgato/streamdeck'
import { magnitudes, bandEdges, bandLevels, Smoother } from './spectrum.js'

const COLS = 8
const ROWS = 4
const KEY = 144 // SDK images are 144x144 for @2x devices; the app scales them.
const BARS_PER_KEY = 4
const BARS = COLS * BARS_PER_KEY
const FPS = 30
const FFT_SIZE = 2048
const FLOOR_DB = -60
const DECAY_PER_SECOND = 1.5
const SLOT = KEY / BARS_PER_KEY
const GAP = 6
// Hex, not hsl(): the app's SVG renderer ignores hsl() fills.
const ROW_COLORS = ['#ff3030', '#ff9900', '#ffe000', '#30e040'] // top to bottom
const TAP_PATH = fileURLToPath(new URL('./audio-tap', import.meta.url))

const log = streamDeck.logger

// One SVG tile for the key at (col, row): its slice of four bars.
function tileSvg(col, row, levels) {
	const panelH = ROWS * KEY
	let bars = ''
	for (let i = 0; i < BARS_PER_KEY; i++) {
		const barTop = panelH * (1 - levels[col * BARS_PER_KEY + i]) - row * KEY // in tile coordinates
		const y = Math.round(Math.max(0, Math.min(KEY, barTop)))
		if (y < KEY) {
			bars += `<rect x="${i * SLOT + GAP / 2}" y="${y}" width="${SLOT - GAP}" height="${KEY - y}" fill="${ROW_COLORS[row]}"/>`
		}
	}
	return (
		'data:image/svg+xml;charset=utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${KEY}" height="${KEY}">` +
				`<rect width="${KEY}" height="${KEY}" fill="#000"/>${bars}</svg>`,
		)
	)
}

class DisplayPixel extends SingletonAction {
	manifestId = 'com.wrtsprt.audio-display.pixel'
	tap = undefined
	timer = undefined
	samples = new Float32Array(FFT_SIZE) // most recent FFT_SIZE samples
	pending = Buffer.alloc(0) // stdout bytes not yet a whole float
	edges = undefined
	smoother = new Smoother(BARS, DECAY_PER_SECOND)
	sent = new Map() // key id -> last image, to skip unchanged keys
	silentFrames = 0

	onWillAppear() {
		if (this.keys().length === COLS * ROWS) this.start()
	}

	// Any key leaving (profile or page switch) breaks the picture, so stop until all 32 are back.
	onWillDisappear() {
		this.stop()
	}

	keys() {
		return [...this.actions].filter((a) => a.isKey() && a.coordinates)
	}

	start() {
		if (this.tap) return
		log.info(`starting ${TAP_PATH}`)
		this.tap = spawn(TAP_PATH, [], { stdio: ['ignore', 'pipe', 'pipe'] })
		this.tap.stderr.setEncoding('utf8')
		this.tap.stderr.on('data', (text) => {
			const rate = /rate=(\d+)/.exec(text)
			if (rate) this.edges = bandEdges(BARS, FFT_SIZE, Number(rate[1]))
			log.info(`audio-tap: ${text.trim()}`)
		})
		this.tap.stdout.on('data', (chunk) => this.push(chunk))
		this.tap.on('exit', (code, signal) => {
			log.warn(`audio-tap exited (code ${code}, signal ${signal})`)
			this.tap = undefined
		})
		let last = performance.now()
		this.timer = setInterval(() => {
			const now = performance.now()
			this.draw((now - last) / 1000)
			last = now
		}, 1000 / FPS)
	}

	stop() {
		clearInterval(this.timer)
		this.timer = undefined
		this.tap?.kill()
		this.tap = undefined
		this.sent.clear()
	}

	// Appends stdout bytes to the rolling sample window.
	push(chunk) {
		const bytes = Buffer.concat([this.pending, chunk])
		const whole = bytes.length - (bytes.length % 4)
		this.pending = bytes.subarray(whole)
		const incoming = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + whole))
		if (incoming.length >= FFT_SIZE) {
			this.samples = incoming.slice(incoming.length - FFT_SIZE)
		} else {
			this.samples.copyWithin(0, incoming.length)
			this.samples.set(incoming, FFT_SIZE - incoming.length)
		}
	}

	draw(dt) {
		if (!this.edges) return
		const levels = this.smoother.update(bandLevels(magnitudes(this.samples), this.edges, FLOOR_DB), dt)
		this.warnIfSilent(levels)
		for (const key of this.keys()) {
			const { column, row } = key.coordinates
			const img = tileSvg(column, row, levels)
			if (this.sent.get(key.id) !== img) {
				this.sent.set(key.id, img)
				key.setImage(img).catch((e) => log.error(`setImage: ${e}`))
			}
		}
	}

	// A tap without system-audio permission delivers silence, not an error.
	warnIfSilent(levels) {
		this.silentFrames = levels.some((l) => l > 0) ? 0 : this.silentFrames + 1
		if (this.silentFrames === 5 * FPS) {
			log.warn('5 s of silence: is audio playing, and does Elgato Stream Deck have system audio permission?')
		}
	}
}

streamDeck.actions.registerAction(new DisplayPixel())
streamDeck.connect()
