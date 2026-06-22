// Microphone capture for the audio plugin's STT. Captures raw PCM via the Web
// Audio API (not MediaRecorder, which emits WebM/Opus that whisper.cpp can't
// read) and encodes a 16 kHz mono 16-bit WAV — exactly what whisper-cli expects.
//
// The live `analyser` is exposed so the SoundWave component can paint a real-time
// waveform from the mic input while recording.

/** whisper.cpp models are trained on 16 kHz mono audio. */
const TARGET_SAMPLE_RATE = 16000;

/** Controller for one recording session. Construct, `start()`, then `stop()`. */
export class AudioRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = TARGET_SAMPLE_RATE;

  /** Live analyser for the waveform (null until `start()` resolves). */
  analyser: AnalyserNode | null = null;

  /** Begin capture. Rejects if mic permission is denied / unavailable. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    // Some webviews ignore a requested sampleRate, so record at the context's
    // actual rate and resample on stop.
    this.ctx = new AudioContext();
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);

    // ScriptProcessorNode is deprecated but reliably available in WebKitGTK; it
    // only fires while connected to a destination, so route it through a muted
    // gain node to avoid feeding the mic back to the speakers.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);
  }

  /** Stop capture and return a 16 kHz mono WAV as bytes. */
  async stop(): Promise<Uint8Array> {
    const samples = concat(this.chunks);
    const rate = this.sampleRate;
    this.teardown();
    const resampled = downsample(samples, rate, TARGET_SAMPLE_RATE);
    return encodeWav(resampled, TARGET_SAMPLE_RATE);
  }

  /** Abort without producing audio (e.g. user cancelled). */
  cancel(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Linear-interpolation downsample (no-op when rates match / target is higher). */
function downsample(
  samples: Float32Array,
  from: number,
  to: number,
): Float32Array {
  if (to >= from || samples.length === 0) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Encode mono Float32 PCM as a 16-bit little-endian WAV byte buffer. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Uint8Array(buffer);
}
