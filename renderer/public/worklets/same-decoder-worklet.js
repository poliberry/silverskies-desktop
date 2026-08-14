// Runs on the audio rendering thread — slices the incoming stream into
// SAME-baud-aligned windows (nominally sampleRate / 520.83 samples each) and
// posts each one back to the main thread, where
// lib/weather-radio/same-decoder.ts's SameDecoder actually does the
// Goertzel tone detection + byte/header framing. Kept deliberately thin:
// worklets load as raw, unbundled script text (via audioWorklet.addModule),
// so there's no TypeScript/bundler step for this file — the real decoding
// logic lives in the one TS module instead of being duplicated here.
class SameDecoderWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate / 520.83 is never a whole number (e.g. ~92.16 samples at
    // 48kHz) — a fixed integer window size would systematically drift out
    // of phase with the real symbol clock (about one full symbol every
    // ~575 symbols at 48kHz), corrupting every bit read after that point.
    // A running fractional remainder, added back in as an occasional
    // one-sample-longer window, keeps the *average* window size exactly
    // right instead.
    this.exactSamplesPerBaud = sampleRate / 520.83;
    this.baseSamples = Math.floor(this.exactSamplesPerBaud);
    this.phaseError = 0;
    this.targetSamples = this.baseSamples;
    this.buffer = new Float32Array(this.baseSamples + 1);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];
      if (this.bufferIndex >= this.targetSamples) {
        this.port.postMessage({ samples: this.buffer.slice(0, this.targetSamples), sampleRate });
        this.bufferIndex = 0;
        this.phaseError += this.exactSamplesPerBaud - this.baseSamples;
        this.targetSamples = this.baseSamples;
        if (this.phaseError >= 1) {
          this.targetSamples += 1;
          this.phaseError -= 1;
        }
      }
    }
    return true;
  }
}

registerProcessor("same-decoder-worklet", SameDecoderWorkletProcessor);
