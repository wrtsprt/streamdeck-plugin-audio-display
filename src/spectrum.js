// Pure audio → bar-height logic: windowed FFT, log-spaced bands, dB scaling, smoothing.

// Magnitude spectrum of a Hann-windowed block, first size/2 bins.
// Scaled so a full-scale sine centred on a bin reads 1.0 at that bin.
// samples.length must be a power of two.
export function magnitudes(samples) {
	const n = samples.length
	const re = new Float64Array(n)
	const im = new Float64Array(n)
	let windowSum = 0
	for (let i = 0; i < n; i++) {
		const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
		re[i] = samples[i] * w
		windowSum += w
	}
	fft(re, im)
	const out = new Float64Array(n / 2)
	for (let k = 0; k < n / 2; k++) out[k] = (2 * Math.hypot(re[k], im[k])) / windowSum
	return out
}

// In-place iterative radix-2 FFT.
function fft(re, im) {
	const n = re.length
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1
		for (; j & bit; bit >>= 1) j ^= bit
		j ^= bit
		if (i < j) {
			;[re[i], re[j]] = [re[j], re[i]]
			;[im[i], im[j]] = [im[j], im[i]]
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len
		for (let start = 0; start < n; start += len) {
			for (let k = 0; k < len / 2; k++) {
				const wr = Math.cos(angle * k)
				const wi = Math.sin(angle * k)
				const a = start + k
				const b = a + len / 2
				const tr = re[b] * wr - im[b] * wi
				const ti = re[b] * wi + im[b] * wr
				re[b] = re[a] - tr
				im[b] = im[a] - ti
				re[a] += tr
				im[a] += ti
			}
		}
	}
}

// FFT-bin edges of `count` log-spaced bands between lowHz and highHz.
// Band i covers bins [edges[i], edges[i + 1]). Low bands narrower than one bin
// are widened to one bin, so every band has at least one.
export function bandEdges(count, size, rate, lowHz = 40, highHz = 16000) {
	const edges = []
	for (let i = 0; i <= count; i++) {
		const hz = lowHz * (highHz / lowHz) ** (i / count)
		const bin = Math.round((hz * size) / rate)
		edges.push(i > 0 ? Math.max(bin, edges[i - 1] + 1) : bin)
	}
	return edges
}

// Bar height 0..1 per band: the loudest bin in the band, on a floorDb..0 dB scale.
export function bandLevels(mags, edges, floorDb = -70) {
	const levels = new Array(edges.length - 1)
	for (let b = 0; b < levels.length; b++) {
		let peak = 0
		for (let k = edges[b]; k < edges[b + 1]; k++) peak = Math.max(peak, mags[k])
		const db = 20 * Math.log10(peak)
		levels[b] = Math.min(1, Math.max(0, (db - floorDb) / -floorDb))
	}
	return levels
}

// Peak-meter ballistics: bars jump up instantly and fall at decayPerSecond.
export class Smoother {
	constructor(count, decayPerSecond) {
		this.values = new Array(count).fill(0)
		this.decay = decayPerSecond
	}

	update(levels, dtSeconds) {
		this.values = this.values.map((v, i) => Math.max(levels[i], v - this.decay * dtSeconds, 0))
		return this.values
	}
}
