import { test } from 'node:test'
import assert from 'node:assert/strict'
import { magnitudes, bandEdges, bandLevels, Smoother } from '../src/spectrum.js'

const RATE = 48000
const SIZE = 2048

function sine(freq, amplitude = 1, size = SIZE) {
	return Float32Array.from({ length: size }, (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / RATE))
}

const argmax = (xs) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0)

test('magnitudes peaks at the bin of a pure sine', () => {
	const bin = 100
	const mags = magnitudes(sine((bin * RATE) / SIZE))
	assert.equal(mags.length, SIZE / 2)
	assert.equal(argmax(mags), bin)
})

test('magnitudes of a full-scale sine is about 1 at its bin', () => {
	const mags = magnitudes(sine((100 * RATE) / SIZE))
	assert.ok(Math.abs(mags[100] - 1) < 0.05, `got ${mags[100]}`)
})

test('magnitudes of silence is all zero', () => {
	const mags = magnitudes(new Float32Array(SIZE))
	assert.deepEqual([...new Set(mags)], [0])
})

test('bandEdges returns one more edge than bands, rising strictly', () => {
	const edges = bandEdges(32, SIZE, RATE)
	assert.equal(edges.length, 33)
	for (let i = 1; i < edges.length; i++) {
		assert.ok(edges[i] > edges[i - 1], `edge ${i}: ${edges[i]} <= ${edges[i - 1]}`)
	}
})

test('bandEdges spans 40 Hz to 16 kHz', () => {
	const edges = bandEdges(32, SIZE, RATE)
	const hz = (bin) => (bin * RATE) / SIZE
	assert.ok(Math.abs(hz(edges[0]) - 40) <= RATE / SIZE, `low edge ${hz(edges[0])} Hz`)
	assert.ok(Math.abs(hz(edges[32]) - 16000) <= RATE / SIZE, `high edge ${hz(edges[32])} Hz`)
})

test('bandEdges is log-spaced: high bands are wider than low bands', () => {
	const edges = bandEdges(32, SIZE, RATE)
	assert.ok(edges[32] - edges[31] > 5 * (edges[1] - edges[0]))
})

test('bandLevels lights the band holding a 1 kHz tone', () => {
	const edges = bandEdges(32, SIZE, RATE)
	const levels = bandLevels(magnitudes(sine(1000)), edges)
	const bin = (1000 * SIZE) / RATE
	const expected = edges.findIndex((e, i) => bin >= e && bin < edges[i + 1])
	assert.equal(argmax(levels), expected)
})

test('bandLevels of silence is all zero', () => {
	const levels = bandLevels(new Float32Array(SIZE / 2), bandEdges(32, SIZE, RATE))
	assert.deepEqual([...levels], new Array(32).fill(0))
})

test('bandLevels stays within 0..1 for a full-scale tone', () => {
	const levels = bandLevels(magnitudes(sine(1000)), bandEdges(32, SIZE, RATE))
	for (const [i, l] of levels.entries()) assert.ok(l >= 0 && l <= 1, `band ${i}: ${l}`)
	assert.ok(Math.max(...levels) > 0.9, `peak ${Math.max(...levels)}`)
})

test('bandLevels maps a -40 dB tone to about half height on a 0..-70 dB scale', () => {
	const levels = bandLevels(magnitudes(sine(1000, 0.01)), bandEdges(32, SIZE, RATE))
	const peak = Math.max(...levels)
	assert.ok(Math.abs(peak - 30 / 70) < 0.05, `peak ${peak}`)
})

test('Smoother rises to a new peak immediately', () => {
	const s = new Smoother(2, 1.5)
	assert.deepEqual(s.update([0.8, 0], 0.03), [0.8, 0])
})

test('Smoother falls at most the decay rate per second', () => {
	const s = new Smoother(1, 1.5)
	s.update([0.9], 0.03)
	const [after] = s.update([0], 0.2)
	assert.ok(Math.abs(after - (0.9 - 0.3)) < 1e-9, `got ${after}`)
})

test('Smoother never falls below zero', () => {
	const s = new Smoother(1, 1.5)
	s.update([0.1], 0.03)
	assert.deepEqual(s.update([0], 1), [0])
})
