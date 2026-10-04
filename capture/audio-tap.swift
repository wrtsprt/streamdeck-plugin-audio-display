// Captures everything the Mac is playing through a Core Audio process tap
// (macOS 14.2+) and writes it to stdout as mono little-endian float32 PCM.
//
// stderr gets one line `rate=<Hz>` at startup, then diagnostics.
// With --meter, it also prints the RMS level every second, to check capture
// without a consumer: `capture/audio-tap --meter > /dev/null`.
//
// Without system-audio recording permission, the tap delivers silence rather
// than an error, so a meter stuck at 0 usually means missing permission.

import AudioToolbox
import CoreAudio
import Foundation

let meter = CommandLine.arguments.contains("--meter")

func fail(_ what: String, _ status: OSStatus) -> Never {
	FileHandle.standardError.write("audio-tap: \(what) failed (OSStatus \(status))\n".data(using: .utf8)!)
	exit(1)
}

func getProperty<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: inout T) -> OSStatus {
	var address = AudioObjectPropertyAddress(
		mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
	var size = UInt32(MemoryLayout<T>.size)
	return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value)
}

// 1. A global stereo tap over all processes, left audible.
let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDescription.isPrivate = true
tapDescription.muteBehavior = .unmuted
var tapID = AudioObjectID(kAudioObjectUnknown)
var status = AudioHardwareCreateProcessTap(tapDescription, &tapID)
if status != noErr { fail("AudioHardwareCreateProcessTap", status) }

var format = AudioStreamBasicDescription()
status = getProperty(tapID, kAudioTapPropertyFormat, &format)
if status != noErr { fail("reading tap format", status) }

// 2. The tap is read through a private aggregate device clocked by the default output.
var outputID = AudioObjectID(kAudioObjectUnknown)
status = getProperty(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, &outputID)
if status != noErr { fail("reading default output device", status) }
var outputUID: CFString = "" as CFString
status = getProperty(outputID, kAudioDevicePropertyDeviceUID, &outputUID)
if status != noErr { fail("reading output device UID", status) }

let aggregate: [String: Any] = [
	kAudioAggregateDeviceNameKey: "Audio Display Tap",
	kAudioAggregateDeviceUIDKey: UUID().uuidString,
	kAudioAggregateDeviceMainSubDeviceKey: outputUID as String,
	kAudioAggregateDeviceIsPrivateKey: true,
	kAudioAggregateDeviceIsStackedKey: false,
	kAudioAggregateDeviceTapAutoStartKey: true,
	kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID as String]],
	kAudioAggregateDeviceTapListKey: [
		[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: tapDescription.uuid.uuidString]
	],
]
var aggregateID = AudioObjectID(kAudioObjectUnknown)
status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
if status != noErr { fail("AudioHardwareCreateAggregateDevice", status) }

func cleanUp() {
	AudioHardwareDestroyAggregateDevice(aggregateID)
	AudioHardwareDestroyProcessTap(tapID)
}

// 3. Downmix each callback's buffers to mono and write them out.
let channels = Int(format.mChannelsPerFrame)
let interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
let stdout = FileHandle.standardOutput
var sumSquares: Double = 0
var sampleCount = 0
let lock = NSLock()

var procID: AudioDeviceIOProcID?
let queue = DispatchQueue(label: "audio-tap")
status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { _, inputData, _, _, _ in
	let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
	guard let first = buffers.first, let firstData = first.mData else { return }
	let frames: Int
	var mono: [Float]
	if interleaved {
		frames = Int(first.mDataByteSize) / (MemoryLayout<Float>.size * channels)
		let samples = firstData.assumingMemoryBound(to: Float.self)
		mono = [Float](repeating: 0, count: frames)
		for f in 0..<frames {
			var sum: Float = 0
			for c in 0..<channels { sum += samples[f * channels + c] }
			mono[f] = sum / Float(channels)
		}
	} else {
		frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
		mono = [Float](repeating: 0, count: frames)
		for buffer in buffers {
			guard let data = buffer.mData else { continue }
			let samples = data.assumingMemoryBound(to: Float.self)
			for f in 0..<frames { mono[f] += samples[f] / Float(buffers.count) }
		}
	}
	if meter {
		lock.lock()
		for s in mono { sumSquares += Double(s * s) }
		sampleCount += frames
		lock.unlock()
	}
	mono.withUnsafeBytes { bytes in
		do { try stdout.write(contentsOf: Data(bytes)) } catch { cleanUp(); exit(0) } // consumer went away
	}
}
if status != noErr { fail("AudioDeviceCreateIOProcIDWithBlock", status) }

FileHandle.standardError.write("rate=\(Int(format.mSampleRate))\n".data(using: .utf8)!)

var signalSources: [DispatchSourceSignal] = [] // kept alive for the process lifetime
for sig in [SIGINT, SIGTERM, SIGPIPE] {
	signal(sig, SIG_IGN)
	let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
	source.setEventHandler { cleanUp(); exit(0) }
	source.resume()
	signalSources.append(source)
}

status = AudioDeviceStart(aggregateID, procID)
if status != noErr { cleanUp(); fail("AudioDeviceStart", status) }

if meter {
	Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
		lock.lock()
		let rms = sampleCount > 0 ? sqrt(sumSquares / Double(sampleCount)) : 0
		sumSquares = 0
		sampleCount = 0
		lock.unlock()
		FileHandle.standardError.write(String(format: "rms=%.4f\n", rms).data(using: .utf8)!)
	}
}

RunLoop.main.run()
