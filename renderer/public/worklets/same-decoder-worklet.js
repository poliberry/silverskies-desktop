// Runs on the audio rendering thread — slices the incoming stream into
// SAME-baud-aligned windows (sampleRate / 520.83 samples each) and posts
// each one back to the main thread, where lib/weather-radio/same-decoder.ts's
// SameDecoder actually does the Goertzel tone detection + byte/header
// framing. Kept deliberately thin: worklets load as raw, unbundled script
// text (via audioWorklet.addModule), so there's no TypeScript/bundler step
// for this file — the real decoding logic lives in the one TS module
// instead of being duplicated here.
class SameDecoderWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.baudSamples = Math.round(sampleRate / 520.83);
    this.buffer = new Float32Array(this.baudSamples);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];
      if (this.bufferIndex >= this.baudSamples) {
        this.port.postMessage({ samples: this.buffer.slice(0), sampleRate });
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("same-decoder-worklet", SameDecoderWorkletProcessor);
